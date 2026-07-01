const DISMISS_KEY = 'yitzur-ios-install-dismissed';

export function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
}

function dismissBanner() {
  localStorage.setItem(DISMISS_KEY, '1');
  document.getElementById('ios-install-banner')?.remove();
}

export function initIOSInstallPrompt() {
  if (!isIOS() || isStandalone() || localStorage.getItem(DISMISS_KEY)) return;

  const banner = document.createElement('div');
  banner.id = 'ios-install-banner';
  banner.className = 'ios-install-banner';
  banner.innerHTML = `
    <div class="ios-install-content">
      <div class="ios-install-icon">📱</div>
      <div class="ios-install-text">
        <strong>התקנה על האייפון</strong>
        <p>לחץ על <span class="ios-share">שיתוף</span> ↗ ואז <strong>«הוסף למסך הבית»</strong> — האפליקציה תעבוד <strong>גם כשה-Mac כבוי</strong> (הנתונים על האייפון).</p>
      </div>
      <button type="button" class="ios-install-close" aria-label="סגור">×</button>
    </div>`;

  banner.querySelector('.ios-install-close').addEventListener('click', dismissBanner);
  document.body.appendChild(banner);
}
