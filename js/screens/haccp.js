import { getCategoryGroups } from '../db.js?v=396';
import { escapeHtml, showToast } from '../utils.js?v=396';
import { openModal, closeModal } from '../modal.js?v=396';
import {
  HACCP_STEPS,
  HACCP_PRP_TOPICS,
  HACCP_TEAM_ROLES,
  HACCP_PLAN_STATUSES,
  HACCP_ALLERGENS,
  HACCP_PROCESS_TECHS,
  haccpRoleLabel,
  getHaccpTeamMembers,
  addHaccpTeamMember,
  updateHaccpTeamMember,
  deleteHaccpTeamMember,
  getHaccpPlans,
  getActiveHaccpPlanId,
  setActiveHaccpPlanId,
  ensureHaccpPlanForGroup,
  updateHaccpPlan,
  deleteHaccpPlan,
  getHaccpProductDescription,
  saveHaccpProductDescription,
  getProductsForHaccpPlan,
  suggestCompositionForHaccpPlan,
} from '../haccp-db.js?v=396';

const STEP_STORAGE_KEY = 'yitzurHaccpStep';

function getSavedStep() {
  try {
    const id = sessionStorage.getItem(STEP_STORAGE_KEY);
    if (HACCP_STEPS.some((s) => s.id === id)) return id;
  } catch { /* ignore */ }
  return 'overview';
}

function saveStep(id) {
  try {
    sessionStorage.setItem(STEP_STORAGE_KEY, id);
  } catch { /* ignore */ }
}

export function haccpMeta() {
  return {
    title: 'HACCP',
    subtitle: 'מערכת בקרת בטיחות מזון עצמית',
  };
}

export async function renderHaccp(container) {
  const stepId = container.dataset.haccpStep || getSavedStep();
  container.dataset.haccpStep = stepId;
  saveStep(stepId);

  const [members, plans, groups, activePlanId] = await Promise.all([
    getHaccpTeamMembers(),
    getHaccpPlans(),
    getCategoryGroups(),
    getActiveHaccpPlanId(),
  ]);

  const groupMap = new Map(groups.map((g) => [g.id, g]));
  const activePlan = plans.find((p) => p.id === activePlanId) || null;
  const step = HACCP_STEPS.find((s) => s.id === stepId) || HACCP_STEPS[0];

  let productDesc = null;
  let familyProducts = [];
  if (step.id === 'product' && activePlan) {
    [productDesc, familyProducts] = await Promise.all([
      getHaccpProductDescription(activePlan.id),
      getProductsForHaccpPlan(activePlan.id),
    ]);
  }

  let body = '';
  if (step.id === 'overview') body = renderOverview(members, plans, groups);
  else if (step.id === 'prp') body = renderPrpPreview();
  else if (step.id === 'team') body = renderTeamSection(members);
  else if (step.id === 'product') {
    body = renderProductSection(activePlan, productDesc, familyProducts, groupMap);
  } else body = renderSoonStep(step);

  container.innerHTML = `
    <div class="haccp-screen">
      <div class="card haccp-hero">
        <div class="card-title">מערכת בקרת בטיחות מזון עצמית מבוססת HACCP</div>
        <p class="haccp-hero-text">
          לפי מדריך משרד הבריאות — נבנה שלב־שלב: צוות, תיאור מוצר לפי משפחה,
          תרשים זרימה, ניתוח סיכונים ונקודות בקרה קריטיות.
        </p>
        ${renderPlanPicker(plans, groups, activePlan, groupMap)}
      </div>

      <div class="card">
        <div class="card-title">מפת דרכים</div>
        <div class="haccp-roadmap" role="tablist" aria-label="שלבי HACCP">
          ${HACCP_STEPS.map((s) => {
            const active = s.id === step.id ? ' is-active' : '';
            const locked = s.status === 'soon' ? ' is-soon' : '';
            const preview = s.status === 'preview' ? ' is-preview' : '';
            const badge = s.status === 'soon' ? 'בקרוב' : s.status === 'preview' ? 'תצוגה' : s.chapter;
            return `
              <button type="button" class="haccp-step-btn${active}${locked}${preview}"
                data-haccp-step="${s.id}" role="tab" aria-selected="${s.id === step.id}">
                <span class="haccp-step-chapter">${escapeHtml(badge)}</span>
                <span class="haccp-step-label">${escapeHtml(s.label)}</span>
              </button>`;
          }).join('')}
        </div>
      </div>

      <div class="haccp-step-panel" data-step="${escapeHtml(step.id)}">
        ${body}
      </div>
    </div>`;

  bindHaccpEvents(container, { members, plans, groups, activePlan, productDesc });
}

function renderPlanPicker(plans, groups, activePlan, groupMap) {
  const usedGroupIds = new Set(plans.map((p) => p.categoryGroupId));
  const availableGroups = groups.filter((g) => !usedGroupIds.has(g.id));

  const options = plans.map((p) => {
    const family = groupMap.get(p.categoryGroupId)?.name || 'משפחה לא ידועה';
    const selected = activePlan?.id === p.id ? 'selected' : '';
    return `<option value="${p.id}" ${selected}>${escapeHtml(p.name)} — ${escapeHtml(family)}</option>`;
  }).join('');

  const createOptions = availableGroups.map((g) =>
    `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('');

  return `
    <div class="haccp-plan-bar">
      <div class="form-group haccp-plan-select-wrap">
        <label for="haccp-active-plan">תכנית לפי משפחת מוצרים</label>
        <select id="haccp-active-plan">
          <option value="">— בחר תכנית —</option>
          ${options || ''}
        </select>
      </div>
      ${activePlan ? `
        <div class="haccp-plan-meta">
          <span class="badge">${escapeHtml(HACCP_PLAN_STATUSES[activePlan.status] || activePlan.status)}</span>
          <span class="haccp-plan-family">${escapeHtml(groupMap.get(activePlan.categoryGroupId)?.name || '')}</span>
          <button type="button" class="btn btn-secondary btn-sm" id="haccp-rename-plan">שנה שם</button>
          <button type="button" class="btn btn-danger btn-sm" id="haccp-delete-plan">מחק תכנית</button>
        </div>` : ''}
      <div class="haccp-plan-create">
        <div class="form-group">
          <label for="haccp-new-family">יצירת תכנית חדשה</label>
          <div class="haccp-inline-row">
            <select id="haccp-new-family" ${availableGroups.length ? '' : 'disabled'}>
              <option value="">${availableGroups.length ? 'בחר משפחה…' : 'כל המשפחות כבר משויכות'}</option>
              ${createOptions}
            </select>
            <button type="button" class="btn btn-primary btn-sm" id="haccp-create-plan"
              ${availableGroups.length ? '' : 'disabled'}>צור</button>
          </div>
        </div>
      </div>
    </div>`;
}

function renderOverview(members, plans, groups) {
  const leaders = members.filter((m) => m.isLeader && m.active !== false);
  const activeMembers = members.filter((m) => m.active !== false);
  return `
    <div class="card">
      <div class="card-title">איפה אנחנו עומדים</div>
      <ul class="haccp-overview-list">
        <li><strong>${activeMembers.length}</strong> חברי צוות פעילים
          ${leaders.length ? `· מוביל: ${escapeHtml(leaders.map((l) => l.name).join(', '))}` : '· עדיין בלי מוביל מערכת'}</li>
        <li><strong>${plans.length}</strong> תכניות לפי משפחות מוצרים
          (מתוך ${groups.length} משפחות במערכת)</li>
        <li>השלבים הפעילים: <strong>3.1 צוות</strong> ו־<strong>3.2 תיאור מוצר</strong></li>
      </ul>
      <p class="haccp-hint">המלצה: הרכב צוות, צור תכנית למשפחה, ואז מלא תיאור מוצר.</p>
      <div class="haccp-inline-row">
        <button type="button" class="btn btn-primary" data-haccp-step="team">צוות HACCP</button>
        <button type="button" class="btn btn-secondary" data-haccp-step="product">תיאור מוצר</button>
      </div>
    </div>`;
}

function renderPrpPreview() {
  return `
    <div class="card">
      <div class="card-title">תכניות קדם (PRP) — תצוגה</div>
      <p class="haccp-hint">
        לפי המדריך, תכניות קדם הן תנאי בסיסי למערכת HACCP.
        בשלב זה מוצגת הרשימה בלבד — ניהול מלא יבוא בהמשך.
      </p>
      <ul class="haccp-prp-list">
        ${HACCP_PRP_TOPICS.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}
      </ul>
    </div>`;
}

function renderSoonStep(step) {
  return `
    <div class="card">
      <div class="card-title">${escapeHtml(step.chapter)} · ${escapeHtml(step.label)}</div>
      <p class="haccp-hint">שלב זה ייבנה בסשן הבא, אחרי שנסיים את צוות ה-HACCP ונתקדם לפי המדריך.</p>
    </div>`;
}

function renderCheckboxGrid(items, selected, nameAttr) {
  const selectedSet = new Set(selected || []);
  return `
    <div class="haccp-check-grid">
      ${items.map((item) => `
        <label class="haccp-check">
          <input type="checkbox" name="${nameAttr}" value="${escapeHtml(item.id)}"
            ${selectedSet.has(item.id) ? 'checked' : ''}>
          <span>${escapeHtml(item.label)}</span>
        </label>`).join('')}
    </div>`;
}

function renderProductSection(activePlan, desc, familyProducts, groupMap) {
  if (!activePlan) {
    return `
      <div class="card">
        <div class="card-title">3.2 · תיאור המוצר</div>
        <p class="haccp-hint">
          תיאור המוצר נשמר לפי משפחת מוצרים. צור או בחר תכנית למעלה (למשל שטרודל / קראנץ)
          ואז מלא את הטופס.
        </p>
      </div>`;
  }

  const familyName = groupMap.get(activePlan.categoryGroupId)?.name || '';
  const productList = familyProducts.length
    ? familyProducts.map((p) => escapeHtml(p.name)).join(' · ')
    : 'אין מוצרים פעילים במשפחה זו';

  const d = desc || {};

  return `
    <div class="card">
      <div class="card-title">3.2 · תיאור המוצר — ${escapeHtml(activePlan.name)}</div>
      <p class="haccp-hint">
        לפי המדריך: תיאור מפורט של המוצר או קבוצת מוצרים דומים, עם מיקוד במאפיינים
        שמשפיעים על בטיחות המזון. משפחה: <strong>${escapeHtml(familyName)}</strong>
      </p>
      <p class="haccp-family-products"><strong>מוצרים במשפחה:</strong> ${productList}</p>

      <form id="haccp-product-form" class="haccp-product-form">
        <div class="form-group">
          <label for="haccp-composition">הרכב המוצר (רשימת רכיבים)</label>
          <textarea id="haccp-composition" rows="3" maxlength="4000"
            placeholder="קמח, מים, שמרים, סוכר…">${escapeHtml(d.composition || '')}</textarea>
          <button type="button" class="btn btn-secondary btn-sm" id="haccp-suggest-composition">
            הצע הרכב ממתכונים
          </button>
        </div>

        <div class="haccp-form-row">
          <div class="form-group">
            <label for="haccp-aw">פעילות מים (aw)</label>
            <input type="text" id="haccp-aw" maxlength="40" value="${escapeHtml(d.waterActivity || '')}"
              placeholder="למשל 0.85 או לא נמדד">
          </div>
          <div class="form-group">
            <label for="haccp-ph">ערך הגבה (pH)</label>
            <input type="text" id="haccp-ph" maxlength="40" value="${escapeHtml(d.phValue || '')}"
              placeholder="למשל 5.2 או לא רלוונטי">
          </div>
        </div>

        <div class="form-group">
          <label for="haccp-preservatives">חומרים משמרים</label>
          <input type="text" id="haccp-preservatives" maxlength="500"
            value="${escapeHtml(d.preservatives || '')}" placeholder="אם אין — כתוב אין">
        </div>

        <div class="form-group">
          <label for="haccp-physchem">מאפיינים פיזיקליים / כימיים נוספים</label>
          <textarea id="haccp-physchem" rows="2" maxlength="2000">${escapeHtml(d.physicalChemicalNotes || '')}</textarea>
        </div>

        <div class="form-group">
          <label for="haccp-micro">מאפיינים מיקרוביולוגיים</label>
          <textarea id="haccp-micro" rows="2" maxlength="2000"
            placeholder="פתוגנים פוטנציאליים, השפעת האפייה על העומס המיקרוביאלי…">${escapeHtml(d.microbiological || '')}</textarea>
        </div>

        <div class="form-group">
          <label>טכנולוגיות עיבוד</label>
          ${renderCheckboxGrid(HACCP_PROCESS_TECHS, d.processTechs, 'haccp-process')}
        </div>

        <div class="form-group">
          <label>אלרגנים / חומרים הגורמים לאי־סבילות</label>
          ${renderCheckboxGrid(HACCP_ALLERGENS, d.allergens, 'haccp-allergen')}
        </div>

        <div class="form-group">
          <label for="haccp-packaging">סוג אריזה ומאפייני מחסום</label>
          <textarea id="haccp-packaging" rows="2" maxlength="1000">${escapeHtml(d.packaging || '')}</textarea>
        </div>

        <div class="form-group">
          <label for="haccp-shelf">חיי מדף מוצהרים</label>
          <input type="text" id="haccp-shelf" maxlength="500" value="${escapeHtml(d.shelfLife || '')}"
            placeholder="למשל 7 ימים בקירור / 3 חודשים בהקפאה">
        </div>

        <div class="form-group">
          <label for="haccp-storage">תנאי אחסון</label>
          <textarea id="haccp-storage" rows="2" maxlength="1000">${escapeHtml(d.storageConditions || '')}</textarea>
        </div>

        <div class="form-group">
          <label for="haccp-distribution">תנאי הפצה</label>
          <textarea id="haccp-distribution" rows="2" maxlength="1000">${escapeHtml(d.distributionConditions || '')}</textarea>
        </div>

        <div class="form-group">
          <label for="haccp-labeling">מידע סימון לבטיחות מזון</label>
          <textarea id="haccp-labeling" rows="2" maxlength="2000"
            placeholder="אלרגנים על התווית, הוראות אחסון, תאריך תפוגה, הוראות חימום…">${escapeHtml(d.labelingInfo || '')}</textarea>
        </div>

        <div class="form-group">
          <label for="haccp-regulatory">דרישות רגולטוריות החלות על המוצר</label>
          <textarea id="haccp-regulatory" rows="2" maxlength="2000"
            placeholder="קריטריונים מיקרוביולוגיים, מגבלות תוספים, טמפרטורות עיבוד מחייבות…">${escapeHtml(d.regulatoryRequirements || '')}</textarea>
        </div>

        <div class="form-group">
          <label for="haccp-desc-notes">הערות</label>
          <textarea id="haccp-desc-notes" rows="2" maxlength="2000">${escapeHtml(d.notes || '')}</textarea>
        </div>

        <button type="submit" class="btn btn-primary" id="haccp-save-product">שמור תיאור מוצר</button>
      </form>
    </div>`;
}

function renderTeamSection(members) {
  const roleOptions = HACCP_TEAM_ROLES
    .map((r) => `<option value="${r.id}">${escapeHtml(r.label)}</option>`)
    .join('');

  const rows = members.length
    ? members.map((m) => `
        <div class="haccp-member-row ${m.active === false ? 'is-inactive' : ''}">
          <div class="haccp-member-main">
            <div class="haccp-member-name">
              ${escapeHtml(m.name)}
              ${m.isLeader ? '<span class="badge haccp-leader-badge">מוביל מערכת</span>' : ''}
              ${m.active === false ? '<span class="badge">לא פעיל</span>' : ''}
            </div>
            <div class="haccp-member-role">${escapeHtml(haccpRoleLabel(m.role))}</div>
            ${m.authorityNotes ? `<div class="haccp-member-notes">${escapeHtml(m.authorityNotes)}</div>` : ''}
          </div>
          <div class="haccp-member-actions">
            <button type="button" class="btn btn-secondary btn-sm haccp-edit-member" data-id="${m.id}">ערוך</button>
            <button type="button" class="btn btn-danger btn-sm haccp-del-member" data-id="${m.id}">מחק</button>
          </div>
        </div>`).join('')
    : `<p class="haccp-hint">עדיין אין חברי צוות. הוסף לפחות מוביל מערכת ונציגים מייצור / איכות.</p>`;

  return `
    <div class="card">
      <div class="card-title">3.1 · צוות HACCP והגדרת סמכויות</div>
      <p class="haccp-hint">
        צוות רב־תחומי המוכר על ידי הנהלת המפעל. לכל חבר מוגדרות אחריות וסמכות כתובות,
        כולל מוביל מערכת בעל יכולת לקבל החלטות ולדרוש משאבים.
      </p>

      <div class="haccp-add-member">
        <div class="form-group">
          <label for="haccp-member-name">שם</label>
          <input type="text" id="haccp-member-name" placeholder="שם מלא" maxlength="80">
        </div>
        <div class="form-group">
          <label for="haccp-member-role">תחום</label>
          <select id="haccp-member-role">${roleOptions}</select>
        </div>
        <div class="form-group">
          <label for="haccp-member-notes">סמכויות / הערות</label>
          <input type="text" id="haccp-member-notes" placeholder="למשל: אישור פעולות מתקנות" maxlength="500">
        </div>
        <label class="haccp-check">
          <input type="checkbox" id="haccp-member-leader">
          <span>מוביל מערכת</span>
        </label>
        <button type="button" class="btn btn-primary" id="haccp-add-member">הוסף לצוות</button>
      </div>

      <div class="haccp-member-list">
        ${rows}
      </div>
    </div>`;
}

function bindHaccpEvents(container, ctx) {
  container.querySelectorAll('[data-haccp-step]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.haccpStep;
      if (!id) return;
      container.dataset.haccpStep = id;
      renderHaccp(container);
    });
  });

  document.getElementById('haccp-active-plan')?.addEventListener('change', async (e) => {
    try {
      await setActiveHaccpPlanId(e.target.value || null);
      showToast('תכנית נבחרה ✓');
      renderHaccp(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  document.getElementById('haccp-create-plan')?.addEventListener('click', async () => {
    const gid = document.getElementById('haccp-new-family')?.value;
    if (!gid) return showToast('בחר משפחת מוצרים');
    try {
      await ensureHaccpPlanForGroup(gid);
      showToast('תכנית נוצרה ✓');
      renderHaccp(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  document.getElementById('haccp-rename-plan')?.addEventListener('click', () => {
    if (!ctx.activePlan) return;
    openModal({
      title: 'שינוי שם תכנית',
      bodyHTML: `
        <div class="form-group">
          <label for="haccp-plan-name">שם</label>
          <input type="text" id="haccp-plan-name" value="${escapeHtml(ctx.activePlan.name)}" maxlength="80">
        </div>`,
      footerHTML: `<button class="btn btn-secondary modal-cancel">ביטול</button>
        <button class="btn btn-primary" id="haccp-save-plan-name">שמור</button>`,
    });
    document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
    document.getElementById('haccp-save-plan-name')?.addEventListener('click', async () => {
      try {
        await updateHaccpPlan(ctx.activePlan.id, {
          name: document.getElementById('haccp-plan-name').value,
        });
        closeModal();
        showToast('עודכן ✓');
        renderHaccp(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  document.getElementById('haccp-delete-plan')?.addEventListener('click', async () => {
    if (!ctx.activePlan) return;
    if (!confirm(`למחוק את התכנית "${ctx.activePlan.name}"?`)) return;
    try {
      await deleteHaccpPlan(ctx.activePlan.id);
      showToast('התכנית נמחקה');
      renderHaccp(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  document.getElementById('haccp-add-member')?.addEventListener('click', async () => {
    try {
      await addHaccpTeamMember({
        name: document.getElementById('haccp-member-name')?.value,
        role: document.getElementById('haccp-member-role')?.value,
        authorityNotes: document.getElementById('haccp-member-notes')?.value,
        isLeader: document.getElementById('haccp-member-leader')?.checked,
      });
      showToast('נוסף לצוות ✓');
      renderHaccp(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  container.querySelectorAll('.haccp-del-member').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('למחוק חבר צוות?')) return;
      try {
        await deleteHaccpTeamMember(btn.dataset.id);
        showToast('נמחק');
        renderHaccp(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  container.querySelectorAll('.haccp-edit-member').forEach((btn) => {
    btn.addEventListener('click', () => {
      const member = ctx.members.find((m) => String(m.id) === String(btn.dataset.id));
      if (!member) return;
      const roleOptions = HACCP_TEAM_ROLES.map((r) =>
        `<option value="${r.id}" ${member.role === r.id ? 'selected' : ''}>${escapeHtml(r.label)}</option>`).join('');
      openModal({
        title: 'עריכת חבר צוות',
        bodyHTML: `
          <div class="form-group">
            <label for="edit-haccp-name">שם</label>
            <input type="text" id="edit-haccp-name" value="${escapeHtml(member.name)}" maxlength="80">
          </div>
          <div class="form-group">
            <label for="edit-haccp-role">תחום</label>
            <select id="edit-haccp-role">${roleOptions}</select>
          </div>
          <div class="form-group">
            <label for="edit-haccp-notes">סמכויות / הערות</label>
            <input type="text" id="edit-haccp-notes" value="${escapeHtml(member.authorityNotes || '')}" maxlength="500">
          </div>
          <label class="haccp-check">
            <input type="checkbox" id="edit-haccp-leader" ${member.isLeader ? 'checked' : ''}>
            <span>מוביל מערכת</span>
          </label>
          <label class="haccp-check">
            <input type="checkbox" id="edit-haccp-active" ${member.active !== false ? 'checked' : ''}>
            <span>פעיל</span>
          </label>`,
        footerHTML: `<button class="btn btn-secondary modal-cancel">ביטול</button>
          <button class="btn btn-primary" id="save-haccp-member">שמור</button>`,
      });
      document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
      document.getElementById('save-haccp-member')?.addEventListener('click', async () => {
        try {
          await updateHaccpTeamMember(member.id, {
            name: document.getElementById('edit-haccp-name').value,
            role: document.getElementById('edit-haccp-role').value,
            authorityNotes: document.getElementById('edit-haccp-notes').value,
            isLeader: document.getElementById('edit-haccp-leader').checked,
            active: document.getElementById('edit-haccp-active').checked,
          });
          closeModal();
          showToast('עודכן ✓');
          renderHaccp(container);
        } catch (err) {
          showToast(err.message || 'שגיאה');
        }
      });
    });
  });

  document.getElementById('haccp-suggest-composition')?.addEventListener('click', async () => {
    if (!ctx.activePlan) return;
    try {
      const suggestion = await suggestCompositionForHaccpPlan(ctx.activePlan.id);
      const el = document.getElementById('haccp-composition');
      if (!el) return;
      if (!suggestion) {
        showToast('לא נמצא הרכב במתכונים למשפחה זו');
        return;
      }
      if (el.value.trim() && !confirm('להחליף את ההרכב הקיים בהצעה מהמתכונים?')) return;
      el.value = suggestion;
      showToast('הוצע הרכב ✓');
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  document.getElementById('haccp-product-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!ctx.activePlan) return showToast('בחר תכנית קודם');
    const checked = (name) =>
      [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((el) => el.value);
    try {
      await saveHaccpProductDescription(ctx.activePlan.id, {
        composition: document.getElementById('haccp-composition')?.value,
        waterActivity: document.getElementById('haccp-aw')?.value,
        phValue: document.getElementById('haccp-ph')?.value,
        preservatives: document.getElementById('haccp-preservatives')?.value,
        physicalChemicalNotes: document.getElementById('haccp-physchem')?.value,
        microbiological: document.getElementById('haccp-micro')?.value,
        processTechs: checked('haccp-process'),
        packaging: document.getElementById('haccp-packaging')?.value,
        shelfLife: document.getElementById('haccp-shelf')?.value,
        storageConditions: document.getElementById('haccp-storage')?.value,
        distributionConditions: document.getElementById('haccp-distribution')?.value,
        allergens: checked('haccp-allergen'),
        labelingInfo: document.getElementById('haccp-labeling')?.value,
        regulatoryRequirements: document.getElementById('haccp-regulatory')?.value,
        notes: document.getElementById('haccp-desc-notes')?.value,
      });
      showToast('תיאור המוצר נשמר ✓');
      renderHaccp(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });
}
