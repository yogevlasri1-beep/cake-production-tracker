/**
 * משיכה למטה לרענון — דחיפת תור ואז משיכה מלאה.
 * לא מעלה את כל הדאטה המקומית.
 * מאזינים ל-touch על כל ה-#app כדי שזה יעבוד באייפון גם מהכותרת.
 */
import {
  planPullToRefreshGesture,
} from './sync/cloud-first.js?v=547';

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
  let tracking = false;
  let pulling = false;
  let busy = false;
  let source = null;
  let startY = 0;
  let startX = 0;
  let lastDy = 0;

  function setActive(on) {
    host.classList.toggle('ptr-active', on);
    scroller.classList.toggle('ptr-active', on);
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

  function stopTracking() {
    tracking = false;
    pulling = false;
    source = null;
  }

  async function run() {
    if (busy) return;
    busy = true;
    scroller.style.overflowY = 'hidden';
    paint(64, { syncing: true, hint: 'דוחף לענן…' });
    try {
      const result = await onRefresh();
      paint(64, { syncing: true, hint: result?.message || 'עודכן' });
    } catch (err) {
      paint(64, { syncing: true, hint: err?.message || 'הסנכרון נכשל' });
    } finally {
      window.setTimeout(() => {
        busy = false;
        scroller.style.overflowY = '';
        setActive(false);
        reset(true);
      }, 520);
    }
  }

  function begin(event, kind) {
    if (busy) return false;
    if (kind === 'pointer' && event.pointerType === 'touch') return false;
    if (kind === 'pointer' && event.pointerType === 'mouse' && event.button !== 0) return false;
    if (canStart && !canStart(event)) return false;
    const plan = planPullToRefreshGesture({
      scrollTop: scroller.scrollTop,
      nestedScrollTop: nestedScrollTopBetween(event.target, scroller),
      dy: 0,
      tracking: true,
    });
    if (!plan.armed) return false;
    tracking = true;
    pulling = false;
    source = kind;
    const pt = eventClientPoint(event);
    startY = pt.y;
    startX = pt.x;
    lastDy = 0;
    scroller.style.transition = '';
    placeIndicator(indicator, host);
    setActive(true);
    return true;
  }

  function move(event, kind) {
    if (!tracking || source !== kind) return;
    const pt = eventClientPoint(event);
    const dy = pt.y - startY;
    const dx = pt.x - startX;
    lastDy = dy;
    if (!pulling && Math.abs(dx) > dy && Math.abs(dx) > 12) {
      stopTracking();
      setActive(false);
      reset(false);
      return;
    }
    const plan = planPullToRefreshGesture({
      scrollTop: scroller.scrollTop,
      nestedScrollTop: nestedScrollTopBetween(event.target, scroller),
      dy,
      tracking: true,
    });
    if (!plan.armed || dy <= 0) {
      if (pulling && dy <= 0) {
        pulling = false;
        reset(false);
      }
      return;
    }
    pulling = true;
    if (event.cancelable) event.preventDefault();
    paint(plan.pullPx, {
      hint: plan.release ? 'שחרר לדחיפה' : 'משוך לרענון',
      ready: plan.release,
    });
  }

  function end(event, kind) {
    if (!tracking || source !== kind) return;
    const pt = eventClientPoint(event);
    const dy = Number.isFinite(pt.y) ? pt.y - startY : lastDy;
    const plan = planPullToRefreshGesture({
      scrollTop: scroller.scrollTop,
      nestedScrollTop: nestedScrollTopBetween(event.target, scroller),
      dy,
      tracking: true,
    });
    stopTracking();
    if (plan.release) run();
    else {
      setActive(false);
      reset(true);
    }
  }

  function onTouchStart(event) { begin(event, 'touch'); }
  function onTouchMove(event) { move(event, 'touch'); }
  function onTouchEnd(event) { end(event, 'touch'); }
  function onPointerDown(event) { begin(event, 'pointer'); }
  function onPointerMove(event) { move(event, 'pointer'); }
  function onPointerUp(event) { end(event, 'pointer'); }
  function onDragStart(event) {
    if (tracking || pulling || busy) event.preventDefault();
  }

  const touchMoveOpts = { passive: false, capture: true };
  host.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
  host.addEventListener('touchmove', onTouchMove, touchMoveOpts);
  host.addEventListener('touchend', onTouchEnd, { capture: true });
  host.addEventListener('touchcancel', onTouchEnd, { capture: true });
  host.addEventListener('pointerdown', onPointerDown);
  host.addEventListener('pointermove', onPointerMove, { passive: false });
  host.addEventListener('pointerup', onPointerUp);
  host.addEventListener('pointercancel', onPointerUp);
  host.addEventListener('dragstart', onDragStart);

  return () => {
    host.removeEventListener('touchstart', onTouchStart, { capture: true });
    host.removeEventListener('touchmove', onTouchMove, touchMoveOpts);
    host.removeEventListener('touchend', onTouchEnd, { capture: true });
    host.removeEventListener('touchcancel', onTouchEnd, { capture: true });
    host.removeEventListener('pointerdown', onPointerDown);
    host.removeEventListener('pointermove', onPointerMove);
    host.removeEventListener('pointerup', onPointerUp);
    host.removeEventListener('pointercancel', onPointerUp);
    host.removeEventListener('dragstart', onDragStart);
  };
}
