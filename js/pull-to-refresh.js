/**
 * משיכה למטה לרענון — דחיפת תור ואז משיכה מלאה.
 * לא מעלה את כל הדאטה המקומית.
 * לא נועלים גלילה עד שממש מושכים למטה — אחרת אי אפשר לגלול במוצרים.
 */
import {
  planPullToRefreshGesture,
} from './sync/cloud-first.js?v=556';

export const PTR_PULL_START_PX = 10;

export function nestedScrollTopBetween(target, root) {
  let el = target instanceof Element ? target : target?.parentElement;
  while (el && el !== root) {
    if (el.scrollHeight > el.clientHeight + 2 && el.scrollTop > 1) return el.scrollTop;
    el = el.parentElement;
  }
  return 0;
}

export function eventClientPoint(event) {
  const t = event?.touches?.[0] || event?.changedTouches?.[0];
  if (t) return { x: t.clientX, y: t.clientY };
  return { x: Number(event?.clientX) || 0, y: Number(event?.clientY) || 0 };
}

export function shouldIgnorePtrTarget(target) {
  if (!target?.closest) return false;
  if (target.closest('input, textarea, select, [contenteditable="true"]')) return true;
  if (target.closest('.bottom-nav')) return true;
  if (target.closest('button, a, .workspace-chip, [role="button"]')) return true;
  return false;
}

export function defaultPullToRefreshCanStart(event) {
  const overlay = document.getElementById('modal-overlay');
  if (overlay && !overlay.classList.contains('hidden')) return false;
  const drawer = document.getElementById('workspace-drawer');
  if (drawer && !drawer.classList.contains('hidden')) return false;
  if (shouldIgnorePtrTarget(event?.target)) return false;
  return true;
}

/** גלילה רגילה לא נחסמת. רענון רק אחרי משיכה ממש למטה. */
export function planPtrFingerMove({
  dy = 0,
  dx = 0,
  atTop = true,
  pulling = false,
} = {}) {
  const y = Number(dy) || 0;
  const x = Number(dx) || 0;
  if (!atTop && !pulling) return { action: 'scroll' };
  if (Math.abs(x) > Math.max(y, 0) && Math.abs(x) > 12) return { action: 'cancel' };
  if (y < -8) return { action: 'scroll' };
  if (atTop && y >= PTR_PULL_START_PX) return { action: 'pull' };
  return { action: 'wait' };
}

function ensureIndicator(surface) {
  let el = document.getElementById('ptr-indicator');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'ptr-indicator';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<div class="ptr-inner"><span class="ptr-spinner"></span><span class="ptr-label">משוך לרענון</span></div>';
  (surface || document.body).appendChild(el);
  return el;
}

function placeIndicator(indicator, surface) {
  const header = surface?.querySelector?.('.app-header');
  const surfaceTop = surface?.getBoundingClientRect?.().top || 0;
  const headerBottom = header ? header.getBoundingClientRect().bottom : surfaceTop + 56;
  indicator.style.top = `${Math.max(8, headerBottom - surfaceTop + 8)}px`;
}

export function installPullToRefresh({
  scroller,
  surface,
  onRefresh,
  canStart = defaultPullToRefreshCanStart,
} = {}) {
  if (!scroller || typeof onRefresh !== 'function') return () => {};

  const host = surface || scroller.closest('#app') || scroller.parentNode || document.body;
  const indicator = ensureIndicator(host);
  const labelEl = indicator.querySelector('.ptr-label');
  let pending = false;
  let pulling = false;
  let busy = false;
  let source = null;
  let startY = 0;
  let startX = 0;
  let lastDy = 0;

  function atTopNow(target) {
    return (Number(scroller.scrollTop) || 0) <= 1
      && nestedScrollTopBetween(target, scroller) <= 1;
  }

  function setPulling(on) {
    host.classList.toggle('ptr-pulling', on);
    scroller.classList.toggle('ptr-pulling', on);
  }

  function paint(pullPx, { syncing = false, hint = '', ready = false } = {}) {
    scroller.style.transform = pullPx ? `translateY(${pullPx}px)` : '';
    indicator.classList.toggle('is-visible', pullPx > 4 || syncing);
    indicator.classList.toggle('is-syncing', syncing);
    indicator.classList.toggle('is-ready', ready);
    if (labelEl && hint) labelEl.textContent = hint;
  }

  function reset(animate = true) {
    scroller.style.transition = animate ? 'transform 0.22s ease' : '';
    if (!busy) paint(0);
    window.setTimeout(() => {
      if (!busy && !pulling) scroller.style.transition = '';
    }, 240);
  }

  function stopGesture() {
    pending = false;
    pulling = false;
    source = null;
    setPulling(false);
  }

  async function run() {
    if (busy) return;
    busy = true;
    setPulling(true);
    paint(64, { syncing: true, hint: 'דוחף לענן…' });
    try {
      const result = await onRefresh();
      paint(64, { syncing: true, hint: result?.message || 'עודכן' });
    } catch (err) {
      paint(64, { syncing: true, hint: err?.message || 'הסנכרון נכשל' });
    } finally {
      window.setTimeout(() => {
        busy = false;
        setPulling(false);
        reset(true);
      }, 520);
    }
  }

  function begin(event, kind) {
    if (busy) return false;
    if (kind === 'pointer' && event.pointerType === 'touch') return false;
    if (kind === 'pointer' && event.pointerType === 'mouse' && event.button !== 0) return false;
    if (canStart && !canStart(event)) return false;
    if (!atTopNow(event.target)) return false;
    pending = true;
    pulling = false;
    source = kind;
    const pt = eventClientPoint(event);
    startY = pt.y;
    startX = pt.x;
    lastDy = 0;
    scroller.style.transition = '';
    return true;
  }

  function move(event, kind) {
    if ((!pending && !pulling) || source !== kind) return;
    const pt = eventClientPoint(event);
    const dy = pt.y - startY;
    const dx = pt.x - startX;
    lastDy = dy;
    const atTop = atTopNow(event.target);
    const intent = planPtrFingerMove({ dy, dx, atTop, pulling });
    if (intent.action === 'scroll' || intent.action === 'cancel') {
      stopGesture();
      reset(false);
      return;
    }
    if (intent.action !== 'pull') return;
    pulling = true;
    pending = false;
    if (event.cancelable) event.preventDefault();
    placeIndicator(indicator, host);
    setPulling(true);
    const plan = planPullToRefreshGesture({
      scrollTop: 0,
      nestedScrollTop: 0,
      dy,
      tracking: true,
    });
    paint(plan.pullPx, {
      hint: plan.release ? 'שחרר לדחיפה' : 'משוך לרענון',
      ready: plan.release,
    });
  }

  function end(event, kind) {
    if ((!pending && !pulling) || source !== kind) return;
    const pt = eventClientPoint(event);
    const dy = Number.isFinite(pt.y) ? pt.y - startY : lastDy;
    const wasPulling = pulling;
    const plan = planPullToRefreshGesture({
      scrollTop: wasPulling ? 0 : scroller.scrollTop,
      nestedScrollTop: nestedScrollTopBetween(event.target, scroller),
      dy,
      tracking: wasPulling,
    });
    stopGesture();
    if (wasPulling && plan.release) run();
    else reset(true);
  }

  function onTouchStart(event) { begin(event, 'touch'); }
  function onTouchMove(event) { move(event, 'touch'); }
  function onTouchEnd(event) { end(event, 'touch'); }
  function onPointerDown(event) { begin(event, 'pointer'); }
  function onPointerMove(event) { move(event, 'pointer'); }
  function onPointerUp(event) { end(event, 'pointer'); }
  function onDragStart(event) {
    if (pulling || busy) event.preventDefault();
  }

  const touchStartOpts = { passive: true, capture: true };
  const touchMoveOpts = { passive: false, capture: true };
  const touchEndOpts = { capture: true };
  host.addEventListener('touchstart', onTouchStart, touchStartOpts);
  host.addEventListener('touchmove', onTouchMove, touchMoveOpts);
  host.addEventListener('touchend', onTouchEnd, touchEndOpts);
  host.addEventListener('touchcancel', onTouchEnd, touchEndOpts);
  host.addEventListener('pointerdown', onPointerDown);
  host.addEventListener('pointermove', onPointerMove, { passive: false });
  host.addEventListener('pointerup', onPointerUp);
  host.addEventListener('pointercancel', onPointerUp);
  host.addEventListener('dragstart', onDragStart);

  return () => {
    host.removeEventListener('touchstart', onTouchStart, touchStartOpts);
    host.removeEventListener('touchmove', onTouchMove, touchMoveOpts);
    host.removeEventListener('touchend', onTouchEnd, touchEndOpts);
    host.removeEventListener('touchcancel', onTouchEnd, touchEndOpts);
    host.removeEventListener('pointerdown', onPointerDown);
    host.removeEventListener('pointermove', onPointerMove);
    host.removeEventListener('pointerup', onPointerUp);
    host.removeEventListener('pointercancel', onPointerUp);
    host.removeEventListener('dragstart', onDragStart);
  };
}
