// -----------------------------------------------------------------------------
// What a sensor does with an answer: find the value (a field path in a JSON
// answer, a regular expression on a text or HTML answer, or the whole
// answer), then turn it into the Gladys value of the type chosen
// (scale and offset for the numbers).
//
// The path notation is the dotted one most APIs document, plus a minimal
// JSONPath: `data.items[0].temp`, `$.sensors[-1].value`, `['key with.dot']`,
// and one filter, `[?(@.name=='kitchen')]` (the first element that matches).
// No dependency: a full JSONPath library would be heavier than this file, for
// lists of values a sensor cannot publish anyway.
// -----------------------------------------------------------------------------

import vm from 'node:vm';
import {
  DEVICE_FEATURE_CATEGORIES as CATEGORY,
  DEVICE_FEATURE_TYPES as TYPE,
  DEVICE_FEATURE_UNITS as UNIT,
} from '@gladysassistant/integration-sdk';

const BIG = 1e12;

// The types offered for a sensor: keys stored in the configuration and in the
// feature external ids, permanent once published. Bounds are display bounds.
// The first six are the ones of guim31/gladys-influxdb.
export const SENSOR_TYPES = Object.freeze({
  number: { category: CATEGORY.UNKNOWN, type: TYPE.UNKNOWN.UNKNOWN, min: -BIG, max: BIG },
  temperature: {
    category: CATEGORY.TEMPERATURE_SENSOR,
    type: TYPE.SENSOR.DECIMAL,
    unit: UNIT.CELSIUS,
    min: -100,
    max: 200,
  },
  humidity: {
    category: CATEGORY.HUMIDITY_SENSOR,
    type: TYPE.SENSOR.DECIMAL,
    unit: UNIT.PERCENT,
    min: 0,
    max: 100,
  },
  percent: {
    category: CATEGORY.LEVEL_SENSOR,
    type: TYPE.LEVEL_SENSOR.LIQUID_LEVEL_PERCENT,
    unit: UNIT.PERCENT,
    min: 0,
    max: 100,
  },
  power: {
    category: CATEGORY.ENERGY_SENSOR,
    type: TYPE.ENERGY_SENSOR.POWER,
    unit: UNIT.WATT,
    // Signed: a solar inverter exports.
    min: -1e6,
    max: 1e6,
  },
  energy: {
    category: CATEGORY.ENERGY_SENSOR,
    type: TYPE.ENERGY_SENSOR.ENERGY,
    unit: UNIT.KILOWATT_HOUR,
    min: 0,
    max: BIG,
  },
  binary: { category: CATEGORY.INPUT, type: TYPE.SENSOR.BINARY, min: 0, max: 1 },
  // min/max are NOT NULL in Gladys, text included.
  text: { category: CATEGORY.TEXT, type: TYPE.TEXT.TEXT, min: 0, max: 0 },
});

export const SENSOR_TYPE_KEYS = Object.keys(SENSOR_TYPES);
export const isNumeric = (type) => type !== 'binary' && type !== 'text';

// What a value can fail on (the error kinds of src/http.js are the others).
export const VALUE_ERRORS = Object.freeze({
  NOT_JSON: 'not_json',
  NOT_FOUND: 'not_found',
  NO_MATCH: 'no_match',
  NOT_NUMBER: 'not_number',
  NOT_BINARY: 'not_binary',
  EMPTY: 'empty',
  REGEX_TIMEOUT: 'regex_timeout',
});

export class ValueError extends Error {
  constructor(kind, detail = '') {
    super(detail ? `${kind}: ${detail}` : kind);
    this.kind = kind;
    this.detail = detail;
  }
}

// Gladys shows a text value in a tile: a page of text helps nobody.
export const MAX_TEXT_LENGTH = 250;
// A regular expression typed by the user runs on up to 1 MB: a catastrophic
// one would block the whole integration, so it runs with a deadline.
export const REGEX_TIMEOUT_MS = 500;

// --- Field paths ------------------------------------------------------------------

/**
 * Parse a field path into steps: `{ key }`, `{ index }` or `{ filter }`.
 * @returns {Array<object>|null} null when the path is not understood
 */
export function parsePath(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  let text = raw.trim();
  if (text === '$' || text === '') {
    return [];
  }
  if (text.startsWith('$')) {
    text = text.slice(1);
  }
  const steps = [];
  let at = 0;
  while (at < text.length) {
    const rest = text.slice(at);
    let match;
    if ((match = rest.match(/^\.?([^.[\]\s'"]+)/)) && (at === 0 || rest.startsWith('.'))) {
      steps.push(
        /^-?\d+$/.test(match[1]) ? { key: match[1], index: Number(match[1]) } : { key: match[1] },
      );
    } else if ((match = rest.match(/^\[(-?\d+)\]/))) {
      steps.push({ index: Number(match[1]) });
    } else if (
      (match =
        rest.match(/^\[\s*'((?:[^'\\]|\\.)*)'\s*\]/) ??
        rest.match(/^\[\s*"((?:[^"\\]|\\.)*)"\s*\]/))
    ) {
      steps.push({ key: match[1].replace(/\\(.)/g, '$1') });
    } else if (
      (match = rest.match(
        /^\[\?\(\s*@((?:\.[^.=!\s)]+)+)\s*(==|!=)\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|true|false|null)\s*\)\]/,
      ))
    ) {
      const quoted = /^['"]/.test(match[3]);
      steps.push({
        filter: {
          keys: match[1].slice(1).split('.'),
          equal: match[2] === '==',
          value: quoted ? match[3].slice(1, -1).replace(/\\(.)/g, '$1') : JSON.parse(match[3]),
        },
      });
    } else {
      return null;
    }
    at += match[0].length;
  }
  return steps;
}

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

/** The value at `steps` in `data`; `undefined` when it is not there. */
export function walkPath(data, steps) {
  let value = data;
  for (const step of steps) {
    if (value === null || typeof value !== 'object') {
      return undefined;
    }
    if (step.filter) {
      if (!Array.isArray(value)) {
        return undefined;
      }
      const { keys, equal, value: expected } = step.filter;
      value = value.find((item) => {
        const actual = walkPath(
          item,
          keys.map((key) => ({ key })),
        );
        return (actual === expected) === equal;
      });
    } else if (Array.isArray(value) && step.index !== undefined) {
      value = value.at(step.index);
    } else if (step.key !== undefined && !Array.isArray(value) && own(value, step.key)) {
      value = value[step.key];
    } else {
      return undefined;
    }
  }
  return value;
}

// --- Regular expressions -------------------------------------------------------------

/**
 * A regular expression written `/pattern/flags`: `{ source, flags }`, or null
 * when the text is not one (it is then a field path).
 */
export function regexOf(raw) {
  const match = typeof raw === 'string' ? raw.trim().match(/^\/(.+)\/([a-z]*)$/s) : null;
  return match ? { source: match[1], flags: match[2] } : null;
}

/** Whether a regular expression compiles; global and sticky flags are refused. */
export function checkRegex(regex) {
  if (/[gy]/.test(regex.flags)) {
    return false;
  }
  try {
    new RegExp(regex.source, regex.flags);
    return true;
  } catch {
    return false;
  }
}

// One context for every run: creating one costs a few milliseconds.
const regexContext = vm.createContext({});
const regexScript = new vm.Script(
  '(() => { const m = new RegExp(source, flags).exec(text); return m && (m[1] ?? m[0]); })()',
);

/** The first capture group of the first match (the whole match without group), or null. */
export function runRegex(regex, text, timeoutMs = REGEX_TIMEOUT_MS) {
  regexContext.source = regex.source;
  regexContext.flags = regex.flags;
  regexContext.text = text;
  try {
    const found = regexScript.runInContext(regexContext, { timeout: timeoutMs });
    return typeof found === 'string' ? found : null;
  } catch (err) {
    if (err?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
      throw new ValueError(VALUE_ERRORS.REGEX_TIMEOUT);
    }
    throw err;
  } finally {
    regexContext.text = '';
  }
}

const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  deg: '°',
  sup2: '²',
  sup3: '³',
  euro: '€',
  micro: 'µ',
};

/** The text of an HTML fragment: tags out, the common entities decoded. */
export function htmlText(fragment) {
  return fragment
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (entity, name) => {
      if (name[0] === '#') {
        const code =
          name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
        return Number.isFinite(code) && code > 0 && code < 0x110000
          ? String.fromCodePoint(code)
          : entity;
      }
      return ENTITIES[name.toLowerCase()] ?? entity;
    });
}

// --- Extraction ----------------------------------------------------------------------

/**
 * The raw value of an answer for an extraction (`{ kind: 'path', steps }`,
 * `{ kind: 'regex', regex }` or `{ kind: 'whole' }`).
 * @param {{ body: string, contentType?: string }} answer
 */
export function extract(extraction, { body, contentType = '' }) {
  const html = /html/i.test(contentType);
  if (extraction.kind === 'regex') {
    const found = runRegex(extraction.regex, body);
    if (found === null) {
      throw new ValueError(VALUE_ERRORS.NO_MATCH);
    }
    return html ? htmlText(found) : found;
  }
  if (extraction.kind === 'whole') {
    try {
      return JSON.parse(body);
    } catch {
      return html ? htmlText(body) : body;
    }
  }
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw new ValueError(VALUE_ERRORS.NOT_JSON);
  }
  const value = walkPath(data, extraction.steps);
  if (value === undefined) {
    throw new ValueError(VALUE_ERRORS.NOT_FOUND);
  }
  return value;
}

// --- Conversion ----------------------------------------------------------------------

const NUMBER = /[-+]?(?:\d+(?:[.,]\d+)?|[.,]\d+)(?:e[-+]?\d+)?/i;

/** A number read from a JSON value or a text ("21,5 °C" → 21.5); null when there is none. */
export function toNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const match = value.match(NUMBER);
  if (!match) {
    return null;
  }
  const number = Number(match[0].replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

const TRUE_WORDS = new Set([
  'true',
  'on',
  'yes',
  'up',
  'active',
  'enabled',
  'oui',
  'ja',
  'si',
  'sí',
]);
const FALSE_WORDS = new Set(['false', 'off', 'no', 'down', 'inactive', 'disabled', 'non', 'nein']);

/** 1 or 0 from a JSON value or a word; null when it is neither. */
export function toBinary(value) {
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Number(value !== 0) : null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const word = value.trim().toLowerCase();
  if (TRUE_WORDS.has(word)) {
    return 1;
  }
  if (FALSE_WORDS.has(word)) {
    return 0;
  }
  const number = /^[-+]?\d+(?:[.,]\d+)?$/.test(word) ? toNumber(word) : null;
  return number === null ? null : Number(number !== 0);
}

/** A text from a JSON value: one line, MAX_TEXT_LENGTH characters at most. */
export function toText(value) {
  if (value === null || value === undefined) {
    return '';
  }
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > MAX_TEXT_LENGTH ? `${line.slice(0, MAX_TEXT_LENGTH - 1)}…` : line;
}

/** Three decimals: a Wh counter read in kWh keeps its watt-hours. */
export const round = (value) => Math.round(value * 1000) / 1000;

/**
 * The Gladys value of a raw value, for a sensor: a number for the numeric
 * types and binary, a non-empty string for text. Throws a ValueError.
 * @param {{ type: string, scale: number, offset: number }} sensor
 */
export function convert(sensor, raw) {
  if (sensor.type === 'text') {
    const text = toText(raw);
    if (!text) {
      throw new ValueError(VALUE_ERRORS.EMPTY);
    }
    return text;
  }
  if (raw === null || raw === '' || (typeof raw === 'string' && raw.trim() === '')) {
    throw new ValueError(VALUE_ERRORS.EMPTY);
  }
  if (sensor.type === 'binary') {
    const binary = toBinary(raw);
    if (binary === null) {
      throw new ValueError(VALUE_ERRORS.NOT_BINARY, toText(raw).slice(0, 40));
    }
    return binary;
  }
  const number = toNumber(raw);
  if (number === null) {
    throw new ValueError(VALUE_ERRORS.NOT_NUMBER, toText(raw).slice(0, 40));
  }
  const value = round(number * sensor.scale + sensor.offset);
  return Object.is(value, -0) ? 0 : value;
}
