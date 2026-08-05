import { escapeHtml, formatDateHebrew, localDateTimeISO } from './utils.js?v=411';
import {
  HACCP_PLAN_STATUSES,
  haccpRoleLabel,
  haccpFlowStepKindLabel,
  haccpFlowMatchLabel,
  haccpHazardTypeLabel,
  haccpRiskLevelLabel,
  haccpCcpDecisionLabel,
  formatCriticalLimit,
  haccpMonitorMethodLabel,
  haccpMonitorFrequencyLabel,
  haccpProductDispositionLabel,
  haccpVerificationMethodLabel,
  haccpVerificationFrequencyLabel,
  haccpDocKindLabel,
  haccpDocFormatLabel,
  haccpPrpTopicLabel,
  haccpPrpStatusLabel,
  getHaccpPlan,
  getHaccpTeamMembers,
  getHaccpProductDescription,
  getHaccpIntendedUse,
  getHaccpFlowSteps,
  getHaccpFlowVerifications,
  getHaccpHazards,
  getHaccpCcps,
  getHaccpCriticalLimits,
  getHaccpMonitoring,
  getHaccpMonitoringLogs,
  haccpMonitorLogResultLabel,
  getHaccpCorrectiveActions,
  getHaccpVerificationProcs,
  getHaccpDocuments,
  getHaccpPrpControls,
} from './haccp-db.js?v=411';
import { getCategoryGroups } from './db.js?v=411';
import { APP_VERSION } from './version.js?v=411';

const HACCP_PRINT_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
    background: #fff;
    color: #0f172a;
    line-height: 1.5;
    padding: 18px;
    max-width: 900px;
    margin: 0 auto;
    direction: rtl;
    font-size: 12.5px;
  }
  h1 { font-size: 1.35rem; margin-bottom: 4px; }
  h2 {
    font-size: 1.05rem;
    margin: 18px 0 8px;
    padding-bottom: 4px;
    border-bottom: 2px solid #0f766e;
    color: #0f766e;
    break-after: avoid;
  }
  h3 { font-size: 0.95rem; margin: 10px 0 4px; color: #134e4a; }
  .meta { color: #64748b; font-size: 0.85rem; margin-bottom: 12px; }
  .banner {
    background: #f0fdfa;
    border: 1px solid #99f6e4;
    border-radius: 8px;
    padding: 10px 12px;
    margin-bottom: 14px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 6px 0 12px;
    font-size: 0.88rem;
  }
  th, td {
    border: 1px solid #e2e8f0;
    padding: 6px 8px;
    text-align: right;
    vertical-align: top;
  }
  th { background: #f8fafc; font-weight: 600; }
  ul { padding-right: 18px; margin: 4px 0 10px; }
  li { margin: 2px 0; }
  .muted { color: #64748b; }
  .empty { color: #94a3b8; font-style: italic; margin: 4px 0 10px; }
  .section { break-inside: avoid; }
  .footer {
    margin-top: 22px;
    padding-top: 10px;
    border-top: 1px solid #e2e8f0;
    font-size: 0.75rem;
    color: #94a3b8;
    text-align: center;
  }
  @page { margin: 12mm; }
  @media print {
    body { padding: 0; max-width: none; }
    h2 { break-after: avoid; }
    .section { break-inside: avoid; }
  }
`;

function textOrDash(value) {
  const s = String(value || '').trim();
  return s || '—';
}

function section(title, body) {
  return `<section class="section"><h2>${escapeHtml(title)}</h2>${body}</section>`;
}

function kvTable(rows) {
  const body = rows
    .filter((r) => r && (r.value || r.always))
    .map((r) => `
      <tr>
        <th style="width:28%">${escapeHtml(r.label)}</th>
        <td>${escapeHtml(textOrDash(r.value))}</td>
      </tr>`)
    .join('');
  return body ? `<table><tbody>${body}</tbody></table>` : '<p class="empty">אין נתונים</p>';
}

function listHtml(items) {
  if (!items?.length) return '<p class="empty">אין פריטים</p>';
  return `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;
}

export async function gatherHaccpPlanPrintData(planId) {
  const plan = await getHaccpPlan(planId);
  if (!plan) throw new Error('תכנית לא נמצאה');
  const groups = await getCategoryGroups();
  const familyName = groups.find((g) => g.id === plan.categoryGroupId)?.name || '';

  const [
    members,
    product,
    intendedUse,
    flowSteps,
    flowVerifications,
    hazards,
    ccps,
    limits,
    monitoring,
    monitoringLogs,
    corrective,
    verification,
    documents,
    prpControls,
  ] = await Promise.all([
    getHaccpTeamMembers(),
    getHaccpProductDescription(plan.id),
    getHaccpIntendedUse(plan.id),
    getHaccpFlowSteps(plan.id),
    getHaccpFlowVerifications(plan.id),
    getHaccpHazards(plan.id),
    getHaccpCcps(plan.id),
    getHaccpCriticalLimits(plan.id),
    getHaccpMonitoring(plan.id),
    getHaccpMonitoringLogs(plan.id, { limit: 40 }),
    getHaccpCorrectiveActions(plan.id),
    getHaccpVerificationProcs(plan.id),
    getHaccpDocuments(plan.id),
    getHaccpPrpControls(plan.id),
  ]);

  return {
    plan,
    familyName,
    members: members.filter((m) => m.active !== false),
    product,
    intendedUse,
    flowSteps,
    flowVerifications,
    hazards,
    ccps,
    limits,
    monitoring,
    monitoringLogs,
    corrective,
    verification,
    documents,
    prpControls,
    printedAt: localDateTimeISO?.() || new Date().toISOString(),
  };
}

export function buildHaccpPlanPrintHtml(data) {
  const {
    plan,
    familyName,
    members = [],
    product,
    intendedUse,
    flowSteps = [],
    flowVerifications = [],
    hazards = [],
    ccps = [],
    limits = [],
    monitoring = [],
    monitoringLogs = [],
    corrective = [],
    verification = [],
    documents = [],
    prpControls = [],
    printedAt,
  } = data;

  const printedLabel = (() => {
    try {
      const d = String(printedAt || '').slice(0, 10);
      return d ? formatDateHebrew(d) : printedAt || '';
    } catch {
      return printedAt || '';
    }
  })();

  const stepMap = new Map(flowSteps.map((s) => [s.id, s]));
  const confirmedCcps = ccps.filter((c) => c.decision === 'ccp');

  const teamHtml = members.length
    ? `<table>
        <thead><tr><th>שם</th><th>תחום</th><th>סמכויות</th><th>תפקיד</th></tr></thead>
        <tbody>${members.map((m) => `
          <tr>
            <td>${escapeHtml(m.name)}</td>
            <td>${escapeHtml(haccpRoleLabel(m.role))}</td>
            <td>${escapeHtml(textOrDash(m.authorityNotes))}</td>
            <td>${m.isLeader ? 'מוביל מערכת' : '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table>`
    : '<p class="empty">לא הוגדר צוות</p>';

  const prpHtml = prpControls.length
    ? `<table>
        <thead><tr><th>נושא</th><th>סטטוס</th><th>נוהל</th><th>אחראי</th></tr></thead>
        <tbody>${prpControls.map((p) => `
          <tr>
            <td>${escapeHtml(haccpPrpTopicLabel(p.topicId))}</td>
            <td>${escapeHtml(haccpPrpStatusLabel(p.status))}</td>
            <td>${escapeHtml(textOrDash(p.procedureSummary))}</td>
            <td>${escapeHtml(haccpRoleLabel(p.responsibleRole))}</td>
          </tr>`).join('')}
        </tbody>
      </table>`
    : '<p class="empty">לא הוגדרו תכניות קדם</p>';

  const productHtml = product
    ? kvTable([
      { label: 'הרכב', value: product.composition, always: true },
      { label: 'aW', value: product.waterActivity },
      { label: 'pH', value: product.phValue },
      { label: 'מיקרוביולוגיה', value: product.microbiological },
      { label: 'אריזה', value: product.packaging },
      { label: 'חיי מדף', value: product.shelfLife },
      { label: 'אחסון', value: product.storageConditions },
      { label: 'הפצה', value: product.distributionConditions },
      { label: 'סימון', value: product.labelingInfo },
    ])
    : '<p class="empty">לא הוגדר תיאור מוצר</p>';

  const useHtml = intendedUse
    ? kvTable([
      { label: 'קהל יעד', value: intendedUse.targetAudience, always: true },
      { label: 'הוראות צרכן', value: intendedUse.consumerInstructions },
      { label: 'שימוש לא נכון', value: intendedUse.potentialMisuse },
      { label: 'לא מתאים ל', value: intendedUse.notSuitableFor },
      { label: 'הערות', value: intendedUse.notes },
    ])
    : '<p class="empty">לא הוגדר שימוש מיועד</p>';

  const flowHtml = flowSteps.length
    ? `<table>
        <thead><tr><th>#</th><th>שלב</th><th>סוג</th><th>תיאור</th></tr></thead>
        <tbody>${flowSteps.map((s, i) => `
          <tr>
            <td>${i + 1}</td>
            <td>${escapeHtml(s.name)}</td>
            <td>${escapeHtml(haccpFlowStepKindLabel(s.stepKind))}</td>
            <td>${escapeHtml(textOrDash(s.description))}</td>
          </tr>`).join('')}
        </tbody>
      </table>`
    : '<p class="empty">לא הוגדר תרשים זרימה</p>';

  const verifyHtml = flowVerifications.length
    ? listHtml(flowVerifications.map((v) =>
      escapeHtml(`${v.verifiedAt ? formatDateHebrew(v.verifiedAt) : ''} · ${haccpFlowMatchLabel(v.matchResult)} · ${v.notes || ''}`)
    ))
    : '<p class="empty">אין אימותי תרשים בשטח</p>';

  const hazardHtml = hazards.length
    ? `<table>
        <thead><tr><th>שלב</th><th>סוג</th><th>תיאור</th><th>סיכון</th></tr></thead>
        <tbody>${hazards.map((h) => `
          <tr>
            <td>${escapeHtml(stepMap.get(h.flowStepId)?.name || '')}</td>
            <td>${escapeHtml(haccpHazardTypeLabel(h.hazardType))}</td>
            <td>${escapeHtml(h.description || '')}</td>
            <td>${escapeHtml(haccpRiskLevelLabel(h.riskLevel))}</td>
          </tr>`).join('')}
        </tbody>
      </table>`
    : '<p class="empty">לא הוגדרו גורמי סיכון</p>';

  const ccpHtml = ccps.length
    ? `<table>
        <thead><tr><th>קוד</th><th>שם</th><th>שלב</th><th>החלטה</th><th>סיכון</th></tr></thead>
        <tbody>${ccps.map((c) => `
          <tr>
            <td>${escapeHtml(c.code || '')}</td>
            <td>${escapeHtml(c.name || '')}</td>
            <td>${escapeHtml(stepMap.get(c.flowStepId)?.name || '')}</td>
            <td>${escapeHtml(haccpCcpDecisionLabel(c.decision))}</td>
            <td>${escapeHtml(textOrDash(c.hazardDescription))}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      <p class="muted">CCP מאושרים: ${confirmedCcps.length}</p>`
    : '<p class="empty">לא נקבעו CCP</p>';

  const limitsHtml = limits.length
    ? `<table>
        <thead><tr><th>CCP</th><th>גבול</th><th>הצדקה</th></tr></thead>
        <tbody>${limits.map((l) => {
          const ccp = confirmedCcps.find((c) => Number(c.id) === Number(l.ccpId))
            || ccps.find((c) => Number(c.id) === Number(l.ccpId));
          return `
            <tr>
              <td>${escapeHtml(ccp ? `${ccp.code || ''} ${ccp.name || ''}` : '')}</td>
              <td>${escapeHtml(formatCriticalLimit(l))}</td>
              <td>${escapeHtml(textOrDash(l.justification))}</td>
            </tr>`;
        }).join('')}
        </tbody>
      </table>`
    : '<p class="empty">לא הוגדרו גבולות קריטיים</p>';

  const monitorHtml = monitoring.length
    ? `<table>
        <thead><tr><th>CCP</th><th>מה</th><th>שיטה</th><th>תדירות</th><th>אחראי</th></tr></thead>
        <tbody>${monitoring.map((m) => {
          const ccp = confirmedCcps.find((c) => Number(c.id) === Number(m.ccpId));
          return `
            <tr>
              <td>${escapeHtml(ccp ? `${ccp.code || ''} ${ccp.name || ''}` : '')}</td>
              <td>${escapeHtml(m.what || '')}</td>
              <td>${escapeHtml(haccpMonitorMethodLabel(m.method))}</td>
              <td>${escapeHtml(haccpMonitorFrequencyLabel(m.frequency))}</td>
              <td>${escapeHtml(haccpRoleLabel(m.responsibleRole))}</td>
            </tr>`;
        }).join('')}
        </tbody>
      </table>`
    : '<p class="empty">לא הוגדרו נהלי ניטור</p>';

  const monitorLogHtml = monitoringLogs.length
    ? `<table>
        <thead><tr><th>תאריך</th><th>CCP</th><th>ערך</th><th>תוצאה</th><th>אצווה</th><th>רשם</th></tr></thead>
        <tbody>${monitoringLogs.map((l) => {
          const ccp = confirmedCcps.find((c) => Number(c.id) === Number(l.ccpId));
          const value = [l.value, l.unit].filter(Boolean).join(' ');
          return `
            <tr>
              <td>${escapeHtml(String(l.recordedAt || '').replace('T', ' ').slice(0, 16))}</td>
              <td>${escapeHtml(ccp ? `${ccp.code || ''} ${ccp.name || ''}` : '')}</td>
              <td>${escapeHtml(value || '—')}</td>
              <td>${escapeHtml(haccpMonitorLogResultLabel(l.result))}</td>
              <td>${escapeHtml(textOrDash(l.batchCode))}</td>
              <td>${escapeHtml(l.recordedByText
                ? `${haccpRoleLabel(l.recordedByRole)} · ${l.recordedByText}`
                : haccpRoleLabel(l.recordedByRole))}</td>
            </tr>`;
        }).join('')}
        </tbody>
      </table>`
    : '<p class="empty">אין רשומות ניטור ביומן</p>';

  const correctiveHtml = corrective.length
    ? `<table>
        <thead><tr><th>CCP</th><th>חריגה</th><th>פעולה מיידית</th><th>גורל מוצר</th></tr></thead>
        <tbody>${corrective.map((a) => {
          const ccp = confirmedCcps.find((c) => Number(c.id) === Number(a.ccpId));
          return `
            <tr>
              <td>${escapeHtml(ccp ? `${ccp.code || ''} ${ccp.name || ''}` : '')}</td>
              <td>${escapeHtml(a.deviation || '')}</td>
              <td>${escapeHtml(a.immediateAction || '')}</td>
              <td>${escapeHtml(haccpProductDispositionLabel(a.productDisposition))}</td>
            </tr>`;
        }).join('')}
        </tbody>
      </table>`
    : '<p class="empty">לא הוגדרו פעולות מתקנות</p>';

  const verificationHtml = verification.length
    ? `<table>
        <thead><tr><th>שיטה</th><th>פעילות</th><th>תדירות</th><th>אחראי</th></tr></thead>
        <tbody>${verification.map((v) => `
          <tr>
            <td>${escapeHtml(haccpVerificationMethodLabel(v.method))}</td>
            <td>${escapeHtml(v.activity || '')}</td>
            <td>${escapeHtml(haccpVerificationFrequencyLabel(v.frequency))}</td>
            <td>${escapeHtml(haccpRoleLabel(v.responsibleRole))}</td>
          </tr>`).join('')}
        </tbody>
      </table>`
    : '<p class="empty">לא הוגדרו נהלי אימות</p>';

  const docsHtml = documents.length
    ? `<table>
        <thead><tr><th>סוג</th><th>שם</th><th>שמירה</th><th>פורמט</th><th>מיקום</th></tr></thead>
        <tbody>${documents.map((d) => `
          <tr>
            <td>${escapeHtml(haccpDocKindLabel(d.docKind))}</td>
            <td>${escapeHtml(d.title || '')}</td>
            <td>${escapeHtml(String(d.retentionYears ?? 2))} שנים</td>
            <td>${escapeHtml(haccpDocFormatLabel(d.format))}</td>
            <td>${escapeHtml(textOrDash(d.storageLocation))}</td>
          </tr>`).join('')}
        </tbody>
      </table>`
    : '<p class="empty">לא הוגדר קטלוג תיעוד</p>';

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>תכנית HACCP · ${escapeHtml(plan.name || '')}</title>
  <style>${HACCP_PRINT_CSS}</style>
</head>
<body>
  <header>
    <h1>תכנית HACCP — ${escapeHtml(plan.name || '')}</h1>
    <p class="meta">
      משפחה: ${escapeHtml(familyName || '—')} ·
      סטטוס: ${escapeHtml(HACCP_PLAN_STATUSES[plan.status] || plan.status || '')} ·
      הודפס: ${escapeHtml(printedLabel)}
    </p>
    <div class="banner">
      מסמך סיכום לתכנית בקרת בטיחות מזון עצמית מבוססת HACCP לפי מדריך משרד הבריאות.
      המסמך משקף את הנתונים השמורים באפליקציה במועד ההדפסה.
    </div>
  </header>

  ${section('3.1 צוות HACCP', teamHtml)}
  ${section('2 תכניות קדם (PRP)', prpHtml)}
  ${section('3.2 תיאור המוצר', productHtml)}
  ${section('3.3 שימוש מיועד', useHtml)}
  ${section('3.4 תרשים זרימה', flowHtml)}
  ${section('3.5 אימות תרשים בשטח', verifyHtml)}
  ${section('5.1 ניתוח גורמי סיכון', hazardHtml)}
  ${section('5.2 נקודות בקרה קריטיות (CCP)', ccpHtml)}
  ${section('5.3 גבולות בקרה קריטיים', limitsHtml)}
  ${section('5.4 ניטור', monitorHtml)}
  ${section('5.4+ יומן ניטור', monitorLogHtml)}
  ${section('5.5 פעולות מתקנות', correctiveHtml)}
  ${section('5.6 אימות מערכת', verificationHtml)}
  ${section('5.7 תיעוד ורישום', docsHtml)}

  <footer class="footer">מעקב יצור · HACCP · גרסה ${escapeHtml(APP_VERSION)}</footer>
</body>
</html>`;
}

export function printHaccpHtml(html) {
  const win = window.open('', '_blank', 'noopener,noreferrer');
  if (!win) return false;
  win.document.write(html);
  win.document.close();
  const trigger = () => {
    win.focus();
    win.print();
  };
  if (win.document.readyState === 'complete') trigger();
  else win.addEventListener('load', trigger, { once: true });
  return true;
}

export async function printHaccpPlan(planId) {
  const data = await gatherHaccpPlanPrintData(planId);
  const html = buildHaccpPlanPrintHtml(data);
  return printHaccpHtml(html);
}
