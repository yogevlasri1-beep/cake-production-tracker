import {
  getCategories, getProducts, upsertTarget, getTarget,
  getEntriesForDate, getEntriesForMonth, getProductionTotals,
} from '../db.js?v=287';
import {
  todayISO, progressBar, moneyProgressBar, moneyProgressBadge,
  formatMoney, currentMonth, monthLabel,
} from '../utils.js?v=287';
import { showToast } from '../utils.js?v=287';

export async function renderTargets(container) {
  const period = container.dataset.period || 'daily';
  const [categories, products] = await Promise.all([getCategories(), getProducts(true)]);
  const today = todayISO();
  const { year, month } = currentMonth();

  const entries = period === 'daily'
    ? await getEntriesForDate(today)
    : await getEntriesForMonth(year, month);

  const productMap = new Map(products.map((p) => [p.id, p]));
  const totals = await getProductionTotals(entries, productMap);

  const totalTarget = await getTarget('total', 0, period);
  const moneyTarget = period === 'daily' ? await getTarget('money', 0, 'daily') : 0;
  const moneyBadge = moneyProgressBadge(totals.totalValue, moneyTarget);

  let html = `
    <div class="tabs">
      <button class="tab ${period === 'daily' ? 'active' : ''}" data-period="daily">יומי</button>
      <button class="tab ${period === 'monthly' ? 'active' : ''}" data-period="monthly">חודשי</button>
    </div>

    <div class="card">
      <div class="card-title">יעד ${period === 'daily' ? 'יומי' : 'חודשי'} — כולל</div>
      ${progressBar(totals.total, totalTarget, 'כל המפעל')}
      <div class="form-group" style="margin-top:12px">
        <label>יעד (יחידות)</label>
        <input type="number" id="target-total" min="0" value="${totalTarget || ''}" placeholder="200">
      </div>
      <button class="btn btn-primary btn-sm" id="save-total">שמור יעד כולל</button>
    </div>`;

  if (period === 'daily') {
    html += `
    <div class="card">
      <div class="card-title">יעד כסף יומי
        ${moneyTarget > 0 ? `<span class="badge ${moneyBadge.cls}" style="float:left">${moneyBadge.text}</span>` : ''}
      </div>
      ${moneyProgressBar(totals.totalValue, moneyTarget, 'ערך יומי')}
      <div class="form-group" style="margin-top:12px">
        <label>יעד (₪)</label>
        <input type="number" id="target-money" min="0" step="0.01" value="${moneyTarget || ''}" placeholder="5000">
      </div>
      <p class="money-target-hint">הערך הנוכחי: <strong class="${totals.totalValue >= moneyTarget && moneyTarget > 0 ? 'money-good' : moneyTarget > 0 ? 'money-bad' : ''}">${formatMoney(totals.totalValue)}</strong></p>
      <button class="btn btn-primary btn-sm" id="save-money">שמור יעד כסף</button>
    </div>`;
  }

  if (categories.length > 0) {
    html += `<div class="card"><div class="card-title">יעדים לפי קטגוריה</div>`;
    for (const cat of categories) {
      const target = await getTarget('category', cat.id, period);
      const current = totals.byCategory[cat.id] || 0;
      html += `
        ${progressBar(current, target, cat.name)}
        <div class="form-group">
          <input type="number" class="cat-target" data-id="${cat.id}" min="0" value="${target || ''}" placeholder="יעד ל${cat.name}">
        </div>`;
    }
    html += `<button class="btn btn-primary btn-sm" id="save-cats">שמור יעדי קטגוריות</button></div>`;
  }

  if (products.length > 0) {
    html += `<div class="card"><div class="card-title">יעדים לפי מוצר</div>`;
    for (const p of products) {
      const cat = categories.find((c) => c.id === p.categoryId);
      const target = await getTarget('product', p.id, period);
      const current = totals.byProduct[p.id] || 0;
      html += `
        ${progressBar(current, target, `${p.name} (${cat?.name || ''})`)}
        <div class="form-group">
          <input type="number" class="prod-target" data-id="${p.id}" min="0" value="${target || ''}" placeholder="יעד">
        </div>`;
    }
    html += `<button class="btn btn-primary btn-sm" id="save-prods">שמור יעדי מוצרים</button></div>`;
  }

  container.innerHTML = html;

  container.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      container.dataset.period = tab.dataset.period;
      renderTargets(container);
    });
  });

  document.getElementById('save-total').addEventListener('click', async () => {
    try {
      const qty = document.getElementById('target-total').value;
      await upsertTarget({ scope: 'total', scopeId: 0, period, quantity: qty || 0 });
      showToast('נשמר ✓');
      renderTargets(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  document.getElementById('save-money')?.addEventListener('click', async () => {
    try {
      const amount = document.getElementById('target-money').value;
      await upsertTarget({ scope: 'money', scopeId: 0, period: 'daily', quantity: amount || 0 });
      showToast('יעד כסף נשמר ✓');
      renderTargets(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  document.getElementById('save-cats')?.addEventListener('click', async () => {
    try {
      for (const input of container.querySelectorAll('.cat-target')) {
        await upsertTarget({ scope: 'category', scopeId: Number(input.dataset.id), period, quantity: input.value || 0 });
      }
      showToast('יעדי קטגוריות נשמרו ✓');
      renderTargets(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  document.getElementById('save-prods')?.addEventListener('click', async () => {
    try {
      for (const input of container.querySelectorAll('.prod-target')) {
        await upsertTarget({ scope: 'product', scopeId: Number(input.dataset.id), period, quantity: input.value || 0 });
      }
      showToast('יעדי מוצרים נשמרו ✓');
      renderTargets(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });
}

export function targetsMeta() {
  const { year, month } = currentMonth();
  return { title: 'יעדים', subtitle: monthLabel(year, month) };
}
