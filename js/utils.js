export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function formatDateHebrew(iso) {
  const date = new Date(iso + 'T12:00:00');
  return date.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function formatMoney(n) {
  return `₪${n.toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function progressClass(pct) {
  if (pct >= 100) return 'good';
  if (pct >= 80) return 'warn';
  return 'bad';
}

export function progressBadge(pct) {
  if (pct >= 100) return { cls: 'badge-success', text: 'הושג' };
  if (pct >= 80) return { cls: 'badge-warning', text: 'קרוב' };
  return { cls: 'badge-danger', text: 'חסר' };
}

export function pct(current, target) {
  if (!target) return target === 0 ? 100 : 0;
  return Math.round((current / target) * 100);
}

export function progressBar(current, target, label) {
  const p = pct(current, target);
  const cls = progressClass(p);
  return `
    <div class="progress-item">
      <div class="progress-header">
        <span class="progress-name">${label}</span>
        <span class="progress-numbers">${current} / ${target || '—'} (${p}%)</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill ${cls}" style="width:${Math.min(p, 100)}%"></div>
      </div>
    </div>`;
}

export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export function showToast(msg) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

export function currentMonth() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

export function monthLabel(year, month) {
  const d = new Date(year, month - 1, 1);
  return d.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
}
