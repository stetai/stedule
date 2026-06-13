/**
 * app.js — UI Controller
 */

const v = new URL(import.meta.url).search;

import {
  openFile, writeFile, reloadFile, hasFileOpen, getFileName, isFirefox
} from './storage.js';

import {
  parseICS, serializeICS, createEvent,
  eventsOnDay, parseRRule, getAdjWeekday,
  isToday, startOfWeek, addTime,
  toDateInputValue, toTimeInputValue, combineDateAndTime,
  scheduleEventNotification, refreshNotifs,
} from './calendar.js';

// ============================================================
// APPLICATION STATE
// ============================================================

let _settingChanged=false;        // Track whether settings have been changed since opening them

let events         = [];          // All parsed event objects
let currentDate    = new Date();  // The date the calendar is currently showing
let currentView    = 'week';      // 'month' | 'week' | 'day' (week/day = future work)
let editingId      = null;        // ID of the event currently in the modal, or null

let editingOriginalDate = null;   // (YYYY-MM-DD) which occurrence of a recurring event to edit

// event draft
let draftEvent     = null;        // Event that is being worked on in quickadd
let draftOutlineEl = null;        // Outline of quickadd
let moving         = false;       // Currently moving event draft?
let startTop       = 0;
let weekScrollEl   = null;
let startScrollTop = 0;
let draftColumn    = null;        // Column of event draft
let resizing       = false;       // Currently resizing event draft?
let startY         = 0;           //|Default values for quickadd outline
let startHeight    = 0;           //|

//future dynamic access
let _weekDayNum    = 7;
let _firstWeekday  = 0; //0 = "Mon", 1 = "Tue", etc
let _seqcDayNum    = 1;

// UI 
let _savedScrollTop= null;

// ============================================================
// DOM REFERENCES
// ============================================================

const $ = id => document.getElementById(id); // tiny shorthand

const elGrid       = $('calendar-grid');
const elPeriod     = $('current-period');
const elStatus     = $('status-bar');
const elOverlay    = $('modal-overlay');
const elSettingsOverlay = $('settings-overlay');
const elModalTitle = $('modal-title');
const elTitle      = $('event-title');
const elWeekdays   = $('weekday-headers');
const elStartDate  = $('event-start-date');
const elStartTime  = $('event-start-time');
const elEndDate    = $('event-end-date');
const elEndTime    = $('event-end-time');
const elRepeat     = $('event-repeat');
const elDesc       = $('event-description');
const elColor      = $('event-color');
const elDeleteBtn  = $('modal-delete');

const elRepeatIntervalGroup = $('repeat-interval-group');
const elRepeatEndGroup = $('repeat-end-group');
const elRepeatInterval = $('repeat-interval');
const elRepeatEndType  = $('repeat-end-type');
const elRepeatCount    = $('repeat-count');
const elRepeatUntil    = $('repeat-until');
const elRepeatWeekdays = $('repeat-weekdays');

const elQuickBar   = $('quick-add-bar');
const elQuickTitle = $('quick-add-title');
const elQuickTime  = $('quick-add-time');
const elQuickOpen  = $('quick-add-open');
const elQuickSave  = $('quick-add-save');

const elScopeOverlay = $('scope-overlay');
const elScopeDesc    = $('scope-description');

const elErrorOverlay   = $('error-overlay');
const elErrorMessage   = $('error-message');
const elConfirmOverlay = $('confirm-overlay');
const elConfirmMessage = $('confirm-message');

// ============================================================
// INITIALIZATION
// ============================================================

if (window.__TAURI__) {
    const { invoke } = window.__TAURI__.core;
    invoke('request_battery_optimisation_exemption').catch(console.error);
}

document.addEventListener('DOMContentLoaded', init);

function init() {
  $('btn-open').addEventListener('click', handleOpenFile);
  $('btn-settings').addEventListener('click', openSettingsModal);
  $('btn-prev').addEventListener('click', () => navigate(-1));
  $('btn-next').addEventListener('click', () => navigate(+1));
  $('btn-today').addEventListener('click', goToToday);

  $('view-switcher').addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-view');
    if (!btn) return; // clicked the container, not a button
    switchView(btn.dataset.view);
  });

  // Settings
  $('settings-cancel').addEventListener('click', confirmCloseSettings)

  $('settings-save').addEventListener('click', () => {
    setStatus("Settings would have been saved if backend existed.", "saved");
    closeSettings();
  })

  // Add Event
  document.addEventListener('click', (e) => {
    if (e.target.closest('.week-day-col')) return;
    if (e.target.closest('.quick-add-bar')) return;
    if (e.target.closest('.week-event-outline')) return;

    closeQuickAdd();
  });

  $('quick-add-open').addEventListener('click', (e) => {
    if (e.target.closest('.week-event-resize')) return;
    e.stopPropagation();
    if (!draftEvent) return;
    openNewEventModal(draftEvent.start, draftEvent.title, draftEvent.end);
  });
  
  $('quick-add-save').addEventListener('click', handleQuickSave);

  elQuickTitle.addEventListener('input', () => {
    if (!draftEvent) return;
    draftEvent.title = elQuickTitle.value;
  });

  elQuickTitle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleQuickSave();
    }
  });

  // move quick add along with keyboard
  if (window.visualViewport) {
    const updateQuickBarOffset = () => {
      const vv = window.visualViewport;
      const offset = window.innerHeight - (vv.height + vv.offsetTop);
      elQuickBar.style.bottom = `${Math.max(offset, 0)}px`;

      if (weekScrollEl) {
        const bottomOffset = parseFloat(elQuickBar.style.bottom) || 0;
        const quickBarTop  = window.innerHeight - bottomOffset - elQuickBar.offsetHeight;
        const scrollTop    = weekScrollEl.getBoundingClientRect().top;
        weekScrollEl.style.maxHeight = `${quickBarTop - scrollTop}px`; 
      }
    };

    window.visualViewport.addEventListener('resize', updateQuickBarOffset);
    window.visualViewport.addEventListener('scroll', updateQuickBarOffset);

    updateQuickBarOffset();
  }

  // Modal buttons
  $('modal-cancel').addEventListener('click', closeModal);
  $('modal-close').addEventListener('click',  closeModal);
  $('modal-save').addEventListener('click',   handleModalSave);
  $('modal-delete').addEventListener('click', handleModalDelete);

  // Scope dialog buttons
  $('scope-cancel').addEventListener('click', closeScopeDialog);
  $('scope-this').addEventListener('click',   () => commitRecurrenceSave('this'));
  $('scope-all').addEventListener('click',    () => commitRecurrenceSave('all'));

  // Error/confirm dialog buttons
  $('error-ok').addEventListener('click', closeError);
  $('confirm-cancel').addEventListener('click', () => resolveConfirm(false));
  $('confirm-ok').addEventListener('click',     () => resolveConfirm(true));

  // Close modal when clicking the dark overlay (outside the modal box)
  elOverlay.addEventListener('click', (e) => {
    if (e.target === elOverlay) closeModal(); 
    // only if the overlay itself was clicked
  });

  // Keyboard: Escape closes the modal.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  elTitle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleModalSave();
    }
  });

  elStartDate.addEventListener('change', shiftEndWithStart);
  elStartTime.addEventListener('change', shiftEndWithStart);

  // reset remembered duration on manual change
  elEndTime.addEventListener('change', () => {
    _modalDuration = null; 
  });
  elEndDate.addEventListener('change', () => {
    _modalDuration = null;
  });

  elRepeat.addEventListener('change', updateRepeatUI);
  elRepeatEndType.addEventListener('change', updateRepeatUI);

  //reload all notificatins on app open
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && events.length > 0) {
      refreshNotifs(events);
    }
  });

  renderCalendar();
  renderWeekdayHeader(_firstWeekday);
  setStatus('No file open. Click "Open .ics file" to begin.');

  updateNowIndicator();
  setInterval(updateNowIndicator, 2 * 1000);
}

// ------------------------------------------------------------
// Settings
// ------------------------------------------------------------
function openSettingsModal() {
  _settingChanged = false;

  // load current settings
  // files
  // categories
  // theme
  // notifications
  
  elSettingsOverlay.classList.add('open');
  elSettingsOverlay.setAttribute('aria-hidden', 'false');
}

async function confirmCloseSettings() {
  if (_settingChanged) {
    if (!await showConfirm("You have made changes to your settings. Do you really want to exit without saving them?")) return;
  }

  closeSettings();
}

async function closeSettings() {
  if (document.activeElement && elOverlay.contains(document.activeElement)) {
    document.activeElement.blur();
  }
  
  elSettingsOverlay.classList.remove('open');
  elSettingsOverlay.setAttribute('aria-hidden', 'true');
}

// ------------------------------------------------------------
// FILE HANDLING
// ------------------------------------------------------------

async function handleOpenFile() {
  try {
    const raw = await openFile();
    events = parseICS(raw);
    renderCalendar();
    const saveNote = !isFirefox()  ? '' : ' · Firefox: saves will download a new file';
    setStatus(`Loaded: ${getFileName()} — ${events.length} event(s)${saveNote}`, 'saved');

    refreshNotifs(events);

  } catch (err) {
    // don't show error if it comes from user input
    if (err.name === 'AbortError') return;
    console.error('Open failed:', err);
    setStatus(`Error opening file: ${err?.message ?? String(err)}`, 'error');
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
    setStatus(`Save failed: ${err?.message ?? String(err)}`, 'error');
  }
}

// ------------------------------------------------------------
// NAVIGATION
// ------------------------------------------------------------

function navigate(direction) {

  if (weekScrollEl) _savedScrollTop = weekScrollEl.scrollTop;

  if (currentView === 'month') {
    currentDate.setMonth(currentDate.getMonth() + direction);
  } else if (currentView === 'week') {
    currentDate.setDate(currentDate.getDate() + 7 * direction); // 7 stays here
  } else if (currentView === 'day') {
    currentDate.setDate(currentDate.getDate() + _seqcDayNum * direction);
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

// ------------------------------------------------------------
// RENDERING
// ------------------------------------------------------------

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

function renderWeekdayHeader(startDay = "Mon") { //todo: make flexible
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

// --- Week view ---

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
  const bubble = document.createElement('div');
  const wn = document.createElement('span');
  const weekNumber = getWeekNumber(monday); // get week number
  wn.className = 'wdh-name';
  wn.textContent = weekNumber;
  bubble.className = 'bubble';
  bubble.appendChild(wn);
  gutterSpacer.className = 'week-gutter-spacer';
  gutterSpacer.appendChild(bubble);

  headerRow.appendChild(gutterSpacer);

  for (let i = 0; i < _weekDayNum; i++) {
    const day = new Date(monday);
    day.setDate(day.getDate() + i);

    const hdr = document.createElement('div');
    hdr.className = 'week-day-header' + (isToday(day) ? ' today' : '');
    
    const name = document.createElement('span');
    name.className = 'wdh-name';
    //display weekday names in local format
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

  weekScrollEl = scroll;

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
 
    // -- Hour grid lines (Purely visual) --------------------------------
    for (let h = 0; h < 24; h++) {
      const row = document.createElement('div');
      row.className = 'week-hour-row';
      // Half-hour tick: a lighter line at the midpoint of each hour cell
      const half = document.createElement('div');
      half.className = 'week-half-tick';
      row.appendChild(half);
      col.appendChild(row);
    }
    
    // -- Positioned events ----------------------------------------------
    // For each event, calculate top and height in pixels from the
    // fractional hour values of start/end time.
    const laidOut = layoutDayEvents(dayEvents);

    for (const item of laidOut) {
      const ev = item.event;
      
      // create event chip
      if (ev.allDay) continue; // all-day events stay in month-chip style
 
      let startH = 0;
      if (ev.start.getDate() === day.getDate()) {
        startH = ev.start.getHours() + ev.start.getMinutes() / 60; 
      }

      const endDate  = ev.end ?? new Date(ev.start.getTime() + 2 * 60 * 60 * 1000); // if unspecified: 2h after start

      let endH = 24;
      if (endDate.getDate() === day.getDate()) {
        endH = endDate.getHours() + endDate.getMinutes() / 60;
      }
      if (endDate.getDate() === day.getDate() + 1 && endDate.getHours() === 0 && endDate.getMinutes() === 0) {
        endH = 23.99;
      }

      // multi-day?
      const continuesFromPrev = ev.start.getDate() !== day.getDate() && ev.start < day;
      const continuesToNext = endH === 24;

      // Clamp to a minimum visual height so short events are still clickable
      const duration = Math.max(endH - startH, 0.25);

      const baseWidth = 100 / item.cols;
      const width = baseWidth * item.span;
      const left  = baseWidth * item.col;
 
      const chip = document.createElement('div');
      chip.className = 'week-event';

      if (continuesFromPrev) chip.classList.add('continues-from-prev');
      if (continuesToNext)   chip.classList.add('continues-to-next');

      chip.style.top        = `${startH * HOUR_H}px`;
      chip.style.height     = `${duration * HOUR_H}px`;
      chip.style.left       = `calc(${left}% + 1px)`;
      chip.style.width      = `calc(${width}% - 2px)`;
      chip.style.background = ev.color;
 
      // Show title + time if there is enough vertical space
      const titleEl = document.createElement('span');
      titleEl.className = 'week-event-title';
      titleEl.textContent = ev.title;
 
      const timeEl = document.createElement('span');
      timeEl.className = 'week-event-time';
      if(duration * HOUR_H > 32 && !continuesFromPrev /*&& there are no collisions*/){
        timeEl.textContent = `${formatTime(ev.start)}`;//- ${formatTime(endDate)}`;
      }
 
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
      // Ignore during resizing
      if (e.target.closest('.week-event-outline')) return;
 
      const scrollRect = scroll.getBoundingClientRect();
      const yInContent = (e.clientY - scrollRect.top) + scroll.scrollTop;
 
      // Snap to the nearest 15 minutes
      const totalMins   = Math.round((yInContent / HOUR_H) * 60 / 15) * 15;
      const clickedDate = new Date(day);
      clickedDate.setHours(Math.floor(totalMins / 60), totalMins % 60, 0, 0);

      if (resizing && clickedDate.getTime() < draftEvent.start.getTime()) 
        // An event is being resized and we stop above the event
        // The minimum size should be used.
        return;

      startQuickAdd(col, clickedDate);
    });

    daysWrap.appendChild(col)
  }

  body.appendChild(daysWrap);
  scroll.appendChild(body);
  view.appendChild(scroll);
  elGrid.appendChild(view);

  updateNowIndicator();

  // Restore scroll position if one was saved
  if (_savedScrollTop !== null) {
    scroll.scrollTop = _savedScrollTop;
    _savedScrollTop = null;
  }
}

/* Determine week number of the current week*/
function getWeekNumber(d) {
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay()||7));
    var yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
    var weekNo = Math.ceil(( ( (d - yearStart) / 86400000) + 1)/7);
    return weekNo;
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

// --------------------------------------------------------
// quick add
// --------------------------------------------------------

function startQuickAdd(col, startDate) {

  const durationHours = 1.5;

  if (draftOutlineEl) {
    draftOutlineEl.remove();
  }

  const startH = startDate.getHours() + startDate.getMinutes() / 60;

  const outline = document.createElement('div');
  outline.className = 'week-event-outline';

  outline.addEventListener('pointerdown', (e) => {
    // Ignore the resize handle
    if (e.target.closest('.week-event-resize')) return;

    e.stopPropagation();
    e.preventDefault();

    moving = true;
    startY = e.clientY;
    startTop = outline.offsetTop;
    
    startScrollTop = weekScrollEl.scrollTop;

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', stopMove);
  });

  outline.style.top = `${startH * HOUR_H}px`;
  outline.style.height = `${durationHours * HOUR_H}px`;

  // handle logic
  const handle = document.createElement('div');
  handle.className = 'week-event-resize';

  handle.addEventListener('pointerdown', (e) => {

    e.stopPropagation();
    e.preventDefault();

    resizing = true;
    startY = e.clientY;
    startHeight = outline.offsetHeight;
    
    startScrollTop = weekScrollEl.scrollTop;

    document.addEventListener('pointermove', onResize);
    document.addEventListener('pointerup', stopResize);
  });

  outline.appendChild(handle);

  col.appendChild(outline);

  draftOutlineEl = outline;
  draftColumn = col;

  const title = elQuickTitle.value.trim();

  const end = new Date(startDate.getTime() + durationHours * 3600000);

  draftEvent = {
    title: title, 
    start: startDate,
    end
  };

  updateQuickBar();

  elQuickBar.classList.add('open');

  const bottomOffset  = parseFloat(elQuickBar.style.bottom) || 0;
  const quickBarTop   = window.innerHeight - bottomOffset - elQuickBar.offsetHeight;
  const scrollTop     = weekScrollEl.getBoundingClientRect().top;

  weekScrollEl.style.maxHeight = `${quickBarTop - scrollTop}px`;

  elQuickTitle.value = '';
  elQuickTitle.focus({ preventScroll: true });
}

function onMove(e) {
  if (!moving) return;

  document.body.style.overflow = "hidden";

  const el = document.elementFromPoint(e.clientX, e.clientY);
  const newCol = el?.closest('.week-day-col');

  if (newCol && newCol !== draftColumn) {

    draftColumn = newCol;
    newCol.appendChild(draftOutlineEl);

    // update date
    const monday = startOfWeek(currentDate);
    const index = [...newCol.parentNode.children].indexOf(newCol);

    const newDate = new Date(monday);
    newDate.setDate(monday.getDate() + index);

    const hours = draftEvent.start.getHours();
    const minutes = draftEvent.start.getMinutes();

    newDate.setHours(hours, minutes, 0, 0);

    const duration = draftEvent.end - draftEvent.start;

    draftEvent.start = newDate;
    draftEvent.end = new Date(newDate.getTime() + duration);

    updateQuickBar();
  }

  const scrollDelta = weekScrollEl.scrollTop - startScrollTop;
  const dy = e.clientY - startY + scrollDelta;

  let newTop = startTop + dy;

  const snap = HOUR_H / 4; // 15 minutes
  newTop = Math.round(newTop / snap) * snap;

  const maxTop = 24 * HOUR_H - draftOutlineEl.offsetHeight;
  newTop = Math.max(0, Math.min(newTop, maxTop));

  draftOutlineEl.style.top = `${newTop}px`;

  const startHours = newTop / HOUR_H;

  const start = new Date(draftEvent.start);
  start.setHours(Math.floor(startHours), (startHours % 1) * 60, 0, 0);

  const duration = draftEvent.end - draftEvent.start;

  draftEvent.start = start;
  draftEvent.end = new Date(start.getTime() + duration);

  autoScrollDuringDrag(e);

  updateQuickBar();
}

function stopMove() {

  moving = false;

  document.body.style.overflow = "";

  document.removeEventListener('pointermove', onMove);
  document.removeEventListener('pointerup', stopMove);
}

function autoScrollDuringDrag(e) {

  if (!weekScrollEl) return;

  const rect = weekScrollEl.getBoundingClientRect();
  const quickBarRect = elQuickBar.getBoundingClientRect();

  const edge = 40;        // trigger zone

  const grid = weekScrollEl.querySelector('.week-body');

  const gridHeight = grid.offsetHeight;
  const visibleHeight = weekScrollEl.clientHeight;

  const maxScroll = Math.max(0, gridHeight - visibleHeight);

  const distTop = rect.top + edge - e.clientY;
  const distBot = e.clientY - (quickBarRect.top - edge);

  if (distTop > 0) {
    weekScrollEl.scrollTop =
      Math.max(0, weekScrollEl.scrollTop - distTop * 0.1);
  }

  if (distBot > 0) {
    weekScrollEl.scrollTop =
      Math.min(maxScroll, weekScrollEl.scrollTop + distBot * 0.1);
  }
}

function onResize(e) {
  if (!resizing) return;

  document.body.style.overflow = "hidden";

  const scrollDelta = weekScrollEl.scrollTop - startScrollTop;
  const dy = e.clientY - startY + scrollDelta;
  let newHeight = startHeight + dy;

  const snap = HOUR_H / 4; // 15 minutes
  newHeight = Math.round(newHeight / snap) * snap;

  const maxHeight = 24 * HOUR_H - draftOutlineEl.offsetHeight;

  const minHeight = snap;
  newHeight = Math.max(newHeight, Math.min(minHeight, maxHeight));

  draftOutlineEl.style.height = `${newHeight}px`;

  const durationHours = newHeight / HOUR_H;
  draftEvent.end = new Date(
    draftEvent.start.getTime() + durationHours * 3600000
  );

  autoScrollDuringDrag(e);

  updateQuickBar();
}

function stopResize() {

  resizing = false;

  document.body.style.overflow = "";

  document.removeEventListener('pointermove', onResize);
  document.removeEventListener('pointerup', stopResize);
}

function updateQuickBar() {
  if (!draftEvent) return;

  elQuickTime.textContent =
    //em-dash for correct formating of start/end time
    `${formatDate(draftEvent.start)}: ${formatTime(draftEvent.start)} – ${formatTime(draftEvent.end)}`;
}

function closeQuickAdd() {
  draftEvent = null;

  if (draftOutlineEl) {
    draftOutlineEl.remove();
    draftOutlineEl = null;
  }

  if (weekScrollEl) {
    weekScrollEl.style.maxHeight = '';
  }

  elQuickTitle.value = '';

  elQuickBar.classList.remove('open');
}

function handleQuickSave() {

  if (!draftEvent) return;

  const title = elQuickTitle.value.trim();

  if (!title) {
    elQuickTitle.focus();
    return;
  }

  const newEvent = createEvent({
    title,
    start: draftEvent.start,
    end: draftEvent.end,
    description: '',
    color: '#A80808',
    rrule: null
  });

  events.push(newEvent);

  closeQuickAdd();
  renderCalendar();
  save();
  refreshNotifs(events);
}

// ============================================================
// MODAL
// ============================================================

function openNewEventModal(date, title='', end=null) {
  editingId = null;
  elModalTitle.textContent = 'New Event';
  elDeleteBtn.style.display = 'none';

  // Pre-fill with the clicked date and a sensible default time
  elTitle.value      = title;
  elStartDate.value  = toDateInputValue(date);
  elStartTime.value  = toTimeInputValue(date); 
  const defaultEnd   = addTime(date,1.5);
  elEndTime.value    = toTimeInputValue(end ?? defaultEnd);
  elEndDate.value    = toDateInputValue(end ?? defaultEnd);
  elDesc.value       = '';
  elColor.value      = '#A80808';
  elRepeat.value     = '';
  elRepeatInterval.value = 1;
  elRepeatEndType.value = '';
  elRepeatCount.value = '';
  elRepeatUntil.value = '';

  document
    .querySelectorAll("#repeat-weekdays input")
    .forEach(cb => cb.checked = false);

  updateRepeatUI();

  openModal();

  closeQuickAdd();

  // Focus the title field so the user can start typing immediately.
  elTitle.focus();

  rememberDuration(); // remember duration for editing
}

function updateRepeatUI() {
  const freq = elRepeat.value;

  // hide everything by default
  elRepeatIntervalGroup.style.display = 'none';
  elRepeatEndGroup.style.display = 'none';
  elRepeatWeekdays.style.display = 'none';
  elRepeatCount.style.display = 'none';
  elRepeatUntil.style.display = 'none';

  if (!freq) return;

  if (freq) {
    elRepeatIntervalGroup.style.display = 'block';
    elRepeatEndGroup.style.display = 'block';
  }

  if (freq === "WEEKLY") {
    elRepeatWeekdays.style.display = 'flex';

    const weekday = ["SU","MO","TU","WE","TH","FR","SA"][new Date(elStartDate.value).getDay()];

    const cb = document.querySelector(`#repeat-weekdays input[value="${weekday}"]`);
    if (cb && !document.querySelector("#repeat-weekdays input:checked")) {
      cb.checked = true;
    }
  }

  const endType = elRepeatEndType.value;

  if (endType === "COUNT") elRepeatCount.style.display = 'block';

  if (endType === "UNTIL") elRepeatUntil.style.display = 'block';
}

function openEditEventModal(ev) {
  editingId = ev.masterId ?? ev.id; // master's ID for recurring events
  editingOriginalDate = ev.originalDate ?? null; // null for non-recurring

  elModalTitle.textContent = 'Edit Event';
  elDeleteBtn.style.display = '';

  elTitle.value     = ev.title;
  elStartDate.value = toDateInputValue(ev.start);
  elStartTime.value = toTimeInputValue(ev.start);
  const end  = ev.end ?? ev.start;
  elEndDate.value   = toDateInputValue(end);
  elEndTime.value   = toTimeInputValue(end);
  elDesc.value      = ev.description ?? '';
  elColor.value     = ev.color ?? '#A80808';

  if (ev.rrule) {
    const recur = parseRRule(ev.rrule);

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

  rememberDuration(); // remember duration for editing
}

function openModal() {
  elOverlay.classList.add('open');
  elOverlay.setAttribute('aria-hidden', 'false');
}

function closeModal() {

  if (document.activeElement && elOverlay.contains(document.activeElement)) {
    document.activeElement.blur();
  }
  
  elOverlay.classList.remove('open');
  elOverlay.setAttribute('aria-hidden', 'true');
  editingId = null;
  editingOriginalDate = null;
}

function handleModalSave() {
  const title = elTitle.value.trim();

  if (!title) {
    formError(elTitle);
    return;
  }

  const start = combineDateAndTime(elStartDate.value, elStartTime.value);
  const end   = combineDateAndTime(elEndDate.value, elEndTime.value);

  if (end < start) {
    if (elStartDate.value === elEndDate.value) {
      formError(elEndTime);
      return;
    } else {
      formError(elEndDate);
      return;
    }
  }

  const repeat = elRepeat.value || null;
  let rrule = null;

  if (repeat) {
    const parts = [];
    parts.push(`FREQ=${repeat}`);

    const interval = elRepeatInterval.value;
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

    const endType = elRepeatEndType.value;

    if (endType === "COUNT") {
      const count = elRepeatCount.value;
      parts.push(`COUNT=${count}`);
    }

    if (endType === "UNTIL") {
      const until = elRepeatUntil.value;
      if (until) {
        parts.push(`UNTIL=${until.replace(/-/g,'')}T235959`);
      }
    }

    rrule = parts.join(";");
  }

  if (editingId && editingOriginalDate){
    _pendingSave = { title, start, end, description: elDesc.value, color: elColor.value, rrule };
    elScopeDesc.textContent = 
      'This is a recurring event. Do you want to apply the changes to just this occurrence, or all occurrences?';
    $('scope-this').textContent = 'This event';
    $('scope-all').textContent = 'All events';
    openScopeDialog();
    return; // wait for scope choice before saving
  }

  // Non-recurring
  _commitRecurrenceSaveNow({title, start, end, description: elDesc.value, color: elColor.value, rrule}, 'all');
}

async function handleModalDelete() {
  if (!editingId) return;

  if (editingOriginalDate) {
    _pendingSave = null; // no changes to save, just delete
    elScopeDesc.textContent = 
      'This is a recurring event. Do you want to delete just this occurrence, or all occurrences?';
    $('scope-this').textContent = 'This event';
    $('scope-all').textContent = 'All events';
    openScopeDialog();
    return;
  }

  if (!await showConfirm(
    `Delete ${elTitle.value}?\n(${elStartDate.value}, ${elStartTime.value} — ${elEndDate.value === elStartDate.value ? '' : elEndDate.value + ', '}${elEndTime.value})`
  )) return;

  events = events.filter(ev => ev.id !== editingId);

  closeModal();
  renderCalendar();
  save();
  refreshNotifs(events);
}

// ============================================================
// SCOPE DIALOG HELPERS
// ============================================================
 
// Temporary holding area for the field values collected by handleModalSave() before the user has confirmed scope. Null when the action is a delete.
let _pendingSave = null;
 
function openScopeDialog() {
  elScopeOverlay.classList.add('open');
  elScopeOverlay.setAttribute('aria-hidden', 'false');
}
 
function closeScopeDialog() {
  elScopeOverlay.classList.remove('open');
  elScopeOverlay.setAttribute('aria-hidden', 'true');
}
 
/**
 * Called when the user picks a scope in the scope dialog.
 * @param {'this'|'all'} scope
 */
async function commitRecurrenceSave(scope) {
  closeScopeDialog();
 
  // --- delete ---
  if (_pendingSave === null) {
    if (scope === 'this') {
      // Mark this single occurrence as deleted in the master's exceptions map.
      const idx = events.findIndex(ev => ev.id === editingId);
      if (idx !== -1) {
        events[idx] = {
          ...events[idx],
          exceptions: {
            ...events[idx].exceptions,
            [editingOriginalDate]: { deleted: true }
          }
        };
      }
    } else {
      // Delete the entire series (master + all occurrences)
      if (!await showConfirm(`Delete all events in the series ${elTitle.value}?`)) return;
      events = events.filter(ev => ev.id !== editingId);
    }

    _pendingSave = null;
 
    closeModal();
    renderCalendar();
    save();
    refreshNotifs(events);
    return;
  }
 
  // --- save ---
  if (scope === 'this'){
    const idx = events.findIndex(ev => ev.id === editingId);
    if (idx !== -1) {
      // Write a sparse exception with the new values for this occurrence
      const master = events[idx];
      const exception = { ..._pendingSave };

      const originalOccurrenceStart = new Date(editingOriginalDate + 'T00:00:00');
      originalOccurrenceStart.setHours(master.start.getHours(), master.start.getMinutes(), 0, 0);

      if (Math.abs(exception.start - originalOccurrenceStart) > 365 * 24 * 3600 * 1000) {
        showError("Occurrences can't be moved more than a year away from the original date. You attempted to move it from " + formatDate(originalOccurrenceStart) + " to " + formatDate(exception.start) + ".");
        return;
      }
    }  
  }

  _commitRecurrenceSaveNow(_pendingSave, scope);
}
 
/**
 * Applies a validated set of field values to the events array.
 * @param {object} fields  - { title, start, end, description, color, rrule }
 * @param {'this'|'all'} scope
 */
function _commitRecurrenceSaveNow(fields, scope) {
  const { title, start, end, description, color, rrule } = fields;
 
  if (editingId) {
    const idx = events.findIndex(ev => ev.id === editingId);
 
    if (idx !== -1) {
      if (scope === 'this' && editingOriginalDate) {
        // Write a sparse exception
        // JSON serialization in X-EXCEPTIONS.
        const master = events[idx];
        const exception = {};
 
        if (title       !== master.title)       exception.title       = title;
        if (description !== master.description) exception.description = description;
        if (color       !== master.color)       exception.color       = color;
 
        // Compare times by value, not reference
        const masterOccStart = (() => {
          const d = new Date(new Date(editingOriginalDate + 'T00:00:00'));
          d.setHours(master.start.getHours(), master.start.getMinutes(), 0, 0);
          return d;
        })();
        const masterDuration = (master.end ?? master.start) - master.start;
        const masterOccEnd   = new Date(masterOccStart.getTime() + masterDuration);
 
        if (start.getTime() !== masterOccStart.getTime()) exception.start = start;
        if (end.getTime()   !== masterOccEnd.getTime())   exception.end   = end;
 
        events[idx] = {
          ...master,
          exceptions: {
            ...master.exceptions,
            [editingOriginalDate]: exception
          }
        };
      } else {
        // Update the master. 
        // Existing per-occurrence exceptions are preserved.
        events[idx] = { ...events[idx], title, start, end, description, color, rrule };
      }
    }
  } else {
    // Brand new event
    events.push(createEvent({ title, start, end, description, color, rrule }));
  }
 
  closeModal();
  renderCalendar();
  save();
  refreshNotifs(events);
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
// ERROR / CONFIRM DIALOGS
// ============================================================

function showError(message) {
  elErrorMessage.textContent = message;
  elErrorOverlay.classList.add('open');
  elErrorOverlay.setAttribute('aria-hidden', 'false');
  $('error-ok').focus();
}

function closeError() {
  elErrorOverlay.classList.remove('open');
  elErrorOverlay.setAttribute('aria-hidden', 'true');
}

// confirm dialog - returns Promise
let _resolveConfirm = null;

function showConfirm(message) {
  elConfirmMessage.textContent = message;
  elConfirmOverlay.classList.add('open');
  elConfirmOverlay.setAttribute('aria-hidden', 'false');
  $('confirm-ok').focus();
  return new Promise(resolve => { _resolveConfirm = resolve; });
}

function resolveConfirm(result) {
  elConfirmOverlay.classList.remove('open');
  elConfirmOverlay.setAttribute('aria-hidden', 'true');
  if (_resolveConfirm) {
    _resolveConfirm(result);
    _resolveConfirm = null;
  }
}

// ------------------------------------------------------------
// UTILITY
// ------------------------------------------------------------

// keep event duration when changing start time in the modal --

let _modalDuration = null;

function rememberDuration() {
  const start = combineDateAndTime(elStartDate.value, elStartTime.value);
  const end = combineDateAndTime(elEndDate.value, elEndTime.value);

  if (start && end) {
    _modalDuration = end - start;
  }
}

function shiftEndWithStart() {
  if (!_modalDuration) return;

  const start = combineDateAndTime(elStartDate.value, elStartTime.value);
  if (!start) return;

  const newEnd = new Date(start.getTime() + _modalDuration);

  elEndDate.value = toDateInputValue(newEnd);
  elEndTime.value = toTimeInputValue(newEnd);
}

// formating --------------------------------------------------

/**
 * Formats a Date as a short time string, e.g. "9:30 AM".
 * Used inside week-view event chips.
 */
function formatTime(date) {
  if (!date) return '';
  return date.toLocaleTimeString('default', { hour: 'numeric', minute: '2-digit' });
}

function formatDate(date) {
  if (!date) return '';
  return date.toLocaleDateString('default', {
      weekday: 'short', year: 'numeric', month: 'long', day: 'numeric',
    }
  );
}

// UI utilities -----------------------------------------------

function layoutDayEvents(events) {

  const sorted = [...events]
    .filter(ev => !ev.allDay)
    .sort((a,b) =>
      a.start - b.start || (b.end - b.start) - (a.end - a.start)
    );

  const columns = [];
  const positioned = [];

  for (const ev of sorted) {

    let colIndex = 0;

    while(true) {

      if(!columns[colIndex]) {
        columns[colIndex] = [];
      }

      const col = columns[colIndex];
      const last = col[col.length-1];

      if (!last || (last.end ?? last.start) <= ev.start) {
        col.push(ev);
        positioned.push({event: ev, col: colIndex});
        break;
      }

      colIndex++;
    }

  }

  const colCount = columns.length;

  return positioned.map(r => {

    let span = 1;

    for (let i = r.col + 1; i < colCount; i++) {

      const conflict = columns[i].some(e =>
        !( (e.end ?? e.start) <= r.event.start ||
           e.start >= (r.event.end ?? r.event.start))
      );

      if (conflict) break;

      span++;
    }

    return {
      event: r.event,
      col: r.col,
      span,
      cols: colCount
    }
  });
}

function weekRangeLabel(date) {
  const monday = startOfWeek(date);
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);

  const fmt = { month: 'short', day: 'numeric' };
  return `${monday.toLocaleDateString('default', fmt)} - ${sunday.toLocaleDateString('default', fmt)}, ${sunday.getFullYear()}`;
}

function formError(element) {
    element.focus();
    element.style.borderColor = 'var(--color-danger)';
    element.style.color = 'var(--color-danger)';
    setTimeout(() => { element.style.borderColor = ''; }, 2000);
    setTimeout(() => { element.style.color = ''; }, 2000);
}

function updateNowIndicator() {
  // Remove any existing indicator(s) from a previous tick
  document.querySelectorAll('.week-now-indicator').forEach(el => el.remove());
  document.querySelectorAll('.week-now-indicator-dot').forEach(el => el.remove());

  // Only relevant in week/day view
  if (currentView !== 'week' && currentView !== 'day') return;

  const now = new Date();
  const todayCol = document.querySelector('.week-day-col.today');
  if (!todayCol) return; // today not in the current week

  const fractionalHour = now.getHours() + now.getMinutes() / 60;
  const topPx = fractionalHour * HOUR_H;

  const line = document.createElement('div');
  line.className = 'week-now-indicator';
  line.style.top = `${topPx}px`;
  todayCol.appendChild(line);

  // Add the dot to the time gutter
  const gutter = document.querySelector('.week-time-gutter');
  if (gutter) {
    const dot = document.createElement('div');
    dot.className = 'week-now-indicator-dot';
    dot.style.top = `${topPx}px`;
    gutter.appendChild(dot);
  }
}