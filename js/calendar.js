/**
 * calendar.js — Event data model and iCalendar parser/serializer
 */

const ICAL = window.ICAL;
if (!ICAL) {
  throw new Error("ical.js failed to load — window.ICAL is undefined");
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

    if (!ev.rrule) {

      if (ev.start < dayEnd && (ev.end ?? ev.start) > dayStart) {
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
  // `new Date("2024-10-15T09:00")` — without a timezone suffix,
  // the browser interprets this in LOCAL time. That's what we want.
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

    const js = next.toJSDate();

    if (js >= dayStart.toJSDate()&& js <= dayEnd.toJSDate()) {
      
      if (ev.exdates?.some(d => isSameDay(d, js))) {
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