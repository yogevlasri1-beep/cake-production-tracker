import { initDB } from './db.js';
import { renderHome, homeMeta } from './screens/home.js';
import { renderRecord, recordMeta } from './screens/record.js';
import { renderProducts, productsMeta } from './screens/products.js';
import { renderTargets, targetsMeta } from './screens/targets.js';
import { renderProcess, processMeta } from './screens/process.js';
import { renderReports, reportsMeta } from './screens/reports.js';
import './modal.js';

const SCREENS = {
  home: { render: renderHome, meta: homeMeta },
  record: { render: renderRecord, meta: recordMeta },
  process: { render: renderProcess, meta: processMeta },
  products: { render: renderProducts, meta: productsMeta },
  targets: { render: renderTargets, meta: targetsMeta },
  reports: { render: renderReports, meta: reportsMeta },
};

let currentScreen = 'home';

async function navigate(screen) {
  if (!SCREENS[screen]) return;
  currentScreen = screen;

  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.screen === screen);
  });

  const { title, subtitle } = SCREENS[screen].meta();
  document.getElementById('page-title').textContent = title;
  document.getElementById('page-subtitle').textContent = subtitle || '';

  const main = document.getElementById('main-content');
  main.innerHTML = '<p style="text-align:center;padding:40px;color:var(--text-muted)">טוען...</p>';
  await SCREENS[screen].render(main);
}

document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => navigate(btn.dataset.screen));
});

async function boot() {
  try {
    await initDB();
    await navigate('home');

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  } catch (err) {
    console.error(err);
    document.getElementById('main-content').innerHTML = `
      <div class="card" style="border:2px solid var(--danger)">
        <div class="card-title">שגיאה בטעינה</div>
        <p style="font-size:0.9rem;line-height:1.5;margin-bottom:12px">${err.message || err}</p>
        <button class="btn btn-primary" onclick="location.reload(true)">רענן דף</button>
      </div>`;
  }
}

boot();

export { navigate };
