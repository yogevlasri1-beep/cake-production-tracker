import { escapeHtml, showToast, formatDateTime } from '../utils.js?v=456';
import {
  getCurrentUserEmail,
  getStoredSession,
  userRoleLabel,
  userStatusLabel,
} from '../auth.js?v=456';
import {
  listAccountProfiles,
  updateAccountProfile,
  createAccountUser,
  approveAccountUser,
  confirmAccountEmail,
  roleOptionsHtml,
  effectiveWorkspaceAccess,
} from '../accounts-api.js?v=456';
import {
  MANAGEABLE_WORKSPACES,
  workspaceLabel,
  defaultWorkspacesForRole,
  sanitizeWorkspaceAccess,
} from '../permissions.js?v=456';
import {
  fetchAuditEvents,
  auditActionLabel,
  auditEntityLabel,
  formatAuditSnapshotSummary,
  auditKnownEntityTables,
} from '../audit.js?v=456';
import { openModal, closeModal } from '../modal.js?v=456';
import {
  getAppShareUrl,
  createAppQrDataUrl,
  downloadAppQrImage,
  copyTextToClipboard,
} from '../app-qr.js?v=456';
import { describeDownloadMethod } from '../download.js?v=456';

const TAB_KEY = 'yitzurAccountsTab';
const TAB_SUBTITLES = {
  users: 'יצירת חשבונות והרשאות עמדות',
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

function workspaceChecksHtml(selectedIds, { disabled = false, name = 'accounts-ws' } = {}) {
  const selected = new Set(selectedIds || []);
  return `
    <div class="accounts-ws-grid" role="group" aria-label="הרשאות עמדות">
      ${MANAGEABLE_WORKSPACES.map((id) => `
        <label class="accounts-ws-item">
          <input type="checkbox" class="${name}" value="${id}"
            ${selected.has(id) ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
          <span>${escapeHtml(workspaceLabel(id))}</span>
        </label>`).join('')}
    </div>`;
}

function readWorkspaceChecks(root, selector = '.accounts-ws') {
  return [...(root?.querySelectorAll(`${selector}:checked`) || [])].map((cb) => cb.value);
}

function setWorkspaceChecks(root, ids, selector = '.accounts-ws') {
  const set = new Set(ids || []);
  root?.querySelectorAll(selector).forEach((cb) => {
    cb.checked = set.has(cb.value);
  });
}

function profileCard(p, selfId) {
  const isSelf = p.id === selfId;
  const email = p.email || '—';
  const name = p.display_name || '';
  const role = p.role || 'production';
  const selectedWs = effectiveWorkspaceAccess(p);
  const custom = sanitizeWorkspaceAccess(p.workspace_access);
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
        <label>תפקיד (תבנית הרשאות)</label>
        <select class="accounts-role" ${isSelf ? 'disabled title="לא ניתן לשנות את התפקיד של עצמך מכאן"' : ''}>
          ${roleOptionsHtml(role)}
        </select>
        <p class="form-hint" style="margin:6px 0 0">שינוי תפקיד ממלא מחדש את סימוני העמדות לפי ברירת המחדל.</p>
      </div>
      <div class="form-group">
        <label>הרשאות באפליקציה (עמדות)</label>
        ${workspaceChecksHtml(selectedWs, { disabled: isSelf, name: 'accounts-ws' })}
        <p class="form-hint" style="margin:6px 0 0">
          ${custom
    ? 'מותאם אישית למשתמש זה'
    : 'לפי תפקיד — סמן/בטל עמדות ולחץ שמירה כדי להתאים'}
        </p>
      </div>
      <div class="accounts-actions">
        ${p.status !== 'active' ? `<button type="button" class="btn btn-primary accounts-approve">אשר כניסה</button>` : ''}
        ${p.status === 'active' && !isSelf ? `<button type="button" class="btn btn-secondary accounts-unlock-login" title="אם המשתמש פעיל אבל לא מצליח להתחבר — מאשר את האימייל ב-Auth">פתח כניסה</button>` : ''}
        ${p.status !== 'rejected' && !isSelf ? `<button type="button" class="btn btn-secondary accounts-reject">דחה</button>` : ''}
        ${!isSelf ? `<button type="button" class="btn btn-secondary accounts-save-perms">שמור הרשאות</button>` : ''}
        ${!isSelf && custom ? `<button type="button" class="btn btn-secondary accounts-reset-perms">אפס לתפקיד</button>` : ''}
      </div>
    </div>`;
}

function createAccountCardHtml() {
  const defaults = defaultWorkspacesForRole('production');
  return `
    <div class="card accounts-create-card" id="accounts-create-card">
      <div class="card-title">צור חשבון חדש</div>
      <p class="form-hint">המנהל יוצר אימייל + סיסמה, בוחר תפקיד והרשאות עמדות — המשתמש יכול להיכנס מיד (סטטוס פעיל).
        השתמש באימייל רגיל בלי + · אם עדיין מופיע «אימייל לא אושר» — הרץ ב-Supabase את המיגרציה
        <code>20260809120000_approve_account_confirms_email.sql</code> ואז לחץ «פתח כניסה» על המשתמש.</p>
      <div class="haccp-form-row" style="display:flex;flex-wrap:wrap;gap:12px">
        <div class="form-group" style="flex:1;min-width:180px">
          <label for="accounts-create-email">אימייל</label>
          <input type="email" id="accounts-create-email" autocomplete="off" placeholder="name@example.com">
        </div>
        <div class="form-group" style="flex:1;min-width:160px">
          <label for="accounts-create-password">סיסמה (לפחות 6)</label>
          <input type="text" id="accounts-create-password" autocomplete="new-password" placeholder="סיסמה זמנית">
        </div>
        <div class="form-group" style="flex:1;min-width:140px">
          <label for="accounts-create-name">שם לתצוגה</label>
          <input type="text" id="accounts-create-name" maxlength="80" placeholder="אופציונלי">
        </div>
      </div>
      <div class="form-group">
        <label for="accounts-create-role">תפקיד</label>
        <select id="accounts-create-role">${roleOptionsHtml('production')}</select>
      </div>
      <div class="form-group">
        <label>הרשאות עמדות</label>
        ${workspaceChecksHtml(defaults, { name: 'accounts-create-ws' })}
      </div>
      <div class="accounts-actions">
        <button type="button" class="btn btn-primary" id="accounts-create-submit">+ צור חשבון</button>
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
      <p class="form-hint">אפשר ליצור חשבון כאן, או לאשר מי שנרשם בדף הכניסה. לכל משתמש בוחרים תפקיד + עמדות באפליקציה.</p>
      <p class="form-hint" style="margin:0">ממתינים: <strong>${pending.length}</strong> · פעילים: <strong>${active.length}</strong> · נדחו: <strong>${rejected.length}</strong></p>
      <div class="accounts-actions" style="margin-top:10px">
        <button type="button" class="btn btn-secondary" id="accounts-refresh">רענון</button>
        <button type="button" class="btn btn-secondary btn-sm accounts-qr-btn" id="accounts-app-qr" title="QR לאפליקציה" aria-label="QR לאפליקציה">QR</button>
      </div>
    </div>
    ${createAccountCardHtml()}
    ${pending.length ? `<h3 class="accounts-section-title">ממתינים לאישור</h3>${pending.map((p) => profileCard(p, selfId)).join('')}` : '<div class="card"><p class="form-hint">אין ממתינים כרגע.</p></div>'}
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

async function openAppQrModal() {
  const appUrl = getAppShareUrl();
  openModal({
    title: 'QR לאפליקציה',
    modalClass: 'modal-accounts-app-qr',
    bodyHTML: `
      <div class="accounts-qr-modal">
        <p class="form-hint" style="margin:0 0 12px">סריקה פותחת את האפליקציה במכשיר.</p>
        <div class="accounts-qr-frame" id="accounts-qr-frame" aria-busy="true">
          <p class="form-hint" style="margin:0">טוען QR...</p>
        </div>
        <div class="accounts-qr-url-row">
          <input type="text" id="accounts-qr-url" class="accounts-qr-url" value="${escapeHtml(appUrl)}" readonly dir="ltr" aria-label="כתובת האפליקציה">
          <button type="button" class="btn btn-secondary btn-sm" id="accounts-qr-copy">העתק</button>
        </div>
      </div>`,
    footerHTML: `
      <button type="button" class="btn btn-secondary modal-cancel">סגור</button>
      <button type="button" class="btn btn-primary" id="accounts-qr-download">הורדה לגלריה</button>`,
  });

  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);

  const copyBtn = document.getElementById('accounts-qr-copy');
  copyBtn?.addEventListener('click', async () => {
    const url = document.getElementById('accounts-qr-url')?.value || appUrl;
    try {
      await copyTextToClipboard(url);
      showToast('הכתובת הועתקה');
    } catch {
      showToast('לא ניתן להעתיק — העתק ידנית');
    }
  });

  const frame = document.getElementById('accounts-qr-frame');
  let qrDataUrl = '';
  try {
    const { url, dataUrl } = await createAppQrDataUrl(appUrl);
    qrDataUrl = dataUrl;
    const urlInput = document.getElementById('accounts-qr-url');
    if (urlInput) urlInput.value = url;
    if (frame) {
      frame.removeAttribute('aria-busy');
      frame.innerHTML = `<img src="${dataUrl}" alt="QR לאפליקציה" class="accounts-qr-img" width="220" height="220">`;
    }
  } catch (err) {
    if (frame) {
      frame.removeAttribute('aria-busy');
      frame.innerHTML = `<p class="form-hint" style="margin:0;color:var(--danger)">${escapeHtml(err.message || 'שגיאה ביצירת QR')}</p>`;
    }
  }

  document.getElementById('accounts-qr-download')?.addEventListener('click', async () => {
    if (!qrDataUrl) return showToast('אין QR להורדה');
    try {
      const method = await downloadAppQrImage(qrDataUrl);
      const tip = describeDownloadMethod(method);
      if (method === 'share') showToast('נפתח Share — בחר «שמור תמונה» / גלריה');
      else if (method === 'cancelled') showToast('בוטל');
      else showToast(tip || 'ה-QR הורד');
    } catch (err) {
      showToast(err.message || 'ההורדה נכשלה');
    }
  });
}

function wireUsersHandlers(container) {
  container.querySelector('#accounts-refresh')?.addEventListener('click', () => renderAccounts(container));
  container.querySelector('#accounts-app-qr')?.addEventListener('click', () => {
    openAppQrModal().catch((err) => showToast(err.message || 'שגיאה ב-QR'));
  });

  const createRole = container.querySelector('#accounts-create-role');
  createRole?.addEventListener('change', () => {
    const card = container.querySelector('#accounts-create-card');
    setWorkspaceChecks(card, defaultWorkspacesForRole(createRole.value), '.accounts-create-ws');
  });

  container.querySelector('#accounts-create-submit')?.addEventListener('click', async () => {
    const card = container.querySelector('#accounts-create-card');
    const email = container.querySelector('#accounts-create-email')?.value || '';
    const password = container.querySelector('#accounts-create-password')?.value || '';
    const display_name = container.querySelector('#accounts-create-name')?.value || '';
    const role = container.querySelector('#accounts-create-role')?.value || 'production';
    const workspace_access = readWorkspaceChecks(card, '.accounts-create-ws');
    const btn = container.querySelector('#accounts-create-submit');
    if (btn) btn.disabled = true;
    try {
      if (!workspace_access.length) {
        showToast('יש לבחור לפחות עמדה אחת');
        return;
      }
      await createAccountUser({
        email,
        password,
        role,
        display_name,
        workspace_access,
        status: 'active',
      });
      showToast('החשבון נוצר ופעיל ✓');
      await renderAccounts(container);
    } catch (err) {
      showToast(err.message || 'שגיאה ביצירת חשבון');
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  container.querySelectorAll('.accounts-card[data-user-id]').forEach((card) => {
    const userId = card.dataset.userId;
    if (!userId) return;
    const roleSelect = card.querySelector('.accounts-role');

    roleSelect?.addEventListener('change', () => {
      setWorkspaceChecks(card, defaultWorkspacesForRole(roleSelect.value), '.accounts-ws');
    });

    card.querySelector('.accounts-approve')?.addEventListener('click', async () => {
      try {
        const workspace_access = readWorkspaceChecks(card, '.accounts-ws');
        if (!workspace_access.length) return showToast('יש לבחור לפחות עמדה אחת');
        await approveAccountUser(userId, {
          role: roleSelect.value,
          workspace_access,
        });
        showToast('החשבון אושר — אפשר להתחבר');
        await renderAccounts(container);
      } catch (err) {
        showToast(err.message || 'שגיאה באישור');
      }
    });

    card.querySelector('.accounts-unlock-login')?.addEventListener('click', async () => {
      try {
        await confirmAccountEmail(userId);
        showToast('האימייל אושר ב-Auth — המשתמש יכול להתחבר עכשיו');
      } catch (err) {
        showToast(err.message || 'לא ניתן לפתוח כניסה');
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

    card.querySelector('.accounts-save-perms')?.addEventListener('click', async () => {
      try {
        const workspace_access = readWorkspaceChecks(card, '.accounts-ws');
        if (!workspace_access.length) return showToast('יש לבחור לפחות עמדה אחת');
        await updateAccountProfile(userId, {
          role: roleSelect.value,
          workspace_access,
        });
        showToast(`הרשאות עודכנו · ${userRoleLabel(roleSelect.value)}`);
        await renderAccounts(container);
      } catch (err) {
        showToast(err.message || 'שגיאה בעדכון');
      }
    });

    card.querySelector('.accounts-reset-perms')?.addEventListener('click', async () => {
      try {
        await updateAccountProfile(userId, {
          role: roleSelect.value,
          workspace_access: null,
        });
        showToast('חזרה להרשאות לפי תפקיד');
        await renderAccounts(container);
      } catch (err) {
        showToast(err.message || 'שגיאה באיפוס');
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
