import { getCategoryGroups } from '../db.js?v=401';
import { escapeHtml, showToast, todayISO, formatDateHebrew } from '../utils.js?v=401';
import { openModal, closeModal } from '../modal.js?v=401';
import {
  HACCP_STEPS,
  HACCP_PRP_TOPICS,
  HACCP_TEAM_ROLES,
  HACCP_PLAN_STATUSES,
  HACCP_ALLERGENS,
  HACCP_PROCESS_TECHS,
  HACCP_CONSUMPTION_MODES,
  HACCP_USE_CHANNELS,
  HACCP_SENSITIVE_GROUPS,
  HACCP_FLOW_STEP_KINDS,
  HACCP_FLOW_MATCH_RESULTS,
  HACCP_HAZARD_TYPES,
  HACCP_RISK_LEVELS,
  HACCP_CCP_TREE_QUESTIONS,
  haccpRoleLabel,
  haccpFlowStepKindLabel,
  haccpFlowMatchLabel,
  haccpHazardTypeLabel,
  haccpRiskLevelLabel,
  haccpCcpDecisionLabel,
  evaluateCcpDecisionTree,
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
  getHaccpIntendedUse,
  saveHaccpIntendedUse,
  getHaccpFlowSteps,
  addHaccpFlowStep,
  updateHaccpFlowStep,
  deleteHaccpFlowStep,
  moveHaccpFlowStep,
  seedDefaultHaccpFlowSteps,
  listProductionFlowsForHaccpPlan,
  importHaccpFlowFromProduction,
  getHaccpFlowVerifications,
  addHaccpFlowVerification,
  deleteHaccpFlowVerification,
  getHaccpHazards,
  addHaccpHazard,
  updateHaccpHazard,
  deleteHaccpHazard,
  seedSuggestedHazardsForStep,
  getHaccpCcps,
  getHaccpCcpCandidates,
  addHaccpCcp,
  addHaccpCcpFromHazard,
  updateHaccpCcp,
  deleteHaccpCcp,
  getConfirmedHaccpCcps,
  getHaccpCriticalLimits,
  addHaccpCriticalLimit,
  updateHaccpCriticalLimit,
  deleteHaccpCriticalLimit,
  seedSuggestedLimitsForCcp,
  HACCP_LIMIT_PARAMETERS,
  HACCP_LIMIT_OPERATORS,
  formatCriticalLimit,
  haccpLimitParameterLabel,
  haccpLimitOperatorLabel,
} from '../haccp-db.js?v=401';

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
  let intendedUse = null;
  let flowSteps = [];
  let productionFlows = [];
  let flowVerifications = [];
  let hazards = [];
  let ccps = [];
  let ccpCandidates = [];
  let criticalLimits = [];
  if (step.id === 'product' && activePlan) {
    [productDesc, familyProducts] = await Promise.all([
      getHaccpProductDescription(activePlan.id),
      getProductsForHaccpPlan(activePlan.id),
    ]);
  }
  if (step.id === 'intended_use' && activePlan) {
    intendedUse = await getHaccpIntendedUse(activePlan.id);
  }
  if (step.id === 'flow' && activePlan) {
    [flowSteps, productionFlows] = await Promise.all([
      getHaccpFlowSteps(activePlan.id),
      listProductionFlowsForHaccpPlan(activePlan.id),
    ]);
  }
  if (step.id === 'flow_verify' && activePlan) {
    [flowSteps, flowVerifications] = await Promise.all([
      getHaccpFlowSteps(activePlan.id),
      getHaccpFlowVerifications(activePlan.id),
    ]);
  }
  if (step.id === 'hazard' && activePlan) {
    [flowSteps, hazards] = await Promise.all([
      getHaccpFlowSteps(activePlan.id),
      getHaccpHazards(activePlan.id),
    ]);
  }
  if (step.id === 'ccp' && activePlan) {
    [flowSteps, hazards, ccps, ccpCandidates] = await Promise.all([
      getHaccpFlowSteps(activePlan.id),
      getHaccpHazards(activePlan.id),
      getHaccpCcps(activePlan.id),
      getHaccpCcpCandidates(activePlan.id),
    ]);
  }
  if (step.id === 'limits' && activePlan) {
    [flowSteps, ccps, criticalLimits] = await Promise.all([
      getHaccpFlowSteps(activePlan.id),
      getConfirmedHaccpCcps(activePlan.id),
      getHaccpCriticalLimits(activePlan.id),
    ]);
  }

  let body = '';
  if (step.id === 'overview') body = renderOverview(members, plans, groups);
  else if (step.id === 'prp') body = renderPrpPreview();
  else if (step.id === 'team') body = renderTeamSection(members);
  else if (step.id === 'product') {
    body = renderProductSection(activePlan, productDesc, familyProducts, groupMap);
  } else if (step.id === 'intended_use') {
    body = renderIntendedUseSection(activePlan, intendedUse, groupMap);
  } else if (step.id === 'flow') {
    body = renderFlowSection(activePlan, flowSteps, productionFlows, groupMap);
  } else if (step.id === 'flow_verify') {
    body = renderFlowVerifySection(activePlan, flowSteps, flowVerifications, members, groupMap);
  } else if (step.id === 'hazard') {
    body = renderHazardSection(activePlan, flowSteps, hazards, groupMap);
  } else if (step.id === 'ccp') {
    body = renderCcpSection(activePlan, flowSteps, hazards, ccps, ccpCandidates, groupMap);
  } else if (step.id === 'limits') {
    body = renderLimitsSection(activePlan, flowSteps, ccps, criticalLimits, groupMap);
  } else body = renderSoonStep(step);

  container.innerHTML = `
    <div class="haccp-screen">
      <div class="card haccp-hero">
        <div class="card-title">מערכת בקרת בטיחות מזון עצמית מבוססת HACCP</div>
        <p class="haccp-hero-text">
          לפי מדריך משרד הבריאות — נבנה שלב־שלב: צוות, תיאור מוצר, שימוש מיועד,
          תרשים זרימה ואימות בשטח, ואז ניתוח סיכונים ונקודות בקרה קריטיות.
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

  bindHaccpEvents(container, {
    members, plans, groups, activePlan, productDesc, flowSteps, productionFlows, flowVerifications, hazards, ccps, ccpCandidates, criticalLimits,
  });
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
        <li>השלבים הפעילים: עד <strong>5.3 גבולות קריטיים</strong></li>
      </ul>
      <p class="haccp-hint">המלצה: אחרי קביעת CCP — הגדר גבול מדיד לכל נקודה.</p>
      <div class="haccp-inline-row">
        <button type="button" class="btn btn-primary" data-haccp-step="ccp">נקודות CCP</button>
        <button type="button" class="btn btn-secondary" data-haccp-step="limits">גבולות קריטיים</button>
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
      <p class="haccp-hint">שלב זה ייבנה בהמשך, אחרי גבולות בקרה קריטיים — לפי סדר המדריך.</p>
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

function renderIntendedUseSection(activePlan, use, groupMap) {
  if (!activePlan) {
    return `
      <div class="card">
        <div class="card-title">3.3 · שימוש מיועד</div>
        <p class="haccp-hint">
          השימוש המיועד נשמר לפי משפחת מוצרים. בחר או צור תכנית למעלה ואז מלא את הטופס.
        </p>
      </div>`;
  }

  const familyName = groupMap.get(activePlan.categoryGroupId)?.name || '';
  const u = use || {};

  return `
    <div class="card">
      <div class="card-title">3.3 · שימוש מיועד — ${escapeHtml(activePlan.name)}</div>
      <p class="haccp-hint">
        לפי המדריך: הגדרת אוכלוסיית היעד ואופן צריכת המוצר, עם דגש מיוחד על אוכלוסיות רגישות.
        משפחה: <strong>${escapeHtml(familyName)}</strong>
      </p>

      <form id="haccp-intended-form" class="haccp-product-form">
        <div class="form-group">
          <label>אופן צריכה צפוי</label>
          ${renderCheckboxGrid(HACCP_CONSUMPTION_MODES, u.consumptionModes, 'haccp-consume')}
        </div>

        <div class="form-group">
          <label for="haccp-audience">אוכלוסיית יעד</label>
          <textarea id="haccp-audience" rows="2" maxlength="2000"
            placeholder="למשל: צרכנים פרטיים, בתי קפה, מוסדות חינוך…">${escapeHtml(u.targetAudience || '')}</textarea>
        </div>

        <div class="form-group">
          <label>ערוצי הפצה / צריכה</label>
          ${renderCheckboxGrid(HACCP_USE_CHANNELS, u.channels, 'haccp-channel')}
        </div>

        <div class="form-group">
          <label>אוכלוסיות רגישות שיש להתייחס אליהן</label>
          ${renderCheckboxGrid(HACCP_SENSITIVE_GROUPS, u.sensitiveGroups, 'haccp-sensitive')}
        </div>

        <div class="form-group">
          <label for="haccp-sensitive-notes">הערות לגבי אוכלוסיות רגישות</label>
          <textarea id="haccp-sensitive-notes" rows="2" maxlength="2000"
            placeholder="סיכונים ייחודיים, הגבלות צריכה, אזהרות על התווית…">${escapeHtml(u.sensitiveNotes || '')}</textarea>
        </div>

        <div class="form-group">
          <label for="haccp-consumer-instructions">הוראות לצרכן / הכנה לפני אכילה</label>
          <textarea id="haccp-consumer-instructions" rows="2" maxlength="2000"
            placeholder="חימום, הפשרה, אחסון בבית אחרי פתיחה…">${escapeHtml(u.consumerInstructions || '')}</textarea>
        </div>

        <div class="form-group">
          <label for="haccp-misuse">שימוש לא מיועד / שימוש לרעה אפשרי</label>
          <textarea id="haccp-misuse" rows="2" maxlength="2000"
            placeholder="למשל: אכילה אחרי תום תוקף, אחסון מחוץ לקירור, הגשה לתינוקות…">${escapeHtml(u.potentialMisuse || '')}</textarea>
        </div>

        <div class="form-group">
          <label for="haccp-not-suitable">למי המוצר אינו מיועד</label>
          <textarea id="haccp-not-suitable" rows="2" maxlength="2000"
            placeholder="אם רלוונטי — קבוצות שיש להימנע מצריכה">${escapeHtml(u.notSuitableFor || '')}</textarea>
        </div>

        <div class="form-group">
          <label for="haccp-use-notes">הערות</label>
          <textarea id="haccp-use-notes" rows="2" maxlength="2000">${escapeHtml(u.notes || '')}</textarea>
        </div>

        <button type="submit" class="btn btn-primary" id="haccp-save-intended">שמור שימוש מיועד</button>
      </form>
    </div>`;
}

function renderFlowSection(activePlan, flowSteps, productionFlows, groupMap) {
  if (!activePlan) {
    return `
      <div class="card">
        <div class="card-title">3.4 · תרשים זרימה</div>
        <p class="haccp-hint">
          תרשים הזרימה נשמר לפי משפחת מוצרים. בחר או צור תכנית למעלה ואז בנה את השלבים.
        </p>
      </div>`;
  }

  const familyName = groupMap.get(activePlan.categoryGroupId)?.name || '';
  const kindOptions = HACCP_FLOW_STEP_KINDS.map((k) =>
    `<option value="${k.id}">${escapeHtml(k.label)}</option>`).join('');

  const importOptions = productionFlows.length
    ? productionFlows.map((f) =>
      `<option value="${f.id}">${escapeHtml(f.name)} (${f.stepCount} שלבים)</option>`).join('')
    : '';

  const diagram = flowSteps.length
    ? `
      <ol class="haccp-flow-diagram">
        ${flowSteps.map((s, i) => `
          <li class="haccp-flow-node ${s.isCcpCandidate ? 'is-ccp' : ''}">
            <div class="haccp-flow-node-index">${i + 1}</div>
            <div class="haccp-flow-node-body">
              <div class="haccp-flow-node-title">
                ${escapeHtml(s.name)}
                ${s.isCcpCandidate ? '<span class="badge">מועמד CCP</span>' : ''}
              </div>
              <div class="haccp-flow-node-kind">${escapeHtml(haccpFlowStepKindLabel(s.stepKind))}</div>
              ${s.description ? `<div class="haccp-flow-node-desc">${escapeHtml(s.description)}</div>` : ''}
            </div>
            <div class="haccp-flow-node-actions">
              <button type="button" class="btn btn-secondary btn-sm haccp-flow-up" data-id="${s.id}"
                ${i === 0 ? 'disabled' : ''} title="למעלה">↑</button>
              <button type="button" class="btn btn-secondary btn-sm haccp-flow-down" data-id="${s.id}"
                ${i === flowSteps.length - 1 ? 'disabled' : ''} title="למטה">↓</button>
              <button type="button" class="btn btn-secondary btn-sm haccp-flow-edit" data-id="${s.id}">ערוך</button>
              <button type="button" class="btn btn-danger btn-sm haccp-flow-del" data-id="${s.id}">מחק</button>
            </div>
          </li>`).join('')}
      </ol>`
    : `<p class="haccp-hint">עדיין אין שלבים. הוסף ידנית, זרע ברירת מחדל למאפייה, או ייבא מתזרים ייצור.</p>`;

  return `
    <div class="card">
      <div class="card-title">3.4 · תרשים זרימה — ${escapeHtml(activePlan.name)}</div>
      <p class="haccp-hint">
        לפי המדריך: תרשים של כל תהליכי הייצור למשפחה, כולל חומרי גלם, אריזות וזרימת המוצר במפעל.
        משפחה: <strong>${escapeHtml(familyName)}</strong>
      </p>

      <div class="haccp-flow-toolbar">
        <button type="button" class="btn btn-secondary btn-sm" id="haccp-flow-seed"
          ${flowSteps.length ? 'disabled' : ''}>זרע שלבי מאפייה</button>
        <div class="haccp-inline-row haccp-flow-import">
          <select id="haccp-flow-import-source" ${productionFlows.length ? '' : 'disabled'}>
            <option value="">${productionFlows.length ? 'ייבוא מתזרים ייצור…' : 'אין תזרימי ייצור למשפחה'}</option>
            ${importOptions}
          </select>
          <button type="button" class="btn btn-secondary btn-sm" id="haccp-flow-import"
            ${productionFlows.length ? '' : 'disabled'}>ייבא</button>
        </div>
      </div>

      ${diagram}

      <div class="haccp-add-member haccp-flow-add">
        <div class="form-group">
          <label for="haccp-flow-name">שם שלב</label>
          <input type="text" id="haccp-flow-name" maxlength="120" placeholder="למשל: אפייה">
        </div>
        <div class="form-group">
          <label for="haccp-flow-kind">סוג שלב</label>
          <select id="haccp-flow-kind">${kindOptions}</select>
        </div>
        <div class="form-group">
          <label for="haccp-flow-desc">תיאור קצר</label>
          <input type="text" id="haccp-flow-desc" maxlength="1000" placeholder="אופציונלי">
        </div>
        <label class="haccp-check">
          <input type="checkbox" id="haccp-flow-ccp">
          <span>מועמד ל־CCP (לשלב 5.2)</span>
        </label>
        <button type="button" class="btn btn-primary" id="haccp-flow-add">הוסף שלב</button>
      </div>
    </div>`;
}

function verifierNames(v, memberMap) {
  const fromMembers = (v.verifierMemberIds || [])
    .map((id) => memberMap.get(Number(id)) || memberMap.get(String(id)))
    .filter(Boolean)
    .map((m) => m.name);
  const extras = String(v.verifiedByText || '').trim();
  const parts = [...fromMembers];
  if (extras) parts.push(extras);
  return parts.length ? parts.join(', ') : '—';
}

function renderFlowVerifySection(activePlan, flowSteps, verifications, members, groupMap) {
  if (!activePlan) {
    return `
      <div class="card">
        <div class="card-title">3.5 · אימות תרשים בשטח</div>
        <p class="haccp-hint">בחר או צור תכנית למעלה, ואז אמת את תרשים הזרימה מול התהליך בפועל.</p>
      </div>`;
  }

  const familyName = groupMap.get(activePlan.categoryGroupId)?.name || '';
  const memberMap = new Map(members.map((m) => [m.id, m]));
  const activeMembers = members.filter((m) => m.active !== false);
  const latest = verifications[0] || null;
  const matchOptions = HACCP_FLOW_MATCH_RESULTS.map((r) =>
    `<option value="${r.id}">${escapeHtml(r.label)}</option>`).join('');

  const memberChecks = activeMembers.length
    ? renderCheckboxGrid(
      activeMembers.map((m) => ({
        id: String(m.id),
        label: `${m.name}${m.isLeader ? ' (מוביל)' : ''}`,
      })),
      [],
      'haccp-verifier',
    )
    : `<p class="haccp-hint">אין חברי צוות פעילים — הוסף ב־3.1 או הזן שמות ידנית.</p>`;

  const flowPreview = flowSteps.length
    ? `<p class="haccp-family-products"><strong>תרשים נוכחי (${flowSteps.length}):</strong>
        ${flowSteps.map((s) => escapeHtml(s.name)).join(' → ')}</p>`
    : `<p class="haccp-hint">אין שלבים בתרשים.
        <button type="button" class="btn btn-secondary btn-sm" data-haccp-step="flow">עבור ל־3.4</button></p>`;

  const latestCard = latest
    ? `
      <div class="haccp-verify-latest">
        <div class="haccp-verify-latest-title">אימות אחרון</div>
        <div><strong>${escapeHtml(formatDateHebrew(latest.verifiedAt) || latest.verifiedAt)}</strong>
          · ${escapeHtml(haccpFlowMatchLabel(latest.matchResult))}</div>
        <div class="haccp-verify-meta">מאמתים: ${escapeHtml(verifierNames(latest, memberMap))}</div>
        <div class="haccp-verify-flags">
          ${latest.walkedOnSite ? '<span class="badge">סיור בשטח</span>' : ''}
          ${latest.packagingIncluded ? '<span class="badge">כולל אריזות</span>' : ''}
          ${latest.allStepsPresent ? '<span class="badge">כל השלבים</span>' : ''}
          ${latest.noUnauthorizedChanges ? '<span class="badge">ללא שינויים לא מתועדים</span>' : ''}
        </div>
        ${latest.discrepancies ? `<div class="haccp-verify-note"><strong>פערים:</strong> ${escapeHtml(latest.discrepancies)}</div>` : ''}
        ${latest.correctionsMade ? `<div class="haccp-verify-note"><strong>תיקונים:</strong> ${escapeHtml(latest.correctionsMade)}</div>` : ''}
      </div>`
    : `<p class="haccp-hint">עדיין לא נרשם אימות בשטח לתכנית זו.</p>`;

  const history = verifications.length > 1
    ? `
      <div class="haccp-verify-history">
        <div class="card-title" style="font-size:1rem">היסטוריית אימותים</div>
        ${verifications.slice(1).map((v) => `
          <div class="haccp-verify-history-row">
            <div>
              <strong>${escapeHtml(formatDateHebrew(v.verifiedAt) || v.verifiedAt)}</strong>
              · ${escapeHtml(haccpFlowMatchLabel(v.matchResult))}
              <div class="haccp-verify-meta">${escapeHtml(verifierNames(v, memberMap))}
                · ${v.stepCountSnapshot || 0} שלבים</div>
            </div>
            <button type="button" class="btn btn-danger btn-sm haccp-verify-del" data-id="${v.id}">מחק</button>
          </div>`).join('')}
      </div>`
    : '';

  const deleteLatest = latest
    ? `<button type="button" class="btn btn-danger btn-sm haccp-verify-del" data-id="${latest.id}">מחק אימות אחרון</button>`
    : '';

  return `
    <div class="card">
      <div class="card-title">3.5 · אימות תרשים בשטח — ${escapeHtml(activePlan.name)}</div>
      <p class="haccp-hint">
        לפי המדריך: יש לאמת שהתרשים תואם את התהליך בפועל במפעל (סיור בשטח),
        כולל חומרי אריזה וכל מרכיבי המוצר. משפחה: <strong>${escapeHtml(familyName)}</strong>
      </p>
      ${flowPreview}
      ${latestCard}
      ${deleteLatest}
      ${history}

      <form id="haccp-verify-form" class="haccp-product-form haccp-verify-form">
        <div class="card-title" style="font-size:1rem;margin-top:8px">רישום אימות חדש</div>
        <div class="haccp-form-row">
          <div class="form-group">
            <label for="haccp-verify-date">תאריך אימות</label>
            <input type="date" id="haccp-verify-date" value="${escapeHtml(todayISO())}" required>
          </div>
          <div class="form-group">
            <label for="haccp-verify-match">תוצאה</label>
            <select id="haccp-verify-match">${matchOptions}</select>
          </div>
        </div>

        <div class="form-group">
          <label>חברי צוות מאמתים</label>
          ${memberChecks}
        </div>

        <div class="form-group">
          <label for="haccp-verify-by-text">שמות נוספים (אופציונלי)</label>
          <input type="text" id="haccp-verify-by-text" maxlength="500"
            placeholder="אם לא מסומנים חברי צוות מהרשימה">
        </div>

        <div class="form-group">
          <label>צ׳קליסט סיור</label>
          <div class="haccp-check-grid">
            <label class="haccp-check">
              <input type="checkbox" id="haccp-verify-walked" checked>
              <span>בוצע סיור בשטח מול התרשים</span>
            </label>
            <label class="haccp-check">
              <input type="checkbox" id="haccp-verify-packaging">
              <span>חומרי אריזה ומרכיבים נכללו</span>
            </label>
            <label class="haccp-check">
              <input type="checkbox" id="haccp-verify-all-steps">
              <span>כל שלבי התהליך מופיעים</span>
            </label>
            <label class="haccp-check">
              <input type="checkbox" id="haccp-verify-no-extra">
              <span>אין שינויים לא מתועדים בתהליך</span>
            </label>
          </div>
        </div>

        <div class="form-group">
          <label for="haccp-verify-discrepancies">פערים שנמצאו</label>
          <textarea id="haccp-verify-discrepancies" rows="2" maxlength="2000"
            placeholder="אם התרשים לא תאם — מה היה חסר / מיותר / שונה"></textarea>
        </div>

        <div class="form-group">
          <label for="haccp-verify-corrections">תיקונים שבוצעו בתרשים</label>
          <textarea id="haccp-verify-corrections" rows="2" maxlength="2000"
            placeholder="מה עודכן ב־3.4 בעקבות האימות"></textarea>
        </div>

        <div class="form-group">
          <label for="haccp-verify-notes">הערות</label>
          <textarea id="haccp-verify-notes" rows="2" maxlength="2000"></textarea>
        </div>

        <button type="submit" class="btn btn-primary" id="haccp-verify-save"
          ${flowSteps.length ? '' : 'disabled'}>שמור אימות</button>
      </form>
    </div>`;
}

function riskOptions(selected) {
  return HACCP_RISK_LEVELS.map((l) =>
    `<option value="${l.id}" ${selected === l.id ? 'selected' : ''}>${escapeHtml(l.label)}</option>`
  ).join('');
}

function hazardTypeOptions(selected) {
  return HACCP_HAZARD_TYPES.map((t) =>
    `<option value="${t.id}" ${selected === t.id ? 'selected' : ''}>${escapeHtml(t.label)}</option>`
  ).join('');
}

function renderHazardSection(activePlan, flowSteps, hazards, groupMap) {
  if (!activePlan) {
    return `
      <div class="card">
        <div class="card-title">5.1 · ניתוח גורמי סיכון</div>
        <p class="haccp-hint">בחר תכנית למעלה. הניתוח נעשה לפי שלבי תרשים הזרימה של המשפחה.</p>
      </div>`;
  }

  const familyName = groupMap.get(activePlan.categoryGroupId)?.name || '';
  if (!flowSteps.length) {
    return `
      <div class="card">
        <div class="card-title">5.1 · ניתוח גורמי סיכון — ${escapeHtml(activePlan.name)}</div>
        <p class="haccp-hint">אין תרשים זרימה. יש לבנות קודם את שלב 3.4.</p>
        <button type="button" class="btn btn-primary" data-haccp-step="flow">עבור לתרשים זרימה</button>
      </div>`;
  }

  const byStep = new Map();
  for (const h of hazards) {
    const key = Number(h.flowStepId);
    if (!byStep.has(key)) byStep.set(key, []);
    byStep.get(key).push(h);
  }

  const significantCount = hazards.filter((h) => h.significant).length;
  const ccpCount = hazards.filter((h) => h.isCcpCandidate).length;
  const coveredSteps = new Set(hazards.map((h) => Number(h.flowStepId))).size;

  const stepOptions = flowSteps.map((s) =>
    `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');

  const stepBlocks = flowSteps.map((step, idx) => {
    const list = byStep.get(Number(step.id)) || [];
    const rows = list.length
      ? list.map((h) => `
          <div class="haccp-hazard-row ${h.significant ? 'is-significant' : ''}">
            <div class="haccp-hazard-main">
              <div class="haccp-hazard-title">
                <span class="badge haccp-hazard-type">${escapeHtml(haccpHazardTypeLabel(h.hazardType))}</span>
                ${escapeHtml(h.description)}
                ${h.significant ? '<span class="badge">משמעותי</span>' : ''}
                ${h.isCcpCandidate ? '<span class="badge">מועמד CCP</span>' : ''}
                ${h.controlledByPrp ? '<span class="badge">PRP</span>' : ''}
              </div>
              <div class="haccp-hazard-meta">
                הסתברות: ${escapeHtml(haccpRiskLevelLabel(h.likelihood))}
                · חומרה: ${escapeHtml(haccpRiskLevelLabel(h.severity))}
                ${h.source ? `· מקור: ${escapeHtml(h.source)}` : ''}
              </div>
              ${h.controlMeasures ? `<div class="haccp-hazard-ctrl"><strong>בקרה:</strong> ${escapeHtml(h.controlMeasures)}</div>` : ''}
            </div>
            <div class="haccp-hazard-actions">
              <button type="button" class="btn btn-secondary btn-sm haccp-hazard-edit" data-id="${h.id}">ערוך</button>
              <button type="button" class="btn btn-danger btn-sm haccp-hazard-del" data-id="${h.id}">מחק</button>
            </div>
          </div>`).join('')
      : `<p class="haccp-hint">אין גורמי סיכון לשלב זה עדיין.</p>`;

    return `
      <section class="haccp-hazard-step">
        <div class="haccp-hazard-step-head">
          <div>
            <strong>${idx + 1}. ${escapeHtml(step.name)}</strong>
            <span class="haccp-hazard-meta"> · ${escapeHtml(haccpFlowStepKindLabel(step.stepKind))}
              · ${list.length} סיכונים</span>
          </div>
          <button type="button" class="btn btn-secondary btn-sm haccp-hazard-seed" data-step-id="${step.id}">
            הצע סיכונים
          </button>
        </div>
        ${rows}
      </section>`;
  }).join('');

  return `
    <div class="card">
      <div class="card-title">5.1 · ניתוח גורמי סיכון — ${escapeHtml(activePlan.name)}</div>
      <p class="haccp-hint">
        לפי המדריך: זיהוי והערכת גורמי סיכון ביולוגיים, כימיים, פיזיקליים ואלרגנים בכל שלב בתרשים,
        כולל אמצעי בקרה. משפחה: <strong>${escapeHtml(familyName)}</strong>
      </p>
      <p class="haccp-family-products">
        <strong>${hazards.length}</strong> גורמי סיכון ·
        <strong>${significantCount}</strong> משמעותיים ·
        <strong>${ccpCount}</strong> מועמדי CCP ·
        כיסוי שלבים: <strong>${coveredSteps}/${flowSteps.length}</strong>
      </p>

      <div class="haccp-hazard-list">
        ${stepBlocks}
      </div>

      <form id="haccp-hazard-form" class="haccp-product-form haccp-hazard-form">
        <div class="card-title" style="font-size:1rem">הוספת גורם סיכון</div>
        <div class="haccp-form-row">
          <div class="form-group">
            <label for="haccp-hazard-step">שלב בתרשים</label>
            <select id="haccp-hazard-step">${stepOptions}</select>
          </div>
          <div class="form-group">
            <label for="haccp-hazard-type">סוג</label>
            <select id="haccp-hazard-type">${hazardTypeOptions('biological')}</select>
          </div>
        </div>
        <div class="form-group">
          <label for="haccp-hazard-desc">תיאור גורם הסיכון</label>
          <input type="text" id="haccp-hazard-desc" maxlength="1000" required
            placeholder="למשל: הישרדות סלמונלה באפייה לא מספקת">
        </div>
        <div class="form-group">
          <label for="haccp-hazard-source">מקור / גורם</label>
          <input type="text" id="haccp-hazard-source" maxlength="500" placeholder="טמפרטורה, ספק, היגיינה…">
        </div>
        <div class="haccp-form-row">
          <div class="form-group">
            <label for="haccp-hazard-likelihood">הסתברות</label>
            <select id="haccp-hazard-likelihood">${riskOptions('medium')}</select>
          </div>
          <div class="form-group">
            <label for="haccp-hazard-severity">חומרה</label>
            <select id="haccp-hazard-severity">${riskOptions('high')}</select>
          </div>
        </div>
        <div class="form-group">
          <label for="haccp-hazard-control">אמצעי בקרה</label>
          <textarea id="haccp-hazard-control" rows="2" maxlength="2000"
            placeholder="מה מונע / מפחית את הסיכון"></textarea>
        </div>
        <div class="haccp-check-grid">
          <label class="haccp-check">
            <input type="checkbox" id="haccp-hazard-significant">
            <span>סיכון משמעותי (אוטומטי לפי הסתברות×חומרה אם לא מסומן)</span>
          </label>
          <label class="haccp-check">
            <input type="checkbox" id="haccp-hazard-prp">
            <span>מבוקר ע״י תכנית קדם (PRP)</span>
          </label>
          <label class="haccp-check">
            <input type="checkbox" id="haccp-hazard-ccp">
            <span>מועמד ל־CCP (לשלב 5.2)</span>
          </label>
        </div>
        <div class="form-group">
          <label for="haccp-hazard-justification">הצדקה</label>
          <textarea id="haccp-hazard-justification" rows="2" maxlength="2000"
            placeholder="מדוע משמעותי / מדוע CCP או PRP"></textarea>
        </div>
        <button type="submit" class="btn btn-primary">הוסף גורם סיכון</button>
      </form>
    </div>`;
}

function yesNoOptions(selected = '') {
  return `
    <option value="" ${!selected ? 'selected' : ''}>— בחר —</option>
    <option value="yes" ${selected === 'yes' ? 'selected' : ''}>כן</option>
    <option value="no" ${selected === 'no' ? 'selected' : ''}>לא</option>`;
}

function renderTreeQuestions(prefix, values = {}) {
  return HACCP_CCP_TREE_QUESTIONS.map((q, i) => `
    <div class="form-group">
      <label for="${prefix}-${q.id}">ש${i + 1}. ${escapeHtml(q.label)}</label>
      <select id="${prefix}-${q.id}" class="haccp-tree-q" data-q="${q.id}">
        ${yesNoOptions(values[q.id] || '')}
      </select>
    </div>`).join('');
}

function renderCcpSection(activePlan, flowSteps, hazards, ccps, candidates, groupMap) {
  if (!activePlan) {
    return `
      <div class="card">
        <div class="card-title">5.2 · נקודות בקרה קריטיות (CCP)</div>
        <p class="haccp-hint">בחר תכנית למעלה. קביעת CCP מתבססת על ניתוח הסיכונים (5.1) ותרשים הזרימה.</p>
      </div>`;
  }

  const familyName = groupMap.get(activePlan.categoryGroupId)?.name || '';
  const stepMap = new Map(flowSteps.map((s) => [s.id, s]));
  const confirmed = ccps.filter((c) => c.decision === 'ccp');
  const other = ccps.filter((c) => c.decision !== 'ccp');

  if (!flowSteps.length) {
    return `
      <div class="card">
        <div class="card-title">5.2 · CCP — ${escapeHtml(activePlan.name)}</div>
        <p class="haccp-hint">אין תרשים זרימה. יש להשלים 3.4 ו־5.1 לפני קביעת CCP.</p>
        <button type="button" class="btn btn-primary" data-haccp-step="flow">עבור לתרשים</button>
      </div>`;
  }

  const confirmedHtml = confirmed.length
    ? confirmed.map((c) => `
        <div class="haccp-ccp-row is-ccp">
          <div>
            <div class="haccp-ccp-title">
              <span class="badge">${escapeHtml(c.code || 'CCP')}</span>
              ${escapeHtml(c.name)}
              <span class="badge haccp-hazard-type">${escapeHtml(haccpHazardTypeLabel(c.hazardType))}</span>
            </div>
            <div class="haccp-hazard-meta">
              שלב: ${escapeHtml(stepMap.get(c.flowStepId)?.name || '—')}
              · ${escapeHtml(c.hazardDescription || '')}
            </div>
            ${c.controlMeasure ? `<div class="haccp-hazard-ctrl"><strong>בקרה:</strong> ${escapeHtml(c.controlMeasure)}</div>` : ''}
            <div class="haccp-tree-summary">
              ש1:${c.q1 || '—'} · ש2:${c.q2 || '—'} · ש3:${c.q3 || '—'} · ש4:${c.q4 || '—'}
            </div>
          </div>
          <div class="haccp-hazard-actions">
            <button type="button" class="btn btn-secondary btn-sm haccp-ccp-edit" data-id="${c.id}">ערוך</button>
            <button type="button" class="btn btn-danger btn-sm haccp-ccp-del" data-id="${c.id}">מחק</button>
          </div>
        </div>`).join('')
    : `<p class="haccp-hint">עדיין אין CCP מאושרים. הרץ עץ החלטות על מועמד מ־5.1.</p>`;

  const candidatesHtml = candidates.length
    ? candidates.map((h) => `
        <div class="haccp-ccp-candidate">
          <div>
            <div class="haccp-hazard-title">
              <span class="badge haccp-hazard-type">${escapeHtml(haccpHazardTypeLabel(h.hazardType))}</span>
              ${escapeHtml(h.description)}
              ${h.significant ? '<span class="badge">משמעותי</span>' : ''}
              ${h.isCcpCandidate ? '<span class="badge">מועמד</span>' : ''}
            </div>
            <div class="haccp-hazard-meta">
              שלב: ${escapeHtml(stepMap.get(h.flowStepId)?.name || '—')}
              ${h.controlMeasures ? `· בקרה: ${escapeHtml(h.controlMeasures)}` : ''}
            </div>
          </div>
          <button type="button" class="btn btn-primary btn-sm haccp-ccp-from-hazard" data-hazard-id="${h.id}">
            עץ החלטות
          </button>
        </div>`).join('')
    : `<p class="haccp-hint">אין מועמדים ממתינים.
        ${hazards.length ? 'כל הסיכונים המשמעותיים כבר עברו קביעה, או שאין סיכונים מסומנים.' : 'הוסף סיכונים משמעותיים ב־5.1.'}
        <button type="button" class="btn btn-secondary btn-sm" data-haccp-step="hazard">לניתוח סיכונים</button>
      </p>`;

  const otherHtml = other.length
    ? `
      <div class="haccp-ccp-other">
        <div class="card-title" style="font-size:1rem">החלטות שאינן CCP</div>
        ${other.map((c) => `
          <div class="haccp-ccp-row">
            <div>
              <div class="haccp-ccp-title">${escapeHtml(haccpCcpDecisionLabel(c.decision))}
                · ${escapeHtml(c.hazardDescription || '')}</div>
              <div class="haccp-hazard-meta">
                שלב: ${escapeHtml(stepMap.get(c.flowStepId)?.name || '—')}
                · ש1:${c.q1 || '—'} ש2:${c.q2 || '—'} ש3:${c.q3 || '—'} ש4:${c.q4 || '—'}
              </div>
            </div>
            <div class="haccp-hazard-actions">
              <button type="button" class="btn btn-secondary btn-sm haccp-ccp-edit" data-id="${c.id}">ערוך</button>
              <button type="button" class="btn btn-danger btn-sm haccp-ccp-del" data-id="${c.id}">מחק</button>
            </div>
          </div>`).join('')}
      </div>`
    : '';

  const stepOptions = flowSteps.map((s) =>
    `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');

  return `
    <div class="card">
      <div class="card-title">5.2 · נקודות בקרה קריטיות — ${escapeHtml(activePlan.name)}</div>
      <p class="haccp-hint">
        לפי המדריך + עץ החלטות Codex 2023: קביעה האם שלב הוא CCP עבור סיכון משמעותי.
        משפחה: <strong>${escapeHtml(familyName)}</strong>
      </p>
      <p class="haccp-family-products">
        <strong>${confirmed.length}</strong> CCP מאושרים ·
        <strong>${candidates.length}</strong> מועמדים ממתינים ·
        <strong>${other.length}</strong> החלטות אחרות
      </p>

      <div class="card-title" style="font-size:1rem">CCP מאושרים</div>
      <div class="haccp-ccp-list">${confirmedHtml}</div>

      <div class="card-title" style="font-size:1rem;margin-top:16px">מועמדים מניתוח הסיכונים</div>
      <div class="haccp-ccp-candidates">${candidatesHtml}</div>
      ${otherHtml}

      <form id="haccp-ccp-form" class="haccp-product-form haccp-ccp-form">
        <div class="card-title" style="font-size:1rem">קביעה ידנית (עץ החלטות)</div>
        <div class="haccp-form-row">
          <div class="form-group">
            <label for="haccp-ccp-step">שלב בתרשים</label>
            <select id="haccp-ccp-step">${stepOptions}</select>
          </div>
          <div class="form-group">
            <label for="haccp-ccp-type">סוג סיכון</label>
            <select id="haccp-ccp-type">${hazardTypeOptions('biological')}</select>
          </div>
        </div>
        <div class="form-group">
          <label for="haccp-ccp-desc">תיאור הסיכון</label>
          <input type="text" id="haccp-ccp-desc" maxlength="1000" required>
        </div>
        <div class="form-group">
          <label for="haccp-ccp-control">אמצעי בקרה בשלב</label>
          <textarea id="haccp-ccp-control" rows="2" maxlength="2000"></textarea>
        </div>
        ${renderTreeQuestions('haccp-ccp')}
        <p class="haccp-hint" id="haccp-ccp-decision-preview">תוצאה: —</p>
        <div class="form-group">
          <label for="haccp-ccp-justification">הצדקה</label>
          <textarea id="haccp-ccp-justification" rows="2" maxlength="2000"></textarea>
        </div>
        <button type="submit" class="btn btn-primary">שמור קביעה</button>
      </form>
    </div>`;
}

function parameterOptions(selected = 'core_temp') {
  return HACCP_LIMIT_PARAMETERS.map((p) =>
    `<option value="${p.id}" ${selected === p.id ? 'selected' : ''}>${escapeHtml(p.label)}</option>`
  ).join('');
}

function operatorOptions(selected = 'gte') {
  return HACCP_LIMIT_OPERATORS.map((o) =>
    `<option value="${o.id}" ${selected === o.id ? 'selected' : ''}>${escapeHtml(o.label)}</option>`
  ).join('');
}

function renderLimitsSection(activePlan, flowSteps, confirmedCcps, limits, groupMap) {
  if (!activePlan) {
    return `
      <div class="card">
        <div class="card-title">5.3 · גבולות בקרה קריטיים</div>
        <p class="haccp-hint">בחר תכנית. הגבולות מוגדרים לכל CCP מאושר משלב 5.2.</p>
      </div>`;
  }

  const familyName = groupMap.get(activePlan.categoryGroupId)?.name || '';
  const stepMap = new Map(flowSteps.map((s) => [s.id, s]));
  if (!confirmedCcps.length) {
    return `
      <div class="card">
        <div class="card-title">5.3 · גבולות קריטיים — ${escapeHtml(activePlan.name)}</div>
        <p class="haccp-hint">אין CCP מאושרים. יש לקבוע קודם נקודות בקרה קריטיות ב־5.2.</p>
        <button type="button" class="btn btn-primary" data-haccp-step="ccp">עבור ל־CCP</button>
      </div>`;
  }

  const byCcp = new Map();
  for (const l of limits) {
    const key = Number(l.ccpId);
    if (!byCcp.has(key)) byCcp.set(key, []);
    byCcp.get(key).push(l);
  }

  const covered = confirmedCcps.filter((c) => (byCcp.get(Number(c.id)) || []).length).length;
  const ccpOptions = confirmedCcps.map((c) =>
    `<option value="${c.id}">${escapeHtml(c.code || 'CCP')} — ${escapeHtml(c.name)}</option>`
  ).join('');

  const blocks = confirmedCcps.map((ccp) => {
    const list = byCcp.get(Number(ccp.id)) || [];
    const rows = list.length
      ? list.map((l) => `
          <div class="haccp-limit-row">
            <div>
              <div class="haccp-ccp-title">${escapeHtml(formatCriticalLimit(l))}</div>
              ${l.justification ? `<div class="haccp-hazard-meta">${escapeHtml(l.justification)}</div>` : ''}
            </div>
            <div class="haccp-hazard-actions">
              <button type="button" class="btn btn-secondary btn-sm haccp-limit-edit" data-id="${l.id}">ערוך</button>
              <button type="button" class="btn btn-danger btn-sm haccp-limit-del" data-id="${l.id}">מחק</button>
            </div>
          </div>`).join('')
      : `<p class="haccp-hint">אין גבולות ל-CCP זה עדיין.</p>`;

    return `
      <section class="haccp-limit-ccp">
        <div class="haccp-hazard-step-head">
          <div>
            <strong>${escapeHtml(ccp.code || 'CCP')} · ${escapeHtml(ccp.name)}</strong>
            <span class="haccp-hazard-meta"> · ${escapeHtml(stepMap.get(ccp.flowStepId)?.name || '')}
              · ${escapeHtml(ccp.hazardDescription || '')}</span>
          </div>
          <button type="button" class="btn btn-secondary btn-sm haccp-limit-seed" data-ccp-id="${ccp.id}">
            הצע גבולות
          </button>
        </div>
        ${rows}
      </section>`;
  }).join('');

  return `
    <div class="card">
      <div class="card-title">5.3 · גבולות בקרה קריטיים — ${escapeHtml(activePlan.name)}</div>
      <p class="haccp-hint">
        לפי המדריך: לכל CCP יש להגדיר גבול קריטי מדיד (טמפרטורה, זמן, pH וכו׳)
        שהחריגה ממנו הופכת את המוצר ללא בטוח. משפחה: <strong>${escapeHtml(familyName)}</strong>
      </p>
      <p class="haccp-family-products">
        <strong>${limits.length}</strong> גבולות ·
        כיסוי CCP: <strong>${covered}/${confirmedCcps.length}</strong>
      </p>

      <div class="haccp-limit-list">${blocks}</div>

      <form id="haccp-limit-form" class="haccp-product-form haccp-limit-form">
        <div class="card-title" style="font-size:1rem">הוספת גבול קריטי</div>
        <div class="form-group">
          <label for="haccp-limit-ccp">CCP</label>
          <select id="haccp-limit-ccp">${ccpOptions}</select>
        </div>
        <div class="haccp-form-row">
          <div class="form-group">
            <label for="haccp-limit-param">פרמטר</label>
            <select id="haccp-limit-param">${parameterOptions('core_temp')}</select>
          </div>
          <div class="form-group">
            <label for="haccp-limit-op">אופרטור</label>
            <select id="haccp-limit-op">${operatorOptions('gte')}</select>
          </div>
        </div>
        <div class="haccp-form-row" id="haccp-limit-value-row">
          <div class="form-group">
            <label for="haccp-limit-value">ערך</label>
            <input type="text" id="haccp-limit-value" maxlength="40" placeholder="75">
          </div>
          <div class="form-group" id="haccp-limit-max-wrap" hidden>
            <label for="haccp-limit-max">עד ערך</label>
            <input type="text" id="haccp-limit-max" maxlength="40">
          </div>
          <div class="form-group">
            <label for="haccp-limit-unit">יחידה</label>
            <input type="text" id="haccp-limit-unit" maxlength="40" value="°C">
          </div>
        </div>
        <div class="form-group" id="haccp-limit-text-wrap" hidden>
          <label for="haccp-limit-text">תיאור הגבול</label>
          <textarea id="haccp-limit-text" rows="2" maxlength="500"></textarea>
        </div>
        <div class="form-group">
          <label for="haccp-limit-justification">בסיס מדעי / הצדקה</label>
          <textarea id="haccp-limit-justification" rows="2" maxlength="2000"
            placeholder="מקור הגבול: ספרות, ניסוי, דרישה רגולטורית…"></textarea>
        </div>
        <button type="submit" class="btn btn-primary">הוסף גבול</button>
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

  document.getElementById('haccp-intended-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!ctx.activePlan) return showToast('בחר תכנית קודם');
    const checked = (name) =>
      [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((el) => el.value);
    try {
      await saveHaccpIntendedUse(ctx.activePlan.id, {
        consumptionModes: checked('haccp-consume'),
        targetAudience: document.getElementById('haccp-audience')?.value,
        sensitiveGroups: checked('haccp-sensitive'),
        sensitiveNotes: document.getElementById('haccp-sensitive-notes')?.value,
        channels: checked('haccp-channel'),
        consumerInstructions: document.getElementById('haccp-consumer-instructions')?.value,
        potentialMisuse: document.getElementById('haccp-misuse')?.value,
        notSuitableFor: document.getElementById('haccp-not-suitable')?.value,
        notes: document.getElementById('haccp-use-notes')?.value,
      });
      showToast('שימוש מיועד נשמר ✓');
      renderHaccp(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  document.getElementById('haccp-flow-add')?.addEventListener('click', async () => {
    if (!ctx.activePlan) return showToast('בחר תכנית קודם');
    try {
      await addHaccpFlowStep(ctx.activePlan.id, {
        name: document.getElementById('haccp-flow-name')?.value,
        stepKind: document.getElementById('haccp-flow-kind')?.value,
        description: document.getElementById('haccp-flow-desc')?.value,
        isCcpCandidate: document.getElementById('haccp-flow-ccp')?.checked,
      });
      showToast('שלב נוסף ✓');
      renderHaccp(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  document.getElementById('haccp-flow-seed')?.addEventListener('click', async () => {
    if (!ctx.activePlan) return;
    try {
      const n = await seedDefaultHaccpFlowSteps(ctx.activePlan.id);
      showToast(`נוספו ${n} שלבי ברירת מחדל ✓`);
      renderHaccp(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  document.getElementById('haccp-flow-import')?.addEventListener('click', async () => {
    if (!ctx.activePlan) return;
    const flowId = document.getElementById('haccp-flow-import-source')?.value;
    if (!flowId) return showToast('בחר תזרים לייבוא');
    let replace = false;
    if (ctx.flowSteps?.length) {
      replace = confirm('יש כבר שלבים בתרשים.\nאישור = החלפה מלאה\nביטול = הוספה בסוף התרשים');
    }
    try {
      const n = await importHaccpFlowFromProduction(ctx.activePlan.id, flowId, { replace });
      showToast(`יובאו ${n} שלבים ✓`);
      renderHaccp(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  container.querySelectorAll('.haccp-flow-up').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!ctx.activePlan) return;
      try {
        await moveHaccpFlowStep(ctx.activePlan.id, btn.dataset.id, 'up');
        renderHaccp(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  container.querySelectorAll('.haccp-flow-down').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!ctx.activePlan) return;
      try {
        await moveHaccpFlowStep(ctx.activePlan.id, btn.dataset.id, 'down');
        renderHaccp(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  container.querySelectorAll('.haccp-flow-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('למחוק שלב מהתרשים?')) return;
      try {
        await deleteHaccpFlowStep(btn.dataset.id);
        showToast('נמחק');
        renderHaccp(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  container.querySelectorAll('.haccp-flow-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      const step = ctx.flowSteps?.find((s) => String(s.id) === String(btn.dataset.id));
      if (!step) return;
      const kindOptions = HACCP_FLOW_STEP_KINDS.map((k) =>
        `<option value="${k.id}" ${step.stepKind === k.id ? 'selected' : ''}>${escapeHtml(k.label)}</option>`
      ).join('');
      openModal({
        title: 'עריכת שלב בתרשים',
        bodyHTML: `
          <div class="form-group">
            <label for="edit-haccp-flow-name">שם</label>
            <input type="text" id="edit-haccp-flow-name" value="${escapeHtml(step.name)}" maxlength="120">
          </div>
          <div class="form-group">
            <label for="edit-haccp-flow-kind">סוג</label>
            <select id="edit-haccp-flow-kind">${kindOptions}</select>
          </div>
          <div class="form-group">
            <label for="edit-haccp-flow-desc">תיאור</label>
            <input type="text" id="edit-haccp-flow-desc" value="${escapeHtml(step.description || '')}" maxlength="1000">
          </div>
          <div class="form-group">
            <label for="edit-haccp-flow-notes">הערות</label>
            <input type="text" id="edit-haccp-flow-notes" value="${escapeHtml(step.notes || '')}" maxlength="1000">
          </div>
          <label class="haccp-check">
            <input type="checkbox" id="edit-haccp-flow-ccp" ${step.isCcpCandidate ? 'checked' : ''}>
            <span>מועמד ל־CCP</span>
          </label>`,
        footerHTML: `<button class="btn btn-secondary modal-cancel">ביטול</button>
          <button class="btn btn-primary" id="save-haccp-flow-step">שמור</button>`,
      });
      document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
      document.getElementById('save-haccp-flow-step')?.addEventListener('click', async () => {
        try {
          await updateHaccpFlowStep(step.id, {
            name: document.getElementById('edit-haccp-flow-name').value,
            stepKind: document.getElementById('edit-haccp-flow-kind').value,
            description: document.getElementById('edit-haccp-flow-desc').value,
            notes: document.getElementById('edit-haccp-flow-notes').value,
            isCcpCandidate: document.getElementById('edit-haccp-flow-ccp').checked,
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

  document.getElementById('haccp-verify-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!ctx.activePlan) return showToast('בחר תכנית קודם');
    const checked = (name) =>
      [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((el) => el.value);
    try {
      await addHaccpFlowVerification(ctx.activePlan.id, {
        verifiedAt: document.getElementById('haccp-verify-date')?.value,
        matchResult: document.getElementById('haccp-verify-match')?.value,
        verifierMemberIds: checked('haccp-verifier'),
        verifiedByText: document.getElementById('haccp-verify-by-text')?.value,
        walkedOnSite: document.getElementById('haccp-verify-walked')?.checked,
        packagingIncluded: document.getElementById('haccp-verify-packaging')?.checked,
        allStepsPresent: document.getElementById('haccp-verify-all-steps')?.checked,
        noUnauthorizedChanges: document.getElementById('haccp-verify-no-extra')?.checked,
        discrepancies: document.getElementById('haccp-verify-discrepancies')?.value,
        correctionsMade: document.getElementById('haccp-verify-corrections')?.value,
        notes: document.getElementById('haccp-verify-notes')?.value,
      });
      showToast('אימות נשמר ✓');
      renderHaccp(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  container.querySelectorAll('.haccp-verify-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('למחוק רשומת אימות?')) return;
      try {
        await deleteHaccpFlowVerification(btn.dataset.id);
        showToast('נמחק');
        renderHaccp(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  document.getElementById('haccp-hazard-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!ctx.activePlan) return showToast('בחר תכנית קודם');
    const forceSignificant = document.getElementById('haccp-hazard-significant')?.checked;
    try {
      await addHaccpHazard(ctx.activePlan.id, {
        flowStepId: document.getElementById('haccp-hazard-step')?.value,
        hazardType: document.getElementById('haccp-hazard-type')?.value,
        description: document.getElementById('haccp-hazard-desc')?.value,
        source: document.getElementById('haccp-hazard-source')?.value,
        likelihood: document.getElementById('haccp-hazard-likelihood')?.value,
        severity: document.getElementById('haccp-hazard-severity')?.value,
        significant: forceSignificant ? true : undefined,
        controlMeasures: document.getElementById('haccp-hazard-control')?.value,
        controlledByPrp: document.getElementById('haccp-hazard-prp')?.checked,
        isCcpCandidate: document.getElementById('haccp-hazard-ccp')?.checked,
        justification: document.getElementById('haccp-hazard-justification')?.value,
      });
      showToast('גורם סיכון נוסף ✓');
      renderHaccp(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  container.querySelectorAll('.haccp-hazard-seed').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!ctx.activePlan) return;
      try {
        const n = await seedSuggestedHazardsForStep(ctx.activePlan.id, btn.dataset.stepId);
        showToast(`נוספו ${n} הצעות ✓`);
        renderHaccp(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  container.querySelectorAll('.haccp-hazard-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('למחוק גורם סיכון?')) return;
      try {
        await deleteHaccpHazard(btn.dataset.id);
        showToast('נמחק');
        renderHaccp(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  container.querySelectorAll('.haccp-hazard-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      const hazard = ctx.hazards?.find((h) => String(h.id) === String(btn.dataset.id));
      if (!hazard) return;
      const stepOptions = (ctx.flowSteps || []).map((s) =>
        `<option value="${s.id}" ${Number(s.id) === Number(hazard.flowStepId) ? 'selected' : ''}>${escapeHtml(s.name)}</option>`
      ).join('');
      openModal({
        title: 'עריכת גורם סיכון',
        bodyHTML: `
          <div class="form-group">
            <label for="edit-hazard-step">שלב</label>
            <select id="edit-hazard-step">${stepOptions}</select>
          </div>
          <div class="form-group">
            <label for="edit-hazard-type">סוג</label>
            <select id="edit-hazard-type">${hazardTypeOptions(hazard.hazardType)}</select>
          </div>
          <div class="form-group">
            <label for="edit-hazard-desc">תיאור</label>
            <input type="text" id="edit-hazard-desc" value="${escapeHtml(hazard.description || '')}" maxlength="1000">
          </div>
          <div class="form-group">
            <label for="edit-hazard-source">מקור</label>
            <input type="text" id="edit-hazard-source" value="${escapeHtml(hazard.source || '')}" maxlength="500">
          </div>
          <div class="haccp-form-row">
            <div class="form-group">
              <label for="edit-hazard-likelihood">הסתברות</label>
              <select id="edit-hazard-likelihood">${riskOptions(hazard.likelihood)}</select>
            </div>
            <div class="form-group">
              <label for="edit-hazard-severity">חומרה</label>
              <select id="edit-hazard-severity">${riskOptions(hazard.severity)}</select>
            </div>
          </div>
          <div class="form-group">
            <label for="edit-hazard-control">אמצעי בקרה</label>
            <textarea id="edit-hazard-control" rows="2" maxlength="2000">${escapeHtml(hazard.controlMeasures || '')}</textarea>
          </div>
          <label class="haccp-check">
            <input type="checkbox" id="edit-hazard-significant" ${hazard.significant ? 'checked' : ''}>
            <span>סיכון משמעותי</span>
          </label>
          <label class="haccp-check">
            <input type="checkbox" id="edit-hazard-prp" ${hazard.controlledByPrp ? 'checked' : ''}>
            <span>מבוקר ע״י PRP</span>
          </label>
          <label class="haccp-check">
            <input type="checkbox" id="edit-hazard-ccp" ${hazard.isCcpCandidate ? 'checked' : ''}>
            <span>מועמד CCP</span>
          </label>
          <div class="form-group">
            <label for="edit-hazard-justification">הצדקה</label>
            <textarea id="edit-hazard-justification" rows="2" maxlength="2000">${escapeHtml(hazard.justification || '')}</textarea>
          </div>`,
        footerHTML: `<button class="btn btn-secondary modal-cancel">ביטול</button>
          <button class="btn btn-primary" id="save-haccp-hazard">שמור</button>`,
      });
      document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
      document.getElementById('save-haccp-hazard')?.addEventListener('click', async () => {
        try {
          await updateHaccpHazard(hazard.id, {
            flowStepId: document.getElementById('edit-hazard-step').value,
            hazardType: document.getElementById('edit-hazard-type').value,
            description: document.getElementById('edit-hazard-desc').value,
            source: document.getElementById('edit-hazard-source').value,
            likelihood: document.getElementById('edit-hazard-likelihood').value,
            severity: document.getElementById('edit-hazard-severity').value,
            significant: document.getElementById('edit-hazard-significant').checked,
            controlMeasures: document.getElementById('edit-hazard-control').value,
            controlledByPrp: document.getElementById('edit-hazard-prp').checked,
            isCcpCandidate: document.getElementById('edit-hazard-ccp').checked,
            justification: document.getElementById('edit-hazard-justification').value,
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

  function readTreeAnswers(prefix) {
    return {
      q1: document.getElementById(`${prefix}-q1`)?.value,
      q2: document.getElementById(`${prefix}-q2`)?.value,
      q3: document.getElementById(`${prefix}-q3`)?.value,
      q4: document.getElementById(`${prefix}-q4`)?.value,
    };
  }

  function bindDecisionPreview(prefix, previewId) {
    const preview = document.getElementById(previewId);
    if (!preview) return;
    const update = () => {
      const decision = evaluateCcpDecisionTree(readTreeAnswers(prefix));
      preview.textContent = `תוצאה: ${haccpCcpDecisionLabel(decision)}`;
    };
    container.querySelectorAll(`#${prefix}-q1, #${prefix}-q2, #${prefix}-q3, #${prefix}-q4`).forEach((el) => {
      el.addEventListener('change', update);
    });
    // also query by id without container scope issues
    ['q1', 'q2', 'q3', 'q4'].forEach((q) => {
      document.getElementById(`${prefix}-${q}`)?.addEventListener('change', update);
    });
    update();
  }

  bindDecisionPreview('haccp-ccp', 'haccp-ccp-decision-preview');

  document.getElementById('haccp-ccp-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!ctx.activePlan) return showToast('בחר תכנית קודם');
    try {
      const tree = readTreeAnswers('haccp-ccp');
      await addHaccpCcp(ctx.activePlan.id, {
        flowStepId: document.getElementById('haccp-ccp-step')?.value,
        hazardType: document.getElementById('haccp-ccp-type')?.value,
        hazardDescription: document.getElementById('haccp-ccp-desc')?.value,
        controlMeasure: document.getElementById('haccp-ccp-control')?.value,
        justification: document.getElementById('haccp-ccp-justification')?.value,
        ...tree,
      });
      showToast('קביעה נשמרה ✓');
      renderHaccp(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  container.querySelectorAll('.haccp-ccp-from-hazard').forEach((btn) => {
    btn.addEventListener('click', () => {
      const hazard = ctx.hazards?.find((h) => String(h.id) === String(btn.dataset.hazardId))
        || ctx.ccpCandidates?.find((h) => String(h.id) === String(btn.dataset.hazardId));
      if (!hazard || !ctx.activePlan) return;
      openModal({
        title: 'עץ החלטות CCP',
        bodyHTML: `
          <p class="haccp-hint">${escapeHtml(hazard.description)}</p>
          ${renderTreeQuestions('modal-ccp', {})}
          <p class="haccp-hint" id="modal-ccp-decision-preview">תוצאה: —</p>
          <div class="form-group">
            <label for="modal-ccp-justification">הצדקה</label>
            <textarea id="modal-ccp-justification" rows="2" maxlength="2000">${escapeHtml(hazard.justification || '')}</textarea>
          </div>`,
        footerHTML: `<button class="btn btn-secondary modal-cancel">ביטול</button>
          <button class="btn btn-primary" id="save-modal-ccp">שמור קביעה</button>`,
      });
      document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
      const update = () => {
        const el = document.getElementById('modal-ccp-decision-preview');
        if (!el) return;
        el.textContent = `תוצאה: ${haccpCcpDecisionLabel(evaluateCcpDecisionTree(readTreeAnswers('modal-ccp')))}`;
      };
      ['q1', 'q2', 'q3', 'q4'].forEach((q) => {
        document.getElementById(`modal-ccp-${q}`)?.addEventListener('change', update);
      });
      update();
      document.getElementById('save-modal-ccp')?.addEventListener('click', async () => {
        try {
          await addHaccpCcpFromHazard(ctx.activePlan.id, hazard.id, {
            ...readTreeAnswers('modal-ccp'),
            justification: document.getElementById('modal-ccp-justification')?.value,
            controlMeasure: hazard.controlMeasures || '',
          });
          closeModal();
          showToast('קביעה נשמרה ✓');
          renderHaccp(container);
        } catch (err) {
          showToast(err.message || 'שגיאה');
        }
      });
    });
  });

  container.querySelectorAll('.haccp-ccp-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('למחוק קביעת CCP?')) return;
      try {
        await deleteHaccpCcp(btn.dataset.id);
        showToast('נמחק');
        renderHaccp(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  container.querySelectorAll('.haccp-ccp-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ccp = ctx.ccps?.find((c) => String(c.id) === String(btn.dataset.id));
      if (!ccp) return;
      const stepOptions = (ctx.flowSteps || []).map((s) =>
        `<option value="${s.id}" ${Number(s.id) === Number(ccp.flowStepId) ? 'selected' : ''}>${escapeHtml(s.name)}</option>`
      ).join('');
      openModal({
        title: 'עריכת קביעת CCP',
        bodyHTML: `
          <div class="form-group">
            <label for="edit-ccp-step">שלב</label>
            <select id="edit-ccp-step">${stepOptions}</select>
          </div>
          <div class="form-group">
            <label for="edit-ccp-code">קוד</label>
            <input type="text" id="edit-ccp-code" value="${escapeHtml(ccp.code || '')}" maxlength="40">
          </div>
          <div class="form-group">
            <label for="edit-ccp-name">שם</label>
            <input type="text" id="edit-ccp-name" value="${escapeHtml(ccp.name || '')}" maxlength="120">
          </div>
          <div class="form-group">
            <label for="edit-ccp-type">סוג סיכון</label>
            <select id="edit-ccp-type">${hazardTypeOptions(ccp.hazardType)}</select>
          </div>
          <div class="form-group">
            <label for="edit-ccp-desc">תיאור סיכון</label>
            <input type="text" id="edit-ccp-desc" value="${escapeHtml(ccp.hazardDescription || '')}" maxlength="1000">
          </div>
          <div class="form-group">
            <label for="edit-ccp-control">אמצעי בקרה</label>
            <textarea id="edit-ccp-control" rows="2" maxlength="2000">${escapeHtml(ccp.controlMeasure || '')}</textarea>
          </div>
          ${renderTreeQuestions('edit-ccp', { q1: ccp.q1, q2: ccp.q2, q3: ccp.q3, q4: ccp.q4 })}
          <p class="haccp-hint" id="edit-ccp-decision-preview">תוצאה: —</p>
          <div class="form-group">
            <label for="edit-ccp-justification">הצדקה</label>
            <textarea id="edit-ccp-justification" rows="2" maxlength="2000">${escapeHtml(ccp.justification || '')}</textarea>
          </div>`,
        footerHTML: `<button class="btn btn-secondary modal-cancel">ביטול</button>
          <button class="btn btn-primary" id="save-edit-ccp">שמור</button>`,
      });
      document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
      const update = () => {
        const el = document.getElementById('edit-ccp-decision-preview');
        if (!el) return;
        el.textContent = `תוצאה: ${haccpCcpDecisionLabel(evaluateCcpDecisionTree(readTreeAnswers('edit-ccp')))}`;
      };
      ['q1', 'q2', 'q3', 'q4'].forEach((q) => {
        document.getElementById(`edit-ccp-${q}`)?.addEventListener('change', update);
      });
      update();
      document.getElementById('save-edit-ccp')?.addEventListener('click', async () => {
        try {
          await updateHaccpCcp(ccp.id, {
            flowStepId: document.getElementById('edit-ccp-step').value,
            code: document.getElementById('edit-ccp-code').value,
            name: document.getElementById('edit-ccp-name').value,
            hazardType: document.getElementById('edit-ccp-type').value,
            hazardDescription: document.getElementById('edit-ccp-desc').value,
            controlMeasure: document.getElementById('edit-ccp-control').value,
            justification: document.getElementById('edit-ccp-justification').value,
            ...readTreeAnswers('edit-ccp'),
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

  function syncLimitFormMode(opSelectId = 'haccp-limit-op') {
    const op = document.getElementById(opSelectId)?.value;
    const maxWrap = document.getElementById('haccp-limit-max-wrap');
    const textWrap = document.getElementById('haccp-limit-text-wrap');
    const valueRow = document.getElementById('haccp-limit-value-row');
    if (!op) return;
    if (op === 'text') {
      if (textWrap) textWrap.hidden = false;
      if (valueRow) valueRow.hidden = true;
    } else {
      if (textWrap) textWrap.hidden = true;
      if (valueRow) valueRow.hidden = false;
      if (maxWrap) maxWrap.hidden = op !== 'between';
    }
  }

  document.getElementById('haccp-limit-op')?.addEventListener('change', () => syncLimitFormMode());
  document.getElementById('haccp-limit-param')?.addEventListener('change', () => {
    const param = document.getElementById('haccp-limit-param')?.value;
    const hint = HACCP_LIMIT_PARAMETERS.find((p) => p.id === param)?.unitHint;
    const unitEl = document.getElementById('haccp-limit-unit');
    if (unitEl && hint != null) unitEl.value = hint;
  });
  syncLimitFormMode();

  document.getElementById('haccp-limit-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!ctx.activePlan) return showToast('בחר תכנית קודם');
    try {
      await addHaccpCriticalLimit(ctx.activePlan.id, {
        ccpId: document.getElementById('haccp-limit-ccp')?.value,
        parameter: document.getElementById('haccp-limit-param')?.value,
        operator: document.getElementById('haccp-limit-op')?.value,
        value: document.getElementById('haccp-limit-value')?.value,
        valueMax: document.getElementById('haccp-limit-max')?.value,
        unit: document.getElementById('haccp-limit-unit')?.value,
        valueText: document.getElementById('haccp-limit-text')?.value,
        justification: document.getElementById('haccp-limit-justification')?.value,
      });
      showToast('גבול נוסף ✓');
      renderHaccp(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  container.querySelectorAll('.haccp-limit-seed').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!ctx.activePlan) return;
      try {
        const n = await seedSuggestedLimitsForCcp(ctx.activePlan.id, btn.dataset.ccpId);
        showToast(`נוספו ${n} הצעות ✓`);
        renderHaccp(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  container.querySelectorAll('.haccp-limit-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('למחוק גבול קריטי?')) return;
      try {
        await deleteHaccpCriticalLimit(btn.dataset.id);
        showToast('נמחק');
        renderHaccp(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  container.querySelectorAll('.haccp-limit-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      const limit = ctx.criticalLimits?.find((l) => String(l.id) === String(btn.dataset.id));
      if (!limit) return;
      const ccpOptions = (ctx.ccps || [])
        .filter((c) => c.decision === 'ccp')
        .map((c) =>
          `<option value="${c.id}" ${Number(c.id) === Number(limit.ccpId) ? 'selected' : ''}>${escapeHtml(c.code || 'CCP')} — ${escapeHtml(c.name)}</option>`
        ).join('');
      openModal({
        title: 'עריכת גבול קריטי',
        bodyHTML: `
          <div class="form-group">
            <label for="edit-limit-ccp">CCP</label>
            <select id="edit-limit-ccp">${ccpOptions}</select>
          </div>
          <div class="haccp-form-row">
            <div class="form-group">
              <label for="edit-limit-param">פרמטר</label>
              <select id="edit-limit-param">${parameterOptions(limit.parameter)}</select>
            </div>
            <div class="form-group">
              <label for="edit-limit-op">אופרטור</label>
              <select id="edit-limit-op">${operatorOptions(limit.operator)}</select>
            </div>
          </div>
          <div class="haccp-form-row" id="edit-limit-value-row">
            <div class="form-group">
              <label for="edit-limit-value">ערך</label>
              <input type="text" id="edit-limit-value" value="${escapeHtml(limit.value || '')}" maxlength="40">
            </div>
            <div class="form-group" id="edit-limit-max-wrap" ${limit.operator === 'between' ? '' : 'hidden'}>
              <label for="edit-limit-max">עד ערך</label>
              <input type="text" id="edit-limit-max" value="${escapeHtml(limit.valueMax || '')}" maxlength="40">
            </div>
            <div class="form-group">
              <label for="edit-limit-unit">יחידה</label>
              <input type="text" id="edit-limit-unit" value="${escapeHtml(limit.unit || '')}" maxlength="40">
            </div>
          </div>
          <div class="form-group" id="edit-limit-text-wrap" ${limit.operator === 'text' ? '' : 'hidden'}>
            <label for="edit-limit-text">תיאור</label>
            <textarea id="edit-limit-text" rows="2" maxlength="500">${escapeHtml(limit.valueText || '')}</textarea>
          </div>
          <div class="form-group">
            <label for="edit-limit-justification">הצדקה</label>
            <textarea id="edit-limit-justification" rows="2" maxlength="2000">${escapeHtml(limit.justification || '')}</textarea>
          </div>`,
        footerHTML: `<button class="btn btn-secondary modal-cancel">ביטול</button>
          <button class="btn btn-primary" id="save-edit-limit">שמור</button>`,
      });
      document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
      const syncEdit = () => {
        const op = document.getElementById('edit-limit-op')?.value;
        const maxWrap = document.getElementById('edit-limit-max-wrap');
        const textWrap = document.getElementById('edit-limit-text-wrap');
        const valueRow = document.getElementById('edit-limit-value-row');
        if (op === 'text') {
          if (textWrap) textWrap.hidden = false;
          if (valueRow) valueRow.hidden = true;
        } else {
          if (textWrap) textWrap.hidden = true;
          if (valueRow) valueRow.hidden = false;
          if (maxWrap) maxWrap.hidden = op !== 'between';
        }
      };
      document.getElementById('edit-limit-op')?.addEventListener('change', syncEdit);
      syncEdit();
      document.getElementById('save-edit-limit')?.addEventListener('click', async () => {
        try {
          await updateHaccpCriticalLimit(limit.id, {
            ccpId: document.getElementById('edit-limit-ccp').value,
            parameter: document.getElementById('edit-limit-param').value,
            operator: document.getElementById('edit-limit-op').value,
            value: document.getElementById('edit-limit-value').value,
            valueMax: document.getElementById('edit-limit-max').value,
            unit: document.getElementById('edit-limit-unit').value,
            valueText: document.getElementById('edit-limit-text').value,
            justification: document.getElementById('edit-limit-justification').value,
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
}
