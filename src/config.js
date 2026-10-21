// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// Up to MAX_SENSORS sensors, in numbered slots (`sensor_<n>_<field>`): Gladys
// has no list field, and a slot can hold a secret field (an action cannot,
// Gladys#3154). The slot number is the identity of the device: renaming a
// sensor or changing its address keeps its device and history.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import {
  SENSOR_TYPE_KEYS,
  checkRegex,
  isNumeric,
  parsePath,
  regexOf,
  toNumber,
} from './sensors.js';

export const LANGUAGES = ['en', 'fr', 'de', 'es'];
export const MAX_SENSORS = 10;
export const SENSOR_METHODS = ['GET', 'POST'];

// Reading intervals offered for a sensor, in seconds (30 s to 1 h).
export const INTERVALS = ['30', '60', '120', '300', '600', '900', '1800', '3600'];

// The fields of a slot, with their defaults (none for the secret).
export const SLOT_DEFAULTS = {
  name: '',
  url: '',
  method: 'GET',
  headers: '',
  secret: undefined,
  body: '',
  path: '',
  type: 'number',
  scale: '',
  offset: '',
  interval: '60',
  verify_tls: true,
};

export const slotKey = (slot, field) => `sensor_${slot}_${field}`;

export const DEFAULT_CONFIG = {
  ...Object.fromEntries(
    Array.from({ length: MAX_SENSORS }, (_, index) =>
      Object.entries(SLOT_DEFAULTS)
        .filter(([, value]) => value !== undefined)
        .map(([field, value]) => [slotKey(index + 1, field), value]),
    ).flat(),
  ),
  language: 'fr',
};

// Problems of a slot, shown in the configuration status and the reports.
export const SLOT_ERRORS = Object.freeze({
  URL: 'url',
  PATH: 'path',
  HEADERS: 'headers',
  SECRET: 'secret',
  NUMBER: 'number',
});

const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
// What node:http accepts in a header value (Latin-1, no control character).
const HEADER_VALUE = /^[\t\x20-\x7e\x80-\xff]*$/;
const FORBIDDEN_HEADERS = new Set(['host', 'content-length', 'transfer-encoding', 'connection']);

/**
 * "Name: value" lines (or separated by " | ") as headers.
 * @returns {Record<string, string>|null} null when a line is not understood
 */
export function parseHeaders(raw) {
  const headers = {};
  const lines = String(raw ?? '')
    .split(/\r?\n|\s\|\s/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    const colon = line.indexOf(':');
    const name = colon > 0 ? line.slice(0, colon).trim() : '';
    const value = colon > 0 ? line.slice(colon + 1).trim() : '';
    if (
      !HEADER_NAME.test(name) ||
      FORBIDDEN_HEADERS.has(name.toLowerCase()) ||
      !HEADER_VALUE.test(value)
    ) {
      return null;
    }
    headers[name] = value;
  }
  return headers;
}

/**
 * The secret header field: "Header-Name: value", or a bare token sent as
 * `Authorization: Bearer <token>` ("Basic …", "Token …" are kept as typed).
 * @returns {Record<string, string>|null}
 */
export function secretHeader(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) {
    return {};
  }
  // A whole header: a colon followed by a space, or a name with a dash
  // (`X-Api-Key:abc`). `user:password` stays a token.
  const named = text.match(/^([!#$%&'*+.^_`|~0-9A-Za-z-]+):(\s*)(\S.*)$/);
  if (
    named &&
    (named[2] || named[1].includes('-')) &&
    !/^(basic|bearer|token|digest|apikey)$/i.test(named[1])
  ) {
    return parseHeaders(text);
  }
  if (!HEADER_VALUE.test(text)) {
    return null;
  }
  return { Authorization: /\s/.test(text) ? text : `Bearer ${text}` };
}

/** A URL the user typed: http(s) only, `http://` added when there is no scheme. */
export function parseUrl(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) {
    return null;
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  try {
    const url = new URL(withScheme);
    // Credentials in the address would end up in logs: there is the secret field.
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

/** The extraction of a slot: a regular expression, a field path, or the whole answer. */
export function parseExtraction(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) {
    return { kind: 'whole' };
  }
  const regex = regexOf(text);
  if (regex) {
    return checkRegex(regex) ? { kind: 'regex', regex } : null;
  }
  const steps = parsePath(text);
  return steps ? { kind: 'path', steps } : null;
}

const digest = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);

const isTrue = (value) => value === true || value === 'true';

/**
 * One slot of the configuration: null when empty (no address), a sensor
 * otherwise, with `error` set (a SLOT_ERRORS key) when a field is wrong.
 */
export function parseSlot(source, slot) {
  const get = (field) => source[slotKey(slot, field)];
  const text = (field) => (typeof get(field) === 'string' ? get(field).trim() : '');
  const typedUrl = text('url');
  if (!typedUrl) {
    return null;
  }
  const choose = (field, list) => {
    const value = get(field) === undefined || get(field) === null ? '' : String(get(field));
    return list.includes(value) ? value : SLOT_DEFAULTS[field];
  };
  const type = choose('type', SENSOR_TYPE_KEYS);
  const number = (field, fallback) => {
    const typed = text(field);
    if (!typed) {
      return fallback;
    }
    return /^[-+]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[-+]?\d+)?$/i.test(typed) ? toNumber(typed) : null;
  };
  const url = parseUrl(typedUrl);
  const extraction = parseExtraction(text('path'));
  const headers = parseHeaders(get('headers'));
  const secret = secretHeader(get('secret'));
  const scale = number('scale', 1);
  const offset = number('offset', 0);
  let error = null;
  if (!url) {
    error = SLOT_ERRORS.URL;
  } else if (!extraction) {
    error = SLOT_ERRORS.PATH;
  } else if (!headers) {
    error = SLOT_ERRORS.HEADERS;
  } else if (!secret) {
    error = SLOT_ERRORS.SECRET;
  } else if (isNumeric(type) && (scale === null || offset === null)) {
    error = SLOT_ERRORS.NUMBER;
  }
  const method = choose('method', SENSOR_METHODS);
  const body = typeof get('body') === 'string' ? get('body') : '';
  const sensor = {
    slot,
    name: text('name').replace(/\s+/g, ' ').slice(0, 60),
    url,
    method,
    headers: { ...headers, ...secret },
    secretHeaders: secret ?? {},
    body: method === 'POST' ? body : '',
    path: text('path'),
    extraction,
    type,
    scale: scale ?? 1,
    offset: offset ?? 0,
    intervalMs: Number(choose('interval', INTERVALS)) * 1000,
    verifyTls: get('verify_tls') === undefined ? true : isTrue(get('verify_tls')),
    error,
  };
  // What makes a reading: a new one forgets the last value and the announced failure.
  // Hashed: it is stored under /data, and the address and the headers can hold a key.
  sensor.signature = digest([
    sensor.url,
    sensor.method,
    sensor.headers,
    sensor.body,
    sensor.path,
    sensor.type,
    sensor.scale,
    sensor.offset,
    sensor.verifyTls,
  ]);
  return sensor;
}

/** The content type of a body: JSON when it parses as JSON, text otherwise. */
export function bodyType(body) {
  try {
    JSON.parse(body);
    return 'application/json';
  } catch {
    return 'text/plain; charset=utf-8';
  }
}

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const sensors = [];
  for (let slot = 1; slot <= MAX_SENSORS; slot += 1) {
    const sensor = parseSlot(source, slot);
    if (sensor) {
      sensors.push(sensor);
    }
  }
  return {
    sensors,
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
