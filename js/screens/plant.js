import {
  escapeHtml,
  showToast,
  todayISO,
  formatDate,
  formatMoney,
  bindTodayDateButtons,
} from '../utils.js?v=556';
import {
  LANES,
  INVEST_STATUSES,
  CORE_CATEGORIES,
  plantId,
  activeItems,
  departmentTracks,
  nextDepartmentNumber,
  shiftDepartment,
  toggleDepartmentTrack,
  daysApart,
  maintenanceUrgency,
  completeMaintenance,
  intervalLabel,
  summarizePlant,
  restoreDefaultDepartments,
  loadPlant,
  savePlant,
  refreshPlantMenuHint,
} from '../plant-db.js?v=556';

const TABS = [
  { id: 'today', label: 'היום' },
  { id: 'map', label: 'מפה' },
  { id: 'improve', label: 'שיפורים' },
  { id: 'maintain', label: 'תחזוקה' },
  { id: 'invest', label: 'השקעות' },
];

const ui = {
  tab: 'today',
  departmentId: '',
  category: '',
  mapEdit: false,
  filterDept: '',
  editKey: '',
};

let saving = false;

function esc(value) {
  return escapeHtml(value == null ? '' : String(value)).replace(/"/g, '&quot;');
}

export function plantMeta() {
  return {
    title: 'שיפור המפעל',
    subtitle: 'מה שדחוף היום, מפת מחלקות, תחזוקה והשקעות',
  };
}

function deptById(data, id) {
  if (!id) return null;
  return activeItems(data.departments).find((dept) => dept.id === id) || null;
}

function deptLabel(data, id) {
  const dept = deptById(data, id);
  if (!dept) return 'כללי';
  return `${dept.number} · ${dept.name}`;
}

function deptOptions(data, selected) {
  const options = [`<option value=""${selected ? '' : ' selected'}>כל המחלקות</option>`];
  for (const dept of departmentTracks(data.departments).flatMap(([, list]) => list)) {
    options.push(`<option value="${dept.id}"${dept.id === selected ? ' selected' : ''}>${esc(dept.number)} · ${esc(dept.name)}</option>`);
  }
  return options.join('');
}

function assignOptions(data, selected) {
  const options = [`<option value=""${selected ? '' : ' selected'}>כללי — בלי מחלקה</option>`];
  for (const dept of departmentTracks(data.departments).flatMap(([, list]) => list)) {
    options.push(`<option value="${dept.id}"${dept.id === selected ? ' selected' : ''}>${esc(dept.number)} · ${esc(dept.name)}</option>`);
  }
  return options.join('');
}

function inDept(item, departmentId) {
  if (!departmentId) return true;
  return item.departmentId === departmentId;
}

function subtitleFor(dept) {
  if (dept) return `${dept.number} · ${dept.name}`;
  if (ui.tab === 'today') return 'תחזוקה להיום ושיפורים שאפשר לסגור עכשיו';
  if (ui.tab === 'map') return 'סכמת המחלקות, מהכניסה עד המוצר המוגמר';
  if (ui.tab === 'improve') return 'אדום עכשיו, צהוב לתכנון, ירוק כשמתפנה';
  if (ui.tab === 'maintain') return 'רשימה מחזורית — סימון אחד וזה חוזר בתור';
  return 'השקעות שמקצרות או מייעלות את הייצור';
}

function tabsHtml(summary) {
  const due = (summary.due || 0) + (summary.red || 0);
  return `<div class="plant-tabs" role="tablist">${TABS.map((tab) => {
    const label = tab.id === 'today' && due > 0 ? `היום · ${due}` : tab.label;
    const active = !ui.departmentId && ui.tab === tab.id;
    return `<button type="button" class="plant-tab${active ? ' is-active' : ''}" role="tab" aria-selected="${active ? 'true' : 'false'}" data-act="tab" data-tab="${tab.id}">${esc(label)}</button>`;
  }).join('')}</div>`;
}

function whenLabel(item, today) {
  const urgency = maintenanceUrgency(item, today);
  if (urgency === 'overdue') {
    const late = daysApart(item.nextDue || today, today);
    return late > 0 ? `באיחור ${late} ימים` : 'באיחור';
  }
  if (urgency === 'today') return 'להיום';
  if (!item.nextDue) return 'בלי תאריך';
  const left = daysApart(today, item.nextDue);
  return `${formatDate(item.nextDue)} · בעוד ${left} ימים`;
}

function maintenanceRow(item, data, today) {
  const urgency = maintenanceUrgency(item, today);
  if (ui.editKey === `maintenance:${item.id}`) {
    return `<article class="plant-task plant-task--${urgency}">
      <form data-form="edit-maintain" data-id="${item.id}" class="form-group plant-edit-form">
        <label>שם<input name="title" required maxlength="80" value="${esc(item.title)}"></label>
        <label>מחלקה<select name="departmentId">${assignOptions(data, item.departmentId)}</select></label>
        ${everyField(item.everyDays)}
        <label>הפעם הבאה<input type="date" name="nextDue" value="${esc(item.nextDue || today)}"></label>
        <button type="submit" class="btn btn-primary plant-inline">שמור</button>
      </form>
    </article>`;
  }
  return `<article class="plant-task plant-task--${urgency}">
    <div class="plant-task-text">
      <strong>${esc(item.title)}</strong>
      <span>${esc(deptLabel(data, item.departmentId))} · ${esc(intervalLabel(item.everyDays))} · ${esc(whenLabel(item, today))}</span>
    </div>
    <div class="plant-task-actions">
      <button type="button" class="btn btn-primary plant-inline" data-act="done-maintain" data-id="${item.id}">בוצע</button>
      ${item.departmentId ? `<button type="button" class="btn btn-secondary plant-inline" data-act="open-dept" data-id="${item.departmentId}">מחלקה</button>` : ''}
      <button type="button" class="btn btn-secondary plant-inline" data-act="edit" data-kind="maintenance" data-id="${item.id}">עריכה</button>
      <button type="button" class="btn btn-danger plant-inline" data-act="delete" data-kind="maintenance" data-id="${item.id}">מחק</button>
    </div>
  </article>`;
}

function everyField(selected) {
  const current = Number(selected) || 7;
  const known = [1, 7, 30, 90];
  const custom = !known.includes(current);
  const options = [
    [1, 'כל יום'],
    [7, 'כל שבוע'],
    [30, 'כל חודש'],
    [90, 'כל 3 חודשים'],
  ].map(([days, label]) => `<option value="${days}"${current === days ? ' selected' : ''}>${label}</option>`).join('');
  return `<label>כל כמה זמן<select name="every">
      ${options}
      <option value="custom"${custom ? ' selected' : ''}>מספר ימים אחר</option>
    </select></label>
    <label class="plant-custom-days"${custom ? '' : ' hidden'}>מספר ימים<input name="customDays" type="number" min="1" max="365" inputmode="numeric" value="${custom ? current : ''}"></label>`;
}

function readEvery(fd) {
  if (fd.get('every') === 'custom') {
    const n = Math.round(Number(fd.get('customDays')));
    return Number.isFinite(n) && n > 0 ? Math.min(365, n) : 0;
  }
  const n = Math.round(Number(fd.get('every')));
  return Number.isFinite(n) && n > 0 ? Math.min(365, n) : 7;
}

function improvementCard(item, data, { done = false } = {}) {
  const lane = LANES.find((row) => row.id === item.lane) || LANES[1];
  const editing = ui.editKey === `improvements:${item.id}`;
  return `<article class="plant-card plant-card--${item.lane}">
    <div class="plant-card-top">
      <span class="plant-lane-tag plant-lane-tag--${item.lane}">${esc(lane.label)} · ${esc(lane.hint)}</span>
      <span class="form-hint">${esc(deptLabel(data, item.departmentId))}</span>
    </div>
    ${editing ? `<form data-form="rename" data-kind="improvements" data-id="${item.id}" class="form-group plant-edit-form">
      <label>שיפור<input name="title" required maxlength="80" value="${esc(item.title)}"></label>
      <label>פירוט<input name="note" maxlength="280" value="${esc(item.note || '')}" placeholder="לא חובה"></label>
      <label>מחלקה<select name="departmentId">${assignOptions(data, item.departmentId)}</select></label>
      <button type="submit" class="btn btn-primary plant-inline">שמור</button>
    </form>` : `<h3 class="plant-card-title">${esc(item.title)}</h3>${item.note ? `<p class="plant-card-note">${esc(item.note)}</p>` : ''}`}
    <div class="plant-card-actions">
      ${done ? '' : LANES.map((row) => `<button type="button" class="plant-mini plant-mini--${row.id}${row.id === item.lane ? ' is-on' : ''}" data-act="lane" data-id="${item.id}" data-lane="${row.id}">${esc(row.label)}</button>`).join('')}
      <button type="button" class="btn btn-primary plant-inline" data-act="${done ? 'reopen-improve' : 'done-improve'}" data-id="${item.id}">${done ? 'החזר ללוח' : 'בוצע'}</button>
      ${done ? '' : `<button type="button" class="btn btn-secondary plant-inline" data-act="edit" data-kind="improvements" data-id="${item.id}">עריכה</button>`}
      <button type="button" class="btn btn-danger plant-inline" data-act="delete" data-kind="improvements" data-id="${item.id}">מחק</button>
    </div>
  </article>`;
}

function investmentCard(item, data) {
  const editing = ui.editKey === `investments:${item.id}`;
  const status = INVEST_STATUSES.find((row) => row.id === item.status) || INVEST_STATUSES[0];
  return `<article class="plant-card plant-card--invest">
    <div class="plant-card-top">
      <span class="plant-lane-tag">${esc(status.label)}</span>
      <span class="form-hint">${esc(deptLabel(data, item.departmentId))}</span>
    </div>
    ${editing ? `<form data-form="rename" data-kind="investments" data-id="${item.id}" class="form-group plant-edit-form">
      <label>השקעה<input name="title" required maxlength="80" value="${esc(item.title)}"></label>
      <label>מה זה מייעל<input name="benefit" maxlength="140" value="${esc(item.benefit || '')}"></label>
      <label>עלות משוערת ₪<input name="cost" inputmode="decimal" value="${item.cost == null ? '' : esc(item.cost)}"></label>
      <label>מחלקה<select name="departmentId">${assignOptions(data, item.departmentId)}</select></label>
      <button type="submit" class="btn btn-primary plant-inline">שמור</button>
    </form>` : `<h3 class="plant-card-title">${esc(item.title)}</h3>
      ${item.benefit ? `<p class="plant-card-note">${esc(item.benefit)}</p>` : ''}
      <p class="form-hint">${item.cost == null ? 'בלי אומדן עלות' : esc(formatMoney(item.cost))}</p>`}
    <div class="plant-status-row">
      ${INVEST_STATUSES.map((row) => `<button type="button" class="plant-mini${row.id === item.status ? ' is-on' : ''}" data-act="status" data-id="${item.id}" data-status="${row.id}">${esc(row.label)}</button>`).join('')}
    </div>
    <div class="plant-card-actions">
      <button type="button" class="btn btn-secondary plant-inline" data-act="edit" data-kind="investments" data-id="${item.id}">עריכה</button>
      <button type="button" class="btn btn-danger plant-inline" data-act="delete" data-kind="investments" data-id="${item.id}">מחק</button>
    </div>
  </article>`;
}

function noteRow(item) {
  const editing = ui.editKey === `notes:${item.id}`;
  return `<article class="plant-task${item.doneAt ? ' is-done' : ''}">
    ${editing ? `<form data-form="rename" data-kind="notes" data-id="${item.id}" class="form-group plant-edit-form">
      <label>רשומה<input name="title" required maxlength="200" value="${esc(item.text)}"></label>
      <button type="submit" class="btn btn-primary plant-inline">שמור</button>
    </form>` : `<div class="plant-task-text"><strong>${esc(item.text)}</strong></div>`}
    <div class="plant-task-actions">
      <button type="button" class="btn btn-primary plant-inline" data-act="toggle-note" data-id="${item.id}">${item.doneAt ? 'החזר' : 'טופל'}</button>
      <button type="button" class="btn btn-secondary plant-inline" data-act="edit" data-kind="notes" data-id="${item.id}">עריכה</button>
      <button type="button" class="btn btn-danger plant-inline" data-act="delete" data-kind="notes" data-id="${item.id}">מחק</button>
    </div>
  </article>`;
}

function laneBoard(data, departmentId) {
  const items = activeItems(data.improvements).filter((item) => inDept(item, departmentId || ui.filterDept));
  const open = items.filter((item) => !item.doneAt);
  const done = items.filter((item) => item.doneAt);
  const lanes = LANES.map((lane) => {
    const cards = open.filter((item) => item.lane === lane.id);
    return `<section class="plant-lane plant-lane--${lane.id}">
      <header>
        <h3>${esc(lane.label)}</h3>
        <p>${esc(lane.hint)} · ${cards.length}</p>
      </header>
      ${cards.map((item) => improvementCard(item, data)).join('') || '<p class="form-hint">אין כאן פריטים</p>'}
    </section>`;
  }).join('');
  const doneHtml = done.length ? `<details class="plant-done">
    <summary>בוצעו (${done.length})</summary>
    ${done.map((item) => improvementCard(item, data, { done: true })).join('')}
  </details>` : '';
  return `<div class="plant-lanes">${lanes}</div>${doneHtml}`;
}

function addImproveBlock(data, departmentId) {
  return `<div class="card plant-add-card" data-block="add-improve">
    <h3 class="card-title">שיפור חדש</h3>
    <div class="form-group">
      <label>מה לשפר<input name="title" maxlength="80" placeholder="למשל להחליף אטם במיקסר"></label>
      ${departmentId ? `<input type="hidden" name="departmentId" value="${esc(departmentId)}">` : `<label>מחלקה<select name="departmentId">${assignOptions(data, '')}</select></label>`}
      <label>פירוט<input name="note" maxlength="280" placeholder="לא חובה"></label>
    </div>
    <div class="plant-lane-picks">
      ${LANES.map((lane) => `<button type="button" class="plant-pick plant-pick--${lane.id}" data-act="add-improve" data-lane="${lane.id}"><strong>${esc(lane.label)}</strong><span>${esc(lane.hint)}</span></button>`).join('')}
    </div>
  </div>`;
}

function addMaintainBlock(data, departmentId, today) {
  return `<form data-form="add-maintain" class="card plant-add-card form-group">
    <h3 class="card-title">תחזוקה חדשה</h3>
    <label>מה עושים<input name="title" required maxlength="80" placeholder="למשל ניקוי פילטר תנור"></label>
    ${departmentId ? `<input type="hidden" name="departmentId" value="${esc(departmentId)}">` : `<label>מחלקה<select name="departmentId">${assignOptions(data, '')}</select></label>`}
    ${everyField(7)}
    <label>הפעם הבאה<input type="date" name="nextDue" value="${esc(today)}"></label>
    <p class="form-hint">אחרי «בוצע» הספירה מתחילה מחדש מאותו יום.</p>
    <button type="submit" class="btn btn-primary">הוסף לרשימה</button>
  </form>`;
}

function addInvestBlock(data, departmentId) {
  return `<form data-form="add-invest" class="card plant-add-card form-group">
    <h3 class="card-title">השקעה ליעילות</h3>
    <label>מה קונים או משנים<input name="title" required maxlength="80" placeholder="למשל מיקסר שני"></label>
    <label>איך זה מייעל את הייצור<input name="benefit" maxlength="140" placeholder="למשל מקצר ערבוב בחצי שעה"></label>
    <label>עלות משוערת ₪<input name="cost" inputmode="decimal" placeholder="לא חובה"></label>
    ${departmentId ? `<input type="hidden" name="departmentId" value="${esc(departmentId)}">` : `<label>מחלקה<select name="departmentId">${assignOptions(data, '')}</select></label>`}
    <button type="submit" class="btn btn-primary">הוסף השקעה</button>
  </form>`;
}

function filterBar(data) {
  return `<label class="form-group plant-filter">מחלקה
    <select data-role="filter">${deptOptions(data, ui.filterDept)}</select>
  </label>`;
}

function todayHtml(data, today, summary) {
  const maintenance = activeItems(data.maintenance);
  const overdue = maintenance.filter((item) => maintenanceUrgency(item, today) === 'overdue')
    .sort((a, b) => String(a.nextDue).localeCompare(String(b.nextDue)));
  const dueToday = maintenance.filter((item) => maintenanceUrgency(item, today) === 'today');
  const upcoming = maintenance.filter((item) => {
    if (maintenanceUrgency(item, today) !== 'later' || !item.nextDue) return false;
    const left = daysApart(today, item.nextDue);
    return left > 0 && left <= 7;
  }).sort((a, b) => String(a.nextDue).localeCompare(String(b.nextDue)));
  const reds = activeItems(data.improvements).filter((item) => !item.doneAt && item.lane === 'red');
  const blocks = [];
  if (overdue.length) {
    blocks.push(`<section><h3 class="plant-section-title">תחזוקה באיחור</h3>${overdue.map((item) => maintenanceRow(item, data, today)).join('')}</section>`);
  }
  if (dueToday.length) {
    blocks.push(`<section><h3 class="plant-section-title">תחזוקה להיום</h3>${dueToday.map((item) => maintenanceRow(item, data, today)).join('')}</section>`);
  }
  if (reds.length) {
    blocks.push(`<section><h3 class="plant-section-title">שיפורים אדומים — דחוף ואפשר עכשיו</h3>${reds.map((item) => improvementCard(item, data)).join('')}</section>`);
  }
  const empty = !blocks.length ? `<div class="card plant-empty">
    <strong>אין משימה דחופה להיום.</strong>
    <p class="form-hint">תחזוקה שמגיעה היום ושיפורים אדומים מופיעים כאן, כדי שלא צריך לחפש במפה באמצע העבודה.</p>
    <button type="button" class="btn btn-secondary plant-inline" data-act="tab" data-tab="map">פתח את מפת המפעל</button>
  </div>` : '';
  const soon = upcoming.length ? `<details class="plant-done">
    <summary>7 הימים הקרובים (${upcoming.length})</summary>
    ${upcoming.map((item) => maintenanceRow(item, data, today)).join('')}
  </details>` : '';
  const more = summary.yellow + summary.green > 0
    ? `<button type="button" class="btn btn-secondary plant-inline" data-act="tab" data-tab="improve">עוד ${summary.yellow + summary.green} שיפורים בצהוב ובירוק</button>`
    : '';
  return `${empty}${blocks.join('')}${soon}${more}`;
}

function mapHtml(data, today) {
  const tracks = departmentTracks(data.departments);
  const rows = tracks.map(([row, depts], index) => {
    const rooms = depts.map((dept, i) => {
      const due = activeItems(data.maintenance).filter((item) => item.departmentId === dept.id && ['overdue', 'today'].includes(maintenanceUrgency(item, today))).length;
      const red = activeItems(data.improvements).filter((item) => item.departmentId === dept.id && !item.doneAt && item.lane === 'red').length;
      const bits = [];
      if (due) bits.push(due === 1 ? 'תחזוקה להיום' : `${due} תחזוקה`);
      if (red) bits.push(red === 1 ? 'שיפור אדום' : `${red} אדומים`);
      return `${i ? '<span class="plant-arrow" aria-hidden="true">←</span>' : ''}
        <div class="plant-room">
          <button type="button" class="plant-room-open" data-act="open-dept" data-id="${dept.id}">
            <span class="plant-room-no">${esc(dept.number)}</span>
            <span class="plant-room-name">${esc(dept.name)}</span>
            ${bits.length ? `<span class="plant-room-meta">${esc(bits.join(' · '))}</span>` : ''}
          </button>
          ${ui.mapEdit ? `<div class="plant-room-edit">
            <button type="button" data-act="shift" data-id="${dept.id}" data-dir="-1">ימינה</button>
            <button type="button" data-act="shift" data-id="${dept.id}" data-dir="1">שמאלה</button>
            <button type="button" data-act="track" data-id="${dept.id}">${(dept.row || 0) > 0 ? 'למסלול הראשי' : 'מסלול מקביל'}</button>
            <button type="button" data-act="delete" data-kind="departments" data-id="${dept.id}">מחק</button>
          </div>` : ''}
        </div>`;
    }).join('');
    const label = row === 0 ? 'מסלול ראשי' : (tracks.length === 2 ? 'מסלול מקביל' : `מסלול ${index + 1}`);
    return `<section class="plant-track-wrap">
      <h3 class="plant-track-label">${label}</h3>
      <div class="plant-track">${rooms}</div>
    </section>`;
  }).join('');

  return `<div class="plant-floor">
      <p class="plant-floor-caption">מהכניסה עד המוצר המוגמר. הזרימה מימין לשמאל. לחיצה על מחלקה פותחת את הקטגוריות שלה.</p>
      ${rows || '<p class="form-hint">אין מחלקות במפה.</p>'}
    </div>
    <div class="plant-map-tools">
      <button type="button" class="btn btn-secondary plant-inline" data-act="toggle-edit">${ui.mapEdit ? 'סיום סידור' : 'סידור מחלקות'}</button>
    </div>
    <details class="card plant-add-card">
      <summary class="card-title">מחלקה חדשה</summary>
      <form data-form="add-dept" class="form-group">
        <label>מספר<input name="number" maxlength="12" value="${esc(nextDepartmentNumber(data.departments))}"></label>
        <label>שם<input name="name" required maxlength="40" placeholder="למשל מחסן אריזות"></label>
        <button type="submit" class="btn btn-primary">הוסף למפה</button>
      </form>
    </details>
    <button type="button" class="btn btn-secondary plant-inline" data-act="restore-map">החזר מחלקות התחלתיות שנמחקו</button>`;
}

function maintainList(data, today, departmentId) {
  const items = activeItems(data.maintenance)
    .filter((item) => inDept(item, departmentId || ui.filterDept))
    .sort((a, b) => {
      const rank = { overdue: 0, today: 1, later: 2, off: 3 };
      const diff = rank[maintenanceUrgency(a, today)] - rank[maintenanceUrgency(b, today)];
      if (diff) return diff;
      return String(a.nextDue).localeCompare(String(b.nextDue));
    });
  if (!items.length) return '<p class="form-hint">עוד אין תחזוקה. הוסף פעולה וכל כמה זמן היא חוזרת.</p>';
  return items.map((item) => maintenanceRow(item, data, today)).join('');
}

function investList(data, departmentId) {
  const rank = { idea: 0, checking: 1, approved: 2, done: 3 };
  const items = activeItems(data.investments)
    .filter((item) => inDept(item, departmentId || ui.filterDept))
    .sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9));
  if (!items.length) return '<p class="form-hint">עוד אין השקעות. כאן רושמים מה שווה לקנות או לשנות כדי לייעל ייצור.</p>';
  return items.map((item) => investmentCard(item, data)).join('');
}

function categoryCount(data, dept, categoryId, today) {
  if (categoryId === 'improve') {
    return activeItems(data.improvements).filter((item) => item.departmentId === dept.id && !item.doneAt).length;
  }
  if (categoryId === 'maintain') {
    return activeItems(data.maintenance).filter((item) => item.departmentId === dept.id && ['overdue', 'today'].includes(maintenanceUrgency(item, today))).length;
  }
  if (categoryId === 'invest') {
    return activeItems(data.investments).filter((item) => item.departmentId === dept.id && item.status !== 'done').length;
  }
  return activeItems(data.notes).filter((item) => item.departmentId === dept.id && item.category === categoryId && !item.doneAt).length;
}

function categoryHint(data, dept, categoryId, today) {
  const count = categoryCount(data, dept, categoryId, today);
  if (categoryId === 'maintain') return count ? `${count} להיום` : 'אין להיום';
  if (categoryId === 'improve') return count ? `${count} פתוחים` : 'אין פתוחים';
  if (categoryId === 'invest') return count ? `${count} בתהליך` : 'אין בתהליך';
  return count ? `${count} פתוחות` : 'ריק';
}

function departmentHtml(data, dept, today) {
  const custom = Array.isArray(dept.categories) ? dept.categories : [];
  const cats = [
    ...CORE_CATEGORIES.map((cat) => ({ id: cat.id, label: cat.label, custom: false })),
    ...custom.map((name) => ({ id: name, label: name, custom: true })),
  ];
  const picker = `<div class="plant-cat-grid">${cats.map((cat) => `
    <button type="button" class="plant-cat-btn${ui.category === cat.id ? ' is-active' : ''}" data-act="dept-cat" data-cat="${esc(cat.id)}">
      <span>${esc(cat.label)}</span>
      <small>${esc(categoryHint(data, dept, cat.id, today))}</small>
    </button>`).join('')}</div>
    <form data-form="add-category" class="plant-inline-form">
      <input name="name" maxlength="24" placeholder="קטגוריה חדשה, למשל ציוד" aria-label="שם קטגוריה">
      <button type="submit" class="btn btn-secondary plant-inline">הוסף</button>
    </form>`;

  let body = '';
  if (ui.category === 'improve') body = `${addImproveBlock(data, dept.id)}${laneBoard(data, dept.id)}`;
  else if (ui.category === 'maintain') body = `${addMaintainBlock(data, dept.id, today)}${maintainList(data, today, dept.id)}`;
  else if (ui.category === 'invest') body = `${addInvestBlock(data, dept.id)}${investList(data, dept.id)}`;
  else if (ui.category) {
    const notes = activeItems(data.notes).filter((item) => item.departmentId === dept.id && item.category === ui.category);
    const open = notes.filter((item) => !item.doneAt);
    const done = notes.filter((item) => item.doneAt);
    body = `<form data-form="add-note" class="card plant-add-card form-group">
        <h3 class="card-title">${esc(ui.category)}</h3>
        <label>רשומה<input name="text" required maxlength="200" placeholder="מה חשוב לזכור במחלקה"></label>
        <button type="submit" class="btn btn-primary">הוסף</button>
      </form>
      ${open.map((item) => noteRow(item)).join('') || '<p class="form-hint">אין רשומות בקטגוריה.</p>'}
      ${done.length ? `<details class="plant-done"><summary>טופלו (${done.length})</summary>${done.map((item) => noteRow(item)).join('')}</details>` : ''}
      <button type="button" class="btn btn-danger plant-inline" data-act="delete-category" data-cat="${esc(ui.category)}">מחק את הקטגוריה</button>`;
  }

  return `<button type="button" class="btn btn-secondary plant-inline" data-act="back">חזרה למפה</button>
    <form data-form="dept-meta" class="card plant-dept-head form-group">
      <div class="plant-dept-fields">
        <label>מספר<input name="number" maxlength="12" value="${esc(dept.number)}"></label>
        <label>שם המחלקה<input name="name" required maxlength="40" value="${esc(dept.name)}"></label>
      </div>
      <button type="submit" class="btn btn-primary plant-inline">שמור שם ומספר</button>
    </form>
    <p class="form-hint">קטגוריות המחלקה. שיפורים, תחזוקה והשקעות תמיד כאן, ואפשר להוסיף קטגוריה משלך.</p>
    ${picker}
    ${body}`;
}

function bodyHtml(data, today, summary) {
  if (ui.tab === 'today') return todayHtml(data, today, summary);
  if (ui.tab === 'map') return mapHtml(data, today);
  if (ui.tab === 'improve') {
    return `${filterBar(data)}${addImproveBlock(data, '')}${laneBoard(data, '')}`;
  }
  if (ui.tab === 'maintain') {
    return `${filterBar(data)}${addMaintainBlock(data, '', today)}${maintainList(data, today, '')}`;
  }
  return `${filterBar(data)}${addInvestBlock(data, '')}${investList(data, '')}`;
}

function paint(container, data) {
  const today = todayISO();
  const summary = summarizePlant(data, today);
  let dept = deptById(data, ui.departmentId);
  if (ui.departmentId && !dept) {
    ui.departmentId = '';
    ui.category = '';
    dept = null;
  }
  container.innerHTML = `<div class="plant-screen">${tabsHtml(summary)}${dept ? departmentHtml(data, dept, today) : bodyHtml(data, today, summary)}</div>`;
  const sub = document.getElementById('page-subtitle');
  if (sub) sub.textContent = subtitleFor(dept);
  bindTodayDateButtons(container);
}

async function commit(container, mutator) {
  if (saving) return;
  saving = true;
  try {
    const data = await loadPlant();
    const now = new Date().toISOString();
    const next = mutator(data, now) || data;
    next.updatedAt = now;
    await savePlant(next);
    await refreshPlantMenuHint();
    paint(container, await loadPlant());
  } catch (err) {
    console.error(err);
    showToast('לא נשמר, נסה שוב');
  } finally {
    saving = false;
  }
}

function tombstone(list, id, now) {
  const item = (list || []).find((row) => row.id === id);
  if (!item || item.deletedAt) return false;
  item.deletedAt = now;
  item.updatedAt = now;
  return true;
}

function parseCost(raw) {
  const text = String(raw || '').trim().replace(/,/g, '');
  if (!text) return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

function onClick(container, event) {
  const btn = event.target.closest('[data-act]');
  if (!btn || !container.contains(btn)) return;
  const act = btn.dataset.act;
  if (act === 'tab') {
    ui.tab = TABS.some((tab) => tab.id === btn.dataset.tab) ? btn.dataset.tab : 'today';
    ui.departmentId = '';
    ui.category = '';
    ui.editKey = '';
    loadPlant().then((data) => paint(container, data)).catch(() => showToast('לא נטען'));
    return;
  }
  if (act === 'back') {
    ui.departmentId = '';
    ui.category = '';
    ui.tab = 'map';
    ui.editKey = '';
    loadPlant().then((data) => paint(container, data)).catch(() => showToast('לא נטען'));
    return;
  }
  if (act === 'open-dept') {
    if (!btn.dataset.id) {
      showToast('הפריט לא משויך למחלקה');
      return;
    }
    ui.departmentId = btn.dataset.id;
    ui.category = '';
    ui.tab = 'map';
    ui.editKey = '';
    loadPlant().then((data) => paint(container, data)).catch(() => showToast('לא נטען'));
    return;
  }
  if (act === 'dept-cat') {
    ui.category = btn.dataset.cat || '';
    ui.editKey = '';
    loadPlant().then((data) => paint(container, data)).catch(() => showToast('לא נטען'));
    return;
  }
  if (act === 'toggle-edit') {
    ui.mapEdit = !ui.mapEdit;
    loadPlant().then((data) => paint(container, data)).catch(() => showToast('לא נטען'));
    return;
  }
  if (act === 'edit') {
    const key = `${btn.dataset.kind}:${btn.dataset.id}`;
    ui.editKey = ui.editKey === key ? '' : key;
    loadPlant().then((data) => paint(container, data)).catch(() => showToast('לא נטען'));
    return;
  }
  if (act === 'add-improve') {
    const block = btn.closest('[data-block="add-improve"]');
    const title = block?.querySelector('[name="title"]')?.value || '';
    const note = block?.querySelector('[name="note"]')?.value || '';
    const departmentId = block?.querySelector('[name="departmentId"]')?.value || '';
    const lane = btn.dataset.lane || 'yellow';
    if (!String(title).trim()) {
      showToast('חסר תיאור לשיפור');
      return;
    }
    commit(container, (data, now) => {
      data.improvements.push({
        id: plantId(),
        departmentId,
        title,
        note,
        lane,
        doneAt: null,
        updatedAt: now,
        deletedAt: null,
      });
      return data;
    });
    return;
  }
  if (act === 'done-maintain') {
    commit(container, (data, now) => {
      const item = data.maintenance.find((row) => row.id === btn.dataset.id && !row.deletedAt);
      if (!item) return data;
      const updated = completeMaintenance(item, todayISO(), now);
      Object.assign(item, updated);
      return data;
    });
    return;
  }
  if (act === 'done-improve' || act === 'reopen-improve') {
    commit(container, (data, now) => {
      const item = data.improvements.find((row) => row.id === btn.dataset.id && !row.deletedAt);
      if (!item) return data;
      item.doneAt = act === 'done-improve' ? now : null;
      item.updatedAt = now;
      return data;
    });
    return;
  }
  if (act === 'lane') {
    commit(container, (data, now) => {
      const item = data.improvements.find((row) => row.id === btn.dataset.id && !row.deletedAt);
      if (!item || !LANES.some((lane) => lane.id === btn.dataset.lane)) return data;
      item.lane = btn.dataset.lane;
      item.doneAt = null;
      item.updatedAt = now;
      return data;
    });
    return;
  }
  if (act === 'status') {
    commit(container, (data, now) => {
      const item = data.investments.find((row) => row.id === btn.dataset.id && !row.deletedAt);
      if (!item || !INVEST_STATUSES.some((status) => status.id === btn.dataset.status)) return data;
      item.status = btn.dataset.status;
      item.updatedAt = now;
      return data;
    });
    return;
  }
  if (act === 'toggle-note') {
    commit(container, (data, now) => {
      const item = data.notes.find((row) => row.id === btn.dataset.id && !row.deletedAt);
      if (!item) return data;
      item.doneAt = item.doneAt ? null : now;
      item.updatedAt = now;
      return data;
    });
    return;
  }
  if (act === 'shift') {
    const dir = Number(btn.dataset.dir);
    commit(container, (data, now) => {
      data.departments = shiftDepartment(data.departments, btn.dataset.id, dir, now);
      return data;
    });
    return;
  }
  if (act === 'track') {
    commit(container, (data, now) => {
      data.departments = toggleDepartmentTrack(data.departments, btn.dataset.id, now);
      return data;
    });
    return;
  }
  if (act === 'restore-map') {
    if (!confirm('להחזיר מחלקות שנמחקו מהסכמה ההתחלתית? מחלקות שערכת יישארו.')) return;
    commit(container, (data, now) => restoreDefaultDepartments(data, now));
    return;
  }
  if (act === 'delete-category') {
    const name = btn.dataset.cat || '';
    if (!name || !confirm(`למחוק את הקטגוריה «${name}» ואת הרשומות שלה?`)) return;
    commit(container, (data, now) => {
      const dept = data.departments.find((row) => row.id === ui.departmentId && !row.deletedAt);
      if (dept) {
        dept.categories = (dept.categories || []).filter((cat) => cat !== name);
        dept.updatedAt = now;
      }
      for (const note of data.notes) {
        if (note.departmentId === ui.departmentId && note.category === name && !note.deletedAt) {
          note.deletedAt = now;
          note.updatedAt = now;
        }
      }
      ui.category = '';
      return data;
    });
    return;
  }
  if (act === 'delete') {
    const kind = btn.dataset.kind;
    const id = btn.dataset.id;
    const labels = {
      departments: 'למחוק את המחלקה מהמפה? השיפורים והתחזוקה שלה יישארו תחת «כללי».',
      improvements: 'למחוק את השיפור?',
      maintenance: 'למחוק את פריט התחזוקה?',
      investments: 'למחוק את ההשקעה?',
      notes: 'למחוק את הרשומה?',
    };
    if (!labels[kind] || !confirm(labels[kind])) return;
    commit(container, (data, now) => {
      const list = data[kind];
      tombstone(list, id, now);
      if (kind === 'departments' && ui.departmentId === id) {
        ui.departmentId = '';
        ui.category = '';
      }
      return data;
    });
  }
}

async function onSubmit(container, event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !form.dataset.form) return;
  event.preventDefault();
  const fd = new FormData(form);
  const kind = form.dataset.form;
  if (kind === 'add-maintain') {
    const title = String(fd.get('title') || '');
    const everyDays = readEvery(fd);
    if (!title.trim() || !everyDays) {
      showToast(everyDays ? 'חסר שם לתחזוקה' : 'חסר מספר ימים');
      return;
    }
    commit(container, (data, now) => {
      data.maintenance.push({
        id: plantId(),
        departmentId: String(fd.get('departmentId') || ''),
        title,
        everyDays,
        nextDue: String(fd.get('nextDue') || todayISO()),
        lastDone: '',
        updatedAt: now,
        deletedAt: null,
      });
      return data;
    });
    return;
  }
  if (kind === 'add-invest') {
    const title = String(fd.get('title') || '');
    if (!title.trim()) {
      showToast('חסר שם להשקעה');
      return;
    }
    const cost = parseCost(fd.get('cost'));
    if (String(fd.get('cost') || '').trim() && cost == null) {
      showToast('עלות לא תקינה');
      return;
    }
    commit(container, (data, now) => {
      data.investments.push({
        id: plantId(),
        departmentId: String(fd.get('departmentId') || ''),
        title,
        benefit: String(fd.get('benefit') || ''),
        cost,
        status: 'idea',
        updatedAt: now,
        deletedAt: null,
      });
      return data;
    });
    return;
  }
  if (kind === 'add-dept') {
    const name = String(fd.get('name') || '').trim();
    if (!name) {
      showToast('חסר שם מחלקה');
      return;
    }
    commit(container, (data, now) => {
      const rowItems = activeItems(data.departments).filter((dept) => (dept.row || 0) === 0);
      const col = rowItems.reduce((max, dept) => Math.max(max, dept.col || 0), -1) + 1;
      data.departments.push({
        id: plantId(),
        number: String(fd.get('number') || nextDepartmentNumber(data.departments)).trim() || nextDepartmentNumber(data.departments),
        name,
        row: 0,
        col,
        categories: [],
        updatedAt: now,
        deletedAt: null,
      });
      return data;
    });
    return;
  }
  if (kind === 'dept-meta') {
    const name = String(fd.get('name') || '').trim();
    const number = String(fd.get('number') || '').trim();
    if (!name || !number) {
      showToast('צריך שם ומספר');
      return;
    }
    commit(container, (data, now) => {
      const dept = data.departments.find((row) => row.id === ui.departmentId && !row.deletedAt);
      if (!dept) return data;
      dept.name = name;
      dept.number = number;
      dept.updatedAt = now;
      return data;
    });
    return;
  }
  if (kind === 'add-category') {
    const name = String(fd.get('name') || '').replace(/\s+/g, ' ').trim();
    if (!name) {
      showToast('חסר שם קטגוריה');
      return;
    }
    if (CORE_CATEGORIES.some((cat) => cat.label === name)) {
      showToast('הקטגוריה כבר קיימת');
      return;
    }
    const current = await loadPlant();
    const dept = current.departments.find((row) => row.id === ui.departmentId && !row.deletedAt);
    const exists = (dept?.categories || []).some((cat) => cat.toLocaleLowerCase('he') === name.toLocaleLowerCase('he'));
    if (!dept || exists) {
      showToast(dept ? 'הקטגוריה כבר קיימת' : 'המחלקה לא נמצאה');
      return;
    }
    if ((dept.categories || []).length >= 12) {
      showToast('אפשר עד 12 קטגוריות למחלקה');
      return;
    }
    commit(container, (data, now) => {
      const target = data.departments.find((row) => row.id === ui.departmentId && !row.deletedAt);
      if (!target) return data;
      target.categories = [...(target.categories || []), name];
      target.updatedAt = now;
      ui.category = name;
      return data;
    });
    return;
  }
  if (kind === 'add-note') {
    const text = String(fd.get('text') || '').trim();
    if (!text || !ui.category) {
      showToast('חסרה רשומה');
      return;
    }
    commit(container, (data, now) => {
      data.notes.push({
        id: plantId(),
        departmentId: ui.departmentId,
        category: ui.category,
        text,
        doneAt: null,
        updatedAt: now,
        deletedAt: null,
      });
      return data;
    });
    return;
  }
  if (kind === 'rename') {
    const listName = form.dataset.kind;
    const id = form.dataset.id;
    commit(container, (data, now) => {
      const item = (data[listName] || []).find((row) => row.id === id && !row.deletedAt);
      if (!item) return data;
      if (listName === 'notes') item.text = String(fd.get('title') || item.text);
      else item.title = String(fd.get('title') || item.title);
      if (listName === 'improvements') {
        item.note = String(fd.get('note') || '');
        item.departmentId = String(fd.get('departmentId') || '');
      }
      if (listName === 'investments') {
        const cost = parseCost(fd.get('cost'));
        if (String(fd.get('cost') || '').trim() && cost == null) return data;
        item.benefit = String(fd.get('benefit') || '');
        item.cost = cost;
        item.departmentId = String(fd.get('departmentId') || '');
      }
      item.updatedAt = now;
      ui.editKey = '';
      return data;
    });
    return;
  }
  if (kind === 'edit-maintain') {
    const everyDays = readEvery(fd);
    const title = String(fd.get('title') || '').trim();
    if (!title || !everyDays) {
      showToast(everyDays ? 'חסר שם' : 'חסר מספר ימים');
      return;
    }
    commit(container, (data, now) => {
      const item = data.maintenance.find((row) => row.id === form.dataset.id && !row.deletedAt);
      if (!item) return data;
      item.title = title;
      item.departmentId = String(fd.get('departmentId') || '');
      item.everyDays = everyDays;
      item.nextDue = String(fd.get('nextDue') || item.nextDue || todayISO());
      item.updatedAt = now;
      ui.editKey = '';
      return data;
    });
  }
}

function onChange(container, event) {
  const select = event.target;
  if (!(select instanceof HTMLSelectElement)) return;
  if (select.dataset.role === 'filter') {
    ui.filterDept = select.value || '';
    ui.editKey = '';
    loadPlant().then((data) => paint(container, data)).catch(() => showToast('לא נטען'));
    return;
  }
  if (select.name === 'every') {
    const custom = select.form?.querySelector('.plant-custom-days');
    if (custom) custom.hidden = select.value !== 'custom';
  }
}

export async function renderPlant(container) {
  if (container.dataset.plantBound !== '1') {
    container.dataset.plantBound = '1';
    container.addEventListener('click', (event) => onClick(container, event));
    container.addEventListener('submit', (event) => onSubmit(container, event));
    container.addEventListener('change', (event) => onChange(container, event));
  }
  const data = await loadPlant();
  paint(container, data);
  refreshPlantMenuHint().catch(() => {});
}
