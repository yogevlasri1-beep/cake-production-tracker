import { escapeHtml, showToast, formatDateTime } from '../utils.js?v=425';
import {
  getCurrentUserEmail,
  getStoredSession,
  userRoleLabel,
  userStatusLabel,
} from '../auth.js?v=425';
import {
  listAccountProfiles,
  updateAccountProfile,
  roleOptionsHtml,
} from '../accounts-api.js?v=425';
import {
  fetchAuditEvents,
  auditActionLabel,
  auditEntityLabel,
  formatAuditSnapshotSummary,
  auditKnownEntityTables,
} from '../audit.js?v=425';

const TAB_KEY = 'yitzurAccountsTab';
const TAB_SUBTITLES = {
  users: 'אישור משתמשים והרשאות',
  audit: 'יומן פעולות — HACCP, מלאי וחשבונות',
};

export function accountsMeta() {
  const tab = sessionStorage.getItem(TAB_KEY) || 'users';
  return {
    title: 'חשבונות',
    subtitle: TAB_SUBTITLES[tab] || TAB_SUBTITLES.users,
  };
}

function tabsHtml(active) {
  return `
    <div class="inventory-tabs" role="tablist">
      <button type="button" class="login-gate-tab ${active === 'users' ? 'active' : ''}" data-accounts-tab="users">משתמשים</button>
      <button type="button" class="login-gate-tab ${active === 'audit' ? 'active' : ''}" data-accounts-tab="audit">יומן ביקורת</button>
    </div>`;
}

function statusBadge(status) {
  const label = userStatusLabel(status);
  const cls = status === 'active' ? 'ok' : status === 'rejected' ? 'danger' : 'warn';
  return `<span class="accounts-status accounts-status--${cls}">${escapeHtml(label)}</span>`;
}

function actionBadge(action) {
  const cls = action === 'delete' ? 'danger' : action === 'create' ? 'ok' : 'warn';
  return `<span class="accounts-status accounts-status--${cls}">${escapeHtml(auditActionLabel(action))}</span>`;
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

function auditEventCard(ev) {
  const summary = formatAuditSnapshotSummary(ev.snapshot);
  return `
    <div class="card accounts-card audit-event-card">
      <div class="accounts-card-head">
        <div>
          <div class="card-title" style="margin-bottom:4px">${escapeHtml(auditEntityLabel(ev.entity_table))}</div>
          <p class="form-hint" style="margin:0">${escapeHtml(formatDateTime(ev.at))}</p>
          <p class="form-hint" style="margin:4px 0 0">
            ${escapeHtml(ev.user_email || 'משתמש לא ידוע')}
            ${ev.entity_id ? ` · מזהה: ${escapeHtml(String(ev.entity_id))}` : ''}
          </p>
          ${summary ? `<p class="form-hint" style="margin:4px 0 0">${escapeHtml(summary)}</p>` : ''}
        </div>
        ${actionBadge(ev.action)}
      </div>
    </div>`;
}

async function renderUsersTab(container) {
  const selfEmail = getCurrentUserEmail();
  const selfId = getStoredSession()?.user?.id || null;

  let profiles = [];
  try {
    profiles = await listAccountProfiles();
  } catch (err) {
    return `
      <div class="card" style="border:2px solid var(--danger)">
        <div class="card-title">לא ניתן לטעון חשבונות</div>
        <p style="font-size:0.9rem;line-height:1.5">${escapeHtml(err.message || err)}</p>
        <p class="form-hint">הרץ ב-Supabase SQL את המיגרציה <code>20260805200000_accounts_approval.sql</code> ואז רענן.</p>
      </div>`;
  }

  const pending = profiles.filter((p) => p.status === 'pending');
  const active = profiles.filter((p) => p.status === 'active');
  const rejected = profiles.filter((p) => p.status === 'rejected');

  return `
    <div class="card">
      <div class="card-title">ניהול חשבונות</div>
      <p class="form-hint" style="margin:0">מחובר כ: <strong>${escapeHtml(selfEmail || '—')}</strong>
        · תפקיד: <strong>${escapeHtml(userRoleLabel(getStoredSession()?.role))}</strong></p>
      <p class="form-hint">משתמשים חדשים נרשמים בדף הכניסה וממתינים לאישור כאן. בחר תפקיד לפני אישור.</p>
      <p class="form-hint" style="margin:0">ממתינים: <strong>${pending.length}</strong> · פעילים: <strong>${active.length}</strong> · נדחו: <strong>${rejected.length}</strong></p>
      <div class="accounts-actions" style="margin-top:10px">
        <button type="button" class="btn btn-secondary" id="accounts-refresh">רענון</button>
      </div>
    </div>
    ${pending.length ? `<h3 class="accounts-section-title">ממתינים לאישור</h3>${pending.map((p) => profileCard(p, selfId)).join('')}` : '<div class="card"><p class="form-hint">אין ממתינים כרגע. כשמישהו נרשם — הוא יופיע כאן.</p></div>'}
    <h3 class="accounts-section-title">פעילים</h3>
    ${active.length ? active.map((p) => profileCard(p, selfId)).join('') : '<div class="card"><p class="form-hint">אין חשבונות פעילים</p></div>'}
    ${rejected.length ? `<h3 class="accounts-section-title">נדחו</h3>${rejected.map((p) => profileCard(p, selfId)).join('')}` : ''}
  `;
}

async function renderAuditTab(container) {
  const action = container.dataset.auditAction || '';
  const entityTable = container.dataset.auditEntity || '';
  const search = container.dataset.auditSearch || '';

  const entityOpts = [
    '<option value="">כל הישויות</option>',
    ...auditKnownEntityTables().map((t) =>
      `<option value="${escapeHtml(t)}" ${entityTable === t ? 'selected' : ''}>${escapeHtml(auditEntityLabel(t))}</option>`),
  ].join('');

  let eventsHtml = '<div class="card"><p class="form-hint">טוען יומן...</p></div>';
  let events = [];
  let loadError = null;
  try {
    events = await fetchAuditEvents({ action, entityTable, search, limit: 120 });
  } catch (err) {
    loadError = err;
  }

  if (loadError) {
    eventsHtml = `
      <div class="card" style="border:2px solid var(--danger)">
        <div class="card-title">לא ניתן לטעון יומן ביקורת</div>
        <p style="font-size:0.9rem;line-height:1.5">${escapeHtml(loadError.message || loadError)}</p>
        <p class="form-hint">ודא שהמיגרציות <code>20260805120000_audit_log.sql</code>
          ו-<code>20260806180000_audit_log_manager_select.sql</code> רצו ב-Supabase.</p>
      </div>`;
  } else if (!events.length) {
    eventsHtml = `
      <div class="card">
        <p class="form-hint" style="margin:0">אין אירועים עדיין — פעולות ב-HACCP, התאמות מלאי, ואישור/דחיית חשבונות נרשמות כאן אוטומטית.</p>
      </div>`;
  } else {
    eventsHtml = events.map(auditEventCard).join('');
  }

  return `
    <div class="card">
      <div class="card-title">יומן ביקורת</div>
      <p class="form-hint">רישום פעולות create/update/delete מהענן — HACCP, התאמות מלאי, ואישורי חשבונות. נגיש למנהל ומנהל מערכת בלבד.</p>
      <div class="filter-row" style="flex-wrap:wrap;gap:8px;align-items:end">
        <div class="form-group" style="flex:1;min-width:140px;margin:0">
          <label for="audit-action">פעולה</label>
          <select id="audit-action">
            <option value="" ${!action ? 'selected' : ''}>הכל</option>
            <option value="create" ${action === 'create' ? 'selected' : ''}>יצירה</option>
            <option value="update" ${action === 'update' ? 'selected' : ''}>עדכון</option>
            <option value="delete" ${action === 'delete' ? 'selected' : ''}>מחיקה</option>
          </select>
        </div>
        <div class="form-group" style="flex:1;min-width:160px;margin:0">
          <label for="audit-entity">ישות</label>
          <select id="audit-entity">${entityOpts}</select>
        </div>
        <div class="form-group" style="flex:2;min-width:180px;margin:0">
          <label for="audit-search">חיפוש</label>
          <input type="search" id="audit-search" value="${escapeHtml(search)}" placeholder="אימייל / טבלה / מזהה">
        </div>
        <button type="button" class="btn btn-secondary" id="audit-apply">סנן</button>
        <button type="button" class="btn btn-secondary" id="audit-refresh">רענון</button>
      </div>
      ${!loadError ? `<p class="form-hint" style="margin:10px 0 0">${events.length} אירועים אחרונים</p>` : ''}
    </div>
    ${eventsHtml}
  `;
}

function wireUsersHandlers(container) {
  container.querySelector('#accounts-refresh')?.addEventListener('click', () => renderAccounts(container));

  container.querySelectorAll('.accounts-card').forEach((card) => {
    const userId = card.dataset.userId;
    if (!userId) return;
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

function wireAuditHandlers(container) {
  const apply = () => {
    container.dataset.auditAction = container.querySelector('#audit-action')?.value || '';
    container.dataset.auditEntity = container.querySelector('#audit-entity')?.value || '';
    container.dataset.auditSearch = container.querySelector('#audit-search')?.value || '';
    renderAccounts(container);
  };
  container.querySelector('#audit-apply')?.addEventListener('click', apply);
  container.querySelector('#audit-refresh')?.addEventListener('click', apply);
  container.querySelector('#audit-search')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') apply();
  });
}

export async function renderAccounts(container) {
  const tab = container.dataset.accountsTab || sessionStorage.getItem(TAB_KEY) || 'users';
  container.dataset.accountsTab = tab;
  sessionStorage.setItem(TAB_KEY, tab);

  container.innerHTML = `
    <div class="card" style="margin-bottom:12px">
      ${tabsHtml(tab)}
    </div>
    <div class="card"><p class="form-hint">טוען...</p></div>
  `;

  const body = tab === 'audit'
    ? await renderAuditTab(container)
    : await renderUsersTab(container);

  container.innerHTML = `
    <div class="card" style="margin-bottom:12px">
      ${tabsHtml(tab)}
    </div>
    ${body}
  `;

  container.querySelectorAll('[data-accounts-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      container.dataset.accountsTab = btn.dataset.accountsTab;
      sessionStorage.setItem(TAB_KEY, btn.dataset.accountsTab);
      renderAccounts(container);
    });
  });

  if (tab === 'audit') wireAuditHandlers(container);
  else wireUsersHandlers(container);
}
