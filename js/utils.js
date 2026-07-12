import { pct, pctDisplay, progressClass, progressBadge } from './calc.js?v=283';

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

/** עיגול ל-3 ספרות אחרי הנקודה */
export function roundDecimal(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return NaN;
  return Math.round(num * 1000) / 1000;
}

/** תצוגה חכמה — עד 3 ספרות, בלי אפסים מיותרים בסוף */
export function formatDecimal(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  const r = roundDecimal(num);
  if (Math.abs(r - Math.round(r * 100) / 100) > 0.0004) return r.toFixed(3);
  if (Math.abs(r - Math.round(r * 10) / 10) > 0.004) return r.toFixed(2);
  if (Math.abs(r - Math.round(r)) > 0.04) return r.toFixed(1);
  return String(Math.round(r));
}

export function formatPortionCount(n) {
  return formatDecimal(n);
}

export function formatPortionWeightKg(kg) {
  if (kg == null || !Number.isFinite(kg)) return '—';
  const rounded = Math.round(kg * 1000) / 1000;
  const text = Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return `${text} ק"ג`;
}

export function productUnitsFromKg(kgQty, product) {
  const uw = Number(product?.unitWeightKg) || 0;
  if (!uw || kgQty == null || kgQty === '') return null;
  const kg = Number(kgQty);
  if (!Number.isFinite(kg) || kg <= 0) return null;
  return roundDecimal(kg / uw);
}

export function productUnitLabel(product) {
  if (product?.priceUnit === 'kg' || product?.priceUnit === 'kg_with_units') return 'ק"ג';
  return "יח'";
}

export function productPriceUnitLabel(product) {
  if (product?.priceUnit === 'kg' || product?.priceUnit === 'kg_units' || product?.priceUnit === 'kg_with_units') {
    return '₪/ק"ג';
  }
  return '₪/יח\'';
}

export function productRecordUsesKg(product) {
  return product?.priceUnit === 'kg' || product?.priceUnit === 'kg_with_units';
}

export function formatProductQuantity(product, qty) {
  if (qty == null || qty === '') return '—';
  const formatted = formatDecimal(qty);
  if (product?.priceUnit === 'kg' || product?.priceUnit === 'kg_with_units') {
    const weight = `${formatted} ק"ג`;
    if (product?.priceUnit === 'kg_with_units') {
      const units = productUnitsFromKg(qty, product);
      if (units != null) return `${weight} (≈${formatDecimal(units)} יח')`;
    }
    return weight;
  }
  return `${formatted} יח'`;
}

/** משך זמן קריא (ms → "2 ימים 3 שע' 15 דק'") */
export function formatDuration(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 1) return 'פחות מדקה';

  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;

  const parts = [];
  if (days > 0) parts.push(days === 1 ? '1 יום' : `${days} ימים`);
  if (hours > 0) parts.push(`${hours} שע'`);
  if (mins > 0) parts.push(`${mins} דק'`);
  if (!parts.length) return "0 דק'";

  return parts.join(' ');
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
  let start = NaN;
  if (step.startedAt) {
    start = Date.parse(step.startedAt);
  } else if (prevCompletedAt) {
    start = Date.parse(prevCompletedAt);
  } else if (runStartedAt) {
    start = Date.parse(runStartedAt);
  }
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
    ? `${formatDecimal(current)} / ${formatDecimal(target)} (${pctDisplay(current, target)})`
    : `${formatDecimal(current)} / —`;
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

/** תחילת שבוע (יום ראשון) לפי ISO date */
export function weekStartISO(iso) {
  const base = iso || todayISO();
  const d = new Date(`${base}T12:00:00`);
  d.setDate(d.getDate() - d.getDay());
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function weekDayLabels() {
  return ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
}

export function addDaysISO(iso, days) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
