(() => {
'use strict';

/* ---------- Constants & state ---------- */
const STORAGE_KEY = 'workoutTracker.workouts';
const THEME_KEY = 'workoutTracker.theme';
const UNIT_KEY = 'workoutTracker.unit';
const TYPES = ['Push', 'Pull', 'Legs', 'Upper Body', 'Lower Body', 'Full Body', 'Cardio', 'Other'];
const MUSCLES = ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Legs', 'Glutes', 'Core', 'Cardio', 'Other'];
const LB_PER_KG = 2.20462;
const TITLES = { dashboard: 'Dashboard', workouts: 'Workouts', progress: 'Progress', records: 'Personal Records', settings: 'Settings' };

const state = {
  workouts: [],
  view: 'dashboard',
  draft: [],          // exercises of the workout being edited in the form
  editingId: null,    // workout id being edited (null = new)
  exEditId: null,     // exercise id being edited in the form
  progressEx: '',
  confirmCb: null
};
let unit = 'kg';

/* ---------- Helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const sum = (arr, fn) => arr.reduce((t, x) => t + fn(x), 0);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => (Math.round(n * 10) / 10).toLocaleString();
const pad2 = n => String(n).padStart(2, '0');
const dateKey = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return dateKey(d); };
const fmtDate = k => parseKey(k).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const isValidKey = k => /^\d{4}-\d{2}-\d{2}$/.test(k) && dateKey(parseKey(k)) === k;

function storeGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function storeSet(key, val) { try { localStorage.setItem(key, val); return true; } catch { return false; } }

function loadWorkouts() {
  try {
    const data = JSON.parse(storeGet(STORAGE_KEY));
    return Array.isArray(data) ? data.filter(w => w && Array.isArray(w.exercises) && w.date) : [];
  } catch { return []; }
}
function saveWorkouts() {
  if (!storeSet(STORAGE_KEY, JSON.stringify(state.workouts))) toast('Could not save data. Browser storage is blocked or full.', 'error');
}

/* ---------- Calculations ---------- */
const toUnit = (v, from) => (from === unit ? v : from === 'kg' ? v * LB_PER_KG : v / LB_PER_KG);
const exVolume = e => e.sets * e.reps * e.weight;              // in the exercise's own unit
const exVolumeU = e => toUnit(exVolume(e), e.unit);            // in the preferred unit

function workoutStats(w) {
  return {
    exercises: w.exercises.length,
    sets: sum(w.exercises, e => e.sets),
    reps: sum(w.exercises, e => e.sets * e.reps),
    volume: sum(w.exercises, exVolumeU)
  };
}
function overallStats() {
  const all = state.workouts.map(workoutStats);
  return {
    workouts: all.length,
    exercises: sum(all, s => s.exercises),
    sets: sum(all, s => s.sets),
    reps: sum(all, s => s.reps),
    volume: sum(all, s => s.volume)
  };
}
// Consecutive days with a workout, ending today (or yesterday if none today). Same-day duplicates count once.
function currentStreak() {
  const days = new Set(state.workouts.map(w => w.date));
  const today = dateKey(new Date());
  let cursor = days.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (days.has(cursor)) { streak++; cursor = addDays(cursor, -1); }
  return streak;
}
function currentWeekDates() {
  const now = new Date();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(monday); d.setDate(monday.getDate() + i); return dateKey(d); });
}
function exerciseKey(name) { return name.trim().toLowerCase(); }

/* ---------- Toasts & modals ---------- */
function toast(message, type = 'success') {
  const el = document.createElement('div');
  el.className = 'toast' + (type === 'error' ? ' error' : '');
  el.textContent = message;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}
const openModal = id => { $('#' + id).hidden = false; document.body.style.overflow = 'hidden'; };
function closeModals() {
  document.querySelectorAll('.modal').forEach(m => { m.hidden = true; });
  document.body.style.overflow = '';
  state.confirmCb = null;
}
function showConfirm({ title, message, okLabel = 'Delete', showCancel = true, onConfirm }) {
  $('#confirm-title').textContent = title;
  $('#confirm-msg').textContent = message;
  $('#confirm-ok').textContent = okLabel;
  $('#confirm-cancel').hidden = !showCancel;
  state.confirmCb = onConfirm || null;
  $('#modal-confirm').hidden = false;
  document.body.style.overflow = 'hidden';
}
// Closes only the confirm dialog, leaving any dialog beneath it open
function closeConfirm() {
  $('#modal-confirm').hidden = true;
  state.confirmCb = null;
  if (document.querySelectorAll('.modal:not([hidden])').length === 0) document.body.style.overflow = '';
}

/* ---------- Validation helpers ---------- */
function setError(id, msg) {
  const slot = document.querySelector(`[data-for="${id}"]`);
  if (slot) slot.textContent = msg;
  const input = document.getElementById(id);
  if (input) input.classList.add('invalid');
}
function clearErrors(root) {
  root.querySelectorAll('.err').forEach(e => { e.textContent = ''; });
  root.querySelectorAll('.invalid').forEach(i => i.classList.remove('invalid'));
}

/* ---------- Rendering: shared ---------- */
function emptyState() {
  return `<div class="card empty"><div class="empty-icon">🏋️</div><h2>No workouts yet</h2>
    <p>Start tracking your training to see your progress here.</p>
    <button class="btn primary" data-action="add-workout">Add Your First Workout</button></div>`;
}
function renderAll() {
  renderDashboard();
  renderWorkouts();
  renderProgress();
  renderRecords();
  renderSettings();
}

/* ---------- Dashboard ---------- */
function renderDashboard() {
  const body = $('#dashboard-body');
  if (!state.workouts.length) { body.innerHTML = emptyState(); return; }

  const s = overallStats();
  const week = currentWeekDates();
  const today = dateKey(new Date());
  const perDay = week.map(d => {
    const ws = state.workouts.filter(w => w.date === d);
    return { date: d, count: ws.length, volume: sum(ws, w => workoutStats(w).volume) };
  });
  const maxVol = Math.max(...perDay.map(d => d.volume), 0);
  const weekWorkouts = sum(perDay, d => d.count);
  const weekVolume = sum(perDay, d => d.volume);
  const weekMinutes = sum(state.workouts.filter(w => week.includes(w.date)), w => Number(w.duration) || 0);
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const bars = perDay.map((d, i) => {
    const h = maxVol ? Math.max(4, Math.round((d.volume / maxVol) * 130)) : 4;
    return `<div class="bar-col" title="${esc(dayNames[i])}: ${d.count} workout(s), ${fmt(d.volume)} ${unit}">
      <span class="bar-val">${d.count ? fmt(d.volume) : ''}</span>
      <div class="bar${d.count ? ' on' : ''}${d.date === today ? ' today-col' : ''}" style="height:${h}px"></div>
      <span class="bar-day">${dayNames[i]}</span></div>`;
  }).join('');

  const counts = new Map();
  state.workouts.forEach(w => w.exercises.forEach(e => {
    const k = exerciseKey(e.name);
    const entry = counts.get(k) || { name: e.name, count: 0 };
    entry.count++;
    counts.set(k, entry);
  }));
  const top = [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 5);
  const topMax = top[0] ? top[0].count : 1;

  const recent = sortWorkouts([...state.workouts], 'newest').slice(0, 5).map(w => {
    const st = workoutStats(w);
    return `<div class="row-item"><div class="info"><b>${esc(w.name)}</b>
      <span class="muted">${fmtDate(w.date)} · ${st.exercises} exercises · ${fmt(st.volume)} ${unit}</span></div>
      <button class="btn sm" data-action="view" data-id="${esc(w.id)}">View</button></div>`;
  }).join('');

  $('#dashboard-body').innerHTML = `
    <div class="stats">
      <div class="card stat"><div class="label">Total workouts</div><div class="value">${fmt(s.workouts)}</div></div>
      <div class="card stat"><div class="label">Total exercises</div><div class="value">${fmt(s.exercises)}</div></div>
      <div class="card stat"><div class="label">Total sets</div><div class="value">${fmt(s.sets)}</div></div>
      <div class="card stat"><div class="label">Total reps</div><div class="value">${fmt(s.reps)}</div></div>
      <div class="card stat"><div class="label">Total weight lifted</div><div class="value">${fmt(s.volume)} <small>${unit}</small></div></div>
      <div class="card stat hot"><div class="label">Current streak</div><div class="value">${currentStreak()} <small>${currentStreak() === 1 ? 'day' : 'days'}</small></div></div>
    </div>
    <div class="grid2">
      <article class="card"><h2>This week</h2>
        <div class="summary-line">
          <div><b>${weekWorkouts}</b><span class="muted">workouts</span></div>
          <div><b>${fmt(weekVolume)} ${unit}</b><span class="muted">volume</span></div>
          <div><b>${fmt(weekMinutes)} min</b><span class="muted">training time</span></div>
        </div>
        <div class="week-chart">${bars}</div>
      </article>
      <article class="card"><h2>Most performed exercises</h2>
        <ul class="rank">${top.map(t => `<li><div class="meta"><span>${esc(t.name)}</span><b>${t.count}×</b></div>
          <div class="meter"><span style="width:${Math.round((t.count / topMax) * 100)}%"></span></div></li>`).join('')}</ul>
      </article>
    </div>
    <article class="card"><h2>Recent workouts</h2>${recent}</article>`;
}

/* ---------- Workout list ---------- */
function sortWorkouts(list, mode) {
  const vol = w => workoutStats(w).volume;
  const byDate = (a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0);
  const sorters = {
    newest: byDate,
    oldest: (a, b) => -byDate(a, b),
    high: (a, b) => vol(b) - vol(a),
    low: (a, b) => vol(a) - vol(b)
  };
  return list.sort(sorters[mode] || byDate);
}
function filteredWorkouts() {
  const q = $('#search').value.trim().toLowerCase();
  const type = $('#f-type').value;
  const muscle = $('#f-muscle').value;
  const date = $('#f-date').value;
  const list = state.workouts.filter(w => {
    if (type && w.type !== type) return false;
    if (date && w.date !== date) return false;
    if (muscle && !w.exercises.some(e => e.muscle === muscle)) return false;
    if (q) {
      const hay = [w.name, ...w.exercises.flatMap(e => [e.name, e.muscle])].join('\n').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  return sortWorkouts(list, $('#f-sort').value);
}
function renderWorkouts() {
  const box = $('#workout-list');
  if (!state.workouts.length) { box.innerHTML = emptyState(); return; }
  const list = filteredWorkouts();
  if (!list.length) {
    box.innerHTML = `<div class="card empty"><div class="empty-icon">🔍</div><h2>No matching workouts</h2>
      <p>Try a different search or reset the filters.</p><button class="btn" data-action="clear-filters">Reset filters</button></div>`;
    return;
  }
  box.innerHTML = `<div class="cards">${list.map(w => {
    const st = workoutStats(w);
    return `<article class="card workout-card">
      <header><div><h3>${esc(w.name)}</h3><span class="muted">${fmtDate(w.date)}</span></div><span class="badge">${esc(w.type)}</span></header>
      <dl class="mini">
        <div><dt>Duration</dt><dd>${Number(w.duration) ? w.duration + ' min' : '—'}</dd></div>
        <div><dt>Exercises</dt><dd>${st.exercises}</dd></div>
        <div><dt>Total sets</dt><dd>${st.sets}</dd></div>
        <div><dt>Total volume</dt><dd>${fmt(st.volume)} ${unit}</dd></div>
      </dl>
      ${w.notes ? `<p class="note">${esc(w.notes)}</p>` : ''}
      <div class="card-actions">
        <button class="btn sm" data-action="view" data-id="${esc(w.id)}">View</button>
        <button class="btn sm" data-action="edit" data-id="${esc(w.id)}">Edit</button>
        <button class="btn sm danger" data-action="delete" data-id="${esc(w.id)}">Delete</button>
      </div></article>`;
  }).join('')}</div>`;
}

/* ---------- Workout details ---------- */
function openDetails(id) {
  const w = state.workouts.find(x => x.id === id);
  if (!w) return;
  const st = workoutStats(w);
  const rows = w.exercises.map(e => `<tr><td><b>${esc(e.name)}</b></td><td>${esc(e.muscle)}</td><td>${e.sets}</td><td>${e.reps}</td>
    <td>${fmt(e.weight)} ${e.unit}</td><td>${fmt(exVolume(e))} ${e.unit}</td><td>${e.rest ? e.rest + ' s' : '—'}</td><td>${esc(e.notes) || '—'}</td></tr>`).join('');
  $('#view-body').innerHTML = `
    <h2>${esc(w.name)} <span class="badge">${esc(w.type)}</span></h2>
    <dl class="detail-meta">
      <div><dt>Date</dt><dd>${fmtDate(w.date)}</dd></div>
      <div><dt>Duration</dt><dd>${Number(w.duration) ? w.duration + ' min' : '—'}</dd></div>
      <div class="span2"><dt>Notes</dt><dd>${esc(w.notes) || '—'}</dd></div>
    </dl>
    <div class="table-wrap"><table>
      <thead><tr><th>Exercise</th><th>Muscle group</th><th>Sets</th><th>Reps</th><th>Weight</th><th>Volume</th><th>Rest</th><th>Notes</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div class="totals">
      <div><b>${st.exercises}</b><span class="muted">Total exercises</span></div>
      <div><b>${st.sets}</b><span class="muted">Total sets</span></div>
      <div><b>${st.reps}</b><span class="muted">Total reps</span></div>
      <div><b>${fmt(st.volume)} ${unit}</b><span class="muted">Total volume</span></div>
    </div>
    <div class="dialog-foot"><button class="btn" data-action="edit" data-id="${esc(w.id)}">Edit</button>
      <button class="btn ghost" data-action="close-modal">Close</button></div>`;
  openModal('modal-view');
}

/* ---------- Workout form ---------- */
function fillSelect(el, items, placeholder) {
  el.innerHTML = (placeholder ? `<option value="">${placeholder}</option>` : '') + items.map(i => `<option value="${esc(i)}">${esc(i)}</option>`).join('');
}
function resetExerciseForm() {
  state.exEditId = null;
  ['ex-name', 'ex-sets', 'ex-reps', 'ex-weight', 'ex-rest', 'ex-notes'].forEach(id => { $('#' + id).value = ''; });
  $('#ex-muscle').value = MUSCLES[0];
  $('#ex-unit').value = unit;
  $('#ex-submit').textContent = 'Add exercise';
  $('#ex-cancel').hidden = true;
}
function openWorkoutForm(id) {
  const w = id ? state.workouts.find(x => x.id === id) : null;
  state.editingId = w ? w.id : null;
  state.draft = w ? w.exercises.map(e => ({ ...e })) : [];
  $('#wf-title').textContent = w ? 'Edit workout' : 'Add workout';
  $('#w-name').value = w ? w.name : '';
  $('#w-date').value = w ? w.date : dateKey(new Date());
  $('#w-type').value = w ? w.type : TYPES[0];
  $('#w-duration').value = w && w.duration ? w.duration : '';
  $('#w-notes').value = w ? w.notes || '' : '';
  clearErrors($('#workout-form'));
  resetExerciseForm();
  renderDraft();
  $('#modal-view').hidden = true;
  openModal('modal-workout');
  $('#w-name').focus();
}
function renderDraft() {
  const box = $('#ex-list');
  if (!state.draft.length) { box.innerHTML = '<p class="muted">No exercises added yet.</p>'; return; }
  box.innerHTML = state.draft.map(e => `<div class="ex-item"><div class="info"><b>${esc(e.name)}</b>
    <span class="muted">${esc(e.muscle)} · ${e.sets} × ${e.reps} · ${fmt(e.weight)} ${e.unit} · volume ${fmt(exVolume(e))} ${e.unit}</span></div>
    <div class="acts"><button type="button" class="btn sm" data-action="ex-edit" data-id="${esc(e.id)}">Edit</button>
    <button type="button" class="btn sm danger" data-action="ex-del" data-id="${esc(e.id)}">Delete</button></div></div>`).join('');
}
function saveExercise() {
  clearErrors($('#ex-fields'));
  let ok = true;
  const name = $('#ex-name').value.trim();
  const sets = Number($('#ex-sets').value);
  const reps = Number($('#ex-reps').value);
  const weightRaw = $('#ex-weight').value.trim();
  const weight = weightRaw === '' ? 0 : Number(weightRaw);
  const restRaw = $('#ex-rest').value.trim();
  const rest = restRaw === '' ? 0 : Number(restRaw);
  if (!name) { setError('ex-name', 'Exercise name is required.'); ok = false; }
  if (!Number.isInteger(sets) || sets <= 0) { setError('ex-sets', 'Sets must be a whole number above 0.'); ok = false; }
  if (!Number.isInteger(reps) || reps <= 0) { setError('ex-reps', 'Reps must be a whole number above 0.'); ok = false; }
  if (!Number.isFinite(weight) || weight < 0) { setError('ex-weight', 'Weight cannot be negative.'); ok = false; }
  if (!Number.isFinite(rest) || rest < 0) { setError('ex-rest', 'Rest time cannot be negative.'); ok = false; }
  if (!ok) return;

  const exercise = {
    id: state.exEditId || uid(), name, muscle: $('#ex-muscle').value, sets, reps, weight,
    unit: $('#ex-unit').value, rest, notes: $('#ex-notes').value.trim()
  };
  if (state.exEditId) {
    state.draft = state.draft.map(e => (e.id === state.exEditId ? exercise : e));
    toast('Exercise updated');
  } else {
    state.draft.push(exercise);
    toast('Exercise added');
  }
  resetExerciseForm();
  renderDraft();
  $('#ex-name').focus();
}
function editDraftExercise(id) {
  const e = state.draft.find(x => x.id === id);
  if (!e) return;
  state.exEditId = id;
  $('#ex-name').value = e.name;
  $('#ex-muscle').value = e.muscle;
  $('#ex-sets').value = e.sets;
  $('#ex-reps').value = e.reps;
  $('#ex-weight').value = e.weight;
  $('#ex-unit').value = e.unit;
  $('#ex-rest').value = e.rest || '';
  $('#ex-notes').value = e.notes || '';
  $('#ex-submit').textContent = 'Update exercise';
  $('#ex-cancel').hidden = false;
  clearErrors($('#ex-fields'));
  $('#ex-name').focus();
}
function deleteDraftExercise(id) {
  state.draft = state.draft.filter(e => e.id !== id);
  if (state.exEditId === id) resetExerciseForm();
  renderDraft();
  toast('Exercise deleted');
}
function saveWorkout(event) {
  event.preventDefault();
  const form = $('#workout-form');
  clearErrors(form);
  let ok = true;
  const name = $('#w-name').value.trim();
  const date = $('#w-date').value;
  const durationRaw = $('#w-duration').value.trim();
  const duration = durationRaw === '' ? 0 : Number(durationRaw);
  if (!name) { setError('w-name', 'Workout name is required.'); ok = false; }
  if (!date) { setError('w-date', 'Date is required.'); ok = false; }
  else if (!isValidKey(date)) { setError('w-date', 'Enter a valid date.'); ok = false; }
  if (!Number.isFinite(duration) || duration < 0) { setError('w-duration', 'Duration cannot be negative.'); ok = false; }
  if ($('#ex-name').value.trim() && !state.exEditId) {
    setError('ex-name', 'Click "Add exercise" to include this exercise, or clear the field.'); ok = false;
  } else if (state.exEditId) {
    setError('ex-name', 'Finish updating this exercise or cancel the edit first.'); ok = false;
  } else if (!state.draft.length) {
    setError('ex-name', 'Add at least one exercise to this workout.'); ok = false;
  }
  if (!ok) { const bad = form.querySelector('.invalid'); if (bad) bad.focus(); return; }

  const data = { name, date, type: $('#w-type').value, duration, notes: $('#w-notes').value.trim(), exercises: state.draft.map(e => ({ ...e })) };
  if (state.editingId) {
    state.workouts = state.workouts.map(w => (w.id === state.editingId ? { ...w, ...data } : w));
    toast('Workout updated successfully');
  } else {
    state.workouts.push({ id: uid(), createdAt: Date.now(), ...data });
    toast('Workout added successfully');
  }
  saveWorkouts();
  closeModals();
  renderAll();
}
function deleteWorkout(id) {
  showConfirm({
    title: 'Delete workout',
    message: 'Are you sure you want to delete this workout?',
    okLabel: 'Delete',
    onConfirm: () => {
      state.workouts = state.workouts.filter(w => w.id !== id);
      saveWorkouts();
      closeModals();
      renderAll();
      toast('Workout deleted successfully');
    }
  });
}

/* ---------- Progress ---------- */
function exerciseNames() {
  const map = new Map();
  state.workouts.forEach(w => w.exercises.forEach(e => { if (!map.has(exerciseKey(e.name))) map.set(exerciseKey(e.name), e.name); }));
  return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
}
function exerciseHistory(key) {
  const rows = [];
  state.workouts.forEach(w => w.exercises.forEach(e => {
    if (exerciseKey(e.name) === key) rows.push({ date: w.date, weight: toUnit(e.weight, e.unit), volume: exVolumeU(e) });
  }));
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}
let progressPoints = [];
function renderProgress() {
  const body = $('#progress-body');
  const names = exerciseNames();
  progressPoints = [];
  if (!names.length) { body.innerHTML = emptyState(); return; }
  if (!names.some(([k]) => k === state.progressEx)) state.progressEx = names[0][0];

  const hist = exerciseHistory(state.progressEx);
  const best = Math.max(...hist.map(h => h.weight));
  const avg = sum(hist, h => h.weight) / hist.length;
  const totalVol = sum(hist, h => h.volume);
  const last = hist[hist.length - 1].date;

  // One point per date: the heaviest weight lifted that day
  const byDate = new Map();
  hist.forEach(h => byDate.set(h.date, Math.max(byDate.get(h.date) || 0, h.weight)));
  progressPoints = [...byDate.entries()].map(([date, value]) => ({ date, value }));

  body.innerHTML = `
    <label class="select-row">Exercise<select id="progress-select">
      ${names.map(([k, n]) => `<option value="${esc(k)}"${k === state.progressEx ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
    <div class="stats">
      <div class="card stat"><div class="label">Times performed</div><div class="value">${hist.length}</div></div>
      <div class="card stat"><div class="label">Best weight</div><div class="value">${fmt(best)} <small>${unit}</small></div></div>
      <div class="card stat"><div class="label">Average weight</div><div class="value">${fmt(avg)} <small>${unit}</small></div></div>
      <div class="card stat"><div class="label">Total volume</div><div class="value">${fmt(totalVol)} <small>${unit}</small></div></div>
      <div class="card stat"><div class="label">Last performed</div><div class="value" style="font-size:1.1rem">${fmtDate(last)}</div></div>
    </div>
    <article class="card"><h2>Weight progression (${unit})</h2><canvas id="progress-canvas"></canvas></article>`;
  drawProgressChart();
}
function drawProgressChart() {
  const canvas = $('#progress-canvas');
  if (!canvas || !progressPoints.length) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const c = canvas.getContext('2d');
  c.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement);
  const colAccent = css.getPropertyValue('--accent').trim(), colLine = css.getPropertyValue('--line').trim(), colMuted = css.getPropertyValue('--muted').trim();
  const L = 48, R = 18, T = 16, B = 30;
  const values = progressPoints.map(p => p.value);
  let min = Math.min(...values), max = Math.max(...values);
  if (min === max) { min = Math.max(0, min - 5); max = max + 5; }
  const span = max - min; min = Math.max(0, min - span * 0.1); max += span * 0.1;
  const x = i => (progressPoints.length === 1 ? L + (w - L - R) / 2 : L + (i * (w - L - R)) / (progressPoints.length - 1));
  const y = v => T + (1 - (v - min) / (max - min)) * (h - T - B);

  c.font = '12px system-ui, sans-serif';
  c.textBaseline = 'middle';
  c.strokeStyle = colLine; c.fillStyle = colMuted; c.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const v = min + ((max - min) * i) / 4, yy = y(v);
    c.beginPath(); c.moveTo(L, yy); c.lineTo(w - R, yy); c.stroke();
    c.textAlign = 'right'; c.fillText(fmt(v), L - 8, yy);
  }
  c.textAlign = 'center'; c.textBaseline = 'top';
  const labelIdx = progressPoints.length === 1 ? [0] : [0, progressPoints.length - 1];
  labelIdx.forEach(i => {
    const d = parseKey(progressPoints[i].date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    c.fillText(d, Math.min(Math.max(x(i), L + 18), w - R - 18), h - B + 8);
  });
  c.strokeStyle = colAccent; c.lineWidth = 2.5; c.lineJoin = 'round';
  c.beginPath();
  progressPoints.forEach((p, i) => (i ? c.lineTo(x(i), y(p.value)) : c.moveTo(x(i), y(p.value))));
  c.stroke();
  c.fillStyle = colAccent;
  progressPoints.forEach((p, i) => { c.beginPath(); c.arc(x(i), y(p.value), 4, 0, Math.PI * 2); c.fill(); });
}

/* ---------- Personal records ---------- */
function renderRecords() {
  const body = $('#records-body');
  const map = new Map();
  state.workouts.forEach(w => w.exercises.forEach(e => {
    const k = exerciseKey(e.name);
    const rec = map.get(k) || { name: e.name, weight: 0, reps: 0, volume: 0 };
    rec.weight = Math.max(rec.weight, toUnit(e.weight, e.unit));
    rec.reps = Math.max(rec.reps, e.reps);
    rec.volume = Math.max(rec.volume, toUnit(e.reps * e.weight, e.unit)); // single set: reps × weight
    map.set(k, rec);
  }));
  if (!map.size) { body.innerHTML = emptyState(); return; }
  const recs = [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  body.innerHTML = `<div class="records">${recs.map(r => `<article class="card"><h3>${esc(r.name)} <span class="badge hot">PR</span></h3>
    <dl><div><dt>Best weight</dt><dd>${fmt(r.weight)} ${unit}</dd></div>
    <div><dt>Best reps</dt><dd>${r.reps}</dd></div>
    <div><dt>Best set volume</dt><dd>${fmt(r.volume)} ${unit}</dd></div></dl></article>`).join('')}</div>`;
}

/* ---------- Settings, theme ---------- */
function renderSettings() {
  $('#set-unit').value = unit;
  $('#set-theme-btn').textContent = document.documentElement.dataset.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
}
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  storeSet(THEME_KEY, theme);
  renderSettings();
  drawProgressChart();
}

/* ---------- CSV export ---------- */
const CSV_HEADERS = ['Workout Name', 'Date', 'Workout Type', 'Exercise', 'Muscle Group', 'Sets', 'Reps', 'Weight', 'Unit', 'Rest', 'Volume', 'Duration', 'Notes', 'Exercise Notes'];
const csvCell = v => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function exportCSV() {
  if (!state.workouts.length) { toast('There are no workouts to export yet.', 'error'); return; }
  const lines = [CSV_HEADERS.join(',')];
  sortWorkouts([...state.workouts], 'oldest').forEach(w => w.exercises.forEach(e => {
    lines.push([w.name, w.date, w.type, e.name, e.muscle, e.sets, e.reps, e.weight, e.unit, e.rest, exVolume(e), w.duration, w.notes, e.notes].map(csvCell).join(','));
  }));
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'workout-data.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Data exported');
}

/* ---------- CSV import ---------- */
function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQuotes = false; }
      else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}
function importCSV(text) {
  const rows = parseCSV(text.replace(/^\ufeff/, ''));
  const fail = msg => showConfirm({ title: 'Import failed', message: msg, okLabel: 'OK', showCancel: false });
  if (rows.length < 2) { fail('The file is empty or has no data rows. Export a file from this app to see the expected format.'); return; }

  const header = rows[0].map(h => h.trim().toLowerCase());
  const required = ['workout name', 'date', 'workout type', 'exercise', 'muscle group', 'sets', 'reps', 'weight', 'unit'];
  const missing = required.filter(h => !header.includes(h));
  if (missing.length) { fail(`Missing required column(s): ${missing.join(', ')}.`); return; }
  const col = name => header.indexOf(name);

  const errors = [];
  const groups = new Map();
  rows.slice(1).forEach((r, idx) => {
    const line = idx + 2;
    const get = name => (col(name) >= 0 ? (r[col(name)] || '').trim() : '');
    const problems = [];
    const name = get('workout name'), date = get('date'), exName = get('exercise');
    const sets = Number(get('sets')), reps = Number(get('reps'));
    const weightRaw = get('weight'), weight = weightRaw === '' ? 0 : Number(weightRaw);
    const rest = get('rest') === '' ? 0 : Number(get('rest'));
    const duration = get('duration') === '' ? 0 : Number(get('duration'));
    const u = get('unit').toLowerCase();
    if (!name) problems.push('workout name is empty');
    if (!isValidKey(date)) problems.push('date must be YYYY-MM-DD');
    if (!exName) problems.push('exercise name is empty');
    if (!Number.isInteger(sets) || sets <= 0) problems.push('sets must be a whole number above 0');
    if (!Number.isInteger(reps) || reps <= 0) problems.push('reps must be a whole number above 0');
    if (!Number.isFinite(weight) || weight < 0) problems.push('weight cannot be negative');
    if (u !== 'kg' && u !== 'lb') problems.push('unit must be kg or lb');
    if (!Number.isFinite(rest) || rest < 0) problems.push('rest cannot be negative');
    if (!Number.isFinite(duration) || duration < 0) problems.push('duration cannot be negative');
    if (problems.length) { errors.push(`Row ${line}: ${problems.join('; ')}.`); return; }

    const type = TYPES.find(t => t.toLowerCase() === get('workout type').toLowerCase()) || 'Other';
    const muscle = MUSCLES.find(m => m.toLowerCase() === get('muscle group').toLowerCase()) || 'Other';
    const notes = get('notes');
    const gKey = [name, date, type, duration, notes].join('\u0001');
    if (!groups.has(gKey)) groups.set(gKey, { id: uid(), createdAt: Date.now(), name, date, type, duration, notes, exercises: [] });
    groups.get(gKey).exercises.push({ id: uid(), name: exName, muscle, sets, reps, weight, unit: u, rest, notes: get('exercise notes') });
  });

  if (errors.length) {
    const shown = errors.slice(0, 5).join(' ');
    fail(`No data was imported. ${shown}${errors.length > 5 ? ` …and ${errors.length - 5} more problem row(s).` : ''}`);
    return;
  }
  state.workouts.push(...groups.values());
  saveWorkouts();
  renderAll();
  toast(`Data imported (${groups.size} workout${groups.size === 1 ? '' : 's'})`);
}

/* ---------- Navigation ---------- */
function showView(view) {
  state.view = view;
  Object.keys(TITLES).forEach(v => { $('#view-' + v).hidden = v !== view; });
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $('#page-title').textContent = TITLES[view];
  window.scrollTo(0, 0);
  renderAll();
}

/* ---------- Events ---------- */
const actions = {
  nav: el => showView(el.dataset.view),
  'add-workout': () => openWorkoutForm(null),
  edit: el => openWorkoutForm(el.dataset.id),
  view: el => openDetails(el.dataset.id),
  delete: el => deleteWorkout(el.dataset.id),
  theme: () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'),
  export: exportCSV,
  import: () => $('#import-file').click(),
  'clear-all': () => {
    if (!state.workouts.length) { toast('There is no data to clear.', 'error'); return; }
    showConfirm({
      title: 'Clear all data',
      message: 'This permanently deletes every saved workout. This cannot be undone.',
      okLabel: 'Delete everything',
      onConfirm: () => { state.workouts = []; saveWorkouts(); renderAll(); toast('All workout data cleared'); }
    });
  },
  'clear-filters': () => {
    ['search', 'f-type', 'f-muscle', 'f-date'].forEach(id => { $('#' + id).value = ''; });
    $('#f-sort').value = 'newest';
    renderWorkouts();
  },
  'close-modal': closeModals,
  'ex-save': saveExercise,
  'ex-cancel': () => { resetExerciseForm(); clearErrors($('#ex-fields')); },
  'ex-edit': el => editDraftExercise(el.dataset.id),
  'ex-del': el => deleteDraftExercise(el.dataset.id),
  'confirm-cancel': closeConfirm,
  'confirm-ok': () => { const cb = state.confirmCb; closeConfirm(); if (cb) cb(); }
};

function bindEvents() {
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (el && actions[el.dataset.action]) { actions[el.dataset.action](el); return; }
    if (e.target.classList.contains('modal')) { // click on backdrop
      if (e.target.id === 'modal-confirm') closeConfirm(); else closeModals();
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!$('#modal-confirm').hidden) closeConfirm(); else closeModals();
    }
  });
  $('#workout-form').addEventListener('submit', saveWorkout);
  // Enter inside exercise fields adds the exercise instead of submitting the whole workout
  $('#ex-fields').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); saveExercise(); }
  });
  ['search', 'f-type', 'f-muscle', 'f-date', 'f-sort'].forEach(id => {
    $('#' + id).addEventListener('input', renderWorkouts);
    $('#' + id).addEventListener('change', renderWorkouts);
  });
  $('#set-unit').addEventListener('change', e => {
    unit = e.target.value;
    storeSet(UNIT_KEY, unit);
    $('#ex-unit').value = unit;
    renderAll();
  });
  document.addEventListener('change', e => {
    if (e.target.id === 'progress-select') { state.progressEx = e.target.value; renderProgress(); }
  });
  $('#import-file').addEventListener('change', e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => importCSV(String(reader.result));
    reader.onerror = () => toast('Could not read that file.', 'error');
    reader.readAsText(file);
  });
  window.addEventListener('resize', () => { if (state.view === 'progress') drawProgressChart(); });
}

/* ---------- Init ---------- */
function init() {
  const savedUnit = storeGet(UNIT_KEY);
  unit = savedUnit === 'lb' ? 'lb' : 'kg';
  const savedTheme = storeGet(THEME_KEY);
  document.documentElement.dataset.theme = savedTheme || (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  state.workouts = loadWorkouts();

  fillSelect($('#w-type'), TYPES);
  fillSelect($('#ex-muscle'), MUSCLES);
  fillSelect($('#f-type'), TYPES, 'All types');
  fillSelect($('#f-muscle'), MUSCLES, 'All muscle groups');
  $('#ex-unit').value = unit;

  bindEvents();
  showView('dashboard');
}
init();
})();
