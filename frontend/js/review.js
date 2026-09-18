/**
 * review.js — Daily self-assessment ("review") data model.
 *
 * Owns three things and nothing else:
 *   1. the in-memory map of reviews          (day key -> scores)
 *   2. (de)serialisation of review.json      (stable, diff-friendly text)
 *   3. the score -> colour mapping           (the only place colour maths lives)
 *
 * Deliberately has no DOM and no file-system knowledge, so it can be unit
 * tested and so app.js does not grow another 400 lines.
 */

export const REVIEW_FILE_VERSION = 1;

export const SCORE_MIN = 0;
export const SCORE_MAX = 10;

/**
 * The three axes, in display order.
 * `color` is only used to tint the slider — the grid colour comes from
 * scoresToHex() below, which is the authoritative mapping.
 */
export const AXES = [
  { key: 'satisfaction', label: 'Satisfaction', color: '#e33d3d' }, // red
  { key: 'energy',       label: 'Energy',       color: '#e0b325' }, // yellow
  { key: 'productivity', label: 'Productivity', color: '#3d6ee3' }, // blue
];

export const AXIS_KEYS = AXES.map(a => a.key);

// ------------------------------------------------------------
// State
// ------------------------------------------------------------

/** Map<'YYYY-MM-DD', {satisfaction, energy, productivity, note, updated}> */
let _days   = new Map();
let _loaded = false;   // true once a review file has been read (or created)

/** Local-time day key. Never use toISOString() — that shifts across midnight. */
export function dateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Parses a 'YYYY-MM-DD' key back into a local midnight Date. */
export function keyToDate(key) {
  return new Date(`${key}T00:00:00`);
}

export function isReviewDataLoaded() { return _loaded; }

export function resetReviews() { _days = new Map(); _loaded = false; }

// ------------------------------------------------------------
// Load / save
// ------------------------------------------------------------

const clampScore = n =>
  Math.max(SCORE_MIN, Math.min(SCORE_MAX, Math.round(Number(n) || 0)));

/**
 * Parses review.json. Unknown/updated schema versions are tolerated:
 * anything we do not understand is ignored rather than throwing, so a
 * newer device writing extra fields cannot brick an older one.
 *
 * @param {string|null} rawText — file contents, or null/'' for a fresh file
 */
export function loadReviews(rawText) {
  _days = new Map();

  if (rawText && rawText.trim()) {
    const parsed = JSON.parse(rawText);           // throws -> caller shows an error
    const days   = parsed?.days ?? {};
    for (const [key, entry] of Object.entries(days)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
      _days.set(key, normaliseEntry(entry));
    }
  }

  _loaded = true;
  return _days.size;
}

function normaliseEntry(entry) {
  const out = {};
  for (const k of AXIS_KEYS) out[k] = clampScore(entry?.[k]);
  if (entry?.note) out.note = String(entry.note);
  out.updated = entry?.updated ?? new Date().toISOString();
  return out;
}

/**
 * Serialises to text.
 *
 * Written by hand rather than with JSON.stringify(obj, null, 2) so that:
 *   - keys are sorted (stable byte output -> no spurious Syncthing churn)
 *   - each day is exactly one line (a sync conflict is then a line conflict
 *     a human can resolve in a text editor, not a whole-file conflict)
 * The result is still ordinary, valid JSON.
 */
export function serializeReviews() {
  const keys  = [..._days.keys()].sort();
  const lines = keys.map(k => `    ${JSON.stringify(k)}: ${JSON.stringify(_days.get(k))}`);

  return [
    '{',
    `  "version": ${REVIEW_FILE_VERSION},`,
    `  "scale": { "min": ${SCORE_MIN}, "max": ${SCORE_MAX} },`,
    `  "axes": ${JSON.stringify(AXIS_KEYS)},`,
    keys.length ? '  "days": {' : '  "days": {}',
    ...(keys.length ? [lines.join(',\n'), '  }'] : []),
    '}',
    '',
  ].join('\n');
}

// ------------------------------------------------------------
// Accessors
// ------------------------------------------------------------

export function getReview(key)  { return _days.get(key) ?? null; }
export function hasReview(key)  { return _days.has(key); }
export function reviewCount()   { return _days.size; }

export function setReview(key, scores) {
  const entry = normaliseEntry(scores);
  entry.updated = new Date().toISOString();
  _days.set(key, entry);
  return entry;
}

export function deleteReview(key) { return _days.delete(key); }

/** Earliest reviewed day as a Date, or null when there is no data yet. */
export function firstReviewDate() {
  if (!_days.size) return null;
  let min = null;
  for (const k of _days.keys()) if (min === null || k < min) min = k;
  return keyToDate(min);
}

/** Consecutive reviewed days ending today or yesterday. Used for the streak pill. */
export function currentStreak(today = new Date()) {
  let streak = 0;
  const d = new Date(today);
  if (!hasReview(dateKey(d))) d.setDate(d.getDate() - 1); // today may not be logged yet
  while (hasReview(dateKey(d))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

// ------------------------------------------------------------
// Colour
// ------------------------------------------------------------

/**
 * How the three lights are mixed into the red channel.
 *
 *   'linear' — R = (satisfaction + energy) / 2      [default]
 *       The mapping stays injective: every distinct score triple gets a
 *       distinct colour (energy = G, satisfaction = 2R - G, productivity = B),
 *       and 5/5/5 lands on neutral grey, which matters for scanning the grid.
 *       Cost: energy alone reads chartreuse rather than pure yellow.
 *
 *   'screen' — R = 1 - (1 - satisfaction)(1 - energy)
 *       Photographic additive blend. Energy alone is true yellow and colours
 *       are punchier, but 5/5/5 is pinkish and satisfaction becomes invisible
 *       when energy is exactly 10.
 *
 * Either way 10/10/10 is white and 0/0/0 is black, as specified.
 */
export const BLEND_MODE = 'linear';

const clamp01 = x => Math.max(0, Math.min(1, x));

/**
 * Maps the three scores to an sRGB triple in 0..255.
 *
 * The normalised score is used directly as the sRGB channel value (no
 * linear-light conversion). That is intentional: sRGB is roughly perceptually
 * uniform, so a 5/10 self-report lands on a mid-grey that *looks* mid.
 */
export function scoresToRGB(satisfaction, energy, productivity) {
  const s = clamp01(satisfaction  / SCORE_MAX);
  const e = clamp01(energy        / SCORE_MAX);
  const p = clamp01(productivity  / SCORE_MAX);

  const r = BLEND_MODE === 'screen' ? 1 - (1 - s) * (1 - e) : (s + e) / 2;

  return [Math.round(r * 255), Math.round(e * 255), Math.round(p * 255)];
}

export function scoresToHex(satisfaction, energy, productivity) {
  return '#' + scoresToRGB(satisfaction, energy, productivity)
    .map(c => c.toString(16).padStart(2, '0'))
    .join('');
}

/** Convenience: colour for a stored entry, or null for an unreviewed day. */
export function reviewColor(entry) {
  if (!entry) return null;
  return scoresToHex(entry.satisfaction, entry.energy, entry.productivity);
}

/** 0..10 mean of the three axes — used for tooltips and summaries. */
export function overallScore(entry) {
  if (!entry) return null;
  return (entry.satisfaction + entry.energy + entry.productivity) / 3;
}