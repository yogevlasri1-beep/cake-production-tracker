-- Deploy as Supabase Edge Function: create-staff-user
-- Requires secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
-- Verifies caller JWT is an active manager/admin, then creates Auth user with email confirmed.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (!supabaseUrl || !anonKey || !serviceKey) {
      return json({ error: 'חסרים secrets לפונקציה' }, 500);
    }

    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return json({ error: 'נדרשת התחברות' }, 401);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user?.id) {
      return json({ error: 'session לא תקין' }, 401);
    }

    const { data: profile, error: profileErr } = await userClient
      .from('profiles')
      .select('role,status')
      .eq('id', userData.user.id)
      .maybeSingle();
    if (profileErr) return json({ error: profileErr.message }, 400);
    if (!profile || profile.status !== 'active' || !['manager', 'admin'].includes(profile.role)) {
      return json({ error: 'אין הרשאה ליצור חשבונות' }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const role = ['production', 'quality', 'manager', 'admin'].includes(body.role)
      ? body.role
      : 'production';
    const status = body.status === 'pending' ? 'pending' : 'active';
    const displayName = body.display_name ? String(body.display_name).trim() : null;
    const workspaceAccess = Array.isArray(body.workspace_access) ? body.workspace_access : null;

    if (!email || !password) return json({ error: 'יש למלא אימייל וסיסמה' }, 400);
    if (password.length < 6) return json({ error: 'הסיסמה חייבת להכיל לפחות 6 תווים' }, 400);
    if (email.includes('+')) {
      return json({ error: 'אימייל עם + לא נתמך — השתמש בכתובת רגילה' }, 400);
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { created_by: userData.user.email || userData.user.id },
    });
    if (createErr) {
      const msg = /already/i.test(createErr.message)
        ? 'האימייל כבר רשום במערכת'
        : createErr.message;
      return json({ error: msg }, 400);
    }

    const userId = created?.user?.id;
    if (!userId) return json({ error: 'יצירת המשתמש נכשלה' }, 500);

    // trigger may create pending/production — force desired fields
    const patch = {
      email,
      role,
      status,
      display_name: displayName,
      workspace_access: workspaceAccess,
      updated_at: new Date().toISOString(),
    };
    const { data: updated, error: updErr } = await admin
      .from('profiles')
      .update(patch)
      .eq('id', userId)
      .select('id,email,role,status,display_name,workspace_access')
      .maybeSingle();
    if (updErr) {
      return json({
        error: `המשתמש נוצר אך עדכון הפרופיל נכשל: ${updErr.message}`,
        userId,
      }, 500);
    }

    return json({
      ok: true,
      user: updated || { id: userId, email, role, status, display_name: displayName, workspace_access: workspaceAccess },
    });
  } catch (err) {
    return json({ error: err?.message || 'שגיאה בשרת' }, 500);
  }
});

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
