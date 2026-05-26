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

export async function refreshNotifs(events) {
  if (!window.__TAURI__) return;

  const {invoke} = await import('@tauri-apps/api/core');
  const result = await invoke('request_notification_permission', {});
  if (!result?.granted) return; // abort if user denied

  const cutoff = Date.now() + 48 * 60 * 60 * 1000;

  // Cancel the fixed set of offsets for every known event first
  for (const ev of events) {
    await cancelEventNotification(notificationId(ev.id, 10)); // todo: do this in a general way, not just 10 mins
  }

  for (const ev of events) {
    if (!ev.start || ev.allDay) continue;
    
    if (ev.start.getTime() > Date.now() && ev.start.getTime() < cutoff) {

      const minsBefore = 10
      const triggerDate = new Date(ev.start.getTime() - minsBefore * 60 * 1000);

      await scheduleEventNotification(
        ev.id,
        ev.title,
        'Starting in 10 minutes',
        triggerDate,
        minsBefore
      );
    }
  }
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

  const {invoke} = await import('@tauri-apps/api/core');

  const id = notificationId(uuid, offsetMinutes);

  await invoke('schedule_notification', {
    id, //must be unique per event; reuse the same id to update.
    title,
    body,
    triggerMs: triggerDate.getTime(), // Unix ms, matches AlarmManager.RTC_WAKEUP
  });
}

export async function cancelEventNotification(id) {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('cancel_notification', { id });
}

function notificationId(eventId, offsetMinutes) {
  let h = 0;
  for (const c of eventId) h = (Math.imul(31, h) + c.charCodeAt(0)) | 0;
  return (Math.abs(h) % 2_000_000) * 10 + offsetMinutes ;
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
 * @returns {object} event
 */
export function createEvent({ title, start, end, description = '', color = '#A80808', allDay = false, rrule = null }) {
  return {
    id: crypto.randomUUID(),
    title,
    start,
    end,
    description,
    color,
    allDay,
    rrule,
    exdates: []
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

    return {
      id: ev.uid ?? crypto.randomUUID(),
      title: ev.summary ?? '(No title)',
      start: ev.startDate?.toJSDate(),
      end: ev.endDate?.toJSDate(),
      description: ev.description ?? '',
      color: v.getFirstPropertyValue('color') ?? '#A80808',
      allDay: ev.startDate?.isDate ?? false,
      rrule: rruleProp ? rruleProp.toString() : null,
      exdates: exdateProps.map(p => p.getFirstValue().toJSDate())
    };
  });
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

    if (recursOnDay(ev, date)) {
      result.push(materializeOccurrence(ev, date));
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

  const dayStart = ICAL.Time.fromJSDate(startOfDay(date));
  const dayEnd = ICAL.Time.fromJSDate(endOfDay(date));

  let next;

  while ((next = iter.next())) {

    if (next.compare(dayEnd) > 0) break;

    const jsStart  = next.toJSDate();
    const duration = (ev.end ?? ev.start) - ev.start;
    const jsEnd    = new Date(jsStart.getTime() + duration);

    if ((jsStart >= dayStart.toJSDate() && jsStart < dayEnd.toJSDate())
      ||(jsEnd > dayStart.toJSDate() && jsEnd <= dayEnd.toJSDate())
      ||(jsStart < dayStart.toJSDate() && jsEnd > dayEnd.toJSDate())
    ) {
      
      if (ev.exdates?.some(d => isSameDay(d, jsStart))) { //ignore exceptions to rrule
        continue;
      }

      return true;
    }
  }

  return false;
}

function materializeOccurrence(ev, date) {

  const start = new Date(date);
  start.setHours(ev.start.getHours(), ev.start.getMinutes(), 0, 0);

  const duration =
    (ev.end ?? ev.start) - ev.start;

  const end = new Date(start.getTime() + duration);

  return {
    ...ev,
    start,
    end,
    recurring: true,
    seriesStart: ev.start
  };
}