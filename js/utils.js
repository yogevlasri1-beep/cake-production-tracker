import { pct, pctDisplay, progressClass, progressBadge } from './calc.js?v=123';

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

/** משך זמן קריא (ms → "2 שע' 15 דק'") */
export function formatDuration(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 1) return 'פחות מדקה';
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hours === 0) return `${mins} דק'`;
  if (mins === 0) return `${hours} שע'`;
  return `${hours} שע' ${mins} דק'`;
}

export function runDurationMs(run) {
  const start = run?.startedAt ? Date.parse(run.startedAt) : NaN;
  if (!Number.isFinite(start)) return null;
  const end = run?.completedAt ? Date.parse(run.completedAt) : Date.now();
  if (!Number.isFinite(end)) return null;
  return Math.max(0, end - start);
}

export function stepDurationMs(step, prevCompletedAt, runStartedAt) {
  if (!step?.completedAt) return null;
  const end = Date.parse(step.completedAt);
  if (!Number.isFinite(end)) return null;
  const start = prevCompletedAt
    ? Date.parse(prevCompletedAt)
    : (runStartedAt ? Date.parse(runStartedAt) : NaN);
  if (!Number.isFinite(start)) return null;
  return Math.max(0, end - start);
}

export function isoToDateInput(iso) {
  if (!iso) return '';
  return String(iso).slice(0, 10);
}

export function isoToTimeInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    const part = String(iso).slice(11, 16);
    return /^\d{2}:\d{2}$/.test(part) ? part : '';
  }
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const date = d.toLocaleDateString('he-IL');
  const time = d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  return `${date} · ${time}`;
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
