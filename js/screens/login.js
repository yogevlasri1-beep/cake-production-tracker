import { signIn, signUp } from '../auth.js?v=456';
import { escapeHtml } from '../utils.js?v=456';

export function renderLoginGate(onSuccess, options = {}) {
  const overlay = document.createElement('div');
  overlay.id = 'login-gate';
  overlay.className = 'login-gate';
  const initialMode = options.mode === 'register' ? 'register' : 'login';
  const notice = options.notice ? `<p class="form-hint login-gate-notice">${escapeHtml(options.notice)}</p>` : '';

  overlay.innerHTML = `
    <div class="card login-gate-card">
      <div class="card-title">כניסה למערכת</div>
      <div class="login-gate-tabs" role="tablist">
        <button type="button" class="login-gate-tab ${initialMode === 'login' ? 'active' : ''}" data-mode="login">כניסה</button>
        <button type="button" class="login-gate-tab ${initialMode === 'register' ? 'active' : ''}" data-mode="register">הרשמה</button>
      </div>
      ${notice}
      <form id="login-gate-form">
        <div class="form-group">
          <label for="login-email">אימייל</label>
          <input type="email" id="login-email" autocomplete="username" required>
        </div>
        <div class="form-group">
          <label for="login-password">סיסמה</label>
          <input type="password" id="login-password" autocomplete="current-password" required minlength="6">
        </div>
        <p class="form-hint login-gate-register-hint" ${initialMode === 'register' ? '' : 'hidden'}>
          אחרי הרשמה החשבון ממתין לאישור מנהל בעמדת «חשבונות».
        </p>
        <p class="form-hint login-gate-error" id="login-gate-error" style="display:none;color:var(--danger)"></p>
        <p class="form-hint login-gate-success" id="login-gate-success" style="display:none;color:var(--success, #059669)"></p>
        <button type="submit" class="btn btn-primary" id="login-gate-submit" style="width:100%">
          ${initialMode === 'register' ? 'הרשמה' : 'כניסה'}
        </button>
      </form>
    </div>`;
  document.body.appendChild(overlay);

  const form = overlay.querySelector('#login-gate-form');
  const errorEl = overlay.querySelector('#login-gate-error');
  const successEl = overlay.querySelector('#login-gate-success');
  const submitBtn = overlay.querySelector('#login-gate-submit');
  const registerHint = overlay.querySelector('.login-gate-register-hint');
  let mode = initialMode;

  function setMode(next) {
    mode = next;
    overlay.querySelectorAll('.login-gate-tab').forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.mode === mode);
    });
    submitBtn.textContent = mode === 'register' ? 'הרשמה' : 'כניסה';
    registerHint.hidden = mode !== 'register';
    errorEl.style.display = 'none';
    successEl.style.display = 'none';
    const passwordInput = overlay.querySelector('#login-password');
    passwordInput.autocomplete = mode === 'register' ? 'new-password' : 'current-password';
  }

  overlay.querySelectorAll('.login-gate-tab').forEach((tab) => {
    tab.addEventListener('click', () => setMode(tab.dataset.mode));
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = overlay.querySelector('#login-email').value;
    const password = overlay.querySelector('#login-password').value;

    errorEl.style.display = 'none';
    successEl.style.display = 'none';
    submitBtn.disabled = true;
    submitBtn.textContent = mode === 'register' ? 'נרשם...' : 'מתחבר...';
    try {
      if (mode === 'register') {
        const result = await signUp(email, password);
        if (result.pending) {
          successEl.textContent = result.message || 'ההרשמה התקבלה וממתינה לאישור מנהל.';
          successEl.style.display = 'block';
          setMode('login');
          submitBtn.disabled = false;
          submitBtn.textContent = 'כניסה';
          return;
        }
        overlay.remove();
        onSuccess();
        return;
      }
      await signIn(email, password);
      overlay.remove();
      onSuccess();
    } catch (err) {
      errorEl.textContent = escapeHtml(err.message || 'שגיאת התחברות');
      errorEl.style.display = 'block';
      submitBtn.disabled = false;
      submitBtn.textContent = mode === 'register' ? 'הרשמה' : 'כניסה';
    }
  });
}
