/**
 * calendar.js — Event data model and iCalendar parser/serializer
 *
 * WHY THIS FILE EXISTS:
 * This module owns the "shape" of data. It knows:
 *   - What an event object looks like
 *   - How to parse raw .ics text into event objects
 *   - How to serialize event objects back to .ics text
 *
 * app.js never touches raw .ics strings — it only works with
 * the plain JS objects this module produces. This separation
 * means you could swap the file format (e.g. to JSON) by only
 * changing THIS file.
 *
 * WHAT IS iCal / .ics?
 * RFC 5545 is the standard. A .ics file looks like:
 *
 *   BEGIN:VCALENDAR
 *   VERSION:2.0
 *   BEGIN:VEVENT
 *   UID:abc-123
 *   SUMMARY:Team meeting
 *   DTSTART:20241015T090000Z
 *   DTEND:20241015T100000Z
 *   END:VEVENT
 *   END:VCALENDAR
 *
 * We implement a practical subset — enough for single-file personal
 * use. For recurring events and timezone complexity, ical.js is the
 * right library to add later.
 */

// ============================================================
// THE EVENT OBJECT SHAPE
// ============================================================
//
// JS QUIRK — no classes required:
// Unlike Java, you don't need a class to define a "type". A plain
// JS object { id, title, start, end } is perfectly valid and idiomatic.
// We use a factory function (createEvent) instead of `new Event()`
// because factory functions are simpler and don't require understanding
// `this`, `new`, or prototype chains yet.
//
// An event object looks like:
// {
//   id:          string  — unique identifier (UUID)
//   title:       string  — display name
//   start:       Date    — JS Date object (has timezone info)
//   end:         Date    — JS Date object
//   description: string  — optional notes
//   color:       string  — CSS hex color, e.g. "#4f72ff"
//   allDay:      boolean — if true, no time component
// }

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
 * @param {string} [params.color='#4f72ff']
 * @param {boolean}[params.allDay=false]
 * @returns {object} event
 */
export function createEvent({ title, start, end, description = '', color = '#4f72ff', allDay = false }) {
  return {
    // crypto.randomUUID() is built into modern browsers and Node.
    // It generates a unique ID like "110e8400-e29b-41d4-a716-446655440000".
    id: crypto.randomUUID(),
    title,
    start,
    end,
    description,
    color,
    allDay,
  };
}

// ============================================================
// PARSING: raw .ics string → array of event objects
// ============================================================

/**
 * Parses a .ics file string into an array of event objects.
 *
 * @param {string} rawText - Full contents of the .ics file
 * @returns {object[]} Array of event objects
 */
export function parseICS(rawText) {
  // JS QUIRK — RegExp and the 's' flag:
  // [\s\S]*? means "any character including newlines, as few as possible".
  // The 'g' flag means "find ALL matches, not just the first".
  // Without 'g', .match() returns only the first VEVENT block.
  const eventBlocks = rawText.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g);

  // JS QUIRK — nullish coalescing (??):
  // If .match() finds no events it returns null, not an empty array.
  // The ?? operator returns the right side when the left is null or undefined.
  // It's different from || which also triggers on 0, '', false.
  const blocks = eventBlocks ?? [];

  return blocks.map(parseVEVENT).filter(ev => ev !== null);
  // .map() transforms each element; .filter() removes nulls from failed parses
}

/**
 * Serializes an array of event objects back to a .ics file string.
 *
 * @param {object[]} events
 * @returns {string} Complete .ics file contents
 */
export function serializeICS(events) {
  // JS QUIRK — template literals (backtick strings):
  // `Hello ${name}` is equivalent to Python's f"Hello {name}".
  // They can also span multiple lines without escape characters.

  const vevents = events.map(serializeVEVENT).join('\r\n');

  // iCal spec (RFC 5545) mandates CRLF (\r\n) line endings.
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//LocalCal//LocalCal 1.0//EN',
    'CALSCALE:GREGORIAN',
    vevents,
    'END:VCALENDAR',
  ].join('\r\n');
}

// ============================================================
// QUERY HELPERS
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
  const dayStart = startOfDay(date);
  const dayEnd   = endOfDay(date);

  return events.filter(ev => {
    if (!ev.start) return false;
    return ev.start < dayEnd && (ev.end ?? ev.start) > dayStart;
  });
}

/**
 * Returns all events that fall within a given week.
 * week is any Date within that week.
 *
 * @param {object[]} events
 * @param {Date} week
 * @returns {object[]}
 */
export function eventsInWeek(events, week) {
  const monday = startOfWeek(week);
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 7);
  return events.filter(ev => ev.start >= monday && ev.start < sunday);
}

// ============================================================
// DATE UTILITIES
// ============================================================
//
// JS QUIRK — Date mutation:
// Date objects are mutable. date.setMonth(3) changes the date IN PLACE
// and returns a timestamp (number), not a new Date.
// This trips up everyone coming from Python where datetime objects
// are immutable. Always clone before mutating:
//   const clone = new Date(original); // ← correct
//   clone.setMonth(3);

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
  // Returns the Sunday of the week containing `date`.
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay()); // .getDay() returns 0=Sun..6=Sat
  d.setHours(0, 0, 0, 0);
  return d;
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
  const m  = String(date.getMonth() + 1).padStart(2, '0'); // months are 0-indexed!
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

// ============================================================
// PRIVATE HELPERS
// ============================================================

function parseVEVENT(block) {
  try {
    // Extracts the value for a given iCal property key.
    // Handles both simple keys (SUMMARY:...) and keys with parameters
    // (DTSTART;TZID=America/New_York:...).
    const get = (key) => {
      // The regex: ^KEY matches at line start; [^:;]* skips any ;PARAM=VAL
      // parts; :(.+) captures everything after the colon.
      const re = new RegExp(`^${key}(?:[^:;]*)?:(.+)$`, 'm');
      const match = block.match(re);
      return match ? match[1].trim() : null;
    };

    const uid   = get('UID');
    const raw   = get('DTSTART');
    const allDay = raw && raw.length === 8; // "20241015" has no time component

    return {
      id:          uid ?? crypto.randomUUID(),
      title:       get('SUMMARY')     ?? '(No title)',
      start:       parseICSDate(get('DTSTART')),
      end:         parseICSDate(get('DTEND')),
      description: get('DESCRIPTION') ?? '',
      color:       get('COLOR')       ?? '#4f72ff',
      allDay,
    };
  } catch (e) {
    console.warn('Failed to parse VEVENT block:', e);
    return null;
  }
}

function serializeVEVENT(ev) {
  return [
    'BEGIN:VEVENT',
    `UID:${ev.id}`,
    `SUMMARY:${ev.title}`,
    `DTSTART:${toICSDate(ev.start, ev.allDay)}`,
    `DTEND:${toICSDate(ev.end,   ev.allDay)}`,
    `DESCRIPTION:${ev.description ?? ''}`,
    `COLOR:${ev.color ?? '#4f72ff'}`,
    'END:VEVENT',
  ].join('\r\n');
}

function parseICSDate(str) {
  if (!str) return null;
  // All-day: "20241015"
  if (str.length === 8) {
    return new Date(`${str.slice(0,4)}-${str.slice(4,6)}-${str.slice(6,8)}`);
  }
  // With time: "20241015T090000Z" or "20241015T090000"
  const hasZ  = str.endsWith('Z');
  const base  = str.replace('Z', '');
  const iso   = `${base.slice(0,4)}-${base.slice(4,6)}-${base.slice(6,8)}` +
                `T${base.slice(9,11)}:${base.slice(11,13)}:${base.slice(13,15)}` +
                (hasZ ? 'Z' : '');
  return new Date(iso);
}

function toICSDate(date, allDay = false) {
  if (!date) return '';
  if (allDay) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }
  // .toISOString() returns "2024-10-15T09:00:00.000Z"
  // We strip dashes, colons, and the milliseconds to get "20241015T090000Z"
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}
