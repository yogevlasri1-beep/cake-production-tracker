import { escapeHtml, showToast } from '../utils.js?v=415';
import {
  getCurrentUserEmail,
  getStoredSession,
  userRoleLabel,
  userStatusLabel,
} from '../auth.js?v=415';
import {
  listAccountProfiles,
  updateAccountProfile,
  roleOptionsHtml,
} from '../accounts-api.js?v=415';

export const accountsMeta = {
  title: 'חשבונות',
  subtitle: 'אישור משתמשים והרשאות',
};

function statusBadge(status) {
  const label = userStatusLabel(status);
  const cls = status === 'active' ? 'ok' : status === 'rejected' ? 'danger' : 'warn';
  return `<span class="accounts-status accounts-status--${cls}">${escapeHtml(label)}</span>`;
}

function profileCard(p, selfId) {
  const isSelf = p.id === selfId;
  const email = p.email || '—';
  const name = p.display_name || '';
  return `
    <div class="card accounts-card" data-user-id="${escapeHtml(p.id)}">
      <div class="accounts-card-head">
        <div>
          <div class="card-title" style="margin-bottom:4px">${escapeHtml(email)}</div>
          ${name ? `<p class="form-hint" style="margin:0">${escapeHtml(name)}</p>` : ''}
          ${isSelf ? '<p class="form-hint" style="margin:4px 0 0">זה החשבון שלך</p>' : ''}
        </div>
        ${statusBadge(p.status || 'pending')}
      </div>
      <div class="form-group" style="margin-top:12px">
        <label>תפקיד / הרשאות</label>
        <select class="accounts-role" ${isSelf ? 'disabled title="לא ניתן לשנות את התפקיד של עצמך מכאן"' : ''}>
          ${roleOptionsHtml(p.role || 'production')}
        </select>
      </div>
      <div class="accounts-actions">
        ${p.status !== 'active' ? `<button type="button" class="btn btn-primary accounts-approve">אשר כניסה</button>` : ''}
        ${p.status !== 'rejected' && !isSelf ? `<button type="button" class="btn btn-secondary accounts-reject">דחה</button>` : ''}
        ${p.status === 'active' && !isSelf ? `<button type="button" class="btn btn-secondary accounts-save-role">שמור תפקיד</button>` : ''}
      </div>
    </div>`;
}

export async function renderAccounts(container) {
  container.innerHTML = `<div class="card"><p class="form-hint">טוען חשבונות...</p></div>`;
  const selfEmail = getCurrentUserEmail();
  const selfId = getStoredSession()?.user?.id || null;

  let profiles = [];
  try {
    profiles = await listAccountProfiles();
  } catch (err) {
    container.innerHTML = `
      <div class="card" style="border:2px solid var(--danger)">
        <div class="card-title">לא ניתן לטעון חשבונות</div>
        <p style="font-size:0.9rem;line-height:1.5">${escapeHtml(err.message || err)}</p>
        <p class="form-hint">הרץ ב-Supabase SQL את המיגרציה <code>20260805200000_accounts_approval.sql</code> ואז רענן.</p>
      </div>`;
    return;
  }

  const pending = profiles.filter((p) => p.status === 'pending');
  const active = profiles.filter((p) => p.status === 'active');
  const rejected = profiles.filter((p) => p.status === 'rejected');

  container.innerHTML = `
    <div class="card">
      <div class="card-title">ניהול חשבונות</div>
      <p class="form-hint" style="margin:0">מחובר כ: <strong>${escapeHtml(selfEmail || '—')}</strong></p>
      <p class="form-hint">משתמשים חדשים נרשמים בדף הכניסה וממתינים לאישור כאן. בחר תפקיד לפני אישור.</p>
      <p class="form-hint" style="margin:0">ממתינים: <strong>${pending.length}</strong> · פעילים: <strong>${active.length}</strong> · נדחו: <strong>${rejected.length}</strong></p>
    </div>
    ${pending.length ? `<h3 class="accounts-section-title">ממתינים לאישור</h3>${pending.map((p) => profileCard(p, selfId)).join('')}` : ''}
    <h3 class="accounts-section-title">פעילים</h3>
    ${active.length ? active.map((p) => profileCard(p, selfId)).join('') : '<div class="card"><p class="form-hint">אין חשבונות פעילים</p></div>'}
    ${rejected.length ? `<h3 class="accounts-section-title">נדחו</h3>${rejected.map((p) => profileCard(p, selfId)).join('')}` : ''}
  `;

  container.querySelectorAll('.accounts-card').forEach((card) => {
    const userId = card.dataset.userId;
    const roleSelect = card.querySelector('.accounts-role');

    card.querySelector('.accounts-approve')?.addEventListener('click', async () => {
      try {
        await updateAccountProfile(userId, { status: 'active', role: roleSelect.value });
        showToast('החשבון אושר');
        await renderAccounts(container);
      } catch (err) {
        showToast(err.message || 'שגיאה באישור');
      }
    });

    card.querySelector('.accounts-reject')?.addEventListener('click', async () => {
      if (!confirm('לדחות את החשבון? המשתמש לא יוכל להיכנס.')) return;
      try {
        await updateAccountProfile(userId, { status: 'rejected' });
        showToast('החשבון נדחה');
        await renderAccounts(container);
      } catch (err) {
        showToast(err.message || 'שגיאה בדחייה');
      }
    });

    card.querySelector('.accounts-save-role')?.addEventListener('click', async () => {
      try {
        await updateAccountProfile(userId, { role: roleSelect.value });
        showToast(`עודכן ל${userRoleLabel(roleSelect.value)}`);
        await renderAccounts(container);
      } catch (err) {
        showToast(err.message || 'שגיאה בעדכון');
      }
    });
  });
}
