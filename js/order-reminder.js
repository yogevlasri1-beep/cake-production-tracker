/**
 * תזכורת הזמנה שבועית — באנר במסך הבית / טאב הזמנה.
 * יום ברירת מחדל: ראשון (0). ניתן לשינוי ב-localStorage.
 */
import { weekStartISO, todayISO } from './utils.js?v=477';
import { computeWeeklyMaterialNeeds } from './kitchen-db.js?v=477';

const REMINDER_DAY_KEY = 'yitzurOrderReminderWeekday'; // 0=ראשון … 6=שבת
const DISMISS_KEY = 'yitzurOrderReminderDismissWeek';

/** @returns {number} 0–6, ברירת מחדל ראשון */
export function getOrderReminderWeekday() {
  const raw = Number(localStorage.getItem(REMINDER_DAY_KEY));
  return Number.isFinite(raw) && raw >= 0 && raw <= 6 ? raw : 0;
}

export function setOrderReminderWeekday(day) {
  const d = Number(day);
  if (!Number.isFinite(d) || d < 0 || d > 6) return;
  localStorage.setItem(REMINDER_DAY_KEY, String(d));
}

function currentWeekStart() {
  return weekStartISO(todayISO());
}

export function dismissOrderReminderForCurrentWeek() {
  localStorage.setItem(DISMISS_KEY, currentWeekStart());
}

function isDismissedThisWeek() {
  return localStorage.getItem(DISMISS_KEY) === currentWeekStart();
}

/** האם היום הוא יום תזכורת (או יום אחריו עד שבת, אם לא נדחה) */
export function isOrderReminderDayActive(now = new Date()) {
  const reminderDay = getOrderReminderWeekday();
  const today = now.getDay(); // 0=Sun
  // מציגים מיום התזכורת ועד סוף השבוע (שבת), אלא אם נדחה
  if (isDismissedThisWeek()) return false;
  if (today === reminderDay) return true;
  // גם יום אחרי אם לא נדחה — כדי שלא ייעלם אם פספסו
  const next = (reminderDay + 1) % 7;
  return today === next;
}

/**
 * @returns {Promise<null|{ weekStart: string, itemCount: number, categoryCount: number }>}
 */
export async function getOrderReminderInfo() {
  if (!isOrderReminderDayActive()) return null;
  try {
    const weekStart = currentWeekStart();
    const { categories } = await computeWeeklyMaterialNeeds(weekStart);
    const itemCount = (categories || []).reduce((n, c) => n + (c.items?.length || 0), 0);
    if (!itemCount) return null;
    return {
      weekStart,
      itemCount,
      categoryCount: categories.length,
      weekday: getOrderReminderWeekday(),
    };
  } catch {
    return null;
  }
}

const WEEKDAY_LABELS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

export function orderReminderWeekdayLabel(day = getOrderReminderWeekday()) {
  return WEEKDAY_LABELS[day] || '';
}

export function renderOrderReminderBannerHTML(info) {
  if (!info) return '';
  return `
    <div class="order-reminder-banner card" id="order-reminder-banner" role="status">
      <div class="order-reminder-banner-body">
        <strong>תזכורת הזמנה שבועית</strong>
        <p class="form-hint" style="margin:4px 0 0">
          יש ${info.itemCount} פריטים להזמנה השבוע (${info.categoryCount} קטגוריות).
          יום תזכורת: ${orderReminderWeekdayLabel(info.weekday)}.
        </p>
      </div>
      <div class="order-reminder-banner-actions">
        <button type="button" class="btn btn-primary btn-sm" data-order-reminder-go>לעמדת הזמנה</button>
        <button type="button" class="btn btn-secondary btn-sm" data-order-reminder-dismiss>הסתר השבוע</button>
      </div>
    </div>`;
}
