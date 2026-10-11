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

export const SCORE_MIN = 0;
export const SCORE_MAX = 10;

/**
 * The three axes, in display order.
 *
 * `color` is a getter: it is the colour a day would get if this axis scored
 * SCORE_MAX and the other two scored 0, under the *currently active* colour
 * mode (see setColorMode). It therefore changes when the mode changes.
 * Note: spreading an entry ({ ...axis }) or JSON-serialising it takes a
 * snapshot of that moment; read `axis.color` again after a mode switch.
 */
export const AXES = [
  { key: 'satisfaction', label: 'Satisfaction', get color() { return axisColor('satisfaction'); } },
  { key: 'energy',       label: 'Energy',       get color() { return axisColor('energy'); } },
  { key: 'productivity', label: 'Productivity', get color() { return axisColor('productivity'); } },
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
    //`  "version": ${REVIEW_FILE_VERSION},`,
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

// ------------------------------------------------------------
// Averages
// ------------------------------------------------------------

export const AVERAGE_WINDOW_DAYS = 14;

/**
 * Mean score per axis over the `days` calendar days ending at `endDate`
 * (inclusive, local time). Default: today and the 13 days before it.
 *
 * Days without a review are skipped, NOT counted as 0 — otherwise a missed
 * day would look like a terrible day. `count` tells the UI how many reviewed
 * days the means are based on. Axes are null when count is 0.
 *
 * Pass yesterday as `endDate` if today's review should not be part of it.
 *
 * @returns {{satisfaction: number|null, energy: number|null,
 *            productivity: number|null, count: number, days: number}}
 */
export function averageScores(days = AVERAGE_WINDOW_DAYS, endDate = new Date()) {
  const sums = Object.fromEntries(AXIS_KEYS.map(k => [k, 0]));
  let count = 0;

  // Step back with setDate (local calendar arithmetic), not with
  // "minus 24 h in ms": the latter drifts by an hour across DST changes
  // and could skip or repeat a day key.
  const d = new Date(endDate);
  for (let i = 0; i < days; i++) {
    const entry = _days.get(dateKey(d));
    if (entry) {
      count++;
      for (const k of AXIS_KEYS) sums[k] += entry[k];
    }
    d.setDate(d.getDate() - 1);
  }

  const out = { count, days };
  for (const k of AXIS_KEYS) out[k] = count ? sums[k] / count : null;
  return out;
}

/** Mean of one axis over the window; null when there is no data. */
export function averageScore(axisKey, days, endDate) {
  if (!AXIS_KEYS.includes(axisKey)) throw new RangeError(`Unknown axis: ${axisKey}`);
  return averageScores(days, endDate)[axisKey];
}

export const averageSatisfaction = (days, endDate) => averageScore('satisfaction', days, endDate);
export const averageEnergy       = (days, endDate) => averageScore('energy',       days, endDate);
export const averageProductivity = (days, endDate) => averageScore('productivity', days, endDate);

// ------------------------------------------------------------
// Colour
// ------------------------------------------------------------

/**
 * Colour modes. Each is a pure function from the three normalised scores
 * (satisfaction, energy, productivity, each 0..1) to a normalised triple
 * (R, G, B, each 0..1). Rounding and clamping happen once, in scoresToRGB().
 *
 *   'rgb'    — satisfaction = R, energy = G, productivity = B, untouched.
 *       No rescaling, no mixing rule. Fundamentals: red, green, blue.
 *       5/5/5 = mid grey, 10/10/10 = white, 0/0/0 = black.
 *
 *   'linear' — R = (satisfaction + energy) / 2, G = energy, B = productivity
 *       Linear additive mix of red, yellow and blue lights, each channel
 *       divided by its maximum so that all-primaries = white. Injective,
 *       5/5/5 = grey. Cost: energy alone is chartreuse, satisfaction alone
 *       is only half-bright red.
 *
 *   'screen' — R = 1 - (1 - satisfaction)(1 - energy), G = energy, B = productivity
 *       Photographic "screen" blend. Energy alone is true yellow, but 5/5/5
 *       is pinkish and satisfaction vanishes when energy is exactly 10.
 *
 *   'ryb'    — neutral axis + paint-style hue mix (see rybToRgb below).
 *       Fundamentals: red, yellow, blue. Red+yellow = orange,
 *       yellow+blue = green, red+blue = purple. Equal scores are always
 *       a pure grey, so 0/0/0 = black, 5/5/5 = grey, 10/10/10 = white.
 *       Not strictly additive: see rybToRgb.
 */
const COLOR_MODES = {
  rgb:    (s, e, p) => [s, e, p],
  linear: (s, e, p) => [(s + e) / 2, e, p],
  screen: (s, e, p) => [1 - (1 - s) * (1 - e), e, p],
  ryb:    (s, e, p) => rybToRgb(s, e, p),
};

export const COLOR_MODE_NAMES = Object.keys(COLOR_MODES);

let _colorMode = 'ryb';

export function getColorMode() { return _colorMode; }

export function setColorMode(mode) {
  if (!COLOR_MODE_NAMES.includes(mode)) {
    throw new RangeError(`Unknown colour mode "${mode}". Use one of: ${COLOR_MODE_NAMES.join(', ')}`);
  }
  _colorMode = mode;
}

const clamp01 = x => Math.max(0, Math.min(1, x));

/**
 * Corners of the RYB cube, keyed by the (red, yellow, blue) bits, valued in
 * RGB 0..1. Hand-tuned for ADDITIVE use (nothing = black); the secondary
 * colours are Itten-style. Edit freely. '111' is unreachable: rybToRgb
 * subtracts the common part first, so at least one coordinate is always 0.
 */
const RYB_CUBE = {
  '000': [0,   0,    0   ],  // black   #000000
  '100': [1,   0,    0   ],  // red     #FF0000
  '010': [1,   1,    0   ],  // yellow  #FFFF00
  '001': [0,   0,    1   ],  // blue    #0000FF
  '110': [1,   0.5,  0   ],  // orange  #FF8000
  '011': [0,   0.65, 0.25],  // green   #008540
  '101': [0.8, 0,    0.8 ],  // purple  #A000A0
  '111': [1,   1,    1   ],  // never reached
};

/** Trilinear interpolation of RYB_CUBE at (r, y, b) in 0..1. */
function trilinear(r, y, b) {
  const out = [0, 0, 0];
  for (const [corner, rgb] of Object.entries(RYB_CUBE)) {
    const w = (corner[0] === '1' ? r : 1 - r)
            * (corner[1] === '1' ? y : 1 - y)
            * (corner[2] === '1' ? b : 1 - b);
    for (let i = 0; i < 3; i++) out[i] += w * rgb[i];
  }
  return out;
}

/**
 * Split the scores into
 *   m = min(s, e, p)          the part all three axes share -> neutral grey
 *   (s, e, p) - m             what is left -> a hue, mixed RYB-style
 * and recombine as   rgb = m + (1 - m) * hue(rest / (1 - m)).
 *
 * Equal scores leave no remainder, hence exact greys; the grey ramp is the
 * additive part. The remainder is blended by trilinear interpolation in an
 * RYB cube, the technique of Gossett & Chen (2004), but with black at the
 * origin instead of their paint-white.
 * That blend is NOT additive in light (red + blue gives a purple that is
 * darker than red), which is the price of getting orange/green/purple.
 */
function rybToRgb(s, e, p) {
  const m = Math.min(s, e, p);
  if (m >= 1) return [1, 1, 1];
  const k = 1 - m;
  const hue = trilinear((s - m) / k, (e - m) / k, (p - m) / k);
  return hue.map(c => m + k * c);
}

/**
 * Maps the three scores to an sRGB triple in 0..255 using `mode`
 * (default: the active mode). The normalised score is used directly as the
 * sRGB channel value (no linear-light conversion), as before.
 */
export function scoresToRGB(satisfaction, energy, productivity, mode = _colorMode) {
  if (!COLOR_MODE_NAMES.includes(mode)) throw new RangeError(`Unknown colour mode "${mode}"`);
  const s = clamp01(satisfaction / SCORE_MAX);
  const e = clamp01(energy       / SCORE_MAX);
  const p = clamp01(productivity / SCORE_MAX);
  return COLOR_MODES[mode](s, e, p).map(c => Math.round(clamp01(c) * 255));
}

export function scoresToHex(satisfaction, energy, productivity, mode) {
  return '#' + scoresToRGB(satisfaction, energy, productivity, mode)
    .map(c => c.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * The colour of one axis on its own: SCORE_MAX on that axis, 0 on the others.
 * Derived from the mapping, so it can never disagree with the grid.
 */
export function axisColor(key, mode) {
  const i = AXIS_KEYS.indexOf(key);
  if (i < 0) throw new RangeError(`Unknown axis: ${key}`);
  const scores = [0, 0, 0];
  scores[i] = SCORE_MAX;
  return scoresToHex(...scores, mode);
}

/** { satisfaction: '#…', energy: '#…', productivity: '#…' } for `mode` (default: active). */
export function axisColors(mode) {
  return Object.fromEntries(AXIS_KEYS.map(k => [k, axisColor(k, mode)]));
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