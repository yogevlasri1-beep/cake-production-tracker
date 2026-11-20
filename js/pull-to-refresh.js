/**
 * גלילה למעלה לרענון — דחיפת תור ואז משיכה מלאה.
 * לא מעלה את כל הדאטה המקומית.
 */
import {
  planPullToRefreshGesture,
} from './sync/cloud-first.js?v=546';

export function nestedScrollTopBetween(target, root) {
  let el = target instanceof Element ? target : target?.parentElement;
  while (el && el !== root) {
    if (el.scrollHeight > el.clientHeight + 2 && el.scrollTop > 1) return el.scrollTop;
    el = el.parentElement;
  }
  return 0;
}

export function defaultPullToRefreshCanStart(event) {
  const overlay = document.getElementById('modal-overlay');
  if (overlay && !overlay.classList.contains('hidden')) return false;
  const drawer = document.getElementById('workspace-drawer');
  if (drawer && !drawer.classList.contains('hidden')) return false;
  const target = event?.target;
  if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) return false;
  return true;
}

function ensureIndicator(scroller) {
  let el = document.getElementById('ptr-indicator');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'ptr-indicator';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<div class="ptr-inner"><span class="ptr-spinner"></span><span class="ptr-label">משוך לרענון</span></div>';
  const parent = scroller?.parentNode;
  if (parent) parent.insertBefore(el, scroller);
  else document.body.appendChild(el);
  return el;
}

export function installPullToRefresh({
  scroller,
  onRefresh,
  canStart = defaultPullToRefreshCanStart,
} = {}) {
  if (!scroller || typeof onRefresh !== 'function') return () => {};

  const indicator = ensureIndicator(scroller);
  const labelEl = indicator.querySelector('.ptr-label');
  let tracking = false;
  let pulling = false;
  let busy = false;
  let startY = 0;
  let startX = 0;
  let startId = null;
  let lastDy = 0;

  function setActive(on) {
    scroller.classList.toggle('ptr-active', on);
  }

  function paint(pullPx, { syncing = false, hint = '', ready = false } = {}) {
    scroller.style.transform = pullPx ? `translateY(${pullPx}px)` : '';
    indicator.classList.toggle('is-visible', pullPx > 8 || syncing);
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

  async function run() {
    if (busy) return;
    busy = true;
    scroller.style.overflowY = 'hidden';
    paint(56, { syncing: true, hint: 'מסנכרן…' });
    try {
      const result = await onRefresh();
      paint(56, { syncing: true, hint: result?.message || 'עודכן' });
    } catch (err) {
      paint(56, { syncing: true, hint: err?.message || 'הסנכרון נכשל' });
    } finally {
      window.setTimeout(() => {
        busy = false;
        scroller.style.overflowY = '';
        setActive(false);
        reset(true);
      }, 480);
    }
  }

  function onDown(event) {
    if (busy) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (canStart && !canStart(event)) return;
    const plan = planPullToRefreshGesture({
      scrollTop: scroller.scrollTop,
      nestedScrollTop: nestedScrollTopBetween(event.target, scroller),
      dy: 0,
      tracking: true,
    });
    if (!plan.armed) return;
    tracking = true;
    pulling = false;
    startY = event.clientY;
    startX = event.clientX;
    startId = event.pointerId;
    lastDy = 0;
    scroller.style.transition = '';
    setActive(true);
    try { scroller.setPointerCapture?.(event.pointerId); } catch { /* ignore */ }
  }

  function onMove(event) {
    if (!tracking || event.pointerId !== startId) return;
    const dy = event.clientY - startY;
    const dx = event.clientX - startX;
    lastDy = dy;
    if (!pulling && Math.abs(dx) > dy && Math.abs(dx) > 12) {
      tracking = false;
      setActive(false);
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
      hint: plan.release ? 'שחרר לסנכרון' : 'משוך לרענון',
      ready: plan.release,
    });
  }

  function onUp(event) {
    if (!tracking || (event.pointerId != null && event.pointerId !== startId)) return;
    const dy = event.clientY != null ? event.clientY - startY : lastDy;
    const plan = planPullToRefreshGesture({
      scrollTop: scroller.scrollTop,
      nestedScrollTop: nestedScrollTopBetween(event.target, scroller),
      dy,
      tracking: true,
    });
    tracking = false;
    pulling = false;
    startId = null;
    try { scroller.releasePointerCapture?.(event.pointerId); } catch { /* ignore */ }
    if (plan.release) run();
    else {
      setActive(false);
      reset(true);
    }
  }

  function onDragStart(event) {
    if (tracking || pulling || busy) event.preventDefault();
  }

  scroller.addEventListener('pointerdown', onDown);
  scroller.addEventListener('pointermove', onMove, { passive: false });
  scroller.addEventListener('pointerup', onUp);
  scroller.addEventListener('pointercancel', onUp);
  scroller.addEventListener('dragstart', onDragStart);
  scroller.addEventListener('touchmove', (event) => {
    if (!pulling) return;
    if (event.cancelable) event.preventDefault();
  }, { passive: false });

  return () => {
    scroller.removeEventListener('pointerdown', onDown);
    scroller.removeEventListener('pointermove', onMove);
    scroller.removeEventListener('pointerup', onUp);
    scroller.removeEventListener('pointercancel', onUp);
    scroller.removeEventListener('dragstart', onDragStart);
  };
}
