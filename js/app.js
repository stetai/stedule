/**
 * app.js — UI Controller
 *
 * This file is the "orchestrator". It:
 *   1. Holds application state (events, current date, current view)
 *   2. Listens for user interactions (clicks, modal submissions)
 *   3. Calls calendar.js to query/transform data
 *   4. Calls storage.js to read/write the file
 *   5. Updates the DOM to reflect the new state
 *
 * The pattern used here is intentionally simple and explicit — no
 * framework (React, Vue, etc.). You will see exactly how the DOM
 * works before any abstractions hide it from you.
 *
 * JS QUIRK — import paths:
 * Imports in ES modules require the FULL filename including extension.
 * Python: `from calendar import parseICS`
 * JS:     `import { parseICS } from './calendar.js'`  ← .js is required
 * Without .js, the browser cannot find the file.
 */

import {
  openFile, writeFile, reloadFile, hasFileOpen, getFileName, canWriteInPlace
} from './storage.js';

import {
  parseICS, serializeICS, createEvent,
  eventsOnDay, eventsInWeek,
  isSameDay, isToday, startOfWeek,
  toDateInputValue, toTimeInputValue, combineDateAndTime,
} from './calendar.js';

import { getAdjWeekday } from './calendar.js';

// ============================================================
// APPLICATION STATE
// ============================================================
//
// JS QUIRK — there is no "private":
// These are module-scoped (not accessible from outside this file),
// but there is no access modifier keyword. The convention of using
// plain `let` at the top level of a module IS the signal that
// these are private to this module.
//
// All state lives here. The rule: if the UI looks wrong, it's because
// one of these variables has a wrong value. That single source of truth
// makes debugging much easier.

let events      = [];           // All parsed event objects
let currentDate = new Date();   // The date the calendar is currently showing
let currentView = 'week';      // 'month' | 'week' | 'day' (week/day = future work)
let editingId   = null;         // ID of the event currently in the modal, or null

// ============================================================
// DOM REFERENCES
// ============================================================
//
// querySelector returns the first element matching a CSS selector.
// We cache these at startup rather than calling querySelector on
// every render. DOM lookups are not expensive, but caching them
// is a good habit and makes the code easier to read.
//
// getElementById is slightly faster than querySelector('#id')
// for IDs, but both work fine.

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

// ============================================================
// INITIALIZATION
// ============================================================
//
// JS QUIRK — DOMContentLoaded vs load:
// 'DOMContentLoaded' fires when HTML is parsed and the DOM tree is
// ready. 'load' fires later, after all images and stylesheets have
// downloaded. For JS that manipulates the DOM, DOMContentLoaded is
// almost always the right choice.
//
// Since this script has type="module" in index.html, it's already
// deferred (guaranteed to run after DOM is ready). The listener
// is included anyway to make the dependency explicit.

document.addEventListener('DOMContentLoaded', init);

function init() {
  // Wire up all buttons. 'click' is the most common event type.
  // addEventListener(event, handler) is the modern way — it's safer
  // than the old onclick="..." HTML attribute approach.

  $('btn-open').addEventListener('click', handleOpenFile);
  $('btn-prev').addEventListener('click', () => navigate(-1));
  $('btn-next').addEventListener('click', () => navigate(+1));
  $('btn-today').addEventListener('click', goToToday);

  // View switcher: all three buttons share one handler.
  // We read the clicked button's data-view attribute to know which view.
  $('view-switcher').addEventListener('click', (e) => {
    // e.target is the element that was actually clicked.
    // .closest() walks up the DOM tree to find the nearest matching
    // ancestor — useful when clicks might land on child elements
    // (like an icon inside a button).
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
    if (e.target === elOverlay) closeModal(); // only if the overlay itself was clicked
  });

  // Keyboard: Escape closes the modal.
  // 'keydown' fires on the document, not just focused elements.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

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
  // JS QUIRK — Date mutation:
  // setMonth/setDate mutate the Date IN PLACE.
  // We are mutating currentDate here intentionally because we want
  // to update the shared state. But be careful: if you ever pass
  // currentDate to a function and that function mutates it, you'll
  // get surprising bugs. The pattern to avoid this is:
  //   const clone = new Date(currentDate);
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
    // classList.toggle(class, condition): adds class if true, removes if false
    btn.classList.toggle('active', btn.dataset.view === view);
  });

  renderCalendar();
}

// ============================================================
// RENDERING
// ============================================================
//
// The core loop of any web app:
//   State changes → renderCalendar() → DOM updates → user sees change
//
// We clear and rebuild the grid on every render.
// This is simple and correct. At scale you'd use a virtual DOM
// (what React does) to avoid unnecessary DOM operations, but
// for a personal calendar it is completely fine.

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
  // WHY day 0 of next month = last day of this month:
  // Day 0 means "one day before day 1", so month+1, day 0 = last day of `month`.
  // This is a common JS idiom.

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

// The HOUR_H constant (px per hour) is the single source of truth
// that connects the CSS layout to the JS positioning math.
// If you change it, update BOTH the constant here AND --hour-h in CSS.

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
    // 24 divs, each HOUR_H tall. Purely visual.
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
    // stopPropagation prevents the click from also triggering the cell's
    // click handler (which would open a NEW event modal).
    // Events "bubble up" the DOM tree — a click on a chip is also a click
    // on its parent cell, grandparent, all the way to document.
    // stopPropagation halts that bubbling.
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
  elStartTime.value  = '09:00';
  elEndTime.value    = '10:00';
  elDesc.value       = '';
  elColor.value      = '#4f72ff';
  elRepeat.value     = '';

  openModal();
  // Focus the title field so the user can start typing immediately.
  // Small UX touches like this matter a lot.
  elTitle.focus();
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
  elColor.value     = ev.color ?? '#4f72ff';
  elRepeat.value    = ev.rrule?.freq ?? '';

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
  const rrule = repeat ? { freq: repeat, interval: 1 } : null;

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
      rrule: repeat  ? { freq: repeat, interval: 1 } : null,
    }));
  }

  closeModal();
  renderCalendar();
  save();
}

function handleModalDelete() {
  if (!editingId) return;

  // Confirm before deleting — a simple guard against accidents.
  if (!confirm('Delete this event?')) return;

  // .filter() returns a NEW array excluding the deleted event.
  // This does NOT mutate the original array; it replaces it entirely.
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
  // toLocaleTimeString with these options gives "9:30 AM" in en-US.
  // 'default' respects the user's locale, so it will use 24h format
  // for users whose OS is set to a 24h locale.
  return date.toLocaleTimeString('default', { hour: 'numeric', minute: '2-digit' });
}
