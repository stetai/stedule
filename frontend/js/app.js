/**
 * app.js — UI Controller
 */

// -- imports -------------------------------------------------
 
const v = new URL(import.meta.url).search;

const _isTauri = !!window.__TAURI__?.core;

import {
  getLocalSetting,
  getSetting,
  loadSyncedSettings,
  saveLocalSetting,
  saveSyncedSettings,
  setSetting
} from './settings.js';

import {
  getFileName,
  getFilePath,
  hasFileOpen,
  isFirefox,
  openFile,
  openFileByPath,
  openSettingsFile,
  writeFile
} from './storage.js';

import {
  addDays,
  addTime,
  combineDateAndTime,
  createEvent,
  dayDiff,
  endOfDay,
  eventsOnDay,
  getAdjWeekday,
  isSameDay,
  isToday,
  parseICS,
  parseRRule,
  refreshNotifs,
  serializeICS,
  startOfDay,
  startOfWeek,
  toDateInputValue, toTimeInputValue
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
let weekTrackEl    = null;   // the currently-mounted .week-track element
let trackBusy      = false;  // true while a slide/settle animation is in flight
let weekDrag       = null;   // pending/active swipe gesture, mirrors chipDrag's shape
let draftColumn    = null;        // Column of event draft
let resizing       = false;       // Currently resizing event draft?
let startY         = 0;           //|Default values for quickadd outline
let startHeight    = 0;           //|

// dragging an existing (already-saved) event chip
let chipDrag = null;
let suppressNextClick = false; // swallow the ghost click after a non-moving long-press
let suppressClickTimer = null;  // fail-safe so the flag can never outlive the gesture

const LONG_PRESS_MS       = 500;  // touch: hold time before a drag starts
const DRAG_MOVE_PX        = 6;    // mouse: movement before pointerdown counts as a drag
const LONG_PRESS_PX       = 10;   // touch: movement that cancels a pending long-press (=scroll)
const DIM_SPEED_PX_PER_MS = 1.3;  // ripple speed for the dim/un-dim wave
const DIM_TRANSITION_MS   = 220;  // must match .week-event.dim-transition in style.css

//future dynamic access
let _weekDayNum    = 7;
let _firstWeekday  = 0; //0 = "Mon", 1 = "Tue", etc
let _seqcDayNum    = 1;

// UI 
let _savedScrollTop= null;

// Categories
const DEFAULT_EVENT_COLOR = '#A80808';
 
const CATEGORIES = {
  '':          { label: 'No category', color: null,         dismissed: false },
  important:   { label: 'Important',   color: '#f2d9d9',  dismissed: false },
  routine:     { label: 'Routine',     color: '#a64b4b',  dismissed: false },
  chores:      { label: 'Chores',      color: '#a63232',  dismissed: false },
  university:  { label: 'University',  color: '#a6226a',  dismissed: false },
  uni_related: { label: 'Uni-related', color: '#a64b80',  dismissed: false },
  dorm_council:{ label: 'Dorm Council',color: '#8542a6',  dismissed: false },
  social:      { label: 'Social',      color: '#5e3aa6',  dismissed: false },
  hobby:       { label: 'Hobby',       color: '#3a4ca6',  dismissed: false },
  career:      { label: 'Career',      color: '#176399',  dismissed: false },
  dismissed:   { label: 'Dismissed',   color: null,         dismissed: true  },
};

// ============================================================
// DOM REFERENCES
// ============================================================

const $ = id => document.getElementById(id); // tiny shorthand

const elGrid       = $('calendar-grid');
const elPeriod     = $('current-period');
const elStatus     = $('status-bar');
const elOverlay    = $('modal-overlay');
const elModal      = $('event-modal');
const elModalTitle = $('modal-title');
const elTitle      = $('event-title');
const elWeekdays   = $('weekday-headers');
const elStartDate  = $('event-start-date');
const elStartTime  = $('event-start-time');
const elEndDate    = $('event-end-date');
const elEndTime    = $('event-end-time');
const elAllDay     = $('event-allday');
const elCategory   = $('event-category');
const elRepeat     = $('event-repeat');
const elDesc       = $('event-description');
const elColor      = $('event-color');
const elDeleteBtn  = $('modal-delete');

const elSettingsOverlay  = $('settings-overlay');
const elSettingsClose    = $('settings-modal-close');
const elSettingsPathText = $('setting-settings-path');

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

const elDragDropZone   = $('drag-drop-zone');
const elDragCancelZone = $('drag-cancel-zone');

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

async function init() {
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

  $('settings-save').addEventListener('click', async () => {
    if (_isTauri) {
      const settingsPath = await getLocalSetting('settingsPath');
      if (!settingsPath) {// No settings file loaded
        closeSettings();
        setStatus('No settings file loaded. Open a .json file in Settings first.', 'error');
        return;   //exit before saving or claiming success
      }

      const selectedTheme = document.querySelector('input[name="theme"]:checked')?.value;
      if (selectedTheme) setSetting('theme', selectedTheme);

      await saveSyncedSettings(settingsPath);
      setStatus('Settings saved.', 'saved');
    } else {
      // Browser: settings are in-memory only (no sync file)
      const selectedTheme = document.querySelector('input[name="theme"]:checked')?.value;
      if (selectedTheme) setSetting('theme', selectedTheme);
      setStatus('Settings saved (in-memory only).', 'saved');
    }

    closeSettings();
  });

  $('setting-settings-add').addEventListener('click', async () => {
    await handleOpenSettings();
  });

  $('setting-files-add').addEventListener('click', async () => {
    await handleOpenFile();
  });

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

      updateModalKeyboardLayout(offset);

      if (elSettingsOverlay.classList.contains('open')) return;
      if (elOverlay.classList.contains('open')) return;

      const safePx = Math.min(offset, window.innerHeight * 0.5);
      elQuickBar.style.bottom = `${safePx}px`;

      if (weekScrollEl) {
        const bottomOffset = parseFloat(elQuickBar.style.bottom) || 0;
        const quickBarTop  = window.innerHeight - bottomOffset - elQuickBar.offsetHeight;
        const scrollTop    = weekScrollEl.getBoundingClientRect().top;
        const newHeight    = quickBarTop - scrollTop;
        if (newHeight > 50) {
          weekScrollEl.style.maxHeight = `${newHeight}px`; 
        }
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
    e.stopPropagation();
  });

  elOverlay.addEventListener('scroll', (e) => {
    e.stopPropagation();
  })

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

  // all-day
  elAllDay.addEventListener('change', onAllDayToggle);

  // categories
  populateCategoryOptions();
  elCategory.addEventListener('change', updateCategoryUI);

  // recurrence
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
  if (_isTauri) {
    const settingsPath = await getLocalSetting('settingsPath');
    if (settingsPath) {
      try {
        await loadSyncedSettings(settingsPath);
      } catch {
        setStatus('Saved file unavailable. Please re-open manually.', 'error');
      }
    }

    const icsPath = getSetting('icsPath') ?? await getLocalSetting('icsPath');
    if (icsPath) {
      try {
        const raw = await openFileByPath(icsPath);
        events = parseICS(raw);
        renderCalendar();
        setStatus(`Loaded: ${getFileName()} — ${events.length} event(s)`, 'saved');
      } catch {
        setStatus('Calendar file unavailable. Please re-open manually.', 'error');
      }
    }
  }
  updateNowIndicator();
  setInterval(updateNowIndicator, 5 * 1000);
  setInterval(refreshTimeSensitiveUI, 5 * 1000);
}

// ------------------------------------------------------------
// Settings
// ------------------------------------------------------------

async function handleOpenSettings() {
  try {
    let settingsPath;

    if (_isTauri) {
      settingsPath = await openSettingsFile();
      if(!settingsPath) return;
    } else {
      setStatus('Settings file sync is only available in the app.', 'error');
      return;
    }

    await loadSyncedSettings(settingsPath);          
    await saveLocalSetting('settingsPath', settingsPath); // persist path locally

    _updateSettingsPathDisplay(settingsPath);
    setStatus("Loaded: Settings", 'saved');

  } catch (err) {
    if (err.name === 'AbortError') return;
    setStatus(`Error opening settings: ${err?.message ?? String(err)}`, 'error');
  }
}

async function openSettingsModal() {
  _settingChanged = false;

  // load current settings
  // settings
  const settingsPath = _isTauri ? await getLocalSetting('settingsPath') : null;
  _updateSettingsPathDisplay(settingsPath);

  // files
  // categories

  // theme
  const theme = getSetting('theme');
  const radio = document.querySelector(`input[name="theme"][value="${theme}"]`);
  if (radio) radio.checked = true;

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
  if (document.activeElement && elSettingsOverlay.contains(document.activeElement)) {
    document.activeElement.blur();
  }
  
  elSettingsOverlay.classList.remove('open');
  elSettingsOverlay.setAttribute('aria-hidden', 'true');

    elQuickBar.style.bottom = '0px';
}

// ------------------------------------------------------------
// FILE HANDLING
// ------------------------------------------------------------

async function handleOpenFile() {
  try {
    const raw = await openFile(); //set _fileHandle internally
    events = parseICS(raw);
    renderCalendar();

    if (_isTauri) {
      const path = getFilePath();
      if (path) {
        await saveLocalSetting('icsPath', path);

        const settingsPath = await getLocalSetting('settingsPath');
        setSetting('icsPath', path);
        if (settingsPath) await saveSyncedSettings(settingsPath);
      }
    }

    const saveNote = !isFirefox()  ? '' : ' · Firefox: saves will download a new file';
    setStatus(`Loaded: ${getFileName()} — ${events.length} event(s)${saveNote}`, 'saved');

    refreshNotifs(events);

  } catch (err) {
    // don't show error if it comes from user input
    if (err.name === 'AbortError') return;
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
    mountWeekSwipe(); // replaces renderWeekView();
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
const CHIP_PADDING = 2;
const OVERLAY_HEADER_PX  = 30;          // (~title + time line)
const OVERLAY_INSET_PCT  = 10;          // % of the host's width left visible behind guest
const ONE_HOUR_MS        = 60 * 60 * 1000;


function buildWeekPane(baseDate) {
  elGrid.classList.remove('view-day');
  elGrid.classList.add('view-week');

  const monday = startOfWeek(baseDate);

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
    hdr.dataset.date = toDateInputValue(day);
    hdr.addEventListener('click', (e) => {
      e.stopPropagation();
      openNewEventModal(day, '', day, true);
    });

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

  // -- All-day band ---

  const alldayRow = renderAllDayRow(monday, _weekDayNum);
  // stash the true target height of the all-day row
  alldayRow.dataset.naturalMaxHeight = alldayRow.style.maxHeight;
  view.appendChild(alldayRow);

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
  const chipsToCheck = [];
 
  for (let i = 0; i < 7; i++) {
    const day = new Date(monday);
    day.setDate(day.getDate() + i);
    const dayEvents = eventsOnDay(events, day);
 
    const col = document.createElement('div');
    col.className = 'week-day-col' + (isToday(day) ? ' today' : '');
    col.dataset.date = toDateInputValue(day); // lets refreshTimeSensitiveUI() re-check "today" later

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
      if (ev.allDay) continue; // all-day events in the band above
 
      let startH = 0;
      if (isSameDay(ev.start, day)) {
        startH = ev.start.getHours() + ev.start.getMinutes() / 60; 
      }

      const endDate  = ev.end ?? new Date(ev.start.getTime() + 2 * 60 * 60 * 1000); // if unspecified: 2h after start

      let endH = 24;
      if (isSameDay(endDate, day)) {
        endH = endDate.getHours() + endDate.getMinutes() / 60;
      }
      if (isSameDay(endDate, addDays(day, 1)) && endDate.getHours() === 0 && endDate.getMinutes() === 0) {
        endH = 23.99;
      } 

      // multi-day?
      const continuesFromPrev = !isSameDay(ev.start, day) && ev.start < day;
      const continuesToNext = endH === 24;

      // Clamp to a minimum visual height so short events are still clickable
      const duration = Math.max(endH - startH, 0.25);

      const left = item.leftPct;
      const width = item.widthPct;
 
      // Chip styling
      const chip = document.createElement('div');
      chip.className = 'week-event';

      if (item.z > 1) chip.classList.add('week-event-overlay');

      if (continuesFromPrev) chip.classList.add('continues-from-prev');
      if (continuesToNext)   chip.classList.add('continues-to-next');

      chip.style.top        = `${startH * HOUR_H}px`;
      chip.style.height     = `${duration * HOUR_H - 1}px`; //1.5px gap at the bottom
      chip.style.left       = `calc(${left}% + 1px)`;
      chip.style.width      = `calc(${width}% - ${CHIP_PADDING}px)`;
      chip.style.zIndex     = item.z;

      chip.dataset.flipKey = ev.masterId ? `${ev.masterId}::${ev.originalDate}` : `id::${ev.id}`;

      const chipStyle = getEventColorStyle(ev);

      // Stash what applyChipTiming() needs so refreshTimeSensitiveUI() can
      // re-evaluate "is this event over now?" later without redoing layout.
      chip.dataset.endTime  = endDate.getTime();
      chip.dataset.dismissed = chipStyle.dismissed ? '1' : '0';
      chip.dataset.baseColor = chipStyle.baseColor;

      applyChipTiming(chip, endDate.getTime(), chipStyle.dismissed, chipStyle.baseColor);

      // Show title + time if there is enough vertical space
      const titleEl = document.createElement('span');
      titleEl.className = 'week-event-title';
      titleEl.style.color = chipStyle.textColor;
      titleEl.textContent = ev.title;

      const timeEl = document.createElement('span');
      timeEl.className = 'week-event-time';
      timeEl.style.color = chipStyle.textColor;
      if(duration * HOUR_H > 32 && !continuesFromPrev /*&& there are no collisions*/){
        timeEl.textContent = `${formatTime(ev.start)}`;//- ${formatTime(endDate)}`;
      }

      chipsToCheck.push({titleEl, timeEl, widthPct: width});
 
      chip.appendChild(titleEl);
      chip.appendChild(timeEl);
 
      chip.addEventListener('click', (e) => {
        // A long-press that turned into a drag can still end in a native "click"
        if (suppressNextClick) { suppressNextClick = false; return; }
        e.stopPropagation();
        openEditEventModal(ev);
      });

      chip.addEventListener('pointerdown', (e) => onChipPointerDown(e, chip, ev));
 
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

  return { el: view, scrollEl: scroll, alldayRow };

  /*
  body.appendChild(daysWrap);
  scroll.appendChild(body);
  view.appendChild(scroll);
  elGrid.appendChild(view);

  //render titles if chip is wide enough
  const colWidthPx = daysWrap.querySelector('.week-day-col')
                      ?.getBoundingClientRect().width ?? 0;
  const MIN_TITLE_PX = 0.6 * HOUR_H; // reuse HOUR_H as proxy for readable width

  for (const { titleEl, timeEl, widthPct } of chipsToCheck) {
    const effectiveWidthPx = (widthPct / 100) * colWidthPx - CHIP_PADDING;
    if (effectiveWidthPx < MIN_TITLE_PX) {
      titleEl.textContent = '';
      timeEl.textContent = '';
    }
  }

  updateNowIndicator();

  // Restore scroll position if one was saved
  if (_savedScrollTop !== null) {
    scroll.scrollTop = _savedScrollTop;
    _savedScrollTop = null;
  }
  */
}

// --- swipe to navigate ------------------------------

function mountWeekSwipe() {
  const prevPane    = buildWeekPane(addDays(currentDate, -7));
  const currentPane = buildWeekPane(currentDate);
  const nextPane    = buildWeekPane(addDays(currentDate, +7));

  // Freeze all-day row height to transition later
  const currentHeight = currentPane.alldayRow.dataset.naturalMaxHeight;
  freezeAllDayHeight(prevPane.alldayRow, currentHeight);
  freezeAllDayHeight(nextPane.alldayRow, currentHeight);

  const viewport = document.createElement('div');
  viewport.className = 'week-swipe-viewport';

  const track = document.createElement('div');
  track.className = 'week-track';
  track.appendChild(prevPane.el);
  track.appendChild(currentPane.el);
  track.appendChild(nextPane.el);

  viewport.appendChild(track);
  elGrid.appendChild(viewport);

  weekTrackEl  = track;
  weekScrollEl = currentPane.scrollEl;

  if (_savedScrollTop !== null) {
    weekScrollEl.scrollTop = _savedScrollTop;
    _savedScrollTop = null;
  }
  syncScrollAcrossPanes(weekScrollEl);
  updateNowIndicator();

  bindWeekSwipeGestures(viewport);
}

function settleTrack(direction) {
  weekTrackEl.classList.remove('dragging');
  weekTrackEl.classList.add('settling');
  weekTrackEl.style.transform = `translateX(${direction > 0 ? -200 / 3 : 0}%)`;

  weekTrackEl.addEventListener('transitionend', function onEnd(e) {
    if (e.propertyName !== 'transform') return;
    weekTrackEl.removeEventListener('transitionend', onEnd);
    finishWeekChange(direction);
  });
}

function cancelSwipe() {
  weekTrackEl.classList.remove('dragging');
  weekTrackEl.classList.add('settling');
  weekTrackEl.style.transform = 'translateX(-33.3333%)';

  weekTrackEl.addEventListener('transitionend', function onEnd(e) {
    if (e.propertyName !== 'transform') return;
    weekTrackEl.removeEventListener('transitionend', onEnd);
    weekTrackEl.classList.remove('settling');
    trackBusy = false;
  });
}

function finishWeekChange(direction) {
  const track = weekTrackEl;
  const [prevEl, currentEl, nextEl] = track.children;
  const incomingPane = direction > 0 ? nextEl : prevEl; // slid fully into view
  const outgoingRow  = currentEl.querySelector('.week-allday-row');
  const frozenHeight = outgoingRow.style.maxHeight; // what's on-screen right now

  currentDate = addDays(currentDate, 7 * direction);
  elPeriod.textContent = weekRangeLabel(currentDate);

  const farDate = addDays(currentDate, direction > 0 ? 7 : -7);
  const farPane = buildWeekPane(farDate);

  const newCurrentPane = { el: incomingPane, scrollEl: incomingPane.querySelector('.week-scroll'), alldayRow: incomingPane.querySelector('.week-allday-row') };

  track.innerHTML = '';
  if (direction > 0) {
    track.appendChild(currentEl);   // old current -> new prev
    track.appendChild(incomingPane);
    track.appendChild(farPane.el);
  } else {
    track.appendChild(farPane.el);
    track.appendChild(incomingPane);
    track.appendChild(currentEl);   // old current -> new next
  }

  // Snap back to centered, instantly — the visible pane doesn't move.
  track.classList.remove('settling');
  track.style.transition = 'none';
  track.style.transform = 'translateX(-33.3333%)';
  void track.offsetHeight;
  track.style.transition = '';

  freezeAllDayHeight(direction > 0 ? farPane.alldayRow : outgoingRow, frozenHeight);
  freezeAllDayHeight(direction > 0 ? outgoingRow : farPane.alldayRow, frozenHeight);

  weekScrollEl = newCurrentPane.scrollEl;
  if (_savedScrollTop !== null) {
    weekScrollEl.scrollTop = _savedScrollTop;
    _savedScrollTop = null;
  }
  syncScrollAcrossPanes(weekScrollEl);
  updateNowIndicator();

  flipAllDayHeight(newCurrentPane.alldayRow, frozenHeight);

  trackBusy = false;
}

function freezeAllDayHeight(row, heightPx) {
  row.style.transition = 'none';
  row.style.maxHeight = heightPx;
}

// --- All-day band (week view) ---

const ALLDAY_LANE_H    = 16; // px, must match .allday-chip height in style.css
const ALLDAY_MAX_LANES = 3;  // lanes shown before the band starts scrolling

/**
 * Builds the all-day band for one week.
 * An event running past either edge of the week is clipped there and gets
 * square corners on that side (.clip-start / .clip-end), so consecutive weeks
 * read as one continuous chip.
 *
 * @param {Date} weekStart - first day of the week (Monday)
 * @param {number} dayCount
 * @returns {HTMLElement}
 */
function renderAllDayRow(weekStart, dayCount = 7) {
  const row = document.createElement('div');
  row.className = 'week-allday-row';

  // Reuses .week-gutter-spacer so the columns line up with the time grid below
  const spacer = document.createElement('div');
  spacer.className = 'week-gutter-spacer';
  row.appendChild(spacer);

  const wrap = document.createElement('div');
  wrap.className = 'allday-days';
  wrap.style.setProperty('--allday-cols', dayCount);
  wrap.style.setProperty('--allday-lane-h', `${ALLDAY_LANE_H}px`);

  const weekEnd = endOfDay(addDays(weekStart, dayCount - 1));

  // -- Collect one segment per event ---
  // Key on the same identity used for flip animations 

  const seen = new Set();
  const segments = [];

  for (let i = 0; i < dayCount; i++) {
    const day = addDays(weekStart, i);

    for (const ev of eventsOnDay(events, day)) {
      if (!ev.allDay) continue;

      const key = ev.masterId ? `${ev.masterId}::${ev.originalDate}` : `id::${ev.id}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const evEnd = ev.end ?? ev.start;

      segments.push({
        ev,
        key,
        startIdx:  Math.max(0, dayDiff(weekStart, ev.start)),
        endIdx:    Math.min(dayCount - 1, dayDiff(weekStart, evEnd)),
        clipStart: startOfDay(ev.start) < weekStart,
        clipEnd:   evEnd > weekEnd,
        length:    dayDiff(ev.start, evEnd)
      });
    }
  }

  // -- Lane packing --------------------
  // Longest first

  segments.sort((a, b) => b.length - a.length || a.startIdx - b.startIdx);

  const lanes = [];

  for (const seg of segments) {
    let lane = 0;

    while (lanes[lane]?.some(o => o.startIdx <= seg.endIdx && o.endIdx >= seg.startIdx)) {
      lane++;
    }

    (lanes[lane] ??= []).push(seg);
    seg.lane = lane;
  }

  row.style.maxHeight =
    `${Math.min(lanes.length || 1, ALLDAY_MAX_LANES) * (ALLDAY_LANE_H + 2) + 4}px`;

  // -- Chips ---------------------------

  for (const seg of segments) {
    const ev = seg.ev;

    const chip = document.createElement('div');
    chip.className = 'allday-chip';

    if (seg.clipStart) chip.classList.add('clip-start');
    if (seg.clipEnd)   chip.classList.add('clip-end');

    chip.style.gridColumn = `${seg.startIdx + 1} / span ${seg.endIdx - seg.startIdx + 1}`;
    chip.style.gridRow    = seg.lane + 1;

    // Same category styling as the time-grid chips
    const chipStyle = getEventColorStyle(ev);
    const endMs     = (ev.end ?? ev.start).getTime();

    chip.dataset.flipKey   = seg.key;
    chip.dataset.endTime   = endMs;
    chip.dataset.dismissed = chipStyle.dismissed ? '1' : '0';
    chip.dataset.baseColor = chipStyle.baseColor;

    applyChipTiming(chip, endMs, chipStyle.dismissed, chipStyle.baseColor);

    chip.style.color = chipStyle.textColor;
    chip.textContent = ev.title; // title only
    chip.title       = ev.title; // tooltip for ellipsised titles

    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditEventModal(ev);
    });

    // No pointerdown yet (it does not work)
    // TODO: make it work

    wrap.appendChild(chip);
  }

  // -- Click empty space to add an all-day event --
  wrap.addEventListener('click', (e) => {
    if (e.target.closest('.allday-chip')) return;

    const rect = wrap.getBoundingClientRect();
    const idx  = Math.floor((e.clientX - rect.left) / (rect.width / dayCount));
    const day  = addDays(weekStart, Math.max(0, Math.min(dayCount - 1, idx)));

    openNewEventModal(day, '', day, true);
  });

  row.appendChild(wrap);
  return row;
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
  label.addEventListener('click', (e) => {
    e.stopPropagation();
    openNewEventModal(date, '', date, true);
  });
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

  if (ev.allDay) chip.classList.add('allday');

  const chipStyle        = getEventColorStyle(ev);
  chip.style.background  = chipStyle.baseColor;
  chip.style.color       = chipStyle.textColor;

  chip.addEventListener('click', (e) => {
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

    document.addEventListener('pointermove', onDraftMove);
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

function onDraftMove(e) {
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

  document.removeEventListener('pointermove', onDraftMove);
  document.removeEventListener('pointerup', stopMove);
}

function autoScrollDuringDrag(e, boundaryEl = elQuickBar) {

  if (!weekScrollEl) return;

  const rect = weekScrollEl.getBoundingClientRect();
  const boundaryRect = boundaryEl.getBoundingClientRect();

  const edge = 60;        // trigger zone

  const grid = weekScrollEl.querySelector('.week-body');

  const gridHeight = grid.offsetHeight;
  const visibleHeight = weekScrollEl.clientHeight;

  const maxScroll = Math.max(0, gridHeight - visibleHeight);

  const distTop = rect.top + edge - e.clientY;
  const distBot = e.clientY - (boundaryRect.top - edge);

  if (distTop > 0) {
    weekScrollEl.scrollTop =
      Math.max(0, weekScrollEl.scrollTop - distTop * 0.1);
  }

  if (distBot > 0) {
    weekScrollEl.scrollTop =
      Math.min(maxScroll, weekScrollEl.scrollTop + distBot * 0.1);
  }

  if (weekScrollEl) _savedScrollTop = weekScrollEl.scrollTop;
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

// --------------------------------------------------------
// dragging an existing event chip
// --------------------------------------------------------
//
// Mouse and touch both start here on pointerdown, then branch:
//   mouse       -> onChipPointerMovePending promotes to a drag once the
//                  pointer has moved DRAG_MOVE_PX (so a plain click still
//                  works normally)
//   touch / pen -> a LONG_PRESS_MS timer promotes to a drag; moving more
//                  than LONG_PRESS_PX before it fires cancels the timer
//                  instead, so the page can still be scrolled normally

/**
 * Arms the guard in the chip's click listener. Self-expiring.
 */
function armClickSuppression() {
  suppressNextClick = true;
  clearTimeout(suppressClickTimer);
  suppressClickTimer = setTimeout(() => { suppressNextClick = false; }, 400);
}

function onChipPointerDown(e, chip, ev) {
  if (e.target.closest('.week-event-resize')) return; // no resize handle on chips (yet)
  if (chipDrag) return;                                // a drag is already in progress
  if (e.pointerType === 'mouse' && e.button !== 0) return; // left button only

  // Scrolling during an active drag is blocked by blockTouchScroll()

  chipDrag = {
    chip, ev,
    pointerId: e.pointerId,
    pointerType: e.pointerType,
    startX: e.clientX,
    startY: e.clientY,
    longPressTimer: null,
    active: false,
    col: chip.parentNode,
  };

  if (e.pointerType !== 'mouse') {
    chipDrag.longPressTimer = setTimeout(() => {
      if (!chipDrag || chipDrag.chip !== chip) return;
      tryBeginChipDrag(e);
    }, LONG_PRESS_MS);
  }

  document.addEventListener('pointermove', onChipPointerMovePending);
  document.addEventListener('pointerup', onChipPointerUpPending);
  document.addEventListener('pointercancel', onChipPointerCancelPending); // pointer is captured by another element
}

function onChipPointerMovePending(e) {
  if (!chipDrag || chipDrag.active) return;
  if (e.pointerId !== chipDrag.pointerId) return;

  const dist = Math.hypot(e.clientX - chipDrag.startX, e.clientY - chipDrag.startY);

  if (chipDrag.pointerType === 'mouse') {
    if (dist > DRAG_MOVE_PX) tryBeginChipDrag(e);
  } else if (dist > LONG_PRESS_PX) { // scrolling
    cancelPendingChipDrag();
  }
}

function onChipPointerUpPending(e) {
  if (!chipDrag || chipDrag.active) return;
  if (e.pointerId !== chipDrag.pointerId) return;
  cancelPendingChipDrag(); // click if released before a drag started
}

function onChipPointerCancelPending(e) {
  if (!chipDrag || chipDrag.active) return;
  if (e.pointerId !== chipDrag.pointerId) return;
  cancelPendingChipDrag();
}

function cancelPendingChipDrag() {
  if (!chipDrag) return;
  clearTimeout(chipDrag.longPressTimer);
  removePendingChipListeners();
  chipDrag = null;
}

function removePendingChipListeners() {
  document.removeEventListener('pointermove', onChipPointerMovePending);
  document.removeEventListener('pointerup', onChipPointerUpPending);
  document.removeEventListener('pointercancel', onChipPointerCancelPending);
}

function removeActiveChipListeners() {
  document.removeEventListener('pointermove', onChipDragMove);
  document.removeEventListener('pointerup', onChipDragEnd);
  document.removeEventListener('pointercancel', onChipDragEnd);
  document.removeEventListener('touchmove', blockTouchScroll);
}

function blockTouchScroll(e) {
  if (e.cancelable) e.preventDefault();
}

/**
 * make sure a throw can never leave chipDrag behind.
 */
function tryBeginChipDrag(e) {
  try {
    beginChipDrag(e);
  } catch (err) {
    console.error('Could not start dragging this event:', err);
    abortChipDrag();
  }
}

function abortChipDrag() {
  removePendingChipListeners();
  removeActiveChipListeners();

  document.body.style.overflow = '';
  elDragDropZone.classList.remove('open');
  elDragCancelZone.classList.remove('armed');

  if (chipDrag) {
    clearTimeout(chipDrag.longPressTimer);
    chipDrag.chip.classList.remove('dragging', 'will-cancel', 'returning');
    chipDrag = null;
  }

  cleanupDimClasses();
  renderCalendar(); // discard whatever half-applied inline geometry is left
}

function beginChipDrag(e) {
  removePendingChipListeners();
  clearTimeout(chipDrag.longPressTimer);

  const { chip, ev } = chipDrag;

  closeQuickAdd(); // a draft and a chip-drag shouldn't be open at once

  const evEnd = ev.end ?? new Date(ev.start.getTime() + 1.5 * ONE_HOUR_MS);

  chipDrag.active         = true;
  chipDrag.origTop        = chip.style.top;
  chipDrag.origLeft       = chip.style.left;
  chipDrag.origWidth      = chip.style.width;
  chipDrag.origHeight     = chip.style.height;
  chipDrag.origCol        = chip.parentNode;
  chipDrag.startTop       = chip.offsetTop;
  chipDrag.startScrollTop = weekScrollEl.scrollTop;
  chipDrag.origStart      = ev.start;
  chipDrag.origEnd        = evEnd;
  chipDrag.durationMs     = evEnd - ev.start;
  chipDrag.newStart       = ev.start;
  chipDrag.newEnd         = evEnd;

  // which day of the span
  const grabbedDate = chipDrag.col.dataset.date
    ? new Date(`${chipDrag.col.dataset.date}T00:00:00`)
    : new Date(ev.start);
  chipDrag.grabDayOffset = dayDiff(startOfDay(ev.start), startOfDay(grabbedDate));

  try { chip.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }

  // Widen the chip to the full column width for the duration of the drag.
  chip.style.left  = '0px';
  chip.style.right = '0px';
  chip.style.width = 'auto';

  // An event that runs past midnight was rendered clipped at the day boundary;
  // show its real length while it is being dragged. (Hours, not milliseconds -
  // and style.height needs a unit or the assignment is silently dropped.)
  const durationH = chipDrag.durationMs / ONE_HOUR_MS;
  const clampedH  = Math.min(Math.max(durationH, 0.25), 24);
  chip.style.height = `${clampedH * HOUR_H - 1}px`;

  chip.classList.add('dragging');

  const chipRect = chip.getBoundingClientRect();
  rippleDim(chipRect.left + chipRect.width / 2, chipRect.top + chipRect.height / 2, true, chip);

  elDragDropZone.classList.add('open');

  document.addEventListener('pointermove', onChipDragMove);
  document.addEventListener('pointerup', onChipDragEnd);
  document.addEventListener('pointercancel', onChipDragEnd);
  document.addEventListener('touchmove', blockTouchScroll, { passive: false });
}

function onChipDragMove(e) {
  if (!chipDrag?.active) return;
  if (e.pointerId !== chipDrag.pointerId) return;

  document.body.style.overflow = 'hidden'; // TODO: Is this where we can display event length exceeding 24h? 

  const { chip } = chipDrag;

  // Same geometry-based column-switch hit-test as onMove()
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const newCol = el?.closest('.week-day-col');

  if (newCol && newCol !== chipDrag.col) {
    chipDrag.col = newCol;
    newCol.appendChild(chip);
  }

  const colDate = chipDrag.col.dataset.date;
  let newDate;
  if (colDate) {
    newDate = new Date(`${colDate}T00:00:00`);
  } else {
    const monday   = startOfWeek(currentDate);
    const colIndex = [...chipDrag.col.parentNode.children].indexOf(chipDrag.col);
    newDate = new Date(monday);
    newDate.setDate(monday.getDate() + colIndex);
  }

  // multi-day event's first day tracks pointer
  newDate.setDate(newDate.getDate() - chipDrag.grabDayOffset);

  if (chipDrag.grabDayOffset === 0) {
    // Grabbed the real start segment: vertical position is a genuine time.
    const scrollDelta = weekScrollEl.scrollTop - chipDrag.startScrollTop;
    const dy = e.clientY - chipDrag.startY + scrollDelta;
    const snap = HOUR_H / 4; // 15 minutes
    let newTop = Math.round((chipDrag.startTop + dy) / snap) * snap;
    const maxTop = 23.75 * HOUR_H;
    newTop = Math.max(0, Math.min(newTop, maxTop));

    chip.style.top = `${newTop}px`;

    const startHours = newTop / HOUR_H;
    newDate.setHours(Math.floor(startHours), Math.round((startHours % 1) * 60), 0, 0);
  } else {
    // Grabbed a continuation segment: no real time to derive from pixels.
    chip.style.top = '0px';
    newDate.setHours(chipDrag.origStart.getHours(), chipDrag.origStart.getMinutes(), 0, 0);
  }

  chipDrag.newStart = newDate;
  chipDrag.newEnd   = new Date(newDate.getTime() + chipDrag.durationMs);


  const timeEl = chip.querySelector('.week-event-time');
  if (timeEl) {
    timeEl.textContent = formatTime(chipDrag.newStart);
  }

  // Cancel-zone hover feedback. The reserved prev/next-week zones (see
  // index.html) have no logic of their own yet, so dropping on any part
  // of the bar - cancel zone or reserved zone alike - currently cancels.
  const overDropZone = !!el?.closest('.drag-zone');
  chip.classList.toggle('will-cancel', overDropZone);
  elDragCancelZone.classList.toggle('armed', !!el?.closest('.drag-zone-cancel'));

  autoScrollDuringDrag(e, elDragDropZone);
}

function onChipDragEnd(e) {
  if (!chipDrag?.active) return;
  if (e.pointerId !== chipDrag.pointerId) return;

  document.body.style.overflow = '';
  removeActiveChipListeners();

  const { chip, ev, newStart, newEnd, origStart, origEnd } = chipDrag;

  try { chip.releasePointerCapture(e.pointerId); } catch { /* already released */ }

  const cancelled = chip.classList.contains('will-cancel');

  elDragDropZone.classList.remove('open');
  elDragCancelZone.classList.remove('armed');

  // Every drag ends in a native click on the chip, cancelled or not, so the
  // guard has to be armed on both paths - otherwise cancelling a drag opens
  // the edit modal for the event you just decided not to move.
  armClickSuppression();

  // Un-dim everyone else, radiating outward from wherever this was let go.
  const waitMs = rippleDim(e.clientX, e.clientY, false, chip);

  if (cancelled) {
    returnChipToOrigin(chipDrag);
    chipDrag = null;
    setTimeout(cleanupDimClasses, waitMs);
    return;
  }

  chip.classList.remove('dragging', 'will-cancel');
  chipDrag = null;

  const unchanged = newStart.getTime() === origStart.getTime()
                 && newEnd.getTime()   === origEnd.getTime();

  // Finish un-dim ripple before rerendering
  setTimeout(() => {
    cleanupDimClasses();
    if (unchanged) {
      // Don't save but rerender to ensure the chip is back in original position
      renderCalendar();
    } else {
      commitDraggedEvent(ev, newStart, newEnd);
    }
  }, waitMs);
}

/**
 * Persists a dragged event's new start/end. 
 * Recurring occurrences get a sparse per-occurrence exception.
 */
function commitDraggedEvent(draggedEv, newStart, newEnd) {
  const idx = events.findIndex(e => e.id === (draggedEv.masterId ?? draggedEv.id));
  if (idx === -1) return;

  events[idx] = draggedEv.masterId
    ? {
        ...events[idx],
        exceptions: {
          ...events[idx].exceptions,
          [draggedEv.originalDate]: {
            ...events[idx].exceptions?.[draggedEv.originalDate],
            start: newStart,
            end: newEnd,
          },
        },
      }
    : { ...events[idx], start: newStart, end: newEnd };

  flipRerender(renderCalendar);
  save();
  refreshNotifs(events);
}

/**
 * Fades every .week-event chip except `exceptChip` in (dimming = false) or
 * out (dimming = true), with each chip's transition-delay set proportional
 * to its distance from (originX, originY) to create ripple effect.
 * Returns how many ms until the slowest chip finishes
 */
function rippleDim(originX, originY, dimming, exceptChip = null) {
  const chips = [...document.querySelectorAll('.week-event')].filter(c => c !== exceptChip);

  let maxDelay = 0;

  for (const chip of chips) {
    const r = chip.getBoundingClientRect();
    const dx = (r.left + r.width / 2) - originX;
    const dy = (r.top  + r.height / 2) - originY;
    const delay = Math.hypot(dx, dy) / DIM_SPEED_PX_PER_MS;
    maxDelay = Math.max(maxDelay, delay);

    chip.classList.add('dim-transition');
    chip.style.transitionDelay = `${delay}ms`;
  }

  // Wait a frame so every chip's transition-delay is registered before the
  // opacity class below is applied
  requestAnimationFrame(() => {
    for (const chip of chips) chip.classList.toggle('dimmed', dimming);
  });

  return maxDelay + DIM_TRANSITION_MS;
}

function cleanupDimClasses() {
  document.querySelectorAll('.week-event.dim-transition').forEach(chip => {
    chip.classList.remove('dim-transition', 'dimmed');
    chip.style.transitionDelay = '';
  });
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
  elQuickBar.style.bottom = '0px';
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
    rrule: null,
    allDay: false // quick add is driven by the time grid
                  // TODO: make it depend on whether the user clicked the all-day band or a timed slot
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

const DEFAULT_TIMED_START = '09:00';
const DEFAULT_TIMED_END   = '10:30';

function openNewEventModal(date, title='', end=null, openAllDay=false) {
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
  elCategory.value   = '';
  elDesc.value       = '';
  elColor.value      = DEFAULT_EVENT_COLOR;
  elColor.disabled   = false;
  elRepeat.value     = '';
  elRepeatInterval.value = 1;
  elRepeatEndType.value = '';
  elRepeatCount.value = '';
  elRepeatUntil.value = '';

  document
    .querySelectorAll("#repeat-weekdays input")
    .forEach(cb => cb.checked = false);

  elAllDay.checked = !!openAllDay; // true if clicked on all-day band

  if (openAllDay) {
    // The dimmed time fields preview what unticking would give back
    elStartTime.value = DEFAULT_TIMED_START;
    elEndTime.value   = DEFAULT_TIMED_END;
  }

  updateRepeatUI();
  updateCategoryUI();
  updateAllDayUI();

  openModal();

  closeQuickAdd();

  // Focus the title field so the user can start typing immediately.
  elTitle.focus();

  rememberDuration(); // remember duration for editing
}

/**
 * Builds the <option> elements for the category dropdown from the
 * CATEGORIES config object. Called on init. If a future
 * Settings panel lets users edit categories, call this again after
 * any change to CATEGORIES.
 */
function populateCategoryOptions() {
  elCategory.innerHTML = '';
  for (const [key, cat] of Object.entries(CATEGORIES)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = cat.label;
    elCategory.appendChild(opt);
  }
}

/**
 * Syncs the colour picker with the currently selected category.
 * Categories with a defined colour force the colour field to that
 * value and lock it, so the two can't drift out of sync; "No
 * category" hands control back to the user.
 */
function updateCategoryUI() {
  const cat = CATEGORIES[elCategory.value];
 
  if (cat && cat.color) {
    elColor.value = cat.color;
    elColor.disabled = true;
  } else {
    elColor.disabled = false;
  }
}

// -- all-day ------------------------------------------------

/**
 * Called when the user ticks/unticks "All day".
 */
function onAllDayToggle() {
  if (elAllDay.checked) {
    if (!elStartTime.value) elStartTime.value = DEFAULT_TIMED_START;
    if (!elEndTime.value)   elEndTime.value   = DEFAULT_TIMED_END;
  }

  updateAllDayUI();
  rememberDuration();
}

/**
 * Reflects the all-day state in the time inputs: disabled and dimmed while
 * all-day is on, editable otherwise. Values are left untouched either way.
 */
function updateAllDayUI() {
  const on = elAllDay.checked;

  elStartTime.disabled = on;
  elEndTime.disabled   = on;

  document
    .querySelectorAll('.time-field')
    .forEach(el => el.classList.toggle('is-disabled', on));
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
  elCategory.value  = ev.categories ?? '';
  elDesc.value      = ev.description ?? '';
  elColor.value     = ev.color ?? DEFAULT_EVENT_COLOR;

  elAllDay.checked  = !!ev.allDay;

  // remembered times or defaults for all-day events
  if (ev.allDay) {
    elStartTime.value = ev.timedStart ?? DEFAULT_TIMED_START;
    elEndTime.value   = ev.timedEnd   ?? DEFAULT_TIMED_END;
  }

  updateCategoryUI(); //re-locks the colour field if category controls it
  updateAllDayUI();

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
  closeQuickAdd();

  rememberDuration(); // remember duration for editing
}

const KEYBOARD_THRESHOLD = 100; 

function updateModalKeyboardLayout(keyboardOffset) {
  if (!elOverlay.classList.contains('open')) {
    elOverlay.classList.remove('keyboard-open');
    //elModal.style.removeProperty('--modal-kb-height');
    elOverlay.style.removeProperty('top');
    elOverlay.style.removeProperty('height');
    return;
  }

  const vv = window.visualViewport;

  elOverlay.style.top    = `${vv.offsetTop}px`;
  elOverlay.style.height = `${vv.height}px`;

  if (keyboardOffset <= KEYBOARD_THRESHOLD) {
    elOverlay.classList.remove('keyboard-open');
    return;
  }

  elOverlay.classList.add('keyboard-open');
} 

function openModal() {
  elOverlay.classList.add('open');
  elOverlay.setAttribute('aria-hidden', 'false');
}

function closeModal() {

  if (document.activeElement && elOverlay.contains(document.activeElement)) { // prevent aria-hidden warning in Chrome
    document.activeElement.blur();
  }
  
  elOverlay.classList.remove('open');
  elOverlay.classList.remove('keyboard-open');
  elModal.style.removeProperty('--modal-kb-height');
  elOverlay.style.removeProperty('top');
  elOverlay.style.removeProperty('height');
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

  const allDay = elAllDay.checked;

  // All-day events span whole days internally: midnight to 23:59:59.999 of the
  // last day. serializeICS() converts that to the exclusive DTEND the spec
  // wants. 
  const start = allDay
    ? startOfDay(new Date(elStartDate.value + 'T00:00:00'))
    : combineDateAndTime(elStartDate.value, elStartTime.value);

  const end = allDay
    ? endOfDay(new Date(elEndDate.value + 'T00:00:00'))
    : combineDateAndTime(elEndDate.value, elEndTime.value);

  const timedStart = allDay ? (elStartTime.value || DEFAULT_TIMED_START) : null;
  const timedEnd   = allDay ? (elEndTime.value   || DEFAULT_TIMED_END)   : null;

  if (end < start) {
    if (elStartDate.value === elEndDate.value) {
      formError(elEndTime);
      return;
    } else {
      formError(elEndDate);
      return;
    }
  }

  const categories = elCategory.value || null;

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
    _pendingSave = { title, start, end, description: elDesc.value, color: elColor.value, rrule, categories, allDay, timedStart, timedEnd };
    elScopeDesc.textContent = 
      'This is a recurring event. Do you want to apply the changes to just this occurrence, or all occurrences?';
    $('scope-this').textContent = 'This event';
    $('scope-all').textContent = 'All events';
    openScopeDialog();
    return; // wait for scope choice before saving
  }

  // Non-recurring
  _commitRecurrenceSaveNow({title, start, end, description: elDesc.value, color: elColor.value, rrule, categories, allDay, timedStart, timedEnd}, 'all');
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
  const { title, start, end, description, color, rrule, categories, allDay, timedStart, timedEnd } = fields;
 
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
        if (categories  !==  (master.categories ?? null)) exception.categories = categories;
        if (allDay      !== !!master.allDay)    exception.allDay      = allDay;
 
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
        events[idx] = { ...events[idx], title, start, end, description, color, categories, rrule, allDay, timedStart, timedEnd};
      }
    }
  } else {
    // Brand new event
    events.push(createEvent({ title, start, end, description, color, categories, rrule, allDay, timedStart, timedEnd }));
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

// settings

function _updateSettingsPathDisplay(path) {
  if (!path) {
    elSettingsPathText.style.display = 'none';
    elSettingsPathText.textContent = '';
  } else {
    elSettingsPathText.textContent = path;
    elSettingsPathText.style.display = '';
  }
}

// keep event duration when changing start time in the modal --

let _modalDuration  = null;
let _modalStartDate = null; // YYYY-MM-DD, used for whole-day shifts

function rememberDuration() {
  const start = combineDateAndTime(elStartDate.value, elStartTime.value);
  const end = combineDateAndTime(elEndDate.value, elEndTime.value);

  if (start && end) {
    _modalDuration = end - start;
  }

  _modalStartDate = elStartDate.value;
}

function shiftEndWithStart() {
  // All-day events must be shifted in whole days. Account for DST change.
  if (elAllDay.checked) {
    if (!elStartDate.value || !elEndDate.value) return;

    const oldStart = new Date(_modalStartDate + 'T00:00:00');
    const newStart = new Date(elStartDate.value + 'T00:00:00');
    const oldEnd   = new Date(elEndDate.value + 'T00:00:00');

    const span = dayDiff(oldStart, oldEnd);
    if (span >= 0) elEndDate.value = toDateInputValue(addDays(newStart, span));

    _modalStartDate = elStartDate.value;
    return;
  }

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

const offWhite = '#f2ece8'
const offBlack = '#1a1a1a'

function hexToRGBA(hex, alpha) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Multiplies two RGB colours together.
 * @param {hex} c1 
 * @param {*} c2 
 */
function multiplyHex(c1, c2) {
  if (typeof c2 === 'number' && c2 >= 0 && c2 <= 1) {
    const r = Math.round(parseInt(c1.slice(1,3),16) * c2);
    const g = Math.round(parseInt(c1.slice(3,5),16) * c2);
    const b = Math.round(parseInt(c1.slice(5,7),16) * c2);
    return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
  } else if (typeof c2 === 'string' && c2.startsWith('#')) {
    const r = Math.round(parseInt(c1.slice(1,3),16) * parseInt(c2.slice(1,3),16) / 255);
    const g = Math.round(parseInt(c1.slice(3,5),16) * parseInt(c2.slice(3,5),16) / 255);
    const b = Math.round(parseInt(c1.slice(5,7),16) * parseInt(c2.slice(5,7),16) / 255);
    return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
  } else {
    throw new Error('Invalid argument for multiplyHex');
  }
}

/**
 * Picks black or white text so it stays readable on top of an
 * arbitrary hex background colour 
 *
 * Uses the WCAG 2.1 relative luminance formula and picks whichever
 * of black/white gives the higher contrast ratio against `hex`.
 * Source: https://www.w3.org/TR/WCAG21/relative-luminance.html
 *
 * @param {string} hex - background colour
 * @returns {string} hex '#f2ece8' or '#1a1a1a'
 */
function getContrastTextColor(hex) {
  if (!hex) return offWhite;
 
  const toLinear = (channelHex) => {
    const c = parseInt(channelHex, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
 
  const r = toLinear(hex.slice(1, 3));
  const g = toLinear(hex.slice(3, 5));
  const b = toLinear(hex.slice(5, 7));
 
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
 
  // Contrast ratio formula: (L1 + 0.05) / (L2 + 0.05), lighter over darker.
  const contrastWithWhite = (1.0 + 0.05) / (luminance + 0.05);
  const contrastWithBlack = (luminance + 0.05) / (0.0 + 0.05);
 
  return contrastWithWhite >= contrastWithBlack ? offWhite : offBlack;
}


/**
 * Paints an event chip's background (and border, for "Dismissed")
 * and returns the text colour that should be used on top of it.
 * Shared by both the month-view chip and the week-view chip so the
 * two views can't drift out of sync.
 *
 * @param {HTMLElement} el - the chip element to style
 * @param {object} ev      - the event (needs .color, .category)
 * @returns {dict} color (hex)     - chip's background colour
 *                 textColor (hex) - text colour for this chip's title/time
 *                 dismissed (bool)- whether or not event is dismissed
 */
function getEventColorStyle(ev) {
  let color = ev.color || DEFAULT_EVENT_COLOR;
 
  if (ev.categories && CATEGORIES[ev.categories]) {
    const cat = CATEGORIES[ev.categories];
    if (cat.color) {color = cat.color;}
  }

  const dismissed = ev.categories === 'dismissed';

  const appBg = getComputedStyle(document.body).getPropertyValue('--color-bg').trim();

  const contrastBase = dismissed ? appBg : color;

  const textColor = getContrastTextColor(contrastBase);

  return {
    baseColor: color, 
    textColor,
    dismissed
  };

  /*if (ev.categories && !CATEGORIES[ev.categories]) {
    color = '#000'; // category error
  }*/
}

/**
 * Sets an event chip's background/border based on whether its end time
 * has passed. Shared by chip creation (renderWeekView) and the periodic
 * refreshTimeSensitiveUI() sweep, so the two can't drift out of sync.
 */
function applyChipTiming(chip, endTime, dismissed, baseColor) {
  const isPast = endTime < Date.now();

  let border = baseColor;
  let background = baseColor;

  if (isPast) {    
    background = multiplyHex(baseColor, 0.6);
    border = multiplyHex(baseColor, 0.6);

  } 

  if (dismissed) { 
    background = hexToRGBA(background, 0.4);
  } else {
    border = null;
  }

  chip.style.background = background;
  chip.style.border = border ? `2px solid ${border}` : '';
}

// event tiling upon collision

function packColumns(events, endOf = (e) => (e.end ?? e.start)) {

  const sorted = [...events]
    .filter(ev => !ev.allDay)
    .sort((a,b) =>
      a.start - b.start || (endOf(b) - b.start) - (endOf(a) - a.start)
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

      if (!last || endOf(last) <= ev.start) {
        col.push(ev);
        positioned.push({event: ev, col: colIndex});
        break;
      }

      colIndex++;
    }

  }

  const colCount = columns.length;

  const items = positioned.map(r => ({
    event: r.event,
    col: r.col,
    span: spanForInterval(r.col, colCount, columns, r.event),
    cols: colCount,
  }));

  return { items, columns, colCount };
}

// Picks the *tightest* (latest-starting) valid host if several contain it.
function findOverlayHost(ev, candidates, headerClearanceHours) {
  let best = null, bestStart = 0, bestEnd = 24 * ONE_HOUR_MS;
  for (const host of candidates) {

    if (host === ev) continue;
    const hostStart = host.start.getTime();
    const hostEnd    = (host.end ?? host.start).getTime();
    const evEnd      = ev.end ?? ev.start;

    const startsInside = hostStart <= ev.start && ev.start < hostEnd;
    const clearsHeader = (ev.start - hostStart) >= headerClearanceHours * ONE_HOUR_MS;
    const hostIsLonger = (hostEnd - hostStart) > (evEnd - ev.start);

    if (!startsInside) continue;
    if (!clearsHeader) continue;
    if (hostStart > bestStart || (hostStart === bestStart && hostEnd < bestEnd)) {
      best = host; bestStart = hostStart; bestEnd = hostEnd;
    }

    /*if (clearsHeader && ev.start < hostEnd){//contained && clearsHeader && hostIsLonger) {
      if (!best || host.start > best.start) best = host;
    }*/
  }
  return best;
}

function layoutDayEvents(events) {
  const timed = events.filter(ev => !ev.allDay);
  const headerClearanceHours = OVERLAY_HEADER_PX / HOUR_H;

  const hostMap = new Map(); // guest -> host
  for (const ev of timed) {
    const host = findOverlayHost(ev, timed, headerClearanceHours);
    if (host) hostMap.set(ev, host);
  }

  const guestsByHost = new Map();
  for (const [guest, host] of hostMap) {
    if (!guestsByHost.has(host)) guestsByHost.set(host, []);
    guestsByHost.get(host).push(guest);
  }

  // A host's slot effectively lasts until the end of its latest (transitive) guest.
  const _effEndCache = new Map();
  function effectiveEndOf(ev) {
    if (_effEndCache.has(ev)) return _effEndCache.get(ev);
    let end = ev.end ?? ev.start;
    for (const g of (guestsByHost.get(ev) || [])) {
      const ge = effectiveEndOf(g);
      if (ge > end) end = ge;
    }
    _effEndCache.set(ev, end);
    return end;
  }

  const baseEvents = timed.filter(ev => !hostMap.has(ev));
  const { items: baseLayout, columns: baseColumns, colCount: baseColCount } = packColumns(baseEvents, effectiveEndOf);
  const baseEventSet = new Set(baseEvents);

  const boxByEvent = new Map();
  const results = [];

  for (const item of baseLayout) {
    const baseWidth = 100 / item.cols;
    const box = {
      leftPct: baseWidth * item.col,
      widthPct: baseWidth * item.span,
      col: item.col,
      z: 1,
    };
    boxByEvent.set(item.event, box);
    results.push({ event: item.event, leftPct: box.leftPct, widthPct: box.widthPct, z: box.z });
  }

  // Kahn's-algorithm-style worklist
  let pending = new Set(guestsByHost.keys());
  while (pending.size > 0) {
    let progressed = false;

    for (const host of pending) {
      if (!boxByEvent.has(host)) continue;

      const hostBox = boxByEvent.get(host);
      const guests  = guestsByHost.get(host);

      let availableWidthPct = hostBox.widthPct; // fallback: chained hosts keep old behavior

      if (baseEventSet.has(host)) {
        const groupStart = new Date(Math.min(...guests.map(g => g.start)));
        const groupEnd   = new Date(Math.max(...guests.map(g => (g.end ?? g.start))));
        const guestSpan  = spanForInterval(hostBox.col, baseColCount, baseColumns,
                                            { start: groupStart, end: groupEnd });
        availableWidthPct = (100 / baseColCount) * guestSpan;
      }

      const insetLeft  = hostBox.leftPct + hostBox.widthPct * (OVERLAY_INSET_PCT / 100);
      const insetWidth = availableWidthPct - hostBox.widthPct * (OVERLAY_INSET_PCT / 100);

      const guestLayout = packColumns(guests, effectiveEndOf).items;
      for (const g of guestLayout) {
        const gBaseWidth = insetWidth / g.cols;
        const box = {
          leftPct: insetLeft + gBaseWidth * g.col,
          widthPct: gBaseWidth * g.span,
          col: 0,
          z: hostBox.z + 1,
        };
        boxByEvent.set(g.event, box);
        results.push({ event: g.event, leftPct: box.leftPct, widthPct: box.widthPct, z: box.z });
      }

      pending.delete(host);
      progressed = true;
    }

    if (!progressed) break; // defensive: shouldn't happen (see note below), avoids an infinite loop
  }

  return results;
}

// number of columns that an interval can occupy to the right
function spanForInterval(colIndex, colCount, columns, interval, ignore=null) {
  let span = 1;
  for (let i = colIndex + 1; i < colCount; i++) {
    const conflict = columns[i].some(e =>
      (!ignore || !ignore.has(e)) &&
      !((e.end ?? e.start) <= interval.start ||
      e.start >= (interval.end ?? interval.start))
    );
    if (conflict) break;
    span++;
  }
  return span;
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

/**
 * Animates a cancelled drag's chip back to its pre-drag position, size and column.
 */
function returnChipToOrigin(drag) {
  const { chip, origCol, origTop, origLeft, origWidth, origHeight } = drag;

  const beforeRect = chip.getBoundingClientRect();

  if (chip.parentNode !== origCol) origCol.appendChild(chip);

  const parentRect = origCol.getBoundingClientRect();

  chip.style.transition = 'none';
  chip.style.top    = `${beforeRect.top  - parentRect.top}px`;
  chip.style.left   = `${beforeRect.left - parentRect.left}px`;
  chip.style.right  = '';
  chip.style.width  = `${beforeRect.width}px`;
  chip.style.height = `${beforeRect.height}px`;

  void chip.offsetHeight; // force layout: commit change before animation.

  chip.classList.add('returning');
  chip.style.transition = '';

  requestAnimationFrame(() => {
    chip.style.top    = origTop;
    chip.style.left   = origLeft;
    chip.style.width  = origWidth;
    chip.style.height = origHeight;
  });

  let cleanedUp = false;
  const finish = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    clearTimeout(fallback);
    chip.removeEventListener('transitionend', done);
    chip.classList.remove('returning', 'dragging', 'will-cancel');
  };

  function done(ev) {
    if (ev.propertyName !== 'top') return; // four properties animate together; fire once
    finish();
  }

  const fallback = setTimeout(finish, 400); // > the 260ms .returning transition

  chip.addEventListener('transitionend', done);
}

/**
 * smoothly animates every .week-event chip whose position or size changed
 */
function flipRerender(applyChanges) {
  const before = new Map();
  document.querySelectorAll('.week-event[data-flip-key]').forEach(chip => {
    const key = chip.dataset.flipKey;
    if (!before.has(key)) before.set(key, []);
    before.get(key).push(chip.getBoundingClientRect());
  });
 
  applyChanges();

  const segmentSeen = new Map();
 
  document.querySelectorAll('.week-event[data-flip-key]').forEach(chip => {
    const key = chip.dataset.flipKey;
    const segment = segmentSeen.get(key) ?? 0;
    segmentSeen.set(key, segment + 1);

    const oldRect = before.get(key)?.[segment];
    if (!oldRect) return; // a genuinely new chip - nothing to animate from
 
    const newRect = chip.getBoundingClientRect();
    const dx = oldRect.left - newRect.left;
    const dy = oldRect.top  - newRect.top;
    const sx = oldRect.width  / newRect.width;
    const sy = oldRect.height / newRect.height;
 
    const unchanged = Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5
                    && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01;
    if (unchanged) return;
 
    chip.style.transformOrigin = 'top left';
    chip.style.transition = 'none';
    chip.style.transform  = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
 
    void chip.offsetHeight; // force layout: commit the instant "invert" above...
 
    chip.classList.add('flip-transition'); // ...before letting this transition it away.
    chip.style.transition = '';
    requestAnimationFrame(() => { chip.style.transform = ''; });
 
    chip.addEventListener('transitionend', function done(e) {
      if (e.propertyName !== 'transform') return;
      chip.removeEventListener('transitionend', done);
      chip.classList.remove('flip-transition');
      chip.style.transformOrigin = '';
    });
  });
}

function flipAllDayHeight(row, fromHeightPx) {
  const toHeight = row.dataset.naturalMaxHeight;
  if (fromHeightPx === toHeight) return; // nothing to animate

  row.style.transition = 'none';
  row.style.maxHeight = fromHeightPx;
  void row.offsetHeight;                 // commit the "from" state (First/Invert)

  row.classList.add('allday-flip-transition');
  requestAnimationFrame(() => { row.style.maxHeight = toHeight; }); // Play

  row.addEventListener('transitionend', function done(e) {
    if (e.propertyName !== 'max-height') return;
    row.removeEventListener('transitionend', done);
    row.classList.remove('allday-flip-transition');
    row.style.transition = '';
  });
}

/**
 * periodic sweep to refresh styling
 */
function refreshTimeSensitiveUI() {
  if (currentView !== 'week' && currentView !== 'day') return;

  const todayKey = toDateInputValue(new Date());

  document
    .querySelectorAll('.week-day-col[data-date], .week-day-header[data-date]')
    .forEach(el => el.classList.toggle('today', el.dataset.date === todayKey));

  document.querySelectorAll('.week-event[data-end-time], .allday-chip[data-end-time]').forEach(chip => {
    applyChipTiming(
      chip,
      Number(chip.dataset.endTime),
      chip.dataset.dismissed === '1',
      chip.dataset.baseColor
    );
  });

  updateNowIndicator(); // now finds the freshly-retagged '.today' column
}