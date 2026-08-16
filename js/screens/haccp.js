import { getCategoryGroups } from '../db.js?v=474';
import { escapeHtml, showToast, todayISO, formatDateHebrew } from '../utils.js?v=474';
import { openModal, closeModal } from '../modal.js?v=474';
import { printHaccpPlan } from '../haccp-print.js?v=474';
import { getCurrentUserRole } from '../auth.js?v=474';
import { canAccessHaccpStep, PERMISSION_DENIED_MESSAGE } from '../permissions.js?v=474';
import {
  HACCP_STEPS,
  HACCP_PRP_TOPICS,
  HACCP_PRP_STATUSES,
  haccpPrpTopicLabel,
  haccpPrpStatusLabel,
  getHaccpPrpControls,
  addHaccpPrpControl,
  updateHaccpPrpControl,
  deleteHaccpPrpControl,
  seedHaccpPrpControls,
  HACCP_TEAM_ROLES,
  HACCP_PLAN_STATUSES,
  buildHaccpTeamRoleCoverage,
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
  getHaccpMonitoring,
  addHaccpMonitoring,
  updateHaccpMonitoring,
  deleteHaccpMonitoring,
  seedSuggestedMonitoringForCcp,
  HACCP_MONITOR_METHODS,
  HACCP_MONITOR_FREQUENCIES,
  haccpMonitorMethodLabel,
  haccpMonitorFrequencyLabel,
  getHaccpMonitoringLogs,
  addHaccpMonitoringLog,
  updateHaccpMonitoringLog,
  deleteHaccpMonitoringLog,
  HACCP_MONITOR_LOG_RESULTS,
  haccpMonitorLogResultLabel,
  getHaccpCorrectiveActions,
  addHaccpCorrectiveAction,
  updateHaccpCorrectiveAction,
  deleteHaccpCorrectiveAction,
  seedSuggestedCorrectiveForCcp,
  HACCP_PRODUCT_DISPOSITIONS,
  haccpProductDispositionLabel,
  getHaccpVerificationProcs,
  addHaccpVerificationProc,
  updateHaccpVerificationProc,
  deleteHaccpVerificationProc,
  seedSuggestedVerificationProcs,
  HACCP_VERIFICATION_METHODS,
  HACCP_VERIFICATION_FREQUENCIES,
  haccpVerificationMethodLabel,
  haccpVerificationFrequencyLabel,
  getHaccpDocuments,
  addHaccpDocument,
  updateHaccpDocument,
  deleteHaccpDocument,
  seedSuggestedHaccpDocuments,
  HACCP_DOC_KINDS,
  HACCP_DOC_FORMATS,
  haccpDocKindLabel,
  haccpDocFormatLabel,
  buildHaccpPlanDraft,
  getHaccpPlanReadiness,
  cloneHaccpPlan,
  suggestCorrectiveNoteForDeviation,
  HACCP_WIZARD_STEPS,
  getHaccpWizardState,
  createHaccpPlanFromBakeryTemplate,
  getHaccpDeviationDashboard,
  HACCP_BAKERY_TEMPLATES,
} from '../haccp-db.js?v=474';

const STEP_STORAGE_KEY = 'yitzurHaccpStep';
const WIZARD_MODE_KEY = 'yitzurHaccpWizardMode';

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

function isWizardMode() {
  try {
    return sessionStorage.getItem(WIZARD_MODE_KEY) === '1';
  } catch {
    return false;
  }
}

function setWizardMode(on) {
  try {
    sessionStorage.setItem(WIZARD_MODE_KEY, on ? '1' : '0');
  } catch { /* ignore */ }
}

export function haccpMeta() {
  return {
    title: 'HACCP',
    subtitle: 'מערכת בקרת בטיחות מזון עצמית',
  };
}

export async function renderHaccp(container) {
  const role = getCurrentUserRole();
  let stepId = container.dataset.haccpStep || getSavedStep();
  if (!canAccessHaccpStep(role, stepId)) stepId = 'overview';
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
  let step = HACCP_STEPS.find((s) => s.id === stepId) || HACCP_STEPS[0];

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
  let monitoring = [];
  let monitoringLogs = [];
  let correctiveActions = [];
  let verificationProcs = [];
  let documents = [];
  let prpControls = [];
  let readiness = null;
  let wizardState = null;
  let deviationDash = null;
  const wizardOn = isWizardMode();
  // מוכנות נטענת לכל תכנית פעילה — גם לסימון ✓/○ במפת הדרכים
  if (activePlan) {
    try {
      readiness = await getHaccpPlanReadiness(activePlan.id);
    } catch {
      readiness = null;
    }
  }
  if (step.id === 'overview') {
    try {
      deviationDash = await getHaccpDeviationDashboard({ days: 30, limit: 20 });
    } catch {
      deviationDash = null;
    }
  }
  if (wizardOn && activePlan && readiness) {
    try {
      wizardState = await getHaccpWizardState(activePlan.id, readiness);
    } catch {
      wizardState = null;
    }
  }
  if (wizardOn && wizardState && !wizardState.isUnlocked(step.id) && canAccessHaccpStep(role, wizardState.firstIncomplete)) {
    stepId = wizardState.firstIncomplete;
    container.dataset.haccpStep = stepId;
    saveStep(stepId);
    step = HACCP_STEPS.find((s) => s.id === stepId) || HACCP_STEPS[0];
  }
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
  if (step.id === 'monitoring' && activePlan) {
    [flowSteps, ccps, criticalLimits, monitoring] = await Promise.all([
      getHaccpFlowSteps(activePlan.id),
      getConfirmedHaccpCcps(activePlan.id),
      getHaccpCriticalLimits(activePlan.id),
      getHaccpMonitoring(activePlan.id),
    ]);
  }
  if (step.id === 'monitor_log' && activePlan) {
    [flowSteps, ccps, criticalLimits, monitoring, monitoringLogs] = await Promise.all([
      getHaccpFlowSteps(activePlan.id),
      getConfirmedHaccpCcps(activePlan.id),
      getHaccpCriticalLimits(activePlan.id),
      getHaccpMonitoring(activePlan.id),
      getHaccpMonitoringLogs(activePlan.id),
    ]);
  }
  if (step.id === 'corrective' && activePlan) {
    [flowSteps, ccps, criticalLimits, correctiveActions] = await Promise.all([
      getHaccpFlowSteps(activePlan.id),
      getConfirmedHaccpCcps(activePlan.id),
      getHaccpCriticalLimits(activePlan.id),
      getHaccpCorrectiveActions(activePlan.id),
    ]);
  }
  if (step.id === 'verification' && activePlan) {
    [flowSteps, ccps, verificationProcs] = await Promise.all([
      getHaccpFlowSteps(activePlan.id),
      getConfirmedHaccpCcps(activePlan.id),
      getHaccpVerificationProcs(activePlan.id),
    ]);
  }
  if (step.id === 'documentation' && activePlan) {
    documents = await getHaccpDocuments(activePlan.id);
  }
  if (step.id === 'prp' && activePlan) {
    prpControls = await getHaccpPrpControls(activePlan.id);
  }

  let body = '';
  if (step.id === 'overview') body = renderOverview(members, plans, groups, activePlan, readiness, deviationDash);
  else if (step.id === 'prp') body = renderPrpSection(activePlan, prpControls, groupMap);
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
  } else if (step.id === 'monitoring') {
    body = renderMonitoringSection(activePlan, flowSteps, ccps, criticalLimits, monitoring, groupMap);
  } else if (step.id === 'monitor_log') {
    body = renderMonitorLogSection(activePlan, flowSteps, ccps, criticalLimits, monitoring, monitoringLogs, groupMap);
  } else if (step.id === 'corrective') {
    body = renderCorrectiveSection(activePlan, flowSteps, ccps, criticalLimits, correctiveActions, groupMap);
  } else if (step.id === 'verification') {
    body = renderVerificationSection(activePlan, flowSteps, ccps, verificationProcs, groupMap);
  } else if (step.id === 'documentation') {
    body = renderDocumentationSection(activePlan, documents, groupMap);
  } else body = renderSoonStep(step);

  container.innerHTML = `
    <div class="haccp-screen${wizardOn ? ' is-wizard' : ''}">
      <div class="card haccp-hero">
        <div class="card-title">מערכת בקרת בטיחות מזון עצמית מבוססת HACCP</div>
        <p class="haccp-hero-text">
          לפי מדריך משרד הבריאות — נבנה שלב־שלב: צוות, תיאור מוצר, שימוש מיועד,
          תרשים זרימה ואימות בשטח, ואז ניתוח סיכונים ונקודות בקרה קריטיות.
        </p>
        ${renderPlanPicker(plans, groups, activePlan, groupMap)}
      </div>

      <div class="card">
        <div class="haccp-roadmap-head">
          <div class="card-title" style="margin:0">מפת דרכים</div>
          <label class="haccp-wizard-toggle">
            <input type="checkbox" id="haccp-wizard-mode" ${wizardOn ? 'checked' : ''}>
            <span>מצב אשף (נעילת דילוגים)</span>
          </label>
        </div>
        ${wizardOn && wizardState ? `
          <div class="haccp-wizard-progress" aria-label="התקדמות אשף">
            <div class="haccp-wizard-progress-bar" aria-hidden="true">
              <span style="width:${Math.round(((wizardState.progressIndex) / Math.max(1, wizardState.progressTotal)) * 100)}%"></span>
            </div>
            <span class="form-hint">שלב ${wizardState.progressIndex + 1} מתוך ${wizardState.progressTotal}
              · הבא להשלמה: ${escapeHtml(HACCP_STEPS.find((s) => s.id === wizardState.firstIncomplete)?.label || '')}</span>
          </div>` : ''}
        <div class="haccp-roadmap" role="tablist" aria-label="שלבי HACCP">
          ${HACCP_STEPS.map((s) => {
            const denied = !canAccessHaccpStep(role, s.id);
            const wizardLocked = wizardOn && wizardState && !wizardState.isUnlocked(s.id) && !denied;
            const active = s.id === step.id ? ' is-active' : '';
            const locked = (s.status === 'soon' || denied || wizardLocked) ? ' is-soon' : '';
            const preview = s.status === 'preview' ? ' is-preview' : '';
            const readyItem = readiness?.items?.find((i) => i.stepId === s.id);
            const doneClass = readyItem ? (readyItem.done ? ' is-done' : ' is-todo') : '';
            const mark = readyItem ? (readyItem.done ? '✓' : '○') : '';
            const badge = s.status === 'soon'
              ? 'בקרוב'
              : denied
                ? 'ללא הרשאה'
                : wizardLocked
                  ? 'נעול'
                  : s.status === 'preview'
                    ? 'תצוגה'
                    : s.chapter;
            return `
              <button type="button" class="haccp-step-btn${active}${locked}${preview}${doneClass}"
                data-haccp-step="${s.id}"
                ${wizardLocked ? 'data-haccp-wizard-locked="1"' : ''}
                role="tab" aria-selected="${s.id === step.id}"
                ${wizardLocked || denied ? 'aria-disabled="true"' : ''}
                title="${readyItem ? escapeHtml(readyItem.detail || readyItem.label) : ''}">
                <span class="haccp-step-chapter">${mark ? `<span class="haccp-step-mark" aria-hidden="true">${mark}</span> ` : ''}${escapeHtml(badge)}</span>
                <span class="haccp-step-label">${escapeHtml(s.label)}</span>
              </button>`;
          }).join('')}
        </div>
      </div>

      <div class="haccp-step-panel" data-step="${escapeHtml(step.id)}">
        ${body}
        ${renderWizardNav(step.id, wizardOn, wizardState)}
      </div>
    </div>`;

  bindHaccpEvents(container, {
    members, plans, groups, activePlan, productDesc, flowSteps, productionFlows, flowVerifications, hazards, ccps, ccpCandidates, criticalLimits, monitoring, monitoringLogs, correctiveActions, verificationProcs, documents, prpControls, readiness, wizardState, wizardOn,
  });
}

function renderWizardNav(stepId, wizardOn, wizardState) {
  if (!wizardOn || !wizardState) return '';
  if (!HACCP_WIZARD_STEPS.includes(stepId)) return '';
  const prev = wizardState.prevStepId(stepId);
  const next = wizardState.nextStepId(stepId);
  const labelOf = (id) => HACCP_STEPS.find((s) => s.id === id)?.label || id;
  return `
    <div class="haccp-wizard-nav card">
      <button type="button" class="btn btn-secondary" data-haccp-step="${prev || ''}"
        ${prev ? '' : 'disabled'}>← הקודם${prev ? `: ${escapeHtml(labelOf(prev))}` : ''}</button>
      <button type="button" class="btn btn-primary" data-haccp-step="${next || ''}"
        ${next ? '' : 'disabled'}
        title="${next ? '' : 'השלם את הסעיף הנוכחי כדי להמשיך'}">
        ${next ? `הבא: ${escapeHtml(labelOf(next))} →` : 'השלם שלב זה כדי להמשיך'}
      </button>
    </div>`;
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
          <button type="button" class="btn btn-primary btn-sm" id="haccp-build-draft">בנה טיוטה מהצעות</button>
          <button type="button" class="btn btn-secondary btn-sm haccp-print-plan">הדפס תכנית</button>
          <button type="button" class="btn btn-secondary btn-sm" id="haccp-clone-plan">שכפל למשפחה</button>
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
            <select id="haccp-template-type" ${availableGroups.length ? '' : 'disabled'}
              title="סוג תבנית מאפייה">
              ${HACCP_BAKERY_TEMPLATES.map((t) =>
                `<option value="${t.id}" ${t.id === 'cakes' ? 'selected' : ''}>${escapeHtml(t.label)}</option>`
              ).join('')}
            </select>
            <button type="button" class="btn btn-secondary btn-sm" id="haccp-create-plan"
              ${availableGroups.length ? '' : 'disabled'}>צור ריקה</button>
            <button type="button" class="btn btn-primary btn-sm" id="haccp-create-from-template"
              ${availableGroups.length ? '' : 'disabled'}
              title="צוות + שימוש מיועד + תיאור + טיוטת PRP/תרשים/סיכונים/CCP">מתבנית</button>
          </div>
        </div>
      </div>
    </div>`;
}

function renderDeviationDashboard(dash) {
  if (!dash) {
    return `
      <div class="card haccp-deviation-card">
        <div class="card-title">דשבורד חריגות (30 יום)</div>
        <p class="haccp-hint">אין נתונים להצגה עדיין.</p>
      </div>`;
  }
  const rows = dash.items.length
    ? dash.items.map((item) => `
        <li class="haccp-deviation-row ${item.hasCorrective ? 'has-note' : 'needs-note'}">
          <div>
            <div class="haccp-ccp-title">
              ${escapeHtml(item.ccpCode)} · ${escapeHtml(item.ccpName)}
              · ${escapeHtml(item.value || '—')}${item.unit ? ` ${escapeHtml(item.unit)}` : ''}
            </div>
            <div class="haccp-hazard-meta">
              ${escapeHtml(item.planName)}
              · ${escapeHtml(formatLogWhen(item.recordedAt))}
              ${item.batchCode ? ` · אצווה: ${escapeHtml(item.batchCode)}` : ''}
              · ${item.hasCorrective ? 'יש פעולה מתקנת' : 'חסרה פעולה מתקנת'}
            </div>
            ${item.correctiveNote ? `<div class="haccp-hazard-meta">${escapeHtml(item.correctiveNote)}</div>` : ''}
          </div>
          <button type="button" class="btn btn-secondary btn-sm"
            data-haccp-open-plan="${escapeHtml(String(item.planId))}"
            data-haccp-step="monitor_log">יומן</button>
        </li>`).join('')
    : '<li class="haccp-hint">אין חריגות ב־30 הימים האחרונים ✓</li>';

  return `
    <div class="card haccp-deviation-card">
      <div class="card-title">דשבורד חריגות (30 יום)</div>
      <p class="haccp-family-products">
        <strong>${dash.total}</strong> חריגות ·
        ללא פעולה מתקנת: <strong>${dash.openWithoutCorrective}</strong>
      </p>
      <ul class="haccp-deviation-list">${rows}</ul>
      <div class="haccp-inline-row">
        <button type="button" class="btn btn-secondary" data-haccp-step="monitor_log">יומן ניטור</button>
        <button type="button" class="btn btn-secondary" data-haccp-step="corrective">נהלי פעולות מתקנות</button>
      </div>
    </div>`;
}

function renderOverview(members, plans, groups, activePlan = null, readiness = null, deviationDash = null) {
  const leaders = members.filter((m) => m.isLeader && m.active !== false);
  const activeMembers = members.filter((m) => m.active !== false);
  const readinessHtml = activePlan && readiness ? `
    <div class="card haccp-readiness-card">
      <div class="card-title">מוכנות תכנית — ${escapeHtml(activePlan.name)}</div>
      <div class="haccp-readiness-score">
        <div class="haccp-readiness-bar" aria-hidden="true">
          <span style="width:${readiness.percent}%"></span>
        </div>
        <strong>${readiness.percent}%</strong>
        <span class="form-hint">${readiness.done}/${readiness.total} סעיפים
          ${readiness.readyForPrint ? '· מוכנה להדפסה/ביקורת בסיסית' : '· עוד לא מוכנה להדפסה'}</span>
      </div>
      <ul class="haccp-readiness-list">
        ${readiness.items.map((item) => `
          <li class="${item.done ? 'done' : 'missing'}">
            <button type="button" class="haccp-readiness-link" data-haccp-step="${escapeHtml(item.stepId)}">
              ${item.done ? '✓' : '○'} ${escapeHtml(item.label)}
            </button>
            <span class="form-hint">${escapeHtml(item.detail || '')}</span>
          </li>`).join('')}
      </ul>
      <div class="haccp-inline-row">
        <button type="button" class="btn btn-primary" id="haccp-build-draft">בנה טיוטה מהצעות</button>
        <button type="button" class="btn btn-secondary haccp-print-plan">הדפס תכנית</button>
      </div>
      <p class="haccp-hint">«בנה טיוטה» ממלא PRP, תרשים, סיכונים, CCP מועמדים, גבולות, ניטור, פעולות מתקנות, אימות ומסמכים — ואז אפשר לערוך.</p>
    </div>` : `
    <div class="card">
      <p class="haccp-hint">בחר או צור תכנית לפי משפחת מוצרים כדי לראות ציון מוכנות ולבנות טיוטה אוטומטית.</p>
    </div>`;

  return `
    <div class="card">
      <div class="card-title">איפה אנחנו עומדים</div>
      <ul class="haccp-overview-list">
        <li><strong>${activeMembers.length}</strong> חברי צוות פעילים
          ${leaders.length ? `· מוביל: ${escapeHtml(leaders.map((l) => l.name).join(', '))}` : '· עדיין בלי מוביל מערכת'}</li>
        <li><strong>${plans.length}</strong> תכניות לפי משפחות מוצרים
          (מתוך ${groups.length} משפחות במערכת)</li>
        <li>השלבים הפעילים: PRP + הכנה + 5.1–5.7 + יומן ניטור</li>
      </ul>
      <p class="haccp-hint">המלצה: צור תכנית «מתבנית מאפייה», הפעל מצב אשף, והשלם אימות תרשים.
        הצוות משותף לכל התכניות — ממלאים פעם אחת ב־3.1.</p>
      <div class="haccp-inline-row">
        <button type="button" class="btn btn-secondary" data-haccp-step="monitor_log">יומן ניטור</button>
        <button type="button" class="btn btn-secondary" data-haccp-step="monitoring">נהלי ניטור</button>
      </div>
    </div>
    ${renderDeviationDashboard(deviationDash)}
    ${readinessHtml}`;
}

function prpStatusOptions(selected = 'not_started') {
  return HACCP_PRP_STATUSES.map((s) =>
    `<option value="${s.id}" ${selected === s.id ? 'selected' : ''}>${escapeHtml(s.label)}</option>`
  ).join('');
}

function prpTopicOptions(selected = '', usedIds = []) {
  const used = new Set(usedIds);
  return HACCP_PRP_TOPICS.map((t) => {
    const disabled = used.has(t.id) && t.id !== selected ? 'disabled' : '';
    const sel = t.id === selected ? 'selected' : '';
    return `<option value="${t.id}" ${sel} ${disabled}>${escapeHtml(t.label)}</option>`;
  }).join('');
}

function renderPrpSection(activePlan, controls, groupMap) {
  if (!activePlan) {
    return `
      <div class="card">
        <div class="card-title">2 · תכניות קדם (PRP)</div>
        <p class="haccp-hint">בחר תכנית. תכניות קדם הן תנאי בסיסי למערכת HACCP — לפני ובמקביל לניתוח סיכונים.</p>
      </div>`;
  }

  const familyName = groupMap.get(activePlan.categoryGroupId)?.name || '';
  const implemented = controls.filter((c) => c.status === 'implemented').length;
  const usedIds = controls.map((c) => c.topicId);
  const missingTopics = HACCP_PRP_TOPICS.filter((t) => !usedIds.includes(t.id));

  const rows = controls.length
    ? controls.map((c) => {
      const who = c.responsibleText
        ? `${haccpRoleLabel(c.responsibleRole)} · ${c.responsibleText}`
        : haccpRoleLabel(c.responsibleRole);
      return `
        <div class="haccp-prp-row status-${escapeHtml(c.status || 'not_started')}">
          <div>
            <div class="haccp-ccp-title">${escapeHtml(haccpPrpTopicLabel(c.topicId))}</div>
            <div class="haccp-hazard-meta">
              <span class="badge">${escapeHtml(haccpPrpStatusLabel(c.status))}</span>
              · ${escapeHtml(who)}
              ${c.lastReviewedAt ? ` · נסקר: ${escapeHtml(formatDateHebrew(c.lastReviewedAt))}` : ''}
            </div>
            ${c.procedureSummary ? `<div class="haccp-hazard-meta">${escapeHtml(c.procedureSummary)}</div>` : ''}
            ${c.records ? `<div class="haccp-hazard-meta">רישום: ${escapeHtml(c.records)}</div>` : ''}
          </div>
          <div class="haccp-hazard-actions">
            <button type="button" class="btn btn-secondary btn-sm haccp-prp-edit" data-id="${c.id}">ערוך</button>
            <button type="button" class="btn btn-danger btn-sm haccp-prp-del" data-id="${c.id}">מחק</button>
          </div>
        </div>`;
    }).join('')
    : `<p class="haccp-hint">עדיין אין בקרות PRP. לחץ «אתחל נושאי PRP» כדי ליצור שלד לכל נושאי המדריך.</p>`;

  return `
    <div class="card">
      <div class="card-title">2 · תכניות קדם (PRP) — ${escapeHtml(activePlan.name)}</div>
      <p class="haccp-hint">
        לפי המדריך: תכניות קדם הן תנאי בסיסי — בקרת ספקים, היגיינה, ניקיון, מזיקים, כיול ועוד.
        לכל נושא מגדירים נוהל, אחראי ורישום. משפחה: <strong>${escapeHtml(familyName)}</strong>
      </p>
      <p class="haccp-family-products">
        <strong>${controls.length}</strong> נושאים ·
        מיושם: <strong>${implemented}/${HACCP_PRP_TOPICS.length}</strong>
        ${missingTopics.length ? ` · חסרים: ${missingTopics.length}` : ''}
      </p>
      <div class="haccp-inline-row" style="margin-bottom:12px">
        <button type="button" class="btn btn-secondary" id="haccp-prp-seed"
          ${missingTopics.length ? '' : 'disabled'}>אתחל נושאי PRP</button>
      </div>

      <div class="haccp-prp-list">${rows}</div>

      <form id="haccp-prp-form" class="haccp-product-form haccp-prp-form">
        <div class="card-title" style="font-size:1rem">הוספת בקרת PRP</div>
        <div class="haccp-form-row">
          <div class="form-group">
            <label for="haccp-prp-topic">נושא</label>
            <select id="haccp-prp-topic">${prpTopicOptions('', usedIds)}</select>
          </div>
          <div class="form-group">
            <label for="haccp-prp-status">סטטוס</label>
            <select id="haccp-prp-status">${prpStatusOptions('in_progress')}</select>
          </div>
        </div>
        <div class="form-group">
          <label for="haccp-prp-procedure">נוהל / אמצעי בקרה</label>
          <textarea id="haccp-prp-procedure" rows="3" maxlength="4000"
            placeholder="איך מבוצעת הבקרה בפועל"></textarea>
        </div>
        <div class="form-group">
          <label for="haccp-prp-monitor">מעקב / ניטור PRP</label>
          <textarea id="haccp-prp-monitor" rows="2" maxlength="2000"
            placeholder="איך מוודאים שהנוהל מיושם"></textarea>
        </div>
        <div class="haccp-form-row">
          <div class="form-group">
            <label for="haccp-prp-role">אחראי</label>
            <select id="haccp-prp-role">${monitorRoleOptions('quality')}</select>
          </div>
          <div class="form-group">
            <label for="haccp-prp-reviewed">תאריך סקירה אחרונה</label>
            <input type="date" id="haccp-prp-reviewed">
          </div>
        </div>
        <div class="form-group">
          <label for="haccp-prp-who">שם / פירוט</label>
          <input type="text" id="haccp-prp-who" maxlength="200" placeholder="אופציונלי">
        </div>
        <div class="form-group">
          <label for="haccp-prp-records">רישום / טופס</label>
          <input type="text" id="haccp-prp-records" maxlength="1000" placeholder="שם טופס / יומן">
        </div>
        <div class="form-group">
          <label for="haccp-prp-notes">הערות</label>
          <textarea id="haccp-prp-notes" rows="2" maxlength="2000"></textarea>
        </div>
        <button type="submit" class="btn btn-primary" ${missingTopics.length ? '' : 'disabled'}>הוסף בקרה</button>
      </form>
    </div>`;
}

function renderSoonStep(step) {
  return `
    <div class="card">
      <div class="card-title">${escapeHtml(step.chapter)} · ${escapeHtml(step.label)}</div>
      <p class="haccp-hint">שלב זה יורחב בהמשך. עקרונות הליבה (5.1–5.7) כבר זמינים במפת הדרכים.</p>
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

function methodOptions(selected = 'thermometer') {
  return HACCP_MONITOR_METHODS.map((m) =>
    `<option value="${m.id}" ${selected === m.id ? 'selected' : ''}>${escapeHtml(m.label)}</option>`
  ).join('');
}

function frequencyOptions(selected = 'every_batch') {
  return HACCP_MONITOR_FREQUENCIES.map((f) =>
    `<option value="${f.id}" ${selected === f.id ? 'selected' : ''}>${escapeHtml(f.label)}</option>`
  ).join('');
}

function monitorRoleOptions(selected = 'production') {
  return HACCP_TEAM_ROLES.map((r) =>
    `<option value="${r.id}" ${selected === r.id ? 'selected' : ''}>${escapeHtml(r.label)}</option>`
  ).join('');
}

function limitOptionsForCcp(limits, ccpId, selectedId = '') {
  const list = (limits || []).filter((l) => Number(l.ccpId) === Number(ccpId));
  const opts = list.map((l) =>
    `<option value="${l.id}" ${String(l.id) === String(selectedId) ? 'selected' : ''}>${escapeHtml(formatCriticalLimit(l))}</option>`
  ).join('');
  return `<option value="">— ללא קישור לגבול —</option>${opts}`;
}

function renderMonitoringSection(activePlan, flowSteps, confirmedCcps, limits, monitoringRows, groupMap) {
  if (!activePlan) {
    return `
      <div class="card">
        <div class="card-title">5.4 · ניטור</div>
        <p class="haccp-hint">בחר תכנית. נהלי ניטור מוגדרים לכל CCP מאושר — מה מנטרים, איך, באיזו תדירות ומי אחראי.</p>
      </div>`;
  }

  const familyName = groupMap.get(activePlan.categoryGroupId)?.name || '';
  const stepMap = new Map(flowSteps.map((s) => [s.id, s]));
  const limitMap = new Map((limits || []).map((l) => [Number(l.id), l]));
  if (!confirmedCcps.length) {
    return `
      <div class="card">
        <div class="card-title">5.4 · ניטור — ${escapeHtml(activePlan.name)}</div>
        <p class="haccp-hint">אין CCP מאושרים. יש לקבוע קודם נקודות בקרה קריטיות ב־5.2.</p>
        <button type="button" class="btn btn-primary" data-haccp-step="ccp">עבור ל־CCP</button>
      </div>`;
  }

  const byCcp = new Map();
  for (const m of monitoringRows) {
    const key = Number(m.ccpId);
    if (!byCcp.has(key)) byCcp.set(key, []);
    byCcp.get(key).push(m);
  }

  const covered = confirmedCcps.filter((c) => (byCcp.get(Number(c.id)) || []).length).length;
  const defaultCcpId = confirmedCcps[0]?.id;
  const ccpOptions = confirmedCcps.map((c) =>
    `<option value="${c.id}">${escapeHtml(c.code || 'CCP')} — ${escapeHtml(c.name)}</option>`
  ).join('');

  const blocks = confirmedCcps.map((ccp) => {
    const list = byCcp.get(Number(ccp.id)) || [];
    const rows = list.length
      ? list.map((m) => {
        const linked = m.limitId ? limitMap.get(Number(m.limitId)) : null;
        const who = m.responsibleText
          ? `${haccpRoleLabel(m.responsibleRole)} · ${m.responsibleText}`
          : haccpRoleLabel(m.responsibleRole);
        return `
          <div class="haccp-monitor-row">
            <div>
              <div class="haccp-ccp-title">${escapeHtml(m.what)}</div>
              <div class="haccp-hazard-meta">
                ${escapeHtml(haccpMonitorMethodLabel(m.method))}
                ${m.methodDetails ? ` · ${escapeHtml(m.methodDetails)}` : ''}
                · ${escapeHtml(haccpMonitorFrequencyLabel(m.frequency))}
                ${m.frequencyDetails ? ` (${escapeHtml(m.frequencyDetails)})` : ''}
                · ${escapeHtml(who)}
              </div>
              ${linked ? `<div class="haccp-hazard-meta">גבול: ${escapeHtml(formatCriticalLimit(linked))}</div>` : ''}
              ${m.records ? `<div class="haccp-hazard-meta">רישום: ${escapeHtml(m.records)}</div>` : ''}
            </div>
            <div class="haccp-hazard-actions">
              <button type="button" class="btn btn-secondary btn-sm haccp-monitor-edit" data-id="${m.id}">ערוך</button>
              <button type="button" class="btn btn-danger btn-sm haccp-monitor-del" data-id="${m.id}">מחק</button>
            </div>
          </div>`;
      }).join('')
      : `<p class="haccp-hint">אין נוהל ניטור ל-CCP זה עדיין.</p>`;

    return `
      <section class="haccp-monitor-ccp">
        <div class="haccp-hazard-step-head">
          <div>
            <strong>${escapeHtml(ccp.code || 'CCP')} · ${escapeHtml(ccp.name)}</strong>
            <span class="haccp-hazard-meta"> · ${escapeHtml(stepMap.get(ccp.flowStepId)?.name || '')}
              · ${escapeHtml(ccp.hazardDescription || '')}</span>
          </div>
          <button type="button" class="btn btn-secondary btn-sm haccp-monitor-seed" data-ccp-id="${ccp.id}">
            הצע ניטור
          </button>
        </div>
        ${rows}
      </section>`;
  }).join('');

  return `
    <div class="card">
      <div class="card-title">5.4 · ניטור — ${escapeHtml(activePlan.name)}</div>
      <p class="haccp-hint">
        לפי המדריך: לכל CCP יש להגדיר נוהל ניטור — מה נמדד, שיטה, תדירות, אחראי, ואיפה נרשמים התוצאות.
        משפחה: <strong>${escapeHtml(familyName)}</strong>
      </p>
      <p class="haccp-family-products">
        <strong>${monitoringRows.length}</strong> נהלי ניטור ·
        כיסוי CCP: <strong>${covered}/${confirmedCcps.length}</strong>
      </p>

      <div class="haccp-monitor-list">${blocks}</div>

      <form id="haccp-monitor-form" class="haccp-product-form haccp-monitor-form">
        <div class="card-title" style="font-size:1rem">הוספת נוהל ניטור</div>
        <div class="form-group">
          <label for="haccp-monitor-ccp">CCP</label>
          <select id="haccp-monitor-ccp">${ccpOptions}</select>
        </div>
        <div class="form-group">
          <label for="haccp-monitor-limit">קישור לגבול קריטי (אופציונלי)</label>
          <select id="haccp-monitor-limit">${limitOptionsForCcp(limits, defaultCcpId)}</select>
        </div>
        <div class="form-group">
          <label for="haccp-monitor-what">מה מנטרים</label>
          <textarea id="haccp-monitor-what" rows="2" maxlength="1000"
            placeholder="למשל: טמפרטורת ליבה בסוף אפייה"></textarea>
        </div>
        <div class="haccp-form-row">
          <div class="form-group">
            <label for="haccp-monitor-method">שיטה</label>
            <select id="haccp-monitor-method">${methodOptions('thermometer')}</select>
          </div>
          <div class="form-group">
            <label for="haccp-monitor-freq">תדירות</label>
            <select id="haccp-monitor-freq">${frequencyOptions('every_batch')}</select>
          </div>
        </div>
        <div class="haccp-form-row">
          <div class="form-group">
            <label for="haccp-monitor-method-details">פירוט שיטה</label>
            <input type="text" id="haccp-monitor-method-details" maxlength="1000" placeholder="סוג מדחום, מיקום מדידה…">
          </div>
          <div class="form-group">
            <label for="haccp-monitor-freq-details">פירוט תדירות</label>
            <input type="text" id="haccp-monitor-freq-details" maxlength="500" placeholder="למשל: כל תבנית ראשונה ואחרונה">
          </div>
        </div>
        <div class="haccp-form-row">
          <div class="form-group">
            <label for="haccp-monitor-role">אחראי (תפקיד)</label>
            <select id="haccp-monitor-role">${monitorRoleOptions('production')}</select>
          </div>
          <div class="form-group">
            <label for="haccp-monitor-who">שם / פירוט אחראי</label>
            <input type="text" id="haccp-monitor-who" maxlength="200" placeholder="אופציונלי">
          </div>
        </div>
        <div class="form-group">
          <label for="haccp-monitor-records">רישום / טופס</label>
          <input type="text" id="haccp-monitor-records" maxlength="1000" placeholder="טופס ניטור CCP / יומן ייצור">
        </div>
        <div class="form-group">
          <label for="haccp-monitor-notes">הערות</label>
          <textarea id="haccp-monitor-notes" rows="2" maxlength="2000"></textarea>
        </div>
        <button type="submit" class="btn btn-primary">הוסף ניטור</button>
      </form>
      <p class="haccp-hint" style="margin-top:14px">
        אחרי הגדרת נהלים —
        <button type="button" class="btn btn-secondary btn-sm" data-haccp-step="monitor_log">עבור ליומן ניטור</button>
      </p>
    </div>`;
}

function dispositionOptions(selected = 'hold_evaluate') {
  return HACCP_PRODUCT_DISPOSITIONS.map((d) =>
    `<option value="${d.id}" ${selected === d.id ? 'selected' : ''}>${escapeHtml(d.label)}</option>`
  ).join('');
}

function monitorLogResultOptions(selected = 'ok') {
  return HACCP_MONITOR_LOG_RESULTS.map((r) =>
    `<option value="${r.id}" ${selected === r.id ? 'selected' : ''}>${escapeHtml(r.label)}</option>`
  ).join('');
}

function datetimeLocalNow() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function formatLogWhen(iso) {
  if (!iso) return '—';
  const date = String(iso).slice(0, 10);
  const time = String(iso).includes('T') ? String(iso).slice(11, 16) : '';
  try {
    return `${formatDateHebrew(date)}${time ? ` · ${time}` : ''}`;
  } catch {
    return iso;
  }
}

function monitorProcOptions(monitoringRows, ccpId, selectedId = '') {
  const list = (monitoringRows || []).filter((m) => Number(m.ccpId) === Number(ccpId));
  const opts = list.map((m) =>
    `<option value="${m.id}" ${String(m.id) === String(selectedId) ? 'selected' : ''}>${escapeHtml(m.what || 'נוהל')}</option>`
  ).join('');
  return `<option value="">— ללא קישור לנוהל —</option>${opts}`;
}

function renderMonitorLogSection(activePlan, flowSteps, confirmedCcps, limits, monitoringRows, logs, groupMap) {
  if (!activePlan) {
    return `
      <div class="card">
        <div class="card-title">5.4+ · יומן ניטור</div>
        <p class="haccp-hint">בחר תכנית. כאן נרשמות מדידות CCP בפועל — ערך, תוצאה וחריגות.</p>
      </div>`;
  }

  const familyName = groupMap.get(activePlan.categoryGroupId)?.name || '';
  const ccpMap = new Map((confirmedCcps || []).map((c) => [Number(c.id), c]));
  if (!confirmedCcps.length) {
    return `
      <div class="card">
        <div class="card-title">5.4+ · יומן ניטור — ${escapeHtml(activePlan.name)}</div>
        <p class="haccp-hint">אין CCP מאושרים. יש לקבוע קודם נקודות בקרה קריטיות.</p>
        <button type="button" class="btn btn-primary" data-haccp-step="ccp">עבור ל־CCP</button>
      </div>`;
  }

  const deviations = logs.filter((l) => l.result === 'deviation').length;
  const ccpOptions = confirmedCcps.map((c) =>
    `<option value="${c.id}">${escapeHtml(c.code || 'CCP')} — ${escapeHtml(c.name)}</option>`
  ).join('');
  const defaultCcp = confirmedCcps[0]?.id;

  const rows = logs.length
    ? logs.map((l) => {
      const ccp = ccpMap.get(Number(l.ccpId));
      const who = l.recordedByText
        ? `${haccpRoleLabel(l.recordedByRole)} · ${l.recordedByText}`
        : haccpRoleLabel(l.recordedByRole);
      return `
        <div class="haccp-log-row result-${escapeHtml(l.result || 'ok')}">
          <div>
            <div class="haccp-ccp-title">
              ${escapeHtml(ccp ? `${ccp.code || 'CCP'} · ${ccp.name}` : 'CCP')}
              · ${escapeHtml(l.value || '—')}${l.unit ? ` ${escapeHtml(l.unit)}` : ''}
            </div>
            <div class="haccp-hazard-meta">
              <span class="badge">${escapeHtml(haccpMonitorLogResultLabel(l.result))}</span>
              · ${escapeHtml(formatLogWhen(l.recordedAt))}
              ${l.batchCode ? ` · אצווה: ${escapeHtml(l.batchCode)}` : ''}
              · ${escapeHtml(who)}
            </div>
            ${l.correctiveNote ? `<div class="haccp-hazard-meta">פעולה: ${escapeHtml(l.correctiveNote)}</div>` : ''}
            ${l.notes ? `<div class="haccp-hazard-meta">${escapeHtml(l.notes)}</div>` : ''}
          </div>
          <div class="haccp-hazard-actions">
            <button type="button" class="btn btn-secondary btn-sm haccp-log-edit" data-id="${l.id}">ערוך</button>
            <button type="button" class="btn btn-danger btn-sm haccp-log-del" data-id="${l.id}">מחק</button>
          </div>
        </div>`;
    }).join('')
    : `<p class="haccp-hint">עדיין אין רשומות. הוסף מדידה ראשונה למטה.</p>`;

  return `
    <div class="card">
      <div class="card-title">5.4+ · יומן ניטור — ${escapeHtml(activePlan.name)}</div>
      <p class="haccp-hint">
        רישום מדידות בפועל לכל CCP — ערך, תוצאה מול הגבול, ואם יש חריגה: פעולה שננקטה.
        משפחה: <strong>${escapeHtml(familyName)}</strong>
      </p>
      <p class="haccp-family-products">
        <strong>${logs.length}</strong> רשומות ·
        חריגות: <strong>${deviations}</strong>
      </p>
      <div class="haccp-inline-row" style="margin-bottom:12px">
        <button type="button" class="btn btn-secondary btn-sm" data-haccp-step="monitoring">נהלי ניטור</button>
      </div>

      <div class="haccp-log-list">${rows}</div>

      <form id="haccp-log-form" class="haccp-product-form haccp-log-form">
        <div class="card-title" style="font-size:1rem">רישום מדידה</div>
        <div class="haccp-form-row">
          <div class="form-group">
            <label for="haccp-log-ccp">CCP</label>
            <select id="haccp-log-ccp">${ccpOptions}</select>
          </div>
          <div class="form-group">
            <label for="haccp-log-when">תאריך ושעה</label>
            <input type="datetime-local" id="haccp-log-when" value="${escapeHtml(datetimeLocalNow())}">
          </div>
        </div>
        <div class="form-group">
          <label for="haccp-log-monitor">נוהל ניטור (אופציונלי)</label>
          <select id="haccp-log-monitor">${monitorProcOptions(monitoringRows, defaultCcp)}</select>
        </div>
        <div class="form-group">
          <label for="haccp-log-limit">גבול קריטי (אופציונלי)</label>
          <select id="haccp-log-limit">${limitOptionsForCcp(limits, defaultCcp)}</select>
        </div>
        <div class="haccp-form-row">
          <div class="form-group">
            <label for="haccp-log-value">ערך מדידה</label>
            <input type="text" id="haccp-log-value" maxlength="80" placeholder="75">
          </div>
          <div class="form-group">
            <label for="haccp-log-unit">יחידה</label>
            <input type="text" id="haccp-log-unit" maxlength="40" placeholder="°C">
          </div>
        </div>
        <div class="haccp-form-row">
          <div class="form-group">
            <label for="haccp-log-result">תוצאה</label>
            <select id="haccp-log-result">${monitorLogResultOptions('ok')}</select>
          </div>
          <div class="form-group">
            <label for="haccp-log-batch">אצווה / תבנית</label>
            <input type="text" id="haccp-log-batch" maxlength="80" placeholder="אופציונלי">
          </div>
        </div>
        <div class="form-group" id="haccp-log-corrective-wrap" hidden>
          <label for="haccp-log-corrective">פעולה מתקנת שננקטה</label>
          <textarea id="haccp-log-corrective" rows="2" maxlength="2000"
            placeholder="מה נעשה בעקבות החריגה"></textarea>
        </div>
        <div class="haccp-form-row">
          <div class="form-group">
            <label for="haccp-log-role">רשם</label>
            <select id="haccp-log-role">${monitorRoleOptions('production')}</select>
          </div>
          <div class="form-group">
            <label for="haccp-log-who">שם</label>
            <input type="text" id="haccp-log-who" maxlength="200" placeholder="אופציונלי">
          </div>
        </div>
        <div class="form-group">
          <label for="haccp-log-notes">הערות</label>
          <textarea id="haccp-log-notes" rows="2" maxlength="2000"></textarea>
        </div>
        <button type="submit" class="btn btn-primary">שמור מדידה</button>
      </form>
    </div>`;
}

function renderCorrectiveSection(activePlan, flowSteps, confirmedCcps, limits, actions, groupMap) {
  if (!activePlan) {
    return `
      <div class="card">
        <div class="card-title">5.5 · פעולות מתקנות</div>
        <p class="haccp-hint">בחר תכנית. לכל CCP מגדירים מראש מה עושים כשיש חריגה מגבול קריטי.</p>
      </div>`;
  }

  const familyName = groupMap.get(activePlan.categoryGroupId)?.name || '';
  const stepMap = new Map(flowSteps.map((s) => [s.id, s]));
  const limitMap = new Map((limits || []).map((l) => [Number(l.id), l]));
  if (!confirmedCcps.length) {
    return `
      <div class="card">
        <div class="card-title">5.5 · פעולות מתקנות — ${escapeHtml(activePlan.name)}</div>
        <p class="haccp-hint">אין CCP מאושרים. יש לקבוע קודם נקודות בקרה קריטיות ב־5.2.</p>
        <button type="button" class="btn btn-primary" data-haccp-step="ccp">עבור ל־CCP</button>
      </div>`;
  }

  const byCcp = new Map();
  for (const a of actions) {
    const key = Number(a.ccpId);
    if (!byCcp.has(key)) byCcp.set(key, []);
    byCcp.get(key).push(a);
  }

  const covered = confirmedCcps.filter((c) => (byCcp.get(Number(c.id)) || []).length).length;
  const defaultCcpId = confirmedCcps[0]?.id;
  const ccpOptions = confirmedCcps.map((c) =>
    `<option value="${c.id}">${escapeHtml(c.code || 'CCP')} — ${escapeHtml(c.name)}</option>`
  ).join('');

  const blocks = confirmedCcps.map((ccp) => {
    const list = byCcp.get(Number(ccp.id)) || [];
    const rows = list.length
      ? list.map((a) => {
        const linked = a.limitId ? limitMap.get(Number(a.limitId)) : null;
        const who = a.responsibleText
          ? `${haccpRoleLabel(a.responsibleRole)} · ${a.responsibleText}`
          : haccpRoleLabel(a.responsibleRole);
        return `
          <div class="haccp-corrective-row">
            <div>
              <div class="haccp-ccp-title">${escapeHtml(a.deviation)}</div>
              <div class="haccp-hazard-meta">
                פעולה מיידית: ${escapeHtml(a.immediateAction)}
              </div>
              <div class="haccp-hazard-meta">
                גורל מוצר: ${escapeHtml(haccpProductDispositionLabel(a.productDisposition))}
                · ${escapeHtml(who)}
              </div>
              ${linked ? `<div class="haccp-hazard-meta">גבול: ${escapeHtml(formatCriticalLimit(linked))}</div>` : ''}
              ${a.records ? `<div class="haccp-hazard-meta">רישום: ${escapeHtml(a.records)}</div>` : ''}
            </div>
            <div class="haccp-hazard-actions">
              <button type="button" class="btn btn-secondary btn-sm haccp-corrective-edit" data-id="${a.id}">ערוך</button>
              <button type="button" class="btn btn-danger btn-sm haccp-corrective-del" data-id="${a.id}">מחק</button>
            </div>
          </div>`;
      }).join('')
      : `<p class="haccp-hint">אין פעולה מתקנת ל-CCP זה עדיין.</p>`;

    return `
      <section class="haccp-corrective-ccp">
        <div class="haccp-hazard-step-head">
          <div>
            <strong>${escapeHtml(ccp.code || 'CCP')} · ${escapeHtml(ccp.name)}</strong>
            <span class="haccp-hazard-meta"> · ${escapeHtml(stepMap.get(ccp.flowStepId)?.name || '')}
              · ${escapeHtml(ccp.hazardDescription || '')}</span>
          </div>
          <button type="button" class="btn btn-secondary btn-sm haccp-corrective-seed" data-ccp-id="${ccp.id}">
            הצע פעולה מתקנת
          </button>
        </div>
        ${rows}
      </section>`;
  }).join('');

  return `
    <div class="card">
      <div class="card-title">5.5 · פעולות מתקנות — ${escapeHtml(activePlan.name)}</div>
      <p class="haccp-hint">
        לפי המדריך: לכל CCP יש להגדיר מראש מה עושים בחריגה — החזרת שליטה, חקירת סיבה,
        מניעת הישנות, וטיפול במוצר החשוד. משפחה: <strong>${escapeHtml(familyName)}</strong>
      </p>
      <p class="haccp-family-products">
        <strong>${actions.length}</strong> פעולות מתקנות ·
        כיסוי CCP: <strong>${covered}/${confirmedCcps.length}</strong>
      </p>

      <div class="haccp-corrective-list">${blocks}</div>

      <form id="haccp-corrective-form" class="haccp-product-form haccp-corrective-form">
        <div class="card-title" style="font-size:1rem">הוספת פעולה מתקנת</div>
        <div class="form-group">
          <label for="haccp-corrective-ccp">CCP</label>
          <select id="haccp-corrective-ccp">${ccpOptions}</select>
        </div>
        <div class="form-group">
          <label for="haccp-corrective-limit">קישור לגבול קריטי (אופציונלי)</label>
          <select id="haccp-corrective-limit">${limitOptionsForCcp(limits, defaultCcpId)}</select>
        </div>
        <div class="form-group">
          <label for="haccp-corrective-deviation">מה נחשב חריגה</label>
          <textarea id="haccp-corrective-deviation" rows="2" maxlength="1000"
            placeholder="למשל: טמפרטורת ליבה מתחת ל־75°C"></textarea>
        </div>
        <div class="form-group">
          <label for="haccp-corrective-immediate">פעולה מיידית (החזרת שליטה)</label>
          <textarea id="haccp-corrective-immediate" rows="2" maxlength="2000"
            placeholder="עצירת תהליך / תיקון פרמטר / סימון מוצר כמושהה…"></textarea>
        </div>
        <div class="form-group">
          <label for="haccp-corrective-cause">חקירת סיבה</label>
          <textarea id="haccp-corrective-cause" rows="2" maxlength="2000"
            placeholder="איך בודקים את מקור החריגה"></textarea>
        </div>
        <div class="form-group">
          <label for="haccp-corrective-prevent">מניעת הישנות</label>
          <textarea id="haccp-corrective-prevent" rows="2" maxlength="2000"
            placeholder="תיקון הסיבה, הדרכה, עדכון נוהל…"></textarea>
        </div>
        <div class="form-group">
          <label for="haccp-corrective-product">בקרת מוצר חשוד</label>
          <textarea id="haccp-corrective-product" rows="2" maxlength="2000"
            placeholder="בידוד אצווה, מניעת שחרור עד החלטת איכות…"></textarea>
        </div>
        <div class="haccp-form-row">
          <div class="form-group">
            <label for="haccp-corrective-disposition">גורל מוצר</label>
            <select id="haccp-corrective-disposition">${dispositionOptions('hold_evaluate')}</select>
          </div>
          <div class="form-group">
            <label for="haccp-corrective-role">אחראי (תפקיד)</label>
            <select id="haccp-corrective-role">${monitorRoleOptions('quality')}</select>
          </div>
        </div>
        <div class="form-group">
          <label for="haccp-corrective-who">שם / פירוט אחראי</label>
          <input type="text" id="haccp-corrective-who" maxlength="200" placeholder="אופציונלי">
        </div>
        <div class="form-group">
          <label for="haccp-corrective-notify">הודעה / דיווח</label>
          <input type="text" id="haccp-corrective-notify" maxlength="1000"
            placeholder="למי מודיעים ובאיזה שלב">
        </div>
        <div class="form-group">
          <label for="haccp-corrective-records">רישום / טופס</label>
          <input type="text" id="haccp-corrective-records" maxlength="1000" placeholder="טופס פעולה מתקנת CCP">
        </div>
        <div class="form-group">
          <label for="haccp-corrective-notes">הערות</label>
          <textarea id="haccp-corrective-notes" rows="2" maxlength="2000"></textarea>
        </div>
        <button type="submit" class="btn btn-primary">הוסף פעולה מתקנת</button>
      </form>
    </div>`;
}

function verificationMethodOptions(selected = 'records_review') {
  return HACCP_VERIFICATION_METHODS.map((m) =>
    `<option value="${m.id}" ${selected === m.id ? 'selected' : ''}>${escapeHtml(m.label)}</option>`
  ).join('');
}

function verificationFrequencyOptions(selected = 'monthly') {
  return HACCP_VERIFICATION_FREQUENCIES.map((f) =>
    `<option value="${f.id}" ${selected === f.id ? 'selected' : ''}>${escapeHtml(f.label)}</option>`
  ).join('');
}

function renderVerificationSection(activePlan, flowSteps, confirmedCcps, procs, groupMap) {
  if (!activePlan) {
    return `
      <div class="card">
        <div class="card-title">5.6 · אימות מערכת</div>
        <p class="haccp-hint">בחר תכנית. האימות מוודא שהמערכת מיושמת כראוי — מעבר לניטור השוטף.</p>
      </div>`;
  }

  const familyName = groupMap.get(activePlan.categoryGroupId)?.name || '';
  const ccpMap = new Map((confirmedCcps || []).map((c) => [Number(c.id), c]));

  const ccpOptions = [
    `<option value="">— כלל התכנית —</option>`,
    ...(confirmedCcps || []).map((c) =>
      `<option value="${c.id}">${escapeHtml(c.code || 'CCP')} — ${escapeHtml(c.name)}</option>`
    ),
  ].join('');

  const rows = procs.length
    ? procs.map((v) => {
      const ccp = v.ccpId ? ccpMap.get(Number(v.ccpId)) : null;
      const who = v.responsibleText
        ? `${haccpRoleLabel(v.responsibleRole)} · ${v.responsibleText}`
        : haccpRoleLabel(v.responsibleRole);
      const scope = ccp
        ? `${ccp.code || 'CCP'} · ${ccp.name}`
        : 'כלל התכנית';
      return `
        <div class="haccp-verify-row">
          <div>
            <div class="haccp-ccp-title">${escapeHtml(haccpVerificationMethodLabel(v.method))} — ${escapeHtml(v.activity)}</div>
            <div class="haccp-hazard-meta">
              היקף: ${escapeHtml(scope)}
              · ${escapeHtml(haccpVerificationFrequencyLabel(v.frequency))}
              ${v.frequencyDetails ? ` (${escapeHtml(v.frequencyDetails)})` : ''}
              · ${escapeHtml(who)}
            </div>
            ${v.records ? `<div class="haccp-hazard-meta">רישום: ${escapeHtml(v.records)}</div>` : ''}
          </div>
          <div class="haccp-hazard-actions">
            <button type="button" class="btn btn-secondary btn-sm haccp-verify-edit" data-id="${v.id}">ערוך</button>
            <button type="button" class="btn btn-danger btn-sm haccp-verify-del" data-id="${v.id}">מחק</button>
          </div>
        </div>`;
    }).join('')
    : `<p class="haccp-hint">עדיין אין נהלי אימות. אפשר להוסיף ידנית או להשתמש בהצעות מהמדריך.</p>`;

  return `
    <div class="card">
      <div class="card-title">5.6 · אימות מערכת — ${escapeHtml(activePlan.name)}</div>
      <p class="haccp-hint">
        לפי המדריך: אימות מתבצע על ידי גורם בכיר יותר מעובדי הייצור — בתצפית ישירה,
        בדיקה מקבילה או בדיקת תיעוד (ואפשר גם כיול וביקורת). משפחה: <strong>${escapeHtml(familyName)}</strong>
      </p>
      <p class="haccp-family-products">
        <strong>${procs.length}</strong> נהלי אימות
        ${confirmedCcps?.length ? ` · ${confirmedCcps.length} CCP מאושרים` : ''}
      </p>
      <div class="haccp-inline-row" style="margin-bottom:12px">
        <button type="button" class="btn btn-secondary" id="haccp-verify-seed">הצע נהלי אימות</button>
      </div>

      <div class="haccp-verify-list">${rows}</div>

      <form id="haccp-verify-form" class="haccp-product-form haccp-verify-form">
        <div class="card-title" style="font-size:1rem">הוספת נוהל אימות</div>
        <div class="haccp-form-row">
          <div class="form-group">
            <label for="haccp-verify-method">שיטה</label>
            <select id="haccp-verify-method">${verificationMethodOptions('records_review')}</select>
          </div>
          <div class="form-group">
            <label for="haccp-verify-freq">תדירות</label>
            <select id="haccp-verify-freq">${verificationFrequencyOptions('monthly')}</select>
          </div>
        </div>
        <div class="form-group">
          <label for="haccp-verify-ccp">היקף (אופציונלי — CCP ספציפי)</label>
          <select id="haccp-verify-ccp">${ccpOptions}</select>
        </div>
        <div class="form-group">
          <label for="haccp-verify-activity">מה מאמתים</label>
          <textarea id="haccp-verify-activity" rows="2" maxlength="2000"
            placeholder="למשל: סקירת רשומות ניטור שבועית"></textarea>
        </div>
        <div class="form-group">
          <label for="haccp-verify-freq-details">פירוט תדירות</label>
          <input type="text" id="haccp-verify-freq-details" maxlength="500" placeholder="אופציונלי">
        </div>
        <div class="haccp-form-row">
          <div class="form-group">
            <label for="haccp-verify-role">אחראי (תפקיד)</label>
            <select id="haccp-verify-role">${monitorRoleOptions('quality')}</select>
          </div>
          <div class="form-group">
            <label for="haccp-verify-who">שם / פירוט</label>
            <input type="text" id="haccp-verify-who" maxlength="200" placeholder="אופציונלי">
          </div>
        </div>
        <div class="form-group">
          <label for="haccp-verify-records">רישום / טופס</label>
          <input type="text" id="haccp-verify-records" maxlength="1000" placeholder="טופס אימות / יומן ביקורת">
        </div>
        <div class="form-group">
          <label for="haccp-verify-notes">הערות</label>
          <textarea id="haccp-verify-notes" rows="2" maxlength="2000"></textarea>
        </div>
        <button type="submit" class="btn btn-primary">הוסף נוהל אימות</button>
      </form>
    </div>`;
}

function docKindOptions(selected = 'monitoring') {
  return HACCP_DOC_KINDS.map((k) =>
    `<option value="${k.id}" ${selected === k.id ? 'selected' : ''}>${escapeHtml(k.label)}</option>`
  ).join('');
}

function docFormatOptions(selected = 'both') {
  return HACCP_DOC_FORMATS.map((f) =>
    `<option value="${f.id}" ${selected === f.id ? 'selected' : ''}>${escapeHtml(f.label)}</option>`
  ).join('');
}

function renderDocumentationSection(activePlan, documents, groupMap) {
  if (!activePlan) {
    return `
      <div class="card">
        <div class="card-title">5.7 · תיעוד ורישום</div>
        <p class="haccp-hint">בחר תכנית. כאן מגדירים אילו מסמכים ורשומות נשמרים, איפה, ובמשך כמה זמן.</p>
      </div>`;
  }

  const familyName = groupMap.get(activePlan.categoryGroupId)?.name || '';
  const rows = documents.length
    ? documents.map((d) => {
      const who = d.responsibleText
        ? `${haccpRoleLabel(d.responsibleRole)} · ${d.responsibleText}`
        : haccpRoleLabel(d.responsibleRole);
      return `
        <div class="haccp-doc-row">
          <div>
            <div class="haccp-ccp-title">${escapeHtml(d.title)}</div>
            <div class="haccp-hazard-meta">
              ${escapeHtml(haccpDocKindLabel(d.docKind))}
              · ${escapeHtml(haccpDocFormatLabel(d.format))}
              · שמירה: ${escapeHtml(String(d.retentionYears ?? 2))} שנים
              · ${escapeHtml(who)}
            </div>
            ${d.storageLocation ? `<div class="haccp-hazard-meta">מיקום: ${escapeHtml(d.storageLocation)}</div>` : ''}
            ${d.description ? `<div class="haccp-hazard-meta">${escapeHtml(d.description)}</div>` : ''}
          </div>
          <div class="haccp-hazard-actions">
            <button type="button" class="btn btn-secondary btn-sm haccp-doc-edit" data-id="${d.id}">ערוך</button>
            <button type="button" class="btn btn-danger btn-sm haccp-doc-del" data-id="${d.id}">מחק</button>
          </div>
        </div>`;
    }).join('')
    : `<p class="haccp-hint">עדיין אין קטלוג תיעוד. אפשר להוסיף ידנית או להשתמש בהצעות מהמדריך.</p>`;

  return `
    <div class="card">
      <div class="card-title">5.7 · תיעוד ורישום — ${escapeHtml(activePlan.name)}</div>
      <p class="haccp-hint">
        לפי המדריך: יש להגדיר בקרת תיעוד ושמירת רשומות לניטור, פעולות מתקנות ואימות —
        כולל ערכים, זמנים, כיולים וחתימות. שמירה מומלצת: לפחות <strong>שנתיים</strong>.
        משפחה: <strong>${escapeHtml(familyName)}</strong>
      </p>
      <p class="haccp-family-products"><strong>${documents.length}</strong> מסמכים / רשומות בקטלוג</p>
      <div class="haccp-inline-row" style="margin-bottom:12px">
        <button type="button" class="btn btn-secondary" id="haccp-doc-seed">הצע קטלוג תיעוד</button>
      </div>

      <div class="haccp-doc-list">${rows}</div>

      <form id="haccp-doc-form" class="haccp-product-form haccp-doc-form">
        <div class="card-title" style="font-size:1rem">הוספת מסמך / רשומה</div>
        <div class="haccp-form-row">
          <div class="form-group">
            <label for="haccp-doc-kind">סוג</label>
            <select id="haccp-doc-kind">${docKindOptions('monitoring')}</select>
          </div>
          <div class="form-group">
            <label for="haccp-doc-format">פורמט</label>
            <select id="haccp-doc-format">${docFormatOptions('both')}</select>
          </div>
        </div>
        <div class="form-group">
          <label for="haccp-doc-title">שם המסמך / הטופס</label>
          <input type="text" id="haccp-doc-title" maxlength="200" placeholder="למשל: טופס ניטור טמפרטורת ליבה">
        </div>
        <div class="form-group">
          <label for="haccp-doc-desc">תיאור</label>
          <textarea id="haccp-doc-desc" rows="2" maxlength="2000" placeholder="מה נרשם ובאיזה שלב"></textarea>
        </div>
        <div class="haccp-form-row">
          <div class="form-group">
            <label for="haccp-doc-retention">שנות שמירה</label>
            <input type="number" id="haccp-doc-retention" min="1" max="30" value="2">
          </div>
          <div class="form-group">
            <label for="haccp-doc-role">אחראי</label>
            <select id="haccp-doc-role">${monitorRoleOptions('quality')}</select>
          </div>
        </div>
        <div class="form-group">
          <label for="haccp-doc-location">מיקום אחסון</label>
          <input type="text" id="haccp-doc-location" maxlength="500" placeholder="תיקיית איכות / מערכת דיגיטלית…">
        </div>
        <div class="form-group">
          <label for="haccp-doc-who">שם / פירוט אחראי</label>
          <input type="text" id="haccp-doc-who" maxlength="200" placeholder="אופציונלי">
        </div>
        <div class="form-group">
          <label for="haccp-doc-notes">הערות</label>
          <textarea id="haccp-doc-notes" rows="2" maxlength="2000"></textarea>
        </div>
        <button type="submit" class="btn btn-primary">הוסף למסמכים</button>
      </form>
    </div>`;
}

function renderTeamSection(members) {
  const coverage = buildHaccpTeamRoleCoverage(members);
  const coverageByRole = new Map(
    coverage.slots.filter((s) => s.kind === 'role').map((s) => [s.id, s]),
  );
  const coverageList = `
    <div class="haccp-team-coverage" aria-label="כיסוי עמדות צוות">
      <div class="haccp-team-coverage-head">
        <strong>עמדות צוות</strong>
        <span class="form-hint">${coverage.doneCount}/${coverage.totalCount} מסומנות
          · ירוק = יש אחראי · אדום = חסר</span>
      </div>
      <ul class="haccp-team-coverage-list">
        ${coverage.slots.map((slot) => `
          <li class="haccp-team-slot ${slot.done ? 'is-filled' : 'is-missing'}${slot.required ? ' is-required' : ''}">
            <button type="button" class="haccp-team-slot-btn"
              data-coverage-id="${escapeHtml(slot.id)}"
              data-coverage-kind="${escapeHtml(slot.kind)}"
              title="${slot.done ? 'מולא' : 'לחץ לבחירת העמדה בטופס'}">
              <span class="haccp-team-slot-mark" aria-hidden="true">${slot.done ? '✓' : '○'}</span>
              <span class="haccp-team-slot-label">${escapeHtml(slot.label)}${slot.required ? ' *' : ''}</span>
              <span class="haccp-team-slot-who">${slot.done
    ? escapeHtml(slot.names.join(' · ') || 'מולא')
    : 'חסר אחראי'}</span>
            </button>
          </li>`).join('')}
      </ul>
    </div>`;

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
      <p class="haccp-hint haccp-team-shared-note">
        <strong>צוות משותף לכל תכניות HACCP</strong> (שטרודל, רונדו ליין, מאפינס וכו׳).
        ממלאים פעם אחת — התכניות החדשות יורשות את אותו צוות. עריכה כאן משפיעה על כולן.
        שאר השלבים (תיאור מוצר, תרשים, CCP…) נשארים נפרדים לכל תכנית.
      </p>

      ${coverageList}

      <div class="haccp-add-member">
        <div class="form-group">
          <label for="haccp-member-name">שם</label>
          <input type="text" id="haccp-member-name" placeholder="שם מלא" maxlength="80">
        </div>
        <div class="form-group">
          <label id="haccp-member-role-label">תחום / עמדה</label>
          ${renderTeamRolePicker({
    id: 'haccp-member-role',
    members,
    coverageByRole,
    selected: 'quality',
    labelledBy: 'haccp-member-role-label',
  })}
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

/** בורר תפקיד עם צבעי ירוק/אדום (native option לא צובע אמין במובייל) */
function renderTeamRolePicker({
  id,
  members = [],
  coverageByRole = null,
  selected = 'quality',
  labelledBy = '',
} = {}) {
  const coverage = coverageByRole || new Map(
    buildHaccpTeamRoleCoverage(members)
      .slots
      .filter((s) => s.kind === 'role')
      .map((s) => [s.id, s]),
  );
  const selectedRole = HACCP_TEAM_ROLES.some((r) => r.id === selected) ? selected : 'quality';
  const selectedSlot = coverage.get(selectedRole);
  const selectedFilled = selectedRole === 'other' ? null : !!selectedSlot?.done;
  const selectedLabel = selectedRole === 'other'
    ? 'אחר'
    : `${selectedFilled ? '✓' : '○'} ${haccpRoleLabel(selectedRole)}${
      selectedFilled && selectedSlot?.names?.length ? ` — ${selectedSlot.names.join(' · ')}` : (selectedFilled ? '' : ' — חסר')
    }`;
  const triggerClass = selectedFilled === true
    ? 'is-filled'
    : selectedFilled === false
      ? 'is-missing'
      : 'is-neutral';
  const ariaLabelledBy = labelledBy
    ? `aria-labelledby="${escapeHtml(labelledBy)}"`
    : `aria-label="תחום / עמדה"`;

  const items = HACCP_TEAM_ROLES.map((r) => {
    if (r.id === 'other') {
      return `
        <button type="button" class="haccp-role-picker-item is-neutral"
          role="option" data-role="${r.id}" aria-selected="${selectedRole === r.id ? 'true' : 'false'}">
          <span class="haccp-role-picker-item-mark">·</span>
          <span class="haccp-role-picker-item-label">${escapeHtml(r.label)}</span>
          <span class="haccp-role-picker-item-who">אופציונלי</span>
        </button>`;
    }
    const slot = coverage.get(r.id);
    const done = !!slot?.done;
    return `
      <button type="button" class="haccp-role-picker-item ${done ? 'is-filled' : 'is-missing'}"
        role="option" data-role="${r.id}" aria-selected="${selectedRole === r.id ? 'true' : 'false'}">
        <span class="haccp-role-picker-item-mark">${done ? '✓' : '○'}</span>
        <span class="haccp-role-picker-item-label">${escapeHtml(r.label)}</span>
        <span class="haccp-role-picker-item-who">${done
    ? escapeHtml(slot.names.join(' · ') || 'מולא')
    : 'חסר אחראי'}</span>
      </button>`;
  }).join('');

  return `
    <div class="haccp-role-picker" data-picker-id="${escapeHtml(id)}">
      <input type="hidden" id="${escapeHtml(id)}" value="${escapeHtml(selectedRole)}">
      <button type="button" class="haccp-role-picker-trigger ${triggerClass}"
        aria-haspopup="listbox" aria-expanded="false" ${ariaLabelledBy}>
        <span class="haccp-role-picker-trigger-text">${escapeHtml(selectedLabel)}</span>
        <span class="haccp-role-picker-caret" aria-hidden="true">▾</span>
      </button>
      <div class="haccp-role-picker-menu hidden" role="listbox" hidden>
        ${items}
      </div>
    </div>`;
}

function bindTeamRolePickers(root = document) {
  root.querySelectorAll('.haccp-role-picker').forEach((picker) => {
    if (picker.dataset.bound === '1') return;
    picker.dataset.bound = '1';
    const trigger = picker.querySelector('.haccp-role-picker-trigger');
    const menu = picker.querySelector('.haccp-role-picker-menu');
    const hidden = picker.querySelector('input[type="hidden"]');
    if (!trigger || !menu || !hidden) return;

    const close = () => {
      menu.classList.add('hidden');
      menu.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      picker.classList.remove('is-open');
    };
    const open = () => {
      document.querySelectorAll('.haccp-role-picker.is-open').forEach((other) => {
        if (other === picker) return;
        other.querySelector('.haccp-role-picker-menu')?.classList.add('hidden');
        const m = other.querySelector('.haccp-role-picker-menu');
        if (m) m.hidden = true;
        other.querySelector('.haccp-role-picker-trigger')?.setAttribute('aria-expanded', 'false');
        other.classList.remove('is-open');
      });
      menu.classList.remove('hidden');
      menu.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      picker.classList.add('is-open');
    };

    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (picker.classList.contains('is-open')) close();
      else open();
    });

    menu.querySelectorAll('.haccp-role-picker-item').forEach((item) => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const role = item.dataset.role;
        if (!role) return;
        hidden.value = role;
        const mark = item.querySelector('.haccp-role-picker-item-mark')?.textContent || '';
        const label = item.querySelector('.haccp-role-picker-item-label')?.textContent || '';
        const who = item.querySelector('.haccp-role-picker-item-who')?.textContent || '';
        const textEl = trigger.querySelector('.haccp-role-picker-trigger-text');
        if (textEl) textEl.textContent = `${mark} ${label}${who ? ` — ${who}` : ''}`.replace(/\s+/g, ' ').trim();
        trigger.classList.remove('is-filled', 'is-missing', 'is-neutral');
        if (item.classList.contains('is-filled')) trigger.classList.add('is-filled');
        else if (item.classList.contains('is-missing')) trigger.classList.add('is-missing');
        else trigger.classList.add('is-neutral');
        menu.querySelectorAll('.haccp-role-picker-item').forEach((opt) => {
          opt.setAttribute('aria-selected', opt === item ? 'true' : 'false');
        });
        close();
        hidden.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });
  });

  if (!bindTeamRolePickers._docBound) {
    bindTeamRolePickers._docBound = true;
    document.addEventListener('click', (e) => {
      if (e.target.closest('.haccp-role-picker')) return;
      document.querySelectorAll('.haccp-role-picker.is-open').forEach((picker) => {
        picker.querySelector('.haccp-role-picker-menu')?.classList.add('hidden');
        const menu = picker.querySelector('.haccp-role-picker-menu');
        if (menu) menu.hidden = true;
        picker.querySelector('.haccp-role-picker-trigger')?.setAttribute('aria-expanded', 'false');
        picker.classList.remove('is-open');
      });
    });
  }
}

function setTeamRolePickerValue(pickerOrId, roleId) {
  const picker = typeof pickerOrId === 'string'
    ? document.querySelector(`.haccp-role-picker[data-picker-id="${pickerOrId}"]`)
    : pickerOrId;
  if (!picker) return;
  const item = picker.querySelector(`.haccp-role-picker-item[data-role="${String(roleId).replace(/"/g, '')}"]`);
  const hidden = picker.querySelector('input[type="hidden"]');
  const trigger = picker.querySelector('.haccp-role-picker-trigger');
  if (!item || !hidden || !trigger) return;
  hidden.value = roleId;
  const mark = item.querySelector('.haccp-role-picker-item-mark')?.textContent || '';
  const label = item.querySelector('.haccp-role-picker-item-label')?.textContent || '';
  const who = item.querySelector('.haccp-role-picker-item-who')?.textContent || '';
  const textEl = trigger.querySelector('.haccp-role-picker-trigger-text');
  if (textEl) {
    textEl.textContent = `${mark} ${label}${who ? ` — ${who}` : ''}`.replace(/\s+/g, ' ').trim();
  }
  trigger.classList.remove('is-filled', 'is-missing', 'is-neutral');
  if (item.classList.contains('is-filled')) trigger.classList.add('is-filled');
  else if (item.classList.contains('is-missing')) trigger.classList.add('is-missing');
  else trigger.classList.add('is-neutral');
  picker.querySelectorAll('.haccp-role-picker-item').forEach((opt) => {
    opt.setAttribute('aria-selected', opt === item ? 'true' : 'false');
  });
}

function bindHaccpEvents(container, ctx) {
  document.getElementById('haccp-wizard-mode')?.addEventListener('change', (e) => {
    setWizardMode(!!e.target.checked);
    if (e.target.checked && ctx.activePlan && ctx.wizardState?.firstIncomplete) {
      container.dataset.haccpStep = ctx.wizardState.firstIncomplete;
    }
    renderHaccp(container);
  });

  container.querySelectorAll('[data-haccp-step]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.haccpStep;
      if (!id) return;
      if (!canAccessHaccpStep(getCurrentUserRole(), id)) {
        showToast(PERMISSION_DENIED_MESSAGE);
        return;
      }
      if (btn.dataset.haccpWizardLocked === '1' || (ctx.wizardOn && ctx.wizardState && !ctx.wizardState.isUnlocked(id))) {
        showToast('במצב אשף: השלם את השלבים הקודמים לפני דילוג');
        return;
      }
      const openPlanId = btn.dataset.haccpOpenPlan;
      if (openPlanId) {
        try {
          await setActiveHaccpPlanId(openPlanId);
        } catch (err) {
          showToast(err.message || 'שגיאה בבחירת תכנית');
          return;
        }
      }
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

  container.querySelectorAll('.haccp-print-plan').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!ctx.activePlan) return showToast('בחר תכנית קודם');
      try {
        const ok = await printHaccpPlan(ctx.activePlan.id);
        if (!ok) showToast('יש לאפשר חלונות קופצים להדפסה');
      } catch (err) {
        showToast(err.message || 'שגיאה בהדפסה');
      }
    });
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

  document.getElementById('haccp-create-from-template')?.addEventListener('click', async () => {
    const gid = document.getElementById('haccp-new-family')?.value;
    const templateId = document.getElementById('haccp-template-type')?.value || 'cakes';
    if (!gid) return showToast('בחר משפחת מוצרים');
    const tmplLabel = HACCP_BAKERY_TEMPLATES.find((t) => t.id === templateId)?.label || templateId;
    if (!confirm(`ליצור תכנית מתבנית «${tmplLabel}»?\nימולאו צוות (אם חסר), שימוש מיועד, תיאור מוצר, וטיוטת PRP/תרשים/סיכונים/CCP.`)) return;
    const btn = document.getElementById('haccp-create-from-template');
    if (btn) btn.disabled = true;
    try {
      showToast(`בונה מתבנית ${tmplLabel}…`);
      const result = await createHaccpPlanFromBakeryTemplate(gid, { templateId });
      setWizardMode(true);
      container.dataset.haccpStep = result.readiness?.missing?.[0]?.stepId || 'flow_verify';
      showToast(`תכנית «${result.templateLabel || tmplLabel}» ✓ (+${result.addedTotal}) · מוכנות ${result.readiness?.percent ?? '?'}%`);
      renderHaccp(container);
    } catch (err) {
      showToast(err.message || 'שגיאה ביצירת תבנית');
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  const runBuildDraft = async () => {
    if (!ctx.activePlan) return showToast('בחר תכנית קודם');
    if (!confirm('לבנות טיוטה אוטומטית מהצעות?\nימולאו רק חלקים ריקים — לא יימחקו נתונים קיימים.')) return;
    const btn = document.getElementById('haccp-build-draft');
    if (btn) btn.disabled = true;
    try {
      showToast('בונה טיוטה…');
      const result = await buildHaccpPlanDraft(ctx.activePlan.id);
      const failed = result.failed?.length || 0;
      const msg = failed
        ? `טיוטה חלקית: +${result.addedTotal} · ${failed} שלבים נכשלו · מוכנות ${result.readiness?.percent ?? '?'}%`
        : `טיוטה מוכנה ✓ (+${result.addedTotal}) · מוכנות ${result.readiness?.percent ?? '?'}%`;
      showToast(msg);
      container.dataset.haccpStep = 'overview';
      renderHaccp(container);
    } catch (err) {
      showToast(err.message || 'שגיאה בבניית טיוטה');
    } finally {
      if (btn) btn.disabled = false;
    }
  };

  document.querySelectorAll('#haccp-build-draft').forEach((btn) => {
    btn.addEventListener('click', runBuildDraft);
  });

  document.getElementById('haccp-clone-plan')?.addEventListener('click', () => {
    if (!ctx.activePlan) return;
    const used = new Set((ctx.plans || []).map((p) => Number(p.categoryGroupId)));
    const available = (ctx.groups || []).filter((g) => !used.has(Number(g.id)));
    if (!available.length) return showToast('אין משפחה פנויה לשכפול');
    openModal({
      title: 'שכפול תכנית למשפחה אחרת',
      bodyHTML: `
        <p class="form-hint">יועתקו PRP, תיאור, שימוש מיועד, תרשים, סיכונים, CCP, גבולות, ניטור, פעולות מתקנות, אימות ומסמכים. יומן ניטור לא מועתק.</p>
        <div class="form-group">
          <label for="haccp-clone-family">משפחת יעד</label>
          <select id="haccp-clone-family">
            ${available.map((g) => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label for="haccp-clone-name">שם לתכנית החדשה</label>
          <input type="text" id="haccp-clone-name" maxlength="80"
            value="${escapeHtml(`${ctx.activePlan.name} (עותק)`)}">
        </div>`,
      footerHTML: `<button class="btn btn-secondary modal-cancel">ביטול</button>
        <button class="btn btn-primary" id="haccp-clone-save">שכפל</button>`,
    });
    document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
    document.getElementById('haccp-clone-save')?.addEventListener('click', async () => {
      try {
        const gid = document.getElementById('haccp-clone-family')?.value;
        const name = document.getElementById('haccp-clone-name')?.value;
        await cloneHaccpPlan(ctx.activePlan.id, gid, { name });
        closeModal();
        showToast('תכנית שוכפלה ✓');
        container.dataset.haccpStep = 'overview';
        renderHaccp(container);
      } catch (err) {
        showToast(err.message || 'שגיאה בשכפול');
      }
    });
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

  container.querySelectorAll('.haccp-team-slot-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const kind = btn.dataset.coverageKind;
      const id = btn.dataset.coverageId;
      const leaderCb = document.getElementById('haccp-member-leader');
      const nameInput = document.getElementById('haccp-member-name');
      if (kind === 'leader') {
        if (leaderCb) leaderCb.checked = true;
        setTeamRolePickerValue('haccp-member-role', 'quality');
        showToast('סמן מוביל מערכת — הזן שם והוסף');
      } else if (id) {
        setTeamRolePickerValue('haccp-member-role', id);
        if (leaderCb) leaderCb.checked = false;
        showToast(`נבחרה עמדה: ${haccpRoleLabel(id)} — הזן שם והוסף`);
      }
      nameInput?.focus();
    });
  });

  bindTeamRolePickers(container);

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
      openModal({
        title: 'עריכת חבר צוות',
        bodyHTML: `
          <div class="form-group">
            <label for="edit-haccp-name">שם</label>
            <input type="text" id="edit-haccp-name" value="${escapeHtml(member.name)}" maxlength="80">
          </div>
          <div class="form-group">
            <label id="edit-haccp-role-label">תחום / עמדה</label>
            ${renderTeamRolePicker({
    id: 'edit-haccp-role',
    members: ctx.members,
    selected: member.role || 'quality',
    labelledBy: 'edit-haccp-role-label',
  })}
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
      bindTeamRolePickers(document.querySelector('.modal-body') || document);
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

  function refreshMonitorLimitOptions() {
    const ccpSelect = document.getElementById('haccp-monitor-ccp');
    const limitSelect = document.getElementById('haccp-monitor-limit');
    if (!ccpSelect || !limitSelect) return;
    limitSelect.innerHTML = limitOptionsForCcp(ctx.criticalLimits || [], ccpSelect.value);
  }

  document.getElementById('haccp-monitor-ccp')?.addEventListener('change', refreshMonitorLimitOptions);

  document.getElementById('haccp-monitor-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!ctx.activePlan) return showToast('בחר תכנית קודם');
    try {
      await addHaccpMonitoring(ctx.activePlan.id, {
        ccpId: document.getElementById('haccp-monitor-ccp')?.value,
        limitId: document.getElementById('haccp-monitor-limit')?.value || null,
        what: document.getElementById('haccp-monitor-what')?.value,
        method: document.getElementById('haccp-monitor-method')?.value,
        methodDetails: document.getElementById('haccp-monitor-method-details')?.value,
        frequency: document.getElementById('haccp-monitor-freq')?.value,
        frequencyDetails: document.getElementById('haccp-monitor-freq-details')?.value,
        responsibleRole: document.getElementById('haccp-monitor-role')?.value,
        responsibleText: document.getElementById('haccp-monitor-who')?.value,
        records: document.getElementById('haccp-monitor-records')?.value,
        notes: document.getElementById('haccp-monitor-notes')?.value,
      });
      showToast('נוהל ניטור נוסף ✓');
      renderHaccp(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  container.querySelectorAll('.haccp-monitor-seed').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!ctx.activePlan) return;
      try {
        const n = await seedSuggestedMonitoringForCcp(ctx.activePlan.id, btn.dataset.ccpId);
        showToast(`נוספו ${n} הצעות ניטור ✓`);
        renderHaccp(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  container.querySelectorAll('.haccp-monitor-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('למחוק נוהל ניטור?')) return;
      try {
        await deleteHaccpMonitoring(btn.dataset.id);
        showToast('נמחק');
        renderHaccp(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  container.querySelectorAll('.haccp-monitor-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = ctx.monitoring?.find((m) => String(m.id) === String(btn.dataset.id));
      if (!row) return;
      const confirmed = (ctx.ccps || []).filter((c) => c.decision === 'ccp');
      const ccpOptions = confirmed.map((c) =>
        `<option value="${c.id}" ${Number(c.id) === Number(row.ccpId) ? 'selected' : ''}>${escapeHtml(c.code || 'CCP')} — ${escapeHtml(c.name)}</option>`
      ).join('');
      openModal({
        title: 'עריכת נוהל ניטור',
        bodyHTML: `
          <div class="form-group">
            <label for="edit-monitor-ccp">CCP</label>
            <select id="edit-monitor-ccp">${ccpOptions}</select>
          </div>
          <div class="form-group">
            <label for="edit-monitor-limit">קישור לגבול קריטי</label>
            <select id="edit-monitor-limit">${limitOptionsForCcp(ctx.criticalLimits || [], row.ccpId, row.limitId || '')}</select>
          </div>
          <div class="form-group">
            <label for="edit-monitor-what">מה מנטרים</label>
            <textarea id="edit-monitor-what" rows="2" maxlength="1000">${escapeHtml(row.what || '')}</textarea>
          </div>
          <div class="haccp-form-row">
            <div class="form-group">
              <label for="edit-monitor-method">שיטה</label>
              <select id="edit-monitor-method">${methodOptions(row.method || 'thermometer')}</select>
            </div>
            <div class="form-group">
              <label for="edit-monitor-freq">תדירות</label>
              <select id="edit-monitor-freq">${frequencyOptions(row.frequency || 'every_batch')}</select>
            </div>
          </div>
          <div class="haccp-form-row">
            <div class="form-group">
              <label for="edit-monitor-method-details">פירוט שיטה</label>
              <input type="text" id="edit-monitor-method-details" maxlength="1000" value="${escapeHtml(row.methodDetails || '')}">
            </div>
            <div class="form-group">
              <label for="edit-monitor-freq-details">פירוט תדירות</label>
              <input type="text" id="edit-monitor-freq-details" maxlength="500" value="${escapeHtml(row.frequencyDetails || '')}">
            </div>
          </div>
          <div class="haccp-form-row">
            <div class="form-group">
              <label for="edit-monitor-role">אחראי</label>
              <select id="edit-monitor-role">${monitorRoleOptions(row.responsibleRole || 'production')}</select>
            </div>
            <div class="form-group">
              <label for="edit-monitor-who">שם / פירוט</label>
              <input type="text" id="edit-monitor-who" maxlength="200" value="${escapeHtml(row.responsibleText || '')}">
            </div>
          </div>
          <div class="form-group">
            <label for="edit-monitor-records">רישום / טופס</label>
            <input type="text" id="edit-monitor-records" maxlength="1000" value="${escapeHtml(row.records || '')}">
          </div>
          <div class="form-group">
            <label for="edit-monitor-notes">הערות</label>
            <textarea id="edit-monitor-notes" rows="2" maxlength="2000">${escapeHtml(row.notes || '')}</textarea>
          </div>`,
        footerHTML: `<button class="btn btn-secondary modal-cancel">ביטול</button>
          <button class="btn btn-primary" id="save-edit-monitor">שמור</button>`,
      });
      document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
      document.getElementById('edit-monitor-ccp')?.addEventListener('change', () => {
        const limitSelect = document.getElementById('edit-monitor-limit');
        const ccpId = document.getElementById('edit-monitor-ccp')?.value;
        if (limitSelect) limitSelect.innerHTML = limitOptionsForCcp(ctx.criticalLimits || [], ccpId);
      });
      document.getElementById('save-edit-monitor')?.addEventListener('click', async () => {
        try {
          await updateHaccpMonitoring(row.id, {
            ccpId: document.getElementById('edit-monitor-ccp').value,
            limitId: document.getElementById('edit-monitor-limit').value || null,
            what: document.getElementById('edit-monitor-what').value,
            method: document.getElementById('edit-monitor-method').value,
            methodDetails: document.getElementById('edit-monitor-method-details').value,
            frequency: document.getElementById('edit-monitor-freq').value,
            frequencyDetails: document.getElementById('edit-monitor-freq-details').value,
            responsibleRole: document.getElementById('edit-monitor-role').value,
            responsibleText: document.getElementById('edit-monitor-who').value,
            records: document.getElementById('edit-monitor-records').value,
            notes: document.getElementById('edit-monitor-notes').value,
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

  function refreshCorrectiveLimitOptions() {
    const ccpSelect = document.getElementById('haccp-corrective-ccp');
    const limitSelect = document.getElementById('haccp-corrective-limit');
    if (!ccpSelect || !limitSelect) return;
    limitSelect.innerHTML = limitOptionsForCcp(ctx.criticalLimits || [], ccpSelect.value);
  }

  document.getElementById('haccp-corrective-ccp')?.addEventListener('change', refreshCorrectiveLimitOptions);

  document.getElementById('haccp-corrective-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!ctx.activePlan) return showToast('בחר תכנית קודם');
    try {
      await addHaccpCorrectiveAction(ctx.activePlan.id, {
        ccpId: document.getElementById('haccp-corrective-ccp')?.value,
        limitId: document.getElementById('haccp-corrective-limit')?.value || null,
        deviation: document.getElementById('haccp-corrective-deviation')?.value,
        immediateAction: document.getElementById('haccp-corrective-immediate')?.value,
        causeInvestigation: document.getElementById('haccp-corrective-cause')?.value,
        preventRecurrence: document.getElementById('haccp-corrective-prevent')?.value,
        productControl: document.getElementById('haccp-corrective-product')?.value,
        productDisposition: document.getElementById('haccp-corrective-disposition')?.value,
        responsibleRole: document.getElementById('haccp-corrective-role')?.value,
        responsibleText: document.getElementById('haccp-corrective-who')?.value,
        notificationInstructions: document.getElementById('haccp-corrective-notify')?.value,
        records: document.getElementById('haccp-corrective-records')?.value,
        notes: document.getElementById('haccp-corrective-notes')?.value,
      });
      showToast('פעולה מתקנת נוספה ✓');
      renderHaccp(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  container.querySelectorAll('.haccp-corrective-seed').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!ctx.activePlan) return;
      try {
        const n = await seedSuggestedCorrectiveForCcp(ctx.activePlan.id, btn.dataset.ccpId);
        showToast(`נוספו ${n} הצעות ✓`);
        renderHaccp(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  container.querySelectorAll('.haccp-corrective-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('למחוק פעולה מתקנת?')) return;
      try {
        await deleteHaccpCorrectiveAction(btn.dataset.id);
        showToast('נמחק');
        renderHaccp(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  container.querySelectorAll('.haccp-corrective-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = ctx.correctiveActions?.find((a) => String(a.id) === String(btn.dataset.id));
      if (!row) return;
      const confirmed = (ctx.ccps || []).filter((c) => c.decision === 'ccp');
      const ccpOptions = confirmed.map((c) =>
        `<option value="${c.id}" ${Number(c.id) === Number(row.ccpId) ? 'selected' : ''}>${escapeHtml(c.code || 'CCP')} — ${escapeHtml(c.name)}</option>`
      ).join('');
      openModal({
        title: 'עריכת פעולה מתקנת',
        bodyHTML: `
          <div class="form-group">
            <label for="edit-corrective-ccp">CCP</label>
            <select id="edit-corrective-ccp">${ccpOptions}</select>
          </div>
          <div class="form-group">
            <label for="edit-corrective-limit">קישור לגבול קריטי</label>
            <select id="edit-corrective-limit">${limitOptionsForCcp(ctx.criticalLimits || [], row.ccpId, row.limitId || '')}</select>
          </div>
          <div class="form-group">
            <label for="edit-corrective-deviation">מה נחשב חריגה</label>
            <textarea id="edit-corrective-deviation" rows="2" maxlength="1000">${escapeHtml(row.deviation || '')}</textarea>
          </div>
          <div class="form-group">
            <label for="edit-corrective-immediate">פעולה מיידית</label>
            <textarea id="edit-corrective-immediate" rows="2" maxlength="2000">${escapeHtml(row.immediateAction || '')}</textarea>
          </div>
          <div class="form-group">
            <label for="edit-corrective-cause">חקירת סיבה</label>
            <textarea id="edit-corrective-cause" rows="2" maxlength="2000">${escapeHtml(row.causeInvestigation || '')}</textarea>
          </div>
          <div class="form-group">
            <label for="edit-corrective-prevent">מניעת הישנות</label>
            <textarea id="edit-corrective-prevent" rows="2" maxlength="2000">${escapeHtml(row.preventRecurrence || '')}</textarea>
          </div>
          <div class="form-group">
            <label for="edit-corrective-product">בקרת מוצר חשוד</label>
            <textarea id="edit-corrective-product" rows="2" maxlength="2000">${escapeHtml(row.productControl || '')}</textarea>
          </div>
          <div class="haccp-form-row">
            <div class="form-group">
              <label for="edit-corrective-disposition">גורל מוצר</label>
              <select id="edit-corrective-disposition">${dispositionOptions(row.productDisposition || 'hold_evaluate')}</select>
            </div>
            <div class="form-group">
              <label for="edit-corrective-role">אחראי</label>
              <select id="edit-corrective-role">${monitorRoleOptions(row.responsibleRole || 'quality')}</select>
            </div>
          </div>
          <div class="form-group">
            <label for="edit-corrective-who">שם / פירוט</label>
            <input type="text" id="edit-corrective-who" maxlength="200" value="${escapeHtml(row.responsibleText || '')}">
          </div>
          <div class="form-group">
            <label for="edit-corrective-notify">הודעה / דיווח</label>
            <input type="text" id="edit-corrective-notify" maxlength="1000" value="${escapeHtml(row.notificationInstructions || '')}">
          </div>
          <div class="form-group">
            <label for="edit-corrective-records">רישום / טופס</label>
            <input type="text" id="edit-corrective-records" maxlength="1000" value="${escapeHtml(row.records || '')}">
          </div>
          <div class="form-group">
            <label for="edit-corrective-notes">הערות</label>
            <textarea id="edit-corrective-notes" rows="2" maxlength="2000">${escapeHtml(row.notes || '')}</textarea>
          </div>`,
        footerHTML: `<button class="btn btn-secondary modal-cancel">ביטול</button>
          <button class="btn btn-primary" id="save-edit-corrective">שמור</button>`,
      });
      document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
      document.getElementById('edit-corrective-ccp')?.addEventListener('change', () => {
        const limitSelect = document.getElementById('edit-corrective-limit');
        const ccpId = document.getElementById('edit-corrective-ccp')?.value;
        if (limitSelect) limitSelect.innerHTML = limitOptionsForCcp(ctx.criticalLimits || [], ccpId);
      });
      document.getElementById('save-edit-corrective')?.addEventListener('click', async () => {
        try {
          await updateHaccpCorrectiveAction(row.id, {
            ccpId: document.getElementById('edit-corrective-ccp').value,
            limitId: document.getElementById('edit-corrective-limit').value || null,
            deviation: document.getElementById('edit-corrective-deviation').value,
            immediateAction: document.getElementById('edit-corrective-immediate').value,
            causeInvestigation: document.getElementById('edit-corrective-cause').value,
            preventRecurrence: document.getElementById('edit-corrective-prevent').value,
            productControl: document.getElementById('edit-corrective-product').value,
            productDisposition: document.getElementById('edit-corrective-disposition').value,
            responsibleRole: document.getElementById('edit-corrective-role').value,
            responsibleText: document.getElementById('edit-corrective-who').value,
            notificationInstructions: document.getElementById('edit-corrective-notify').value,
            records: document.getElementById('edit-corrective-records').value,
            notes: document.getElementById('edit-corrective-notes').value,
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

  document.getElementById('haccp-verify-seed')?.addEventListener('click', async () => {
    if (!ctx.activePlan) return;
    try {
      const n = await seedSuggestedVerificationProcs(ctx.activePlan.id);
      showToast(`נוספו ${n} נהלי אימות ✓`);
      renderHaccp(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  document.getElementById('haccp-verify-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!ctx.activePlan) return showToast('בחר תכנית קודם');
    try {
      await addHaccpVerificationProc(ctx.activePlan.id, {
        ccpId: document.getElementById('haccp-verify-ccp')?.value || null,
        method: document.getElementById('haccp-verify-method')?.value,
        activity: document.getElementById('haccp-verify-activity')?.value,
        frequency: document.getElementById('haccp-verify-freq')?.value,
        frequencyDetails: document.getElementById('haccp-verify-freq-details')?.value,
        responsibleRole: document.getElementById('haccp-verify-role')?.value,
        responsibleText: document.getElementById('haccp-verify-who')?.value,
        records: document.getElementById('haccp-verify-records')?.value,
        notes: document.getElementById('haccp-verify-notes')?.value,
      });
      showToast('נוהל אימות נוסף ✓');
      renderHaccp(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  container.querySelectorAll('.haccp-verify-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('למחוק נוהל אימות?')) return;
      try {
        await deleteHaccpVerificationProc(btn.dataset.id);
        showToast('נמחק');
        renderHaccp(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  container.querySelectorAll('.haccp-verify-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = ctx.verificationProcs?.find((v) => String(v.id) === String(btn.dataset.id));
      if (!row) return;
      const confirmed = (ctx.ccps || []).filter((c) => c.decision === 'ccp');
      const ccpOptions = [
        `<option value="" ${!row.ccpId ? 'selected' : ''}>— כלל התכנית —</option>`,
        ...confirmed.map((c) =>
          `<option value="${c.id}" ${Number(c.id) === Number(row.ccpId) ? 'selected' : ''}>${escapeHtml(c.code || 'CCP')} — ${escapeHtml(c.name)}</option>`
        ),
      ].join('');
      openModal({
        title: 'עריכת נוהל אימות',
        bodyHTML: `
          <div class="haccp-form-row">
            <div class="form-group">
              <label for="edit-verify-method">שיטה</label>
              <select id="edit-verify-method">${verificationMethodOptions(row.method || 'records_review')}</select>
            </div>
            <div class="form-group">
              <label for="edit-verify-freq">תדירות</label>
              <select id="edit-verify-freq">${verificationFrequencyOptions(row.frequency || 'monthly')}</select>
            </div>
          </div>
          <div class="form-group">
            <label for="edit-verify-ccp">היקף</label>
            <select id="edit-verify-ccp">${ccpOptions}</select>
          </div>
          <div class="form-group">
            <label for="edit-verify-activity">מה מאמתים</label>
            <textarea id="edit-verify-activity" rows="2" maxlength="2000">${escapeHtml(row.activity || '')}</textarea>
          </div>
          <div class="form-group">
            <label for="edit-verify-freq-details">פירוט תדירות</label>
            <input type="text" id="edit-verify-freq-details" maxlength="500" value="${escapeHtml(row.frequencyDetails || '')}">
          </div>
          <div class="haccp-form-row">
            <div class="form-group">
              <label for="edit-verify-role">אחראי</label>
              <select id="edit-verify-role">${monitorRoleOptions(row.responsibleRole || 'quality')}</select>
            </div>
            <div class="form-group">
              <label for="edit-verify-who">שם / פירוט</label>
              <input type="text" id="edit-verify-who" maxlength="200" value="${escapeHtml(row.responsibleText || '')}">
            </div>
          </div>
          <div class="form-group">
            <label for="edit-verify-records">רישום / טופס</label>
            <input type="text" id="edit-verify-records" maxlength="1000" value="${escapeHtml(row.records || '')}">
          </div>
          <div class="form-group">
            <label for="edit-verify-notes">הערות</label>
            <textarea id="edit-verify-notes" rows="2" maxlength="2000">${escapeHtml(row.notes || '')}</textarea>
          </div>`,
        footerHTML: `<button class="btn btn-secondary modal-cancel">ביטול</button>
          <button class="btn btn-primary" id="save-edit-verify">שמור</button>`,
      });
      document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
      document.getElementById('save-edit-verify')?.addEventListener('click', async () => {
        try {
          await updateHaccpVerificationProc(row.id, {
            ccpId: document.getElementById('edit-verify-ccp').value || null,
            method: document.getElementById('edit-verify-method').value,
            activity: document.getElementById('edit-verify-activity').value,
            frequency: document.getElementById('edit-verify-freq').value,
            frequencyDetails: document.getElementById('edit-verify-freq-details').value,
            responsibleRole: document.getElementById('edit-verify-role').value,
            responsibleText: document.getElementById('edit-verify-who').value,
            records: document.getElementById('edit-verify-records').value,
            notes: document.getElementById('edit-verify-notes').value,
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

  document.getElementById('haccp-doc-seed')?.addEventListener('click', async () => {
    if (!ctx.activePlan) return;
    try {
      const n = await seedSuggestedHaccpDocuments(ctx.activePlan.id);
      showToast(`נוספו ${n} מסמכים ✓`);
      renderHaccp(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  document.getElementById('haccp-doc-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!ctx.activePlan) return showToast('בחר תכנית קודם');
    try {
      await addHaccpDocument(ctx.activePlan.id, {
        docKind: document.getElementById('haccp-doc-kind')?.value,
        title: document.getElementById('haccp-doc-title')?.value,
        description: document.getElementById('haccp-doc-desc')?.value,
        retentionYears: document.getElementById('haccp-doc-retention')?.value,
        storageLocation: document.getElementById('haccp-doc-location')?.value,
        format: document.getElementById('haccp-doc-format')?.value,
        responsibleRole: document.getElementById('haccp-doc-role')?.value,
        responsibleText: document.getElementById('haccp-doc-who')?.value,
        notes: document.getElementById('haccp-doc-notes')?.value,
      });
      showToast('מסמך נוסף ✓');
      renderHaccp(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  container.querySelectorAll('.haccp-doc-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('למחוק מסמך מהקטלוג?')) return;
      try {
        await deleteHaccpDocument(btn.dataset.id);
        showToast('נמחק');
        renderHaccp(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  container.querySelectorAll('.haccp-doc-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = ctx.documents?.find((d) => String(d.id) === String(btn.dataset.id));
      if (!row) return;
      openModal({
        title: 'עריכת מסמך / רשומה',
        bodyHTML: `
          <div class="haccp-form-row">
            <div class="form-group">
              <label for="edit-doc-kind">סוג</label>
              <select id="edit-doc-kind">${docKindOptions(row.docKind || 'other')}</select>
            </div>
            <div class="form-group">
              <label for="edit-doc-format">פורמט</label>
              <select id="edit-doc-format">${docFormatOptions(row.format || 'both')}</select>
            </div>
          </div>
          <div class="form-group">
            <label for="edit-doc-title">שם</label>
            <input type="text" id="edit-doc-title" maxlength="200" value="${escapeHtml(row.title || '')}">
          </div>
          <div class="form-group">
            <label for="edit-doc-desc">תיאור</label>
            <textarea id="edit-doc-desc" rows="2" maxlength="2000">${escapeHtml(row.description || '')}</textarea>
          </div>
          <div class="haccp-form-row">
            <div class="form-group">
              <label for="edit-doc-retention">שנות שמירה</label>
              <input type="number" id="edit-doc-retention" min="1" max="30" value="${escapeHtml(String(row.retentionYears ?? 2))}">
            </div>
            <div class="form-group">
              <label for="edit-doc-role">אחראי</label>
              <select id="edit-doc-role">${monitorRoleOptions(row.responsibleRole || 'quality')}</select>
            </div>
          </div>
          <div class="form-group">
            <label for="edit-doc-location">מיקום אחסון</label>
            <input type="text" id="edit-doc-location" maxlength="500" value="${escapeHtml(row.storageLocation || '')}">
          </div>
          <div class="form-group">
            <label for="edit-doc-who">שם / פירוט</label>
            <input type="text" id="edit-doc-who" maxlength="200" value="${escapeHtml(row.responsibleText || '')}">
          </div>
          <div class="form-group">
            <label for="edit-doc-notes">הערות</label>
            <textarea id="edit-doc-notes" rows="2" maxlength="2000">${escapeHtml(row.notes || '')}</textarea>
          </div>`,
        footerHTML: `<button class="btn btn-secondary modal-cancel">ביטול</button>
          <button class="btn btn-primary" id="save-edit-doc">שמור</button>`,
      });
      document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
      document.getElementById('save-edit-doc')?.addEventListener('click', async () => {
        try {
          await updateHaccpDocument(row.id, {
            docKind: document.getElementById('edit-doc-kind').value,
            title: document.getElementById('edit-doc-title').value,
            description: document.getElementById('edit-doc-desc').value,
            retentionYears: document.getElementById('edit-doc-retention').value,
            storageLocation: document.getElementById('edit-doc-location').value,
            format: document.getElementById('edit-doc-format').value,
            responsibleRole: document.getElementById('edit-doc-role').value,
            responsibleText: document.getElementById('edit-doc-who').value,
            notes: document.getElementById('edit-doc-notes').value,
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

  document.getElementById('haccp-prp-seed')?.addEventListener('click', async () => {
    if (!ctx.activePlan) return;
    try {
      const n = await seedHaccpPrpControls(ctx.activePlan.id);
      showToast(`נוספו ${n} נושאי PRP ✓`);
      renderHaccp(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  document.getElementById('haccp-prp-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!ctx.activePlan) return showToast('בחר תכנית קודם');
    try {
      await addHaccpPrpControl(ctx.activePlan.id, {
        topicId: document.getElementById('haccp-prp-topic')?.value,
        status: document.getElementById('haccp-prp-status')?.value,
        procedureSummary: document.getElementById('haccp-prp-procedure')?.value,
        monitoringMethod: document.getElementById('haccp-prp-monitor')?.value,
        responsibleRole: document.getElementById('haccp-prp-role')?.value,
        responsibleText: document.getElementById('haccp-prp-who')?.value,
        lastReviewedAt: document.getElementById('haccp-prp-reviewed')?.value,
        records: document.getElementById('haccp-prp-records')?.value,
        notes: document.getElementById('haccp-prp-notes')?.value,
      });
      showToast('בקרת PRP נוספה ✓');
      renderHaccp(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  container.querySelectorAll('.haccp-prp-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('למחוק בקרת PRP?')) return;
      try {
        await deleteHaccpPrpControl(btn.dataset.id);
        showToast('נמחק');
        renderHaccp(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  container.querySelectorAll('.haccp-prp-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = ctx.prpControls?.find((c) => String(c.id) === String(btn.dataset.id));
      if (!row) return;
      const usedIds = (ctx.prpControls || []).map((c) => c.topicId);
      openModal({
        title: 'עריכת בקרת PRP',
        bodyHTML: `
          <div class="haccp-form-row">
            <div class="form-group">
              <label for="edit-prp-topic">נושא</label>
              <select id="edit-prp-topic">${prpTopicOptions(row.topicId, usedIds)}</select>
            </div>
            <div class="form-group">
              <label for="edit-prp-status">סטטוס</label>
              <select id="edit-prp-status">${prpStatusOptions(row.status || 'not_started')}</select>
            </div>
          </div>
          <div class="form-group">
            <label for="edit-prp-procedure">נוהל / אמצעי בקרה</label>
            <textarea id="edit-prp-procedure" rows="3" maxlength="4000">${escapeHtml(row.procedureSummary || '')}</textarea>
          </div>
          <div class="form-group">
            <label for="edit-prp-monitor">מעקב / ניטור PRP</label>
            <textarea id="edit-prp-monitor" rows="2" maxlength="2000">${escapeHtml(row.monitoringMethod || '')}</textarea>
          </div>
          <div class="haccp-form-row">
            <div class="form-group">
              <label for="edit-prp-role">אחראי</label>
              <select id="edit-prp-role">${monitorRoleOptions(row.responsibleRole || 'quality')}</select>
            </div>
            <div class="form-group">
              <label for="edit-prp-reviewed">תאריך סקירה אחרונה</label>
              <input type="date" id="edit-prp-reviewed" value="${escapeHtml(row.lastReviewedAt || '')}">
            </div>
          </div>
          <div class="form-group">
            <label for="edit-prp-who">שם / פירוט</label>
            <input type="text" id="edit-prp-who" maxlength="200" value="${escapeHtml(row.responsibleText || '')}">
          </div>
          <div class="form-group">
            <label for="edit-prp-records">רישום / טופס</label>
            <input type="text" id="edit-prp-records" maxlength="1000" value="${escapeHtml(row.records || '')}">
          </div>
          <div class="form-group">
            <label for="edit-prp-notes">הערות</label>
            <textarea id="edit-prp-notes" rows="2" maxlength="2000">${escapeHtml(row.notes || '')}</textarea>
          </div>`,
        footerHTML: `<button class="btn btn-secondary modal-cancel">ביטול</button>
          <button class="btn btn-primary" id="save-edit-prp">שמור</button>`,
      });
      document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
      document.getElementById('save-edit-prp')?.addEventListener('click', async () => {
        try {
          await updateHaccpPrpControl(row.id, {
            topicId: document.getElementById('edit-prp-topic').value,
            status: document.getElementById('edit-prp-status').value,
            procedureSummary: document.getElementById('edit-prp-procedure').value,
            monitoringMethod: document.getElementById('edit-prp-monitor').value,
            responsibleRole: document.getElementById('edit-prp-role').value,
            responsibleText: document.getElementById('edit-prp-who').value,
            lastReviewedAt: document.getElementById('edit-prp-reviewed').value,
            records: document.getElementById('edit-prp-records').value,
            notes: document.getElementById('edit-prp-notes').value,
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

  function syncLogCorrectiveVisibility(resultSelectId = 'haccp-log-result', wrapId = 'haccp-log-corrective-wrap') {
    const result = document.getElementById(resultSelectId)?.value;
    const wrap = document.getElementById(wrapId);
    if (wrap) wrap.hidden = result !== 'deviation';
  }

  async function maybePrefillCorrectiveNote() {
    const result = document.getElementById('haccp-log-result')?.value;
    const noteEl = document.getElementById('haccp-log-corrective');
    const ccpId = document.getElementById('haccp-log-ccp')?.value;
    if (result !== 'deviation' || !noteEl || noteEl.value.trim() || !ccpId) return;
    try {
      const suggestion = await suggestCorrectiveNoteForDeviation(ccpId);
      if (suggestion) noteEl.value = suggestion;
    } catch { /* ignore */ }
  }

  function refreshLogLinkedOptions() {
    const ccpId = document.getElementById('haccp-log-ccp')?.value;
    const monSelect = document.getElementById('haccp-log-monitor');
    const limitSelect = document.getElementById('haccp-log-limit');
    if (monSelect) monSelect.innerHTML = monitorProcOptions(ctx.monitoring || [], ccpId);
    if (limitSelect) limitSelect.innerHTML = limitOptionsForCcp(ctx.criticalLimits || [], ccpId);
    maybePrefillCorrectiveNote();
  }

  document.getElementById('haccp-log-ccp')?.addEventListener('change', refreshLogLinkedOptions);
  document.getElementById('haccp-log-result')?.addEventListener('change', () => {
    syncLogCorrectiveVisibility();
    maybePrefillCorrectiveNote();
  });
  syncLogCorrectiveVisibility();

  document.getElementById('haccp-log-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!ctx.activePlan) return showToast('בחר תכנית קודם');
    try {
      const resultVal = document.getElementById('haccp-log-result')?.value;
      await addHaccpMonitoringLog(ctx.activePlan.id, {
        ccpId: document.getElementById('haccp-log-ccp')?.value,
        monitoringId: document.getElementById('haccp-log-monitor')?.value || null,
        limitId: document.getElementById('haccp-log-limit')?.value || null,
        recordedAt: document.getElementById('haccp-log-when')?.value,
        batchCode: document.getElementById('haccp-log-batch')?.value,
        value: document.getElementById('haccp-log-value')?.value,
        unit: document.getElementById('haccp-log-unit')?.value,
        result: resultVal,
        recordedByRole: document.getElementById('haccp-log-role')?.value,
        recordedByText: document.getElementById('haccp-log-who')?.value,
        correctiveNote: document.getElementById('haccp-log-corrective')?.value,
        notes: document.getElementById('haccp-log-notes')?.value,
      });
      showToast(resultVal === 'deviation'
        ? 'חריגה נרשמה ✓ · טיוטת פעולה מתקנת + נוהל CCP אם חסר'
        : 'מדידה נשמרה ✓');
      renderHaccp(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  container.querySelectorAll('.haccp-log-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('למחוק רשומת ניטור?')) return;
      try {
        await deleteHaccpMonitoringLog(btn.dataset.id);
        showToast('נמחק');
        renderHaccp(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  container.querySelectorAll('.haccp-log-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = ctx.monitoringLogs?.find((l) => String(l.id) === String(btn.dataset.id));
      if (!row) return;
      const confirmed = (ctx.ccps || []).filter((c) => c.decision === 'ccp');
      const ccpOptions = confirmed.map((c) =>
        `<option value="${c.id}" ${Number(c.id) === Number(row.ccpId) ? 'selected' : ''}>${escapeHtml(c.code || 'CCP')} — ${escapeHtml(c.name)}</option>`
      ).join('');
      openModal({
        title: 'עריכת רשומת ניטור',
        bodyHTML: `
          <div class="haccp-form-row">
            <div class="form-group">
              <label for="edit-log-ccp">CCP</label>
              <select id="edit-log-ccp">${ccpOptions}</select>
            </div>
            <div class="form-group">
              <label for="edit-log-when">תאריך ושעה</label>
              <input type="datetime-local" id="edit-log-when" value="${escapeHtml(String(row.recordedAt || '').slice(0, 16))}">
            </div>
          </div>
          <div class="form-group">
            <label for="edit-log-monitor">נוהל ניטור</label>
            <select id="edit-log-monitor">${monitorProcOptions(ctx.monitoring || [], row.ccpId, row.monitoringId || '')}</select>
          </div>
          <div class="form-group">
            <label for="edit-log-limit">גבול קריטי</label>
            <select id="edit-log-limit">${limitOptionsForCcp(ctx.criticalLimits || [], row.ccpId, row.limitId || '')}</select>
          </div>
          <div class="haccp-form-row">
            <div class="form-group">
              <label for="edit-log-value">ערך</label>
              <input type="text" id="edit-log-value" maxlength="80" value="${escapeHtml(row.value || '')}">
            </div>
            <div class="form-group">
              <label for="edit-log-unit">יחידה</label>
              <input type="text" id="edit-log-unit" maxlength="40" value="${escapeHtml(row.unit || '')}">
            </div>
          </div>
          <div class="haccp-form-row">
            <div class="form-group">
              <label for="edit-log-result">תוצאה</label>
              <select id="edit-log-result">${monitorLogResultOptions(row.result || 'ok')}</select>
            </div>
            <div class="form-group">
              <label for="edit-log-batch">אצווה</label>
              <input type="text" id="edit-log-batch" maxlength="80" value="${escapeHtml(row.batchCode || '')}">
            </div>
          </div>
          <div class="form-group" id="edit-log-corrective-wrap" ${row.result === 'deviation' ? '' : 'hidden'}>
            <label for="edit-log-corrective">פעולה מתקנת</label>
            <textarea id="edit-log-corrective" rows="2" maxlength="2000">${escapeHtml(row.correctiveNote || '')}</textarea>
          </div>
          <div class="haccp-form-row">
            <div class="form-group">
              <label for="edit-log-role">רשם</label>
              <select id="edit-log-role">${monitorRoleOptions(row.recordedByRole || 'production')}</select>
            </div>
            <div class="form-group">
              <label for="edit-log-who">שם</label>
              <input type="text" id="edit-log-who" maxlength="200" value="${escapeHtml(row.recordedByText || '')}">
            </div>
          </div>
          <div class="form-group">
            <label for="edit-log-notes">הערות</label>
            <textarea id="edit-log-notes" rows="2" maxlength="2000">${escapeHtml(row.notes || '')}</textarea>
          </div>`,
        footerHTML: `<button class="btn btn-secondary modal-cancel">ביטול</button>
          <button class="btn btn-primary" id="save-edit-log">שמור</button>`,
      });
      document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
      document.getElementById('edit-log-ccp')?.addEventListener('change', () => {
        const ccpId = document.getElementById('edit-log-ccp')?.value;
        const mon = document.getElementById('edit-log-monitor');
        const lim = document.getElementById('edit-log-limit');
        if (mon) mon.innerHTML = monitorProcOptions(ctx.monitoring || [], ccpId);
        if (lim) lim.innerHTML = limitOptionsForCcp(ctx.criticalLimits || [], ccpId);
      });
      document.getElementById('edit-log-result')?.addEventListener('change', () => {
        syncLogCorrectiveVisibility('edit-log-result', 'edit-log-corrective-wrap');
      });
      document.getElementById('save-edit-log')?.addEventListener('click', async () => {
        try {
          await updateHaccpMonitoringLog(row.id, {
            ccpId: document.getElementById('edit-log-ccp').value,
            monitoringId: document.getElementById('edit-log-monitor').value || null,
            limitId: document.getElementById('edit-log-limit').value || null,
            recordedAt: document.getElementById('edit-log-when').value,
            batchCode: document.getElementById('edit-log-batch').value,
            value: document.getElementById('edit-log-value').value,
            unit: document.getElementById('edit-log-unit').value,
            result: document.getElementById('edit-log-result').value,
            recordedByRole: document.getElementById('edit-log-role').value,
            recordedByText: document.getElementById('edit-log-who').value,
            correctiveNote: document.getElementById('edit-log-corrective').value,
            notes: document.getElementById('edit-log-notes').value,
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
