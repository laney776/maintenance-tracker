(() => {
  'use strict';
  const STORAGE_KEY = 'e92-servicebook-v1';
  const APP_VERSION = 1;
  const today = new Date();
  const todayIso = toIsoDate(today);
  const DEFAULT_TASKS = [
    ['Engine oil & filter', 'Engine', '◉'],
    ['Fuel filter', 'Engine', '▤'],
    ['Engine air filter', 'Engine', '⌁'],
    ['Cabin microfilter', 'Inspection', '▥'],
    ['Brake fluid', 'Fluids', '◌'],
    ['Coolant', 'Fluids', '◍'],
    ['Brake pads & discs', 'Brakes', '▰'],
    ['Tyres & wheels', 'Tyres & wheels', '◒'],
    ['Transmission service', 'Transmission', '⚙'],
    ['Differential oil', 'Transmission', '◌'],
    ['Drive belt & pulleys', 'Engine', '⤴'],
    ['DPF / exhaust inspection', 'Exhaust & emissions', '≋'],
    ['Battery & charging system', 'Electrical', '⌁'],
    ['Annual inspection / MOT', 'Inspection', '✓']
  ].map(([name, category, icon]) => ({ id: uid(), name, category, icon, intervalDistance: null, intervalMonths: null, leadDistance: 1000, notes: '' }));

  const defaultState = () => ({
    appVersion: APP_VERSION,
    profile: { name: 'BMW E92 325d', year: '', registration: '', odometer: '', unit: 'mi', currency: 'GBP', engine: 'M57 diesel · Pre-LCI', vin: '' },
    tasks: DEFAULT_TASKS,
    records: [],
    settings: { calloutDismissed: false, lastBackup: '' }
  });
  let state = loadState();
  let activeView = 'overview';
  let planFilter = 'all';
  let toastTimer;
  let deferredInstallPrompt = null;

  function uid() { return globalThis.crypto?.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
  function toIsoDate(date) { const d = new Date(date); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
  function parseDate(value) { if (!value) return null; const [y, m, d] = value.split('-').map(Number); return new Date(y, m - 1, d, 12); }
  function addMonths(date, months) { const result = new Date(date); const originalDay = result.getDate(); result.setDate(1); result.setMonth(result.getMonth() + Number(months)); const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate(); result.setDate(Math.min(originalDay, lastDay)); return result; }
  function daysBetween(a, b) { const first = new Date(a.getFullYear(), a.getMonth(), a.getDate()); const second = new Date(b.getFullYear(), b.getMonth(), b.getDate()); return Math.round((second - first) / 86400000); }
  function esc(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!saved || !Array.isArray(saved.tasks) || !Array.isArray(saved.records)) return defaultState();
      const base = defaultState();
      return { ...base, ...saved, profile: { ...base.profile, ...(saved.profile || {}) }, settings: { ...base.settings, ...(saved.settings || {}) }, tasks: saved.tasks.map(t => ({ icon: iconFor(t.category), intervalDistance: null, intervalMonths: null, leadDistance: 1000, notes: '', ...t })), records: saved.records.map(r => ({ ...r, taskName: r.taskName || saved.tasks.find(t => t.id === r.taskId)?.name || 'Archived item' })) };
    } catch { return defaultState(); }
  }
  function persist() { state.appVersion = APP_VERSION; localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  function byId(id) { return document.getElementById(id); }
  function currency(value, currencyCode = state.profile.currency) {
    const amount = Number(value || 0);
    try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: currencyCode, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount); }
    catch { return `${currencyCode} ${amount.toFixed(2)}`; }
  }
  function numberFormat(value) { return new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 }).format(Number(value)); }
  function formatDate(value, options = { day: 'numeric', month: 'short', year: 'numeric' }) { const d = typeof value === 'string' ? parseDate(value) : value; return d ? new Intl.DateTimeFormat('en-GB', options).format(d) : '—'; }
  function iconFor(category = '') { return ({ Engine: '◉', Fluids: '◌', Brakes: '▰', 'Tyres & wheels': '◒', Transmission: '⚙', 'Exhaust & emissions': '≋', Electrical: '⌁', Inspection: '✓', Other: '⋯' })[category] || '⋯'; }
  function activeTasks() { return state.tasks.filter(task => !task.archived); }
  function recordsFor(taskId) { return state.records.filter(record => record.taskId === taskId); }
  function lastRecord(taskId) { return recordsFor(taskId).sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0] || null; }

  function taskStatus(task) {
    const last = lastRecord(task.id);
    const distInterval = Number(task.intervalDistance) > 0 ? Number(task.intervalDistance) : null;
    const monthInterval = Number(task.intervalMonths) > 0 ? Number(task.intervalMonths) : null;
    if (!distInterval && !monthInterval) return { key: 'unset', label: 'Set interval', detail: 'Add a mileage or time interval', last };
    if (!last) return { key: 'baseline', label: 'Set baseline', detail: 'Log the last service to start tracking', last };
    const checks = [];
    if (distInterval) {
      if (last.odometer !== '' && last.odometer != null && state.profile.odometer !== '' && state.profile.odometer != null) {
        const next = Number(last.odometer) + distInterval;
        const remaining = next - Number(state.profile.odometer);
        checks.push({ type: 'distance', next, remaining, due: remaining <= 0, soon: remaining > 0 && remaining <= Number(task.leadDistance || 1000) });
      }
    }
    if (monthInterval && last.date) {
      const next = addMonths(parseDate(last.date), monthInterval);
      const remainingDays = daysBetween(today, next);
      checks.push({ type: 'time', next, remaining: remainingDays, due: remainingDays <= 0, soon: remainingDays > 0 && remainingDays <= 30 });
    }
    if (!checks.length) return { key: 'unknown', label: 'Update odometer', detail: distInterval ? 'Enter a current odometer reading' : 'Log the service date', last };
    const overdue = checks.some(check => check.due);
    const soon = checks.some(check => check.soon);
    const distanceCheck = checks.find(check => check.type === 'distance');
    const timeCheck = checks.find(check => check.type === 'time');
    const details = [];
    if (distanceCheck) details.push(distanceCheck.remaining <= 0 ? `Overdue by ${numberFormat(Math.abs(distanceCheck.remaining))} ${state.profile.unit}` : `Due in ${numberFormat(distanceCheck.remaining)} ${state.profile.unit}`);
    else if (distInterval && state.profile.odometer === '') details.push('Add current odometer');
    if (timeCheck) details.push(timeCheck.remaining === 0 ? 'Due today' : timeCheck.remaining < 0 ? `Overdue by ${Math.abs(timeCheck.remaining)} days` : `Due ${formatDate(timeCheck.next, { day: 'numeric', month: 'short' })}`);
    const nextDue = [distanceCheck?.remaining, timeCheck?.remaining].filter(v => typeof v === 'number').sort((a, b) => a - b)[0];
    return { key: overdue ? 'overdue' : soon ? 'soon' : 'good', label: overdue ? 'Overdue' : soon ? 'Due soon' : 'On track', detail: details.join(' · ') || 'Intervals active', last, checks, nextDue };
  }

  function render() {
    renderProfile();
    renderOverview();
    renderPlan();
    renderHistory();
    renderCallout();
  }
  function renderProfile() {
    const p = state.profile;
    byId('bannerVehicleName').textContent = p.name || 'BMW E92 325d';
    byId('bannerSubline').innerHTML = `${esc(p.engine || 'M57 diesel · Pre-LCI')}`;
    byId('yearPill').textContent = p.year ? `Model year ${p.year}` : 'Year not set';
    byId('platePill').textContent = p.registration || 'Registration not set';
    byId('currentOdoDisplay').textContent = p.odometer === '' || p.odometer == null ? '—' : numberFormat(p.odometer);
    byId('distanceUnitDisplay').textContent = p.unit || 'mi';
    byId('vehicleMenuBtn').textContent = (p.name || 'E').trim().slice(0, 1).toUpperCase();
    byId('profileName').value = p.name || '';
    byId('profileYear').value = p.year || '';
    byId('profileReg').value = p.registration || '';
    byId('profileOdo').value = p.odometer ?? '';
    byId('profileUnit').value = p.unit || 'mi';
    byId('profileCurrency').value = p.currency || 'GBP';
    byId('profileEngine').value = p.engine || '';
    byId('profileVin').value = p.vin || '';
    byId('serviceUnitLabel').textContent = p.unit || 'mi';
    byId('taskUnitSuffix').textContent = p.unit || 'mi';
    byId('taskLeadUnit').textContent = p.unit || 'mi';
    byId('currencyLabel').textContent = p.currency || 'GBP';
    byId('lastBackupLabel').textContent = p.lastBackup || state.settings.lastBackup ? formatDate(p.lastBackup || state.settings.lastBackup, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Not backed up yet';
  }
  function renderOverview() {
    const tasks = activeTasks();
    const statuses = tasks.map(task => ({ task, status: taskStatus(task) }));
    const overdue = statuses.filter(x => x.status.key === 'overdue');
    const upcoming = statuses.filter(x => x.status.key === 'soon');
    byId('attentionCount').textContent = String(overdue.length);
    byId('attentionFoot').textContent = overdue.length ? `${overdue.length} item${overdue.length === 1 ? '' : 's'} past due` : 'No overdue items';
    byId('upcomingCount').textContent = String(upcoming.length);
    const year = today.getFullYear();
    const yearRecords = state.records.filter(record => (parseDate(record.date)?.getFullYear() || 0) === year);
    const yearSpend = yearRecords.reduce((sum, record) => sum + Number(record.cost || 0), 0);
    byId('yearSpend').textContent = currency(yearSpend);
    byId('yearSpendFoot').textContent = `${yearRecords.length} service record${yearRecords.length === 1 ? '' : 's'}`;
    const last = [...state.records].sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
    byId('lastServiceDate').textContent = last ? formatDate(last.date, { day: 'numeric', month: 'short' }) : '—';
    byId('lastServiceFoot').textContent = last ? (last.taskName || state.tasks.find(t => t.id === last.taskId)?.name || 'Service logged') : 'No services logged yet';
    const configured = tasks.filter(task => Number(task.intervalDistance) > 0 || Number(task.intervalMonths) > 0).length;
    const percent = tasks.length ? Math.round(configured / tasks.length * 100) : 0;
    byId('healthPercent').textContent = `${percent}%`;
    byId('healthMeterFill').style.width = `${percent}%`;
    byId('configuredCount').textContent = `${configured} configured`;
    byId('totalItemsCount').textContent = `${tasks.length} items`;
    byId('healthCopy').textContent = !configured ? 'Add intervals from your preferred schedule to activate due tracking.' : configured === tasks.length ? 'Every active maintenance item has an interval.' : `${tasks.length - configured} item${tasks.length - configured === 1 ? '' : 's'} still need an interval.`;
    byId('planNavCount').textContent = String(overdue.length + upcoming.length);

    const priorities = [...statuses].sort((a, b) => priorityRank(a.status.key) - priorityRank(b.status.key) || (a.status.nextDue ?? Infinity) - (b.status.nextDue ?? Infinity)).slice(0, 4);
    const list = byId('priorityList');
    if (!priorities.length) list.innerHTML = `<div class="empty-state"><strong>Maintenance plan is clear</strong>Add items to begin tracking work on your car.</div>`;
    else list.innerHTML = priorities.map(({ task, status }) => `<div class="priority-row"><span class="task-icon">${esc(task.icon || iconFor(task.category))}</span><div><div class="priority-name">${esc(task.name)}</div><div class="priority-detail">${esc(status.detail)}</div></div><span class="due-badge ${badgeClass(status.key)}">${esc(status.label)}</span></div>`).join('');
    const sortedRecords = [...state.records].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 5);
    const table = byId('recentTable');
    table.innerHTML = sortedRecords.length ? sortedRecords.map(record => {
      const item = record.taskName || state.tasks.find(t => t.id === record.taskId)?.name || 'Archived item';
      return `<tr><td><div class="td-main">${esc(item)}</div>${record.parts ? `<div class="td-sub">${esc(record.parts)}</div>` : ''}</td><td>${formatDate(record.date, { day: 'numeric', month: 'short', year: 'numeric' })}</td><td>${record.odometer !== '' && record.odometer != null ? `${numberFormat(record.odometer)} ${state.profile.unit}` : '—'}</td><td>${esc(record.provider || '—')}</td><td class="cost-cell">${record.cost ? currency(record.cost) : '—'}</td></tr>`;
    }).join('') : `<tr><td colspan="5"><div class="empty-state"><strong>No service history yet</strong>Log your last service to start a useful maintenance timeline.</div></td></tr>`;
  }
  function priorityRank(key) { return ({ overdue: 0, soon: 1, baseline: 2, unknown: 3, unset: 4, good: 5 })[key] ?? 6; }
  function badgeClass(key) { return ({ overdue: 'overdue', soon: 'soon', good: 'good', baseline: 'setup', unknown: 'neutral', unset: 'neutral' })[key] || 'neutral'; }

  function renderPlan() {
    const query = byId('planSearch').value.trim().toLowerCase();
    const tasks = activeTasks().filter(task => `${task.name} ${task.category} ${task.notes || ''}`.toLowerCase().includes(query));
    const statusPairs = tasks.map(task => ({ task, status: taskStatus(task) }));
    const dueCount = statusPairs.filter(({ status }) => ['overdue', 'soon'].includes(status.key)).length;
    const unconfiguredCount = statusPairs.filter(({ status }) => ['unset', 'baseline', 'unknown'].includes(status.key)).length;
    byId('filterAllCount').textContent = String(activeTasks().length);
    byId('filterDueCount').textContent = String(activeTasks().filter(task => ['overdue', 'soon'].includes(taskStatus(task).key)).length);
    byId('filterUnconfiguredCount').textContent = String(activeTasks().filter(task => ['unset', 'baseline', 'unknown'].includes(taskStatus(task).key)).length);
    let shown = statusPairs;
    if (planFilter === 'due') shown = shown.filter(({ status }) => ['overdue', 'soon'].includes(status.key));
    if (planFilter === 'unconfigured') shown = shown.filter(({ status }) => ['unset', 'baseline', 'unknown'].includes(status.key));
    const list = byId('planList');
    if (!shown.length) {
      const message = !tasks.length ? 'No items match that search.' : planFilter === 'due' ? 'Nothing is due soon.' : 'Every item has an interval and a service baseline.';
      list.innerHTML = `<div class="panel"><div class="empty-state"><strong>${esc(message)}</strong>Change the filter or add a maintenance item.</div></div>`;
      return;
    }
    list.innerHTML = shown.map(({ task, status }) => {
      const distanceChip = Number(task.intervalDistance) > 0 ? `Every ${numberFormat(task.intervalDistance)} ${esc(state.profile.unit)}` : '';
      const monthChip = Number(task.intervalMonths) > 0 ? `Every ${numberFormat(task.intervalMonths)} months` : '';
      const last = status.last;
      const baseline = last ? `Last logged ${formatDate(last.date, { day: 'numeric', month: 'short', year: 'numeric' })}${last.odometer !== '' && last.odometer != null ? ` · ${numberFormat(last.odometer)} ${esc(state.profile.unit)}` : ''}` : 'No service baseline logged';
      return `<article class="plan-card"><span class="task-icon">${esc(task.icon || iconFor(task.category))}</span><div><div class="plan-title">${esc(task.name)}</div><div class="plan-category">${esc(task.category)}</div></div><div><div class="plan-schedule">${distanceChip ? `<span class="schedule-chip">${distanceChip}</span>` : ''}${monthChip ? `<span class="schedule-chip">${monthChip}</span>` : ''}${!distanceChip && !monthChip ? `<span class="schedule-chip empty">Interval not set</span>` : ''}</div><div class="plan-meta">${esc(baseline)} <span class="status-badge ${badgeClass(status.key)}">${esc(status.label)}</span></div></div><div class="plan-actions"><button class="mini-button log" data-log="${esc(task.id)}" type="button">Log service</button><button class="mini-button edit" data-edit-task="${esc(task.id)}" type="button">Edit</button></div></article>`;
    }).join('');
  }

  function renderHistory() {
    let records = [...state.records].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const filter = byId('historyFilter').value;
    if (filter === '12') { const cutoff = new Date(today); cutoff.setMonth(cutoff.getMonth() - 12); records = records.filter(r => parseDate(r.date) >= cutoff); }
    if (filter === 'year') records = records.filter(r => parseDate(r.date)?.getFullYear() === today.getFullYear());
    byId('historyRecordCount').textContent = String(state.records.length);
    byId('lifetimeSpend').textContent = currency(state.records.reduce((sum, record) => sum + Number(record.cost || 0), 0));
    const list = byId('historyList');
    if (!records.length) { list.innerHTML = `<div class="empty-state"><strong>${state.records.length ? 'No records in this date range' : 'Your service timeline starts here'}</strong>Record maintenance, repairs, inspections, and spend as you go.</div>`; return; }
    let lastYear = '';
    list.innerHTML = records.map(record => {
      const d = parseDate(record.date); const year = d?.getFullYear() || 'Unknown date';
      const yearHeader = year !== lastYear ? `<div class="history-year">${year}</div>` : ''; lastYear = year;
      const taskName = record.taskName || state.tasks.find(t => t.id === record.taskId)?.name || 'Archived item';
      return `${yearHeader}<article class="history-entry"><div class="history-date-block"><strong>${d ? formatDate(d, { day: 'numeric' }) : '—'}</strong><span>${d ? formatDate(d, { month: 'short' }) : 'Date'}</span></div><div><div class="history-item-name">${esc(taskName)}</div><div class="history-detail">${record.odometer !== '' && record.odometer != null ? `${numberFormat(record.odometer)} ${esc(state.profile.unit)}` : 'Odometer not recorded'}${record.provider ? ` · ${esc(record.provider)}` : ''}</div>${record.notes ? `<div class="history-notes">${esc(record.notes)}</div>` : ''}${record.parts ? `<div class="history-ref">${esc(record.parts)}</div>` : ''}</div><div class="history-right"><span class="history-cost">${record.cost ? currency(record.cost) : '—'}</span><div class="history-controls"><button class="record-action" data-edit-record="${esc(record.id)}" type="button">Edit</button><button class="record-action delete" data-delete-record="${esc(record.id)}" type="button">Delete</button></div></div></article>`;
    }).join('');
  }
  function renderCallout() { byId('dismissCallout').closest('.plan-callout').hidden = !!state.settings.calloutDismissed; }

  function go(view) {
    if (!['overview', 'plan', 'history', 'vehicle'].includes(view)) return;
    activeView = view;
    document.querySelectorAll('.view').forEach(el => el.classList.toggle('active', el.id === `view-${view}`));
    document.querySelectorAll('[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === view));
    byId('mainContent').focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function notify(message) {
    const toast = byId('toast'); toast.textContent = message; toast.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
  }
  function openDialog(id) { byId(id).showModal(); }
  function closeDialog(id) { byId(id).close(); }
  function populateTaskOptions(selectedId = '') {
    const select = byId('serviceTask');
    select.replaceChildren();
    activeTasks().sort((a, b) => a.name.localeCompare(b.name)).forEach(task => {
      const option = document.createElement('option'); option.value = task.id; option.textContent = task.name; select.append(option);
    });
    if (selectedId && !activeTasks().some(task => task.id === selectedId)) {
      const record = state.records.find(r => r.taskId === selectedId);
      const option = document.createElement('option'); option.value = selectedId; option.textContent = `${record?.taskName || 'Archived item'} (archived)`; select.append(option);
    }
    if (selectedId) select.value = selectedId;
  }
  function openService(taskId = '', record = null) {
    byId('serviceForm').reset();
    byId('serviceId').value = record?.id || '';
    byId('serviceDialogTitle').textContent = record ? 'Edit service record' : 'Log a service';
    populateTaskOptions(record?.taskId || taskId);
    byId('serviceDate').value = record?.date || todayIso;
    byId('serviceOdo').value = record?.odometer ?? state.profile.odometer ?? '';
    byId('serviceCost').value = record?.cost ?? '';
    byId('serviceProvider').value = record?.provider || '';
    byId('serviceParts').value = record?.parts || '';
    byId('serviceNotes').value = record?.notes || '';
    openDialog('serviceDialog');
  }
  function openTask(task = null) {
    byId('taskForm').reset();
    byId('taskId').value = task?.id || '';
    byId('taskDialogTitle').textContent = task ? 'Edit maintenance item' : 'Add maintenance item';
    byId('taskName').value = task?.name || '';
    byId('taskCategory').value = task?.category || 'Engine';
    byId('taskIntervalKm').value = task?.intervalDistance ?? '';
    byId('taskIntervalMonths').value = task?.intervalMonths ?? '';
    byId('taskLeadKm').value = task?.leadDistance ?? 1000;
    byId('taskNotes').value = task?.notes || '';
    const remove = byId('removeTaskBtn');
    remove.hidden = !task;
    remove.dataset.taskId = task?.id || '';
    openDialog('taskDialog');
  }
  function download(filename, content, type) {
    const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  function exportBackup() {
    state.settings.lastBackup = todayIso;
    persist(); renderProfile();
    const payload = { app: 'E92 Servicebook', version: APP_VERSION, exportedAt: new Date().toISOString(), data: state };
    const stamp = todayIso.replaceAll('-', '');
    download(`e92-servicebook-backup-${stamp}.json`, JSON.stringify(payload, null, 2), 'application/json');
    notify('Backup saved. Keep it somewhere safe.');
  }
  function importBackup(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const decoded = JSON.parse(reader.result);
        const incoming = decoded.data || decoded;
        if (!incoming.profile || !Array.isArray(incoming.tasks) || !Array.isArray(incoming.records)) throw new Error('This file is not an E92 Servicebook backup.');
        if (!confirm(`Restore ${incoming.records.length} service record(s) and ${incoming.tasks.length} plan item(s)? This replaces the data in this browser.`)) return;
        const base = defaultState();
        state = { ...base, ...incoming, profile: { ...base.profile, ...incoming.profile }, settings: { ...base.settings, ...incoming.settings } };
        persist(); render(); notify('Backup restored successfully.');
      } catch (error) { notify(error.message || 'Could not read that backup file.'); }
      finally { byId('importInput').value = ''; }
    };
    reader.readAsText(file);
  }
  function csvCell(value) {
    let safe = String(value ?? '');
    if (/^[\s]*[=+@]/.test(safe)) safe = `'${safe}`;
    if (/^[\s]*-/.test(safe) && !/^[\s]*-?\d+(?:\.\d+)?$/.test(safe)) safe = `'${safe}`;
    return `"${safe.replaceAll('"', '""')}"`;
  }
  function exportCsv() {
    const rows = [['Date', 'Maintenance item', 'Odometer', 'Unit', 'Cost', 'Currency', 'Provider', 'Parts / reference', 'Notes']];
    [...state.records].sort((a, b) => (a.date || '').localeCompare(b.date || '')).forEach(record => rows.push([record.date, record.taskName || state.tasks.find(t => t.id === record.taskId)?.name || 'Archived item', record.odometer, state.profile.unit, record.cost, state.profile.currency, record.provider, record.parts, record.notes]));
    download('e92-service-history.csv', rows.map(row => row.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
    notify('Service history exported as CSV.');
  }
  function exportCalendar() {
    const events = activeTasks().map(task => {
      const status = taskStatus(task); const check = status.checks?.find(item => item.type === 'time');
      if (!check) return null;
      const date = check.due ? today : check.next;
      const taskName = task.name.replace(/[\\,;]/g, ' ');
      const dt = toIsoDate(date).replaceAll('-', '');
      return `BEGIN:VEVENT\nUID:${task.id}-${dt}@e92-servicebook\nDTSTAMP:${new Date().toISOString().replaceAll(/[-:]/g, '').replace(/\.\d{3}/, '')}\nDTSTART:${dt}T090000\nDTEND:${dt}T093000\nSUMMARY:${taskName} — BMW E92\nDESCRIPTION:Maintenance reminder from E92 Servicebook. Check your current plan and service history.\nEND:VEVENT`;
    }).filter(Boolean);
    if (!events.length) { notify('Set a time interval and log a baseline service to create calendar reminders.'); return; }
    const ics = `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//E92 Servicebook//Maintenance Planner//EN\nCALSCALE:GREGORIAN\n${events.join('\n')}\nEND:VCALENDAR`;
    download('e92-maintenance-reminders.ics', ics, 'text/calendar;charset=utf-8');
    notify('Calendar reminder file created. Open it to add events to Calendar.');
  }

  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => go(button.dataset.view)));
  document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => go(button.dataset.go)));
  byId('vehicleMenuBtn').addEventListener('click', () => go('vehicle'));
  byId('quickLogBtn').addEventListener('click', () => openService());
  byId('historyLogBtn').addEventListener('click', () => openService());
  byId('addTaskBtn').addEventListener('click', () => openTask());
  byId('updateOdoBtn').addEventListener('click', () => { byId('odoInput').value = state.profile.odometer ?? ''; byId('odoUnitLabel').textContent = state.profile.unit; openDialog('odoDialog'); });
  byId('planSearch').addEventListener('input', renderPlan);
  byId('historyFilter').addEventListener('change', renderHistory);
  byId('planFilters').addEventListener('click', event => { const button = event.target.closest('[data-filter]'); if (!button) return; planFilter = button.dataset.filter; document.querySelectorAll('.filter-tab').forEach(el => el.classList.toggle('selected', el === button)); renderPlan(); });
  byId('planList').addEventListener('click', event => {
    const log = event.target.closest('[data-log]'); if (log) return openService(log.dataset.log);
    const edit = event.target.closest('[data-edit-task]'); if (edit) return openTask(state.tasks.find(task => task.id === edit.dataset.editTask));
  });
  byId('historyList').addEventListener('click', event => {
    const edit = event.target.closest('[data-edit-record]');
    if (edit) return openService('', state.records.find(record => record.id === edit.dataset.editRecord));
    const remove = event.target.closest('[data-delete-record]');
    if (remove && confirm('Delete this service record?')) { state.records = state.records.filter(record => record.id !== remove.dataset.deleteRecord); persist(); render(); notify('Service record deleted.'); }
  });
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => closeDialog(button.dataset.close)));
  [byId('serviceDialog'), byId('taskDialog'), byId('odoDialog')].forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); }));

  byId('serviceForm').addEventListener('submit', event => {
    event.preventDefault();
    const id = byId('serviceId').value || uid();
    const task = state.tasks.find(item => item.id === byId('serviceTask').value);
    const old = state.records.find(record => record.id === id);
    const odoText = byId('serviceOdo').value;
    const record = { id, taskId: byId('serviceTask').value, taskName: task?.name || old?.taskName || 'Archived item', date: byId('serviceDate').value, odometer: odoText === '' ? '' : Number(odoText), cost: byId('serviceCost').value === '' ? '' : Number(byId('serviceCost').value), provider: byId('serviceProvider').value.trim(), parts: byId('serviceParts').value.trim(), notes: byId('serviceNotes').value.trim() };
    state.records = old ? state.records.map(item => item.id === id ? record : item) : [...state.records, record];
    if (record.odometer !== '' && (state.profile.odometer === '' || Number(record.odometer) > Number(state.profile.odometer))) state.profile.odometer = record.odometer;
    persist(); closeDialog('serviceDialog'); render(); notify(old ? 'Service record updated.' : 'Service recorded.');
  });
  byId('taskForm').addEventListener('submit', event => {
    event.preventDefault();
    const id = byId('taskId').value || uid();
    const old = state.tasks.find(task => task.id === id);
    const task = { id, name: byId('taskName').value.trim(), category: byId('taskCategory').value, icon: old?.icon || iconFor(byId('taskCategory').value), intervalDistance: byId('taskIntervalKm').value ? Number(byId('taskIntervalKm').value) : null, intervalMonths: byId('taskIntervalMonths').value ? Number(byId('taskIntervalMonths').value) : null, leadDistance: byId('taskLeadKm').value === '' ? 1000 : Number(byId('taskLeadKm').value), notes: byId('taskNotes').value.trim(), archived: false };
    state.tasks = old ? state.tasks.map(item => item.id === id ? task : item) : [...state.tasks, task];
    persist(); closeDialog('taskDialog'); render(); notify(old ? 'Maintenance plan updated.' : 'Maintenance item added.');
  });
  byId('removeTaskBtn').addEventListener('click', () => {
    const id = byId('removeTaskBtn').dataset.taskId;
    const count = recordsFor(id).length;
    if (!confirm(`Remove this item from your active plan? ${count ? `${count} past record(s) will remain in your history.` : 'It can be added again later.'}`)) return;
    state.tasks = state.tasks.filter(task => task.id !== id); persist(); closeDialog('taskDialog'); render(); notify('Item removed from the plan.');
  });
  byId('odoForm').addEventListener('submit', event => {
    event.preventDefault(); state.profile.odometer = Number(byId('odoInput').value); persist(); closeDialog('odoDialog'); render(); notify('Odometer updated.');
  });
  function saveProfile() {
    const previousUnit = state.profile.unit || 'mi';
    const nextUnit = byId('profileUnit').value;
    if (previousUnit !== nextUnit) {
      const factor = previousUnit === 'mi' ? 1.609344 : 1 / 1.609344;
      const oldCurrent = state.profile.odometer;
      state.tasks.forEach(task => {
        if (Number(task.intervalDistance) > 0) task.intervalDistance = Math.round(Number(task.intervalDistance) * factor);
        if (Number(task.leadDistance) > 0) task.leadDistance = Math.round(Number(task.leadDistance) * factor);
      });
      state.records.forEach(record => { if (record.odometer !== '' && record.odometer != null) record.odometer = Math.round(Number(record.odometer) * factor); });
      if (byId('profileOdo').value !== '' && oldCurrent !== '' && Number(byId('profileOdo').value) === Number(oldCurrent)) byId('profileOdo').value = String(Math.round(Number(oldCurrent) * factor));
    }
    state.profile.name = byId('profileName').value.trim() || 'BMW E92 325d';
    state.profile.year = byId('profileYear').value.trim();
    state.profile.registration = byId('profileReg').value.trim().toUpperCase();
    state.profile.odometer = byId('profileOdo').value === '' ? '' : Number(byId('profileOdo').value);
    state.profile.unit = nextUnit;
    state.profile.currency = byId('profileCurrency').value;
    state.profile.engine = byId('profileEngine').value.trim();
    state.profile.vin = byId('profileVin').value.trim().toUpperCase();
    persist(); render(); byId('profileSaveStatus').textContent = 'Saved'; setTimeout(() => { if (byId('profileSaveStatus')) byId('profileSaveStatus').textContent = ''; }, 2200); notify('Vehicle profile saved.');
  }
  byId('saveVehicleBtn').addEventListener('click', saveProfile);
  byId('saveVehicleBtn2').addEventListener('click', saveProfile);
  byId('profileOdo').addEventListener('change', () => { /* Save remains explicit. */ });
  byId('backupBtn').addEventListener('click', exportBackup);
  byId('profileBackupBtn').addEventListener('click', exportBackup);
  byId('importInput').addEventListener('change', event => { if (event.target.files?.[0]) importBackup(event.target.files[0]); });
  byId('calendarBtn').addEventListener('click', exportCalendar);
  byId('dismissCallout').addEventListener('click', () => { state.settings.calloutDismissed = true; persist(); renderCallout(); });

  const importButton = document.createElement('button');
  importButton.type = 'button'; importButton.className = 'nav-item'; importButton.innerHTML = '<span class="nav-icon">⇩</span> Restore backup';
  importButton.addEventListener('click', () => byId('importInput').click());
  byId('backupBtn').after(importButton);
  const profileImport = document.createElement('button');
  profileImport.type = 'button'; profileImport.className = 'button quiet full'; profileImport.style.marginTop = '8px'; profileImport.textContent = 'Restore from backup'; profileImport.addEventListener('click', () => byId('importInput').click());
  byId('profileBackupBtn').after(profileImport);

  byId('todayLabel').textContent = `GARAGE / ${formatDate(today, { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase()}`;
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredInstallPrompt = event; byId('installBtn').hidden = false; });
  byId('installBtn').addEventListener('click', async () => { if (!deferredInstallPrompt) return; deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice; deferredInstallPrompt = null; byId('installBtn').hidden = true; });
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('./sw.js').catch(() => {});
  render();
})();
