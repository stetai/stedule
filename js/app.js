/**
 * app.js — UI Controller
 */

import {
  openFile, writeFile, reloadFile, hasFileOpen, getFileName, canWriteInPlace
} from './storage.js';

import {
  parseICS, serializeICS, createEvent,
  eventsOnDay,
  isSameDay, isToday, startOfWeek,
  toDateInputValue, toTimeInputValue, combineDateAndTime,
} from './calendar.js';

import { getAdjWeekday } from './calendar.js';

// ============================================================
// APPLICATION STATE
// ============================================================

let events      = [];           // All parsed event objects
let currentDate = new Date();   // The date the calendar is currently showing
let currentView = 'week';      // 'month' | 'week' | 'day' (week/day = future work)
let editingId   = null;         // ID of the event currently in the modal, or null

// ============================================================
// DOM REFERENCES
// ============================================================

const $ = id => document.getElementById(id); // tiny shorthand

const elGrid       = $('calendar-grid');
const elPeriod     = $('current-period');
const elStatus     = $('status-bar');
const elOverlay    = $('modal-overlay');
const elModalTitle = $('modal-title');
const elTitle      = $('event-title');
const elDate       = $('event-date');
const elWeekdays   = $('weekday-headers');
const elStartTime  = $('event-start-time');
const elEndTime    = $('event-end-time');
const elRepeat     = $('event-repeat');
const elDesc       = $('event-description');
const elColor      = $('event-color');
const elDeleteBtn  = $('modal-delete');

const elRepeatInterval = $('repeat-interval');
const elRepeatEndType  = $('repeat-end-type');
const elRepeatCount    = $('repeat-count');
const elRepeatUntil    = $('repeat-until');
const elRepeatWeekdays = document.getElementById('repeat-weekdays');

// ============================================================
// INITIALIZATION
// ============================================================


document.addEventListener('DOMContentLoaded', init);

function init() {
  $('btn-open').addEventListener('click', handleOpenFile);
  $('btn-prev').addEventListener('click', () => navigate(-1));
  $('btn-next').addEventListener('click', () => navigate(+1));
  $('btn-today').addEventListener('click', goToToday);

  $('view-switcher').addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-view');
    if (!btn) return; // clicked the container, not a button
    switchView(btn.dataset.view);
  });

  // Modal buttons
  $('modal-cancel').addEventListener('click', closeModal);
  $('modal-close').addEventListener('click',  closeModal);
  $('modal-save').addEventListener('click',   handleModalSave);
  $('modal-delete').addEventListener('click', handleModalDelete);

  // Close modal when clicking the dark overlay (outside the modal box)
  elOverlay.addEventListener('click', (e) => {
    if (e.target === elOverlay) closeModal(); 
    // only if the overlay itself was clicked
  });

  // Keyboard: Escape closes the modal.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  elRepeat.addEventListener('change', updateRepeatUI);
  elRepeatEndType.addEventListener('change', updateRepeatUI);

  renderCalendar();
  renderWeekdayHeader("Mon");
  setStatus('No file open. Click "Open .ics file" to begin.');
}

// ============================================================
// FILE HANDLING
// ============================================================

async function handleOpenFile() {
  try {
    const raw = await openFile();
    events = parseICS(raw);
    renderCalendar();
    const saveNote = canWriteInPlace() ? '' : ' · Firefox: saves will download a new file';
    setStatus(`Loaded: ${getFileName()} — ${events.length} event(s)${saveNote}`, 'saved');
  } catch (err) {
    // The File System Access API throws an AbortError when the user
    // cancels the picker. This is not a real error — don't show an alert.
    if (err.name === 'AbortError') return;
    console.error('Open failed:', err);
    setStatus(`Error opening file: ${err.message}`, 'error');
  }
}

async function save() {
  if (!hasFileOpen()) return;

  setStatus('Saving…', 'saving');
  try {
    await writeFile(serializeICS(events));
    setStatus(`Saved: ${getFileName()}`, 'saved');
  } catch (err) {
    console.error('Save failed:', err);
    setStatus(`Save failed: ${err.message}`, 'error');
  }
}

// ============================================================
// NAVIGATION
// ============================================================

function navigate(direction) {
  if (currentView === 'month') {
    currentDate.setMonth(currentDate.getMonth() + direction);
  } else if (currentView === 'week') {
    currentDate.setDate(currentDate.getDate() + 7 * direction);
  } else if (currentView === 'day') {
    currentDate.setDate(currentDate.getDate() + direction);
  }
  renderCalendar();
}

function goToToday() {
  currentDate = new Date();
  renderCalendar();
}

function switchView(view) {
  currentView = view;

  // Update the active button styles
  document.querySelectorAll('.btn-view').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });

  renderCalendar();
}

// ============================================================
// RENDERING
// ============================================================

function renderCalendar() {
  // Clear previous render
  elGrid.innerHTML = '';

  // headers for week/days
  const weekdayHeaders = document.getElementById('weekday-headers');
  weekdayHeaders.style.display = currentView === 'month' ? '' : 'none';

  elGrid.className = `calendar-grid view-${currentView}`;

  // Update the period label in the header
  if (currentView === 'month') {
    elPeriod.textContent = currentDate.toLocaleString('default', {
      month: 'long', year: 'numeric',
    });
    renderMonthView();
  } else if (currentView === 'week') {
    elPeriod.textContent = weekRangeLabel(currentDate);
    renderWeekView();
  } else if (currentView === 'day') {
    elPeriod.textContent = currentDate.toLocaleDateString('default', {
      weekday: 'long', month: 'long', day: 'numeric',
    });
    renderDayView();
  }
}

function  renderWeekdayHeader(startDay = "Mon") {
  let days;
  if (startDay === "Mon") {
    days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  } else {
    days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  }

  elWeekdays.innerHTML = '';

  for (const d of days) {
    const el = document.createElement('div');
    el.className = 'weekday-label';
    el.textContent = d;
    elWeekdays.appendChild(el);
  }
}

// --- Month view ---

function renderMonthView() {
  const year  = currentDate.getFullYear();
  const month = currentDate.getMonth(); // 0=Jan … 11=Dec

  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month + 1, 0);

  // Fill leading empty cells so day 1 falls on the correct column
  const weekday = getAdjWeekday(firstDay);

  for (let i = 0; i < weekday; i++) {
    const empty = document.createElement('div');
    empty.className = 'day-cell empty';
    elGrid.appendChild(empty);
  }

  for (let d = 1; d <= lastDay.getDate(); d++) {
    const date      = new Date(year, month, d);
    const dayEvents = eventsOnDay(events, date);
    elGrid.appendChild(createDayCell(date, dayEvents));
  }
}

// --- Week view (scaffold — expand for full implementation) ---

// If you change HOUR_H, update BOTH the constant here AND --hour-h in CSS.

const HOUR_H = 32; // pixels per hour. Must match --hour-h in style.css

function renderWeekView() {
  elGrid.classList.remove('view-day');
  elGrid.classList.add('view-week');

  const monday = startOfWeek(currentDate);

  // -- Outer wrapper ---
  // .week-view is a flex colum that fills the grid container
  const view = document.createElement('div');
  view.className = 'week-view';

  // -- Date header row ---
  const headerRow = document.createElement('div');
  headerRow.className = 'week-header-row';

  const gutterSpacer = document.createElement('div');
  gutterSpacer.className = 'week-gutter-spacer';
  headerRow.appendChild(gutterSpacer);

  for (let i = 0; i < 7; i++) {
    const day = new Date(monday);
    day.setDate(day.getDate() + i);

    const hdr = document.createElement('div');
    hdr.className = 'week-day-header' + (isToday(day) ? ' today' : '');
    
    const name = document.createElement('span');
    name.className = 'wdh-name';
    name.textContent = day.toLocaleDateString('default', { weekday: 'short'});

    const num = document.createElement('span');
    num.className = 'wdh-num';
    num.textContent = day.getDate();
 
    hdr.appendChild(name);
    hdr.appendChild(num);
    headerRow.appendChild(hdr);
  }
  view.appendChild(headerRow);

  // -- scrollable body ---

  const scroll = document.createElement('div');
  scroll.className = 'week-scroll';

  const body = document.createElement('div');
  body.className = 'week-body';

  // -- Time gutter ---

  const gutter = document.createElement('div');
  gutter.className = 'week-time-gutter';
  for (let h = 0; h < 24; h++) {
    const label = document.createElement('div');
    label.className = 'week-hour-label';
    label.textContent = h === 0 ? '' : h;
    gutter.appendChild(label);
  }
  body.appendChild(gutter);

  // -- Day columns ---

  const daysWrap = document.createElement('div');
  daysWrap.className = 'week-days';
 
  for (let i = 0; i < 7; i++) {
    const day = new Date(monday);
    day.setDate(day.getDate() + i);
    const dayEvents = eventsOnDay(events, day);
 
    const col = document.createElement('div');
    col.className = 'week-day-col' + (isToday(day) ? ' today' : '');
 
    // ── Hour grid lines ──────────────────────────────────────────
    // Purely visual.
    for (let h = 0; h < 24; h++) {
      const row = document.createElement('div');
      row.className = 'week-hour-row';
      // Half-hour tick: a lighter line at the midpoint of each hour cell
      const half = document.createElement('div');
      half.className = 'week-half-tick';
      row.appendChild(half);
      col.appendChild(row);
    }
    
    // ── Positioned events ────────────────────────────────────────
    // For each event, calculate top and height in pixels from the
    // fractional hour values of start/end time.
    for (const ev of dayEvents) {
      if (ev.allDay) continue; // all-day events stay in month-chip style
 
      const startH   = ev.start.getHours() + ev.start.getMinutes() / 60;
      const endDate  = ev.end ?? new Date(ev.start.getTime() + 60 * 60 * 1000);
      const endH     = endDate.getHours() + endDate.getMinutes() / 60;
      // Clamp to a minimum visual height so short events are still clickable
      const duration = Math.max(endH - startH, 0.25);
 
      const chip = document.createElement('div');
      chip.className = 'week-event';
      chip.style.top        = `${startH * HOUR_H}px`;
      chip.style.height     = `${duration * HOUR_H}px`;
      chip.style.background = ev.color;
 
      // Show title + time if there is enough vertical space
      const titleEl = document.createElement('span');
      titleEl.className = 'week-event-title';
      titleEl.textContent = ev.title;
 
      const timeEl = document.createElement('span');
      timeEl.className = 'week-event-time';
      timeEl.textContent = `${formatTime(ev.start)} - ${formatTime(endDate)}`;
 
      chip.appendChild(titleEl);
      chip.appendChild(timeEl);
 
      chip.addEventListener('click', (e) => {
        e.stopPropagation(); // prevent bubbling to the column click handler
        openEditEventModal(ev);
      });
 
      col.appendChild(chip);
    }
 
    // ── Click-to-add ─────────────────────────────────────────────
    // When the user clicks an empty area, compute which hour/minute
    // was clicked using the scroll container's scrollTop.
    col.addEventListener('click', (e) => {
      // Ignore clicks that landed on an event chip
      if (e.target.closest('.week-event')) return;
 
      const scrollRect = scroll.getBoundingClientRect();
      const yInContent = (e.clientY - scrollRect.top) + scroll.scrollTop;
 
      // Snap to the nearest 15 minutes
      const totalMins   = Math.round((yInContent / HOUR_H) * 60 / 15) * 15;
      const clickedDate = new Date(day);
      clickedDate.setHours(Math.floor(totalMins / 60), totalMins % 60, 0, 0);
      openNewEventModal(clickedDate);
    });

    //todo: check why not working

    daysWrap.appendChild(col)
  }

  body.appendChild(daysWrap);
  scroll.appendChild(body);
  view.appendChild(scroll);
  elGrid.appendChild(view);
}

// --- Day view (scaffold) ---

function renderDayView() {
  // TODO: implement hourly time-grid layout
  const dayEvents = eventsOnDay(events, currentDate);
  const cell = createDayCell(currentDate, dayEvents);
  cell.style.gridColumn = '1 / -1'; // span all 7 columns
  elGrid.appendChild(cell);
}

// ============================================================
// DAY CELL FACTORY
// ============================================================

function createDayCell(date, dayEvents = []) {
  const cell = document.createElement('div');
  cell.className = 'day-cell';
  if (isToday(date))   cell.classList.add('today');

  // Day number label
  const label       = document.createElement('span');
  label.className   = 'day-number';
  label.textContent = date.getDate();
  cell.appendChild(label);

  // Event chips
  for (const ev of dayEvents) {
    cell.appendChild(createEventChip(ev));
  }

  // Click to open "new event" modal for this day
  cell.addEventListener('click', () => openNewEventModal(date));

  return cell;
}

function createEventChip(ev) {
  const chip             = document.createElement('div');
  chip.className         = 'event-chip';
  chip.textContent       = ev.title;
  chip.style.background  = ev.color;

  chip.addEventListener('click', (e) => {
    // stop click event from propagating up the DOM tree
    e.stopPropagation();
    openEditEventModal(ev);
  });

  return chip;
}

// ============================================================
// MODAL
// ============================================================

function openNewEventModal(date) {
  editingId = null;
  elModalTitle.textContent = 'New Event';
  elDeleteBtn.style.display = 'none';

  // Pre-fill with the clicked date and a sensible default time
  elTitle.value      = '';
  elDate.value       = toDateInputValue(date);
  elStartTime.value  = '09:00'; //todo: is this the spot?
  elEndTime.value    = '10:00';
  elDesc.value       = '';
  elColor.value      = '#Bf8888';
  elRepeat.value     = '';
  elRepeatInterval.value = 1;
  elRepeatEndType.value = '';
  elRepeatCount.value = '';
  elRepeatUntil.value = '';

  document
    .querySelectorAll("#repeat-weekdays input")
    .forEach(cb => cb.checked = false);

  updateRepeatUI();

  elRepeat.addEventListener("change", updateRepeatUI);

  openModal();

  // Focus the title field so the user can start typing immediately.
  elTitle.focus();
}

function updateRepeatUI() {
  const freq = elRepeat.value;

  // hide everything by default
  elRepeatWeekdays.style.display = 'none';
  elRepeatCount.style.display = 'none';
  elRepeatUntil.style.display = 'none';

  if (!freq) return;

  if (freq === "WEEKLY") {
    elRepeatWeekdays.style.display = '';
  }

  const endType = elRepeatEndType.value;

  if (endType === "COUNT") {
    elRepeatCount.style.display = '';
  }

  if (endType === "UNTIL") {
    elRepeatUntil.style.display = '';
  }
}

function openEditEventModal(ev) {
  editingId = ev.id;
  elModalTitle.textContent = 'Edit Event';
  elDeleteBtn.style.display = '';

  elTitle.value     = ev.title;
  elDate.value      = toDateInputValue(ev.start);
  elStartTime.value = toTimeInputValue(ev.start);
  elEndTime.value   = toTimeInputValue(ev.end ?? ev.start);
  elDesc.value      = ev.description ?? '';
  elColor.value     = ev.color ?? '#bf8888';

  if (ev.rrule) {
    const recur = ICAL.Recur.fromString(ev.rrule);

    elRepeat.value = recur.freq ?? '';
    elRepeatInterval.value = recur.interval ?? 1;

    if (recur.count) {
      elRepeatEndType.value = "COUNT";
      elRepeatCount.value = recur.count;
    } else if (recur.until) {
      elRepeatEndType.value = "UNTIL";
      elRepeatUntil.value = recur.until.toJSDate().toISOString().slice(0,10);
    } else {
      elRepeatEndType.value = "";
    }

    if (recur.parts.BYDAY) {
      const days = recur.parts.BYDAY;

      document
        .querySelectorAll("#repeat-weekdays input")
        .forEach(cb => {
          cb.checked = days.includes(cb.value);
        });
    }

  } else {
    elRepeat.value = '';
  }

  updateRepeatUI();
  openModal();
}

function openModal() {
  elOverlay.classList.add('open');
  elOverlay.setAttribute('aria-hidden', 'false');
}

function closeModal() {
  elOverlay.classList.remove('open');
  elOverlay.setAttribute('aria-hidden', 'true');
  editingId = null;
}

function handleModalSave() {
  const title = elTitle.value.trim();

  if (!title) {
    elTitle.focus();
    elTitle.style.borderColor = 'var(--color-danger)';
    setTimeout(() => { elTitle.style.borderColor = ''; }, 2000);
    return;
  }

  const start = combineDateAndTime(elDate.value, elStartTime.value);
  const end   = combineDateAndTime(elDate.value, elEndTime.value);

  const repeat = elRepeat.value || null;
  let rrule = null;

  if (repeat) {
    const parts = [];
    parts.push(`FREQ=${repeat}`);

    const interval = document.getElementById("repeat-interval").value;
    if (interval && interval > 1) {
      parts.push(`INTERVAL=${interval}`);
    }

    if (repeat === "WEEKLY") {
      const days = [...document.querySelectorAll("#repeat-weekdays input:checked")]
        .map(el => el.value);
      if (days.length) {
        parts.push(`BYDAY=${days.join(",")}`);
      }
    }

    const endType = document.getElementById("repeat-end-type").value;

    if (endType === "COUNT") {
      const count = document.getElementById("repeat-count").value;
      parts.push(`COUNT=${count}`);
    }

    if (endType === "UNTIL") {
      const until = document.getElementById("repeat-until").value;
      if (until) {
        parts.push(`UNTIL=${until.replace(/-/g,'')}T235959`);
      }
    }

    rrule = parts.join(";");
  }

  if (editingId) {
    // Update existing event: find it and replace its fields.
    // events.findIndex() returns the index of the first matching element,
    // or -1 if not found.
    const idx = events.findIndex(ev => ev.id === editingId);
    if (idx !== -1) {
      // Create a NEW object with old properties, then overwrite listed ones
      // "Update an object" without mutating the original.
      events[idx] = { ...events[idx], title, start, end,
                      description: elDesc.value,
                      color: elColor.value,
                      rrule };
    }
    // todo: handle not found case
  } else {
    // New event
    events.push(createEvent({
      title,
      start,
      end,
      description: elDesc.value,
      color: elColor.value,
      rrule,
    }));
  }

  closeModal();
  renderCalendar();
  save();
}

function handleModalDelete() {
  if (!editingId) return;

  if (!confirm('Delete this event?')) return;

  events = events.filter(ev => ev.id !== editingId);

  closeModal();
  renderCalendar();
  save();
}

// ============================================================
// STATUS BAR
// ============================================================

let _statusTimer = null;

function setStatus(message, type = '') {
  elStatus.textContent  = message;
  elStatus.className    = `status-bar ${type}`;

  // Auto-clear 'saving'/'saved' messages after 3s
  if (type === 'saved') {
    clearTimeout(_statusTimer);
    _statusTimer = setTimeout(() => {
      elStatus.textContent = hasFileOpen()
        ? `File: ${getFileName()}`
        : 'No file open.';
      elStatus.className = 'status-bar';
    }, 3000);
  }
}

// ============================================================
// UTILITY
// ============================================================

function weekRangeLabel(date) {
  const monday = startOfWeek(date);
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);

  const fmt = { month: 'short', day: 'numeric' };
  return `${monday.toLocaleDateString('default', fmt)} - ${sunday.toLocaleDateString('default', fmt)}, ${sunday.getFullYear()}`;
}

/**
 * Formats a Date as a short time string, e.g. "9:30 AM".
 * Used inside week-view event chips.
 */
function formatTime(date) {
  if (!date) return '';
  return date.toLocaleTimeString('default', { hour: 'numeric', minute: '2-digit' });
}
