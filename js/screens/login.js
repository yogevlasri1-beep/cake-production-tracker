import { signIn } from '../auth.js?v=412';
import { escapeHtml } from '../utils.js?v=412';

export function renderLoginGate(onSuccess) {
  const overlay = document.createElement('div');
  overlay.id = 'login-gate';
  overlay.className = 'login-gate';
  overlay.innerHTML = `
    <div class="card login-gate-card">
      <div class="card-title">כניסה למערכת</div>
      <form id="login-gate-form">
        <div class="form-group">
          <label for="login-email">אימייל</label>
          <input type="email" id="login-email" autocomplete="username" required>
        </div>
        <div class="form-group">
          <label for="login-password">סיסמה</label>
          <input type="password" id="login-password" autocomplete="current-password" required>
        </div>
        <p class="form-hint login-gate-error" id="login-gate-error" style="display:none;color:var(--danger)"></p>
        <button type="submit" class="btn btn-primary" id="login-gate-submit" style="width:100%">כניסה</button>
      </form>
    </div>`;
  document.body.appendChild(overlay);

  const form = overlay.querySelector('#login-gate-form');
  const errorEl = overlay.querySelector('#login-gate-error');
  const submitBtn = overlay.querySelector('#login-gate-submit');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = overlay.querySelector('#login-email').value;
    const password = overlay.querySelector('#login-password').value;

    errorEl.style.display = 'none';
    submitBtn.disabled = true;
    submitBtn.textContent = 'מתחבר...';
    try {
      await signIn(email, password);
      overlay.remove();
      onSuccess();
    } catch (err) {
      errorEl.textContent = escapeHtml(err.message || 'שגיאת התחברות');
      errorEl.style.display = 'block';
      submitBtn.disabled = false;
      submitBtn.textContent = 'כניסה';
    }
  });
}
