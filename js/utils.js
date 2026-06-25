import { pct, pctDisplay, progressClass, progressBadge } from './calc.js?v=105';

export function formatDate(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function formatDateHebrew(iso) {
  const date = new Date(iso + 'T12:00:00');
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function formatMoney(n) {
  const val = Number(n);
  if (!Number.isFinite(val)) return '₪0';
  return `₪${val.toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function formatPortionCount(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  if (Number.isInteger(num)) return String(num);
  return String(Math.round(num * 10) / 10);
}

export function productUnitLabel(product) {
  if (product?.priceUnit === 'kg') return 'ק"ג';
  return "יח'";
}

export function productPriceUnitLabel(product) {
  if (product?.priceUnit === 'kg' || product?.priceUnit === 'kg_units') return '₪/ק"ג';
  return '₪/יח\'';
}

export function productRecordUsesKg(product) {
  return product?.priceUnit === 'kg';
}

export function formatProductQuantity(product, qty) {
  if (qty == null || qty === '') return '—';
  if (product?.priceUnit === 'kg') return `${qty} ק"ג`;
  return `${qty} יח'`;
}

export { pct, pctDisplay, progressClass, progressBadge };

export function progressBar(current, target, label) {
  const p = pct(current, target);
  const cls = progressClass(p);
  const tgt = Number(target) || 0;
  const numbers = tgt > 0
    ? `${current} / ${target} (${pctDisplay(current, target)})`
    : `${current} / —`;
  return `
    <div class="progress-item">
      <div class="progress-header">
        <span class="progress-name">${label}</span>
        <span class="progress-numbers">${numbers}</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill ${cls}" style="width:${Math.min(p, 100)}%"></div>
      </div>
    </div>`;
}

export function moneyProgressBar(current, target, label) {
  const cur = Number(current) || 0;
  const tgt = Number(target) || 0;
  const reached = tgt > 0 && cur >= tgt;
  const cls = tgt > 0 ? (reached ? 'good' : 'bad') : 'warn';
  const p = tgt > 0 ? Math.min(Math.round((cur / tgt) * 100), 100) : 0;
  const numbers = tgt > 0
    ? `${formatMoney(cur)} / ${formatMoney(tgt)}`
    : `${formatMoney(cur)} / —`;
  return `
    <div class="progress-item money-progress">
      <div class="progress-header">
        <span class="progress-name">${label}</span>
        <span class="progress-numbers ${tgt > 0 ? (reached ? 'money-good' : 'money-bad') : ''}">${numbers}</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill ${cls}" style="width:${tgt > 0 ? Math.min(p, 100) : 0}%"></div>
      </div>
    </div>`;
}

export function moneyProgressBadge(current, target) {
  const tgt = Number(target) || 0;
  if (tgt <= 0) return { cls: '', text: '' };
  const cur = Number(current) || 0;
  if (cur >= tgt) return { cls: 'badge-success', text: 'הושג' };
  return { cls: 'badge-danger', text: 'לא הושג' };
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

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** תחילת שבוע (יום שני) לפי ISO date */
export function weekStartISO(iso) {
  const base = iso || todayISO();
  const d = new Date(`${base}T12:00:00`);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function weekDayLabels() {
  return ['שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת', 'ראשון'];
}

export function addDaysISO(iso, days) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
