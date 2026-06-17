/**
 * calendar.js — Event data model and iCalendar parser/serializer
 */

const ICAL = window.ICAL;
if (!ICAL) {
  throw new Error("ical.js failed to load — window.ICAL is undefined");
}

/* #############################################################
 *   Notifications
 * ########################################################## */

/**
 * Schedules notifications for the next 400 occurrences of the given events.
 * Existing notifications are cancelled first, so this can be safely called multiple times.
 * @param {*} events 
 * @returns none
 */
export async function refreshNotifs(events) {
  if (!window.__TAURI__) return;

  const {invoke} = window.__TAURI__.core;
  const result = await invoke('request_notification_permission', {});
  if (!result?.granted) return; // abort if user denied

  await invoke('cancel_all_notifications', {});

  const now = new Date();
  const cutoff = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  const maxNotifs = 400;

  for (const ev of events) {
    if (!ev.start || ev.allDay) continue; // TODO: support all-day events

    const occurrences = ev.rrule 
      ? occurrencesInWindow(ev, now, cutoff) 
      : (ev.start > now && ev.start < cutoff ? [ev.start] : []);


    for (const occ of occurrences) {// TODO: change to 400 events in the future

      const minsBefore = 10;
      const triggerDate = new Date(occ.getTime() - minsBefore * 60 * 1000);

      if (triggerDate <= now) continue;

      await scheduleEventNotification(
        ev.id,
        `${ev.title} starts at ${toTimeInputValue(occ)} (in ${minsBefore} minutes)`,
        ev.description || 'Make sure not to miss it!',
        triggerDate,
        minsBefore
      );
    }
  }

  
  // TODO: schedule notifs to remind user to open the app one week, three days and one day before the last scheduled notification to refresh notifs
}

/**
 * Schedules a notification at a specific Date.
 * @param {string} uuid: 
 * @param {string} title
 * @param {string} body: Notification content
 * @param {Date} triggerDate: Time of trigger
 * 
 */
export async function scheduleEventNotification(uuid, title, body, triggerDate, offsetMinutes) {

  const {invoke} = window.__TAURI__.core; 

  const id = notificationId(uuid, offsetMinutes, triggerDate.getTime());

  if (triggerDate.getDate() === new Date().getDate()) {
    console.log(`Scheduled notification for event "${title}" at ${triggerDate.toLocaleTimeString()}`);
  }

  await invoke('schedule_notification', {
    id, //must be unique per event; reuse the same id to update.
    title,
    body,
    triggerMs: triggerDate.getTime(), // Unix ms, matches AlarmManager.RTC_WAKEUP
  });
}

export async function cancelEventNotification(id) {
  const { invoke } = window.__TAURI__.core; 
  await invoke('cancel_notification', { id });
}

function notificationId(eventId, offsetMinutes, occurrenceMs = 0) {
  let h = 0;
  for (const c of eventId) h = (Math.imul(31, h) + c.charCodeAt(0)) | 0;
  // Mix in the occurrence time so two occurrences of the same series don't collide
  h = (Math.imul(31, h) + (occurrenceMs / 60000 | 0)) | 0;
  return (Math.abs(h) % 2_000_000) * 10 + offsetMinutes;
}

/**
 * Returns all start times of a recurring event that fall within [windowStart, windowEnd].
 * Uses the rrule iterator directly, so the dates are exact — not materialized to today.
 *
 * @param {object} ev       - Event with a valid ev.rrule string
 * @param {Date}   windowStart
 * @param {Date}   windowEnd
 * @returns {Date[]}
 */
function occurrencesInWindow(ev, windowStart, windowEnd) {
  const rule      = ICAL.Recur.fromString(ev.rrule);
  const startTime = ICAL.Time.fromJSDate(ev.start);
  const iter      = rule.iterator(startTime);
  const results   = [];

  // look only one yr ahead
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const breakGuard = new Date(windowEnd.getTime() + 365 * MS_PER_DAY);

  let next;
  while ((next = iter.next())) {
    const jsDate = next.toJSDate();

    if (jsDate > breakGuard) break;

    // Skip exdates
    if (ev.exdates?.some(ex => isSameDay(ex, jsDate))) continue;

    const key = toDateInputValue(jsDate);
    const exception = ev.exceptions?.[key];

    if (exception?.deleted) continue;

    const start = exception?.start ? new Date(exception.start) : jsDate;

    if (start >= windowEnd) continue;
    if (start < windowStart) continue;

    results.push(start);
  }

  return results;
}


// ============================================================
// FACTORY FUNCTION
// ============================================================

/**
 * Creates a new event object with sensible defaults.
 * Caller must supply title, start, end. Everything else is optional.
 *
 * @param {object} params
 * @param {string} params.title
 * @param {Date}   params.start
 * @param {Date}   params.end
 * @param {string} [params.description='']
 * @param {string} [params.color='#A80808']
 * @param {boolean}[params.allDay=false]
 * @param {string|null}[params.categories=null]
 * @returns {object} event
 */
export function createEvent({ title, start, end, description = '', color = '#A80808', allDay = false, rrule = null, categories = null }) {
  return {
    id: crypto.randomUUID(),
    title,
    start,
    end,
    description,
    color,
    allDay,
    rrule,
    categories,
    exdates: [],
    exceptions: {} // sparse map of per-occurrence overrides, keyed by YYYY-MM-DD
  };
}

// ============================================================
// PARSING
// ============================================================

/**
 * Parses a .ics file string into an array of event objects.
 *
 * @param {string} rawText - Full contents of the .ics file
 * @returns {object[]} Array of event objects
 */
export function parseICS(rawText) {
  const jcal = ICAL.parse(rawText);
  const comp = new ICAL.Component(jcal);

  const vevents = comp.getAllSubcomponents('vevent');

  return vevents.map(v => {
    const ev = new ICAL.Event(v);

    const rruleProp = v.getFirstPropertyValue('rrule');
    const exdateProps = v.getAllProperties('exdate');

    const xExceptions = v.getFirstPropertyValue('x-exceptions');

    const categoryProp = v.getFirstPropertyValue('categories');
    const categories = Array.isArray(categoryProp)
      ? (categoryProp[0] ?? null) // TODO: support multiple categories, return the first for now
      : (categoryProp ?? null);

    return {
      id: ev.uid ?? crypto.randomUUID(),
      title: ev.summary ?? '(No title)',
      start: ev.startDate?.toJSDate(),
      end: ev.endDate?.toJSDate(),
      description: ev.description ?? '',
      color: v.getFirstPropertyValue('color') ?? '#A80808',
      allDay: ev.startDate?.isDate ?? false,
      rrule: rruleProp ? rruleProp.toString() : null,
      categories,
      exdates: exdateProps.map(p => p.getFirstValue().toJSDate()),
      exceptions: xExceptions ? JSON.parse(xExceptions) : {}
    };
  });
}

/**
 * Checks for common problems like overlapping events, malformed RRULEs, etc. 
 * Display warnings in the status bar if any issues are found. 
 * Make warnings descriptive.
 * @param {*} events 
 * @returns 
 */
function checkQuality(events) {

  recurringEvents = events.filter(e => e.rrule);

  // Check if an exception is moved further than a year from the original date 
  // (not supported by notifications scheduling)
  for (const recurring of recurringEvents) {
    for (const [originalDate, exception] of Object.entries(recurring.exceptions)) {
      if (exception.deleted) continue;

      const original = new Date(originalDate + 'T00:00:00');
      const exceptionStart = new Date(exception.start);

      if (Math.abs(exceptionStart.getTime() - original.getTime()) > 365 * 24 * 60 * 60 * 1000) {
        //setStatus(`Warning: Bad recurrent event: An exception (at ${exception.start}) for event "${exception.title}" is moved more than a year from the original date. This may cause notifications for this occurrence to not work.`, 'warning'); //TODO: refactor to have access to setStatus
        return;
      }
    }
  }
}

// ============================================================
// SERIALIZATION
// ============================================================

/**
 * Serializes an array of event objects back to a .ics file string.
 *
 * @param {object[]} events
 * @returns {string} Complete .ics file contents
 */
export function serializeICS(events) {
  const vcal = new ICAL.Component(['vcalendar', [], []]);

  vcal.addPropertyWithValue('version', '2.0');
  vcal.addPropertyWithValue('prodid', '-//Stedule//Stedule 1.0//EN');
  vcal.addPropertyWithValue('calscale', 'GREGORIAN');

  for (const ev of events) {
    const vevent = new ICAL.Component('vevent');

    vevent.addPropertyWithValue('uid', ev.id);
    vevent.addPropertyWithValue('summary', ev.title);
    vevent.addPropertyWithValue(
      'dtstart',
      ICAL.Time.fromJSDate(ev.start, ev.allDay)
    );

    if (ev.end) {
      vevent.addPropertyWithValue(
        'dtend',
        ICAL.Time.fromJSDate(ev.end, ev.allDay)
      );
    }

    if (ev.description) {
      vevent.addPropertyWithValue('description', ev.description);
    }

    if (ev.color) {
      vevent.addPropertyWithValue('color', ev.color);
    }

    if (ev.categories) {
      vevent.addPropertyWithValue('categories', ev.categories);
    }

    if (ev.rrule) {
      vevent.addPropertyWithValue(
        'rrule',
        ICAL.Recur.fromString(ev.rrule)
      );
    }

    if (ev.exdates) {
      for (const ex of ev.exdates) {
        vevent.addPropertyWithValue(
          'exdate',
          ICAL.Time.fromJSDate(ex)
        );
      }
    }

    if (ev.exceptions && Object.keys(ev.exceptions).length > 0) {
      vevent.addPropertyWithValue(
        'x-exceptions',
        JSON.stringify(ev.exceptions)
      );
    }

    vcal.addSubcomponent(vevent);
  }

  return vcal.toString();
}

// ============================================================
// EVENT QUERYING
// ============================================================

/**
 * Returns all events that overlap a given day.
 * An event overlaps a day if it starts before the day ends
 * and ends after the day starts.
 *
 * @param {object[]} events
 * @param {Date} date
 * @returns {object[]}
 */
export function eventsOnDay(events, date) {
  const result = [];
  const dayStart = startOfDay(date);
  const dayEnd   = endOfDay(date);

  for (const ev of events) {

    if (!ev.start) continue;

    if (!ev.end) ev.end=ev.start;

    if (!ev.rrule) {

      if (
           (ev.start < dayEnd && ev.start > dayStart) // starts on day
        || (ev.end < dayEnd && ev.end > dayStart) // ends on day
        || (ev.start < dayStart && ev.end > dayEnd)) { // covers day
        result.push(ev);
      }

      continue;
    }

    // Scan all exceptions for ones whose resolved start falls on this day.
    if (ev.exceptions) {
      for (const [originalKey, exception] of Object.entries(ev.exceptions)) {
        if (exception.deleted) continue;
        if (!exception.start) continue; 

        if (originalKey === toDateInputValue(date)) continue;
 
        const resolvedStart = new Date(exception.start);
        if (!isSameDay(resolvedStart, date)) continue;

        const originalDate = new Date(originalKey + 'T00:00:00');
        const occurrence = materializeOccurrence(ev, originalDate);
        if (occurrence) result.push(occurrence);
      }
    }

    // rrule occurrence on this day
    const dateKey = toDateInputValue(date);
    const exceptionOnThisDay = ev.exceptions?.[dateKey];
 
    if (exceptionOnThisDay) {
      if (exceptionOnThisDay.deleted) continue;
 
      if (exceptionOnThisDay.start &&
          !isSameDay(new Date(exceptionOnThisDay.start), date)) continue;
 
      // Time-only shift (same day): materialize normally.
      const occurrence = materializeOccurrence(ev, date);
      if (occurrence) result.push(occurrence);
      continue;
    }

    // No exception entry for this day — check the plain RRULE.
    if (recursOnDay(ev, date)) {
      const occurrence = materializeOccurrence(ev, date);
      if (occurrence) result.push(occurrence);
    }
  }

  return result;
}

// ============================================================
// DATE UTILITIES
// ============================================================

export function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function startOfWeek(date) {
  // first week day (monday)
  const d = new Date(date);
  const weekday = getAdjWeekday(d)
  d.setDate(d.getDate() - weekday);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Returns weekday index with Monday = 0 ... Sunday = 6
 * JS default is Sunday = 0 ... Saturday = 6.
 */
export function getAdjWeekday(date) {
  // first week day (monday)
  return (date.getDay() + 6) % 7;
}

export function isSameDay(a, b) {
  if (!a || !b) return false;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth()    === b.getMonth()    &&
    a.getDate()     === b.getDate()
  );
}

export function isToday(date) {
  return isSameDay(date, new Date());
}

/**
 * Formats a Date for use in <input type="date"> (value="YYYY-MM-DD")
 * @param {Date} date
 * @returns {string}
 */
export function toDateInputValue(date) {
  if (!date) return '';
  const y  = date.getFullYear();
  const m  = String(date.getMonth() + 1).padStart(2, '0'); 
  const d  = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Formats a Date for use in <input type="time"> (value="HH:MM")
 * @param {Date} date
 * @returns {string}
 */
export function toTimeInputValue(date) {
  if (!date) return '';
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Combines a date string (YYYY-MM-DD) and time string (HH:MM) into a Date.
 * @param {string} dateStr
 * @param {string} timeStr
 * @returns {Date}
 */
export function combineDateAndTime(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr}`);
}

/**
 * Adds a time to a date.
 * @param {Date} date 
 * @param {float} hours
 * @returns {Date}
 */
export function addTime(date, hours) {
  const d = new Date(date);
  d.setTime(d.getTime() + Math.floor(hours * 60 * 60 * 1000))
  return d;
}

export function parseRRule(rruleStr) {
  return ICAL.Recur.fromString(rruleStr);
}

// ============================================================
// PRIVATE HELPERS
// ============================================================

function recursOnDay(ev, date) {
  const rule = ICAL.Recur.fromString(ev.rrule);
  const startTime = ICAL.Time.fromJSDate(ev.start);

  const iter = rule.iterator(startTime);
  //iter.advanceTo(ICAL.Time.fromJSDate(startOfDay(date))); // TODO: investigate how to make this work

  const dayStart = ICAL.Time.fromJSDate(startOfDay(date));
  const dayEnd = ICAL.Time.fromJSDate(endOfDay(date));

  let next;

  while ((next = iter.next())) {

    if (next.compare(dayEnd) > 0) break;

    if (next.compare(dayStart) >= 0 && next.compare(dayEnd) <= 0) {

      const jsStart = next.toJSDate();

      if (ev.exdates?.some(d => isSameDay(d, jsStart))) continue;

      const originalDate = toDateInputValue(jsStart);
      const exception = ev.exceptions?.[originalDate];
      if (exception?.deleted) continue;

      // exception moved to another day
      if (exception?.start && !isSameDay(new Date(exception.start), jsStart)) continue;

      return true;
    }
  }

  return false;
}

function materializeOccurrence(ev, date) {

  const originalDate = toDateInputValue(date);
  const exception = ev.exceptions?.[originalDate] ?? {};
  if (exception.deleted) return null;

  const baseStart = exception.start ? new Date(exception.start) : (() => {
    const s = new Date(date);
    s.setHours(ev.start.getHours(), ev.start.getMinutes(), 0, 0);
    return s;
  })();

  const baseEnd = exception.end 
    ? new Date(exception.end)
    : new Date(baseStart.getTime() + ((ev.end ?? ev.start) - ev.start));

  return {
    ...ev,
    ...exception,
    start: baseStart,
    end: baseEnd,
    masterId: ev.id,
    originalDate,
    recurring: true,
    seriesStart: ev.start
  };
}