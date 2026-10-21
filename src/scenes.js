// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// "Call an address": what the sensors cannot do — send a request from a
// scene (a webhook, a relay, an API of a device), with scene values in the
// address, headers and body (Gladys replaces them before the action
// arrives), and hand the answer to the next actions. No secret field is
// possible in a scene (its JSON is readable by every user): the secret header
// of a configured sensor can be reused instead, towards the host of that
// sensor only (a scene must not be a way to send it elsewhere).
//
// "Read a sensor now": a fresh value before a decision (the sensor reads at
// its interval otherwise), published as a state like the timer would.
//
// Neither throws on a failed request: `success` and `error` say what
// happened, so the scene can test them. Only a field that cannot be used
// fails the action.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { MAX_SENSORS, parseExtraction, parseHeaders, parseUrl } from './config.js';
import { HttpHub, fetchValue } from './hub.js';
import { METHODS, hostOf } from './http.js';
import { toNumber, toText } from './sensors.js';
import { ACTION_TEXT, pick } from './texts.js';

const logger = createLogger({ name: 'http-json-scenes' });

// The deadline of a call: within the action's 30 s, the relay included.
export const CALL_TIMEOUT_MS = 20_000;
export const SECRET_SOURCES = [
  'none',
  ...Array.from({ length: MAX_SENSORS }, (_, i) => String(i + 1)),
];

const fail = (text, language) => {
  throw new Error(pick(text, language));
};

/** The outputs of an outcome (src/hub.js fetchValue). */
function outputsOf(hub, outcome, value) {
  const number = typeof value === 'number' ? value : toNumber(value);
  return {
    success: !outcome.error,
    status: outcome.status,
    value: toText(value ?? ''),
    // 0 when there is no number: `success` and `value` tell the difference.
    number: number ?? 0,
    error: hub.errorLine(outcome.error),
  };
}

export const SCENE_ACTIONS = {
  async call_url(hub, { fields = {} }) {
    const language = hub.config.language;
    const url = parseUrl(fields.url);
    if (!url) {
      fail(ACTION_TEXT.badUrl, language);
    }
    const method = METHODS.includes(fields.method) ? fields.method : 'GET';
    const headers = parseHeaders(fields.headers);
    if (!headers) {
      fail(ACTION_TEXT.badHeaders, language);
    }
    const extraction = parseExtraction(fields.path);
    if (!extraction) {
      fail(ACTION_TEXT.badPath, language);
    }
    // The secret header of a sensor: read from the configuration, never from the scene.
    const source = String(fields.secret_from ?? 'none');
    const slot = SECRET_SOURCES.includes(source) && source !== 'none' ? Number(source) : 0;
    const secret = slot ? hub.secretOf(slot, url) : {};
    if (!secret) {
      fail(ACTION_TEXT.secretHost, language);
    }
    const call = {
      url,
      method,
      headers: { ...headers, ...secret },
      body: method === 'GET' || typeof fields.body !== 'string' ? '' : fields.body,
      extraction,
      verifyTls: fields.verify_tls !== false && fields.verify_tls !== 'false',
      error: null,
    };
    const outcome = await fetchValue(hub.request, call, {
      convertValue: false,
      timeoutMs: CALL_TIMEOUT_MS,
    });
    const line = `Call: ${method} ${hostOf(url)} → ${outcome.status ? `HTTP ${outcome.status}` : outcome.error.kind}`;
    if (outcome.error) {
      logger.warn(line);
    } else {
      logger.info(line);
    }
    return {
      ...outputsOf(hub, outcome, outcome.error ? null : outcome.raw),
      response: HttpHub.excerpt(outcome.body),
    };
  },

  async read_sensor(hub, { fields = {} }) {
    const sensor = hub.sensorOf(fields.sensor);
    if (!sensor) {
      fail(ACTION_TEXT.unknownSensor, hub.config.language);
    }
    const reading = await hub.readNow(sensor);
    const outcome = { error: reading?.error ?? null, status: reading?.status ?? 0 };
    return outputsOf(hub, outcome, reading?.error ? null : reading?.value);
  },
};
