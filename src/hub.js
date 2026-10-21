// -----------------------------------------------------------------------------
// The hub: reads every configured sensor on a timer of the container, each
// at its own interval; publishes the states of the added devices when they
// change; fires the scene events (a sensor that fails, a text that changes);
// holds the last readings the widget, the reports and the scene actions show.
//
// Gladys never polls these devices (should_poll: false): the intervals go up
// to one hour, beyond the fixed list of the core scheduler.
//
// A failed reading is tried again after RETRY_MS (or the interval, if
// shorter); the sensor is "in error" after FAILED_AFTER failures in a row, so
// one lost answer neither starts the scenes nor marks the device. What was
// announced lives in /data (src/store.js): no duplicate after a restart.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { bodyType } from './config.js';
import { buildSensorDevice, parseSlotId, sensorIds, sensorName, sensorStates } from './devices.js';
import { FailureLog } from './logs.js';
import { HTTP_ERRORS, HttpError, hostOf, httpRequest, isLocalAddress } from './http.js';
import { ValueError, convert, extract } from './sensors.js';
import { CONNECTION_TEXT, REPORT_TEXT, errorText, labelled } from './texts.js';

const logger = createLogger({ name: 'http-json-hub' });

export const WIDGET_KEY = 'values';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  FAILED: 'request_failed',
  TEXT_CHANGED: 'text_changed',
});

export const HUB_TIMINGS = {
  // A failed reading is tried again this soon (or at the interval, if shorter).
  retryMs: 30_000,
  // An unchanged value is sent again this often: Gladys marks a value older
  // than 48 h as outdated.
  heartbeatMs: 6 * 3600_000,
  // The timer never sleeps longer than this (a clock that jumps).
  maxSleepMs: 60_000,
};

export const FAILED_AFTER = 2;
const CONCURRENCY = 5;
// What a scene action hands over of an answer (the core caps an output at
// 10 000 characters).
export const MAX_EXCERPT = 2000;

const LANGUAGES = Object.keys(REPORT_TEXT);
export const inEveryLanguage = (render) =>
  Object.fromEntries(LANGUAGES.map((language) => [language, render(language)]));

const cut = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** Anything thrown while reading, as `{ kind, detail, status }`. */
function asError(caught) {
  if (caught instanceof HttpError || caught instanceof ValueError) {
    return { kind: caught.kind, detail: caught.detail ?? '', status: caught.status ?? 0 };
  }
  return { kind: HTTP_ERRORS.UNREACHABLE, detail: String(caught?.message ?? caught), status: 0 };
}

/**
 * One request and the value it gives, for a sensor (or the "Call an
 * address" scene action). Never throws: the outcome says what happened.
 * @returns {Promise<{ value: number|string|null, raw: unknown, status: number, body: string, error: object|null }>}
 */
export async function fetchValue(request, sensor, { convertValue = true, timeoutMs } = {}) {
  if (sensor.error) {
    return {
      value: null,
      raw: null,
      status: 0,
      body: '',
      error: { kind: 'config', detail: sensor.error, status: 0 },
    };
  }
  const headers = { ...sensor.headers };
  const hasType = Object.keys(headers).some((name) => name.toLowerCase() === 'content-type');
  if (sensor.body && !hasType) {
    headers['Content-Type'] = bodyType(sensor.body);
  }
  let answer;
  try {
    answer = await request(sensor.url, {
      method: sensor.method,
      headers,
      body: sensor.body,
      verifyTls: sensor.verifyTls,
      ...(timeoutMs ? { timeoutMs } : {}),
    });
  } catch (caught) {
    return {
      value: null,
      raw: null,
      status: caught?.status ?? 0,
      body: '',
      error: asError(caught),
    };
  }
  const outcome = { value: null, raw: null, status: answer.status, body: answer.body, error: null };
  if (answer.status < 200 || answer.status > 299) {
    outcome.error = { kind: HTTP_ERRORS.STATUS, detail: '', status: answer.status };
    return outcome;
  }
  try {
    outcome.raw = extract(sensor.extraction, {
      body: answer.body,
      contentType: String(answer.headers?.['content-type'] ?? ''),
    });
    if (convertValue) {
      outcome.value = convert(sensor, outcome.raw);
    }
  } catch (caught) {
    outcome.error = { ...asError(caught), status: answer.status };
  }
  return outcome;
}

export class HttpHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/http.js)
   * @param {boolean} [options.timers] the reading timer (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, request, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request ?? httpRequest;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.config = { sensors: [], language: 'fr' };
    /** @type {Map<number, object>} the sensors, by slot */
    this.sensors = new Map();
    /** @type {Map<number, object>} the last reading per slot */
    this.readings = new Map();
    /** @type {Map<number, number>} when each slot is due */
    this.dueAt = new Map();
    /** @type {Map<number, Promise>} the readings in progress */
    this.inProgress = new Map();
    this.published = new Map();
    this.publishedAt = new Map();
    this.transports = new Map();
    this.connection = null;
    this.discovered = null;
    // What was announced to the scenes, kept across restarts.
    this.events = { failing: {}, texts: {} };
    this.timer = null;
    this.cycle = null;
    this.stopped = false;
    this.failureLog = new FailureLog(logger);
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    const events = saved.events ?? {};
    const object = (value) =>
      value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    this.events = { failing: object(events.failing), texts: object(events.texts) };
    // A failure announced before the restart still stands until a reading
    // works: no "In error" 1 → 0 → 1 (nor badge flip) that would start the
    // scenes again.
    for (const sensor of config.sensors) {
      if (this.events.failing[sensor.slot] === sensor.signature) {
        this.readings.set(sensor.slot, {
          value: null,
          error: { kind: HTTP_ERRORS.UNREACHABLE, detail: '', status: 0 },
          failures: FAILED_AFTER,
          failing: true,
          status: 0,
          readAt: 0,
        });
      }
    }
    await this.reconfigure(config);
    logger.info(`${this.sensors.size} sensor(s) configured`);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.published.clear();
    this.publishedAt.clear();
    this.transports.clear();
    this.connection = null;
    this.discovered = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    this.config = config;
    const next = new Map(config.sensors.map((sensor) => [sensor.slot, sensor]));
    for (const [slot, previous] of this.sensors) {
      const sensor = next.get(slot);
      if (!sensor || sensor.signature !== previous.signature) {
        // Another reading: the last value, the announced failure and the
        // text known are those of the old one.
        this.readings.delete(slot);
        this.dueAt.delete(slot);
      } else if (sensor.intervalMs !== previous.intervalMs && this.readings.has(slot)) {
        this.dueAt.set(slot, this.readings.get(slot).readAt + sensor.intervalMs);
      }
    }
    this.sensors = next;
    // What was announced for a reading that is not the current one is forgotten.
    const known = new Set([...Object.keys(this.events.failing), ...Object.keys(this.events.texts)]);
    for (const slot of known) {
      this.forget(slot, next.get(Number(slot))?.signature);
    }
    await this.readDue({ publish: true });
  }

  /** Forget what was announced for a slot (it changed, or is gone). */
  forget(slot, signature) {
    let changed = false;
    if (slot in this.events.failing && this.events.failing[slot] !== signature) {
      delete this.events.failing[slot];
      changed = true;
    }
    if (slot in this.events.texts && this.events.texts[slot].signature !== signature) {
      delete this.events.texts[slot];
      changed = true;
    }
    if (changed) {
      this.save();
    }
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.cycle?.catch(() => {});
    await this.store.flush();
  }

  save() {
    return this.store.save({ events: this.events });
  }

  schedule() {
    clearTimeout(this.timer);
    if (!this.timersEnabled || this.stopped || this.sensors.size === 0) {
      return;
    }
    const next = Math.min(...[...this.sensors.keys()].map((slot) => this.dueAt.get(slot) ?? 0));
    const delay = Math.min(this.timings.maxSleepMs, Math.max(1000, next - this.now()));
    this.timer = setTimeout(async () => {
      try {
        await this.readDue();
        this.failureLog.recover('cycle', 'Reading cycle works again');
      } catch (err) {
        this.failureLog.fail('cycle', `Reading cycle failed: ${err.message}`, 'error');
        this.schedule();
      }
    }, delay);
  }

  // --- Reading ---------------------------------------------------------------

  /** Read the sensors that are due (all of them with `force`), then publish. */
  async readDue({ publish = false, force = false, slots = null } = {}) {
    const run = async () => {
      const now = this.now();
      const due = [...this.sensors.values()].filter((sensor) =>
        slots ? slots.includes(sensor.slot) : force || (this.dueAt.get(sensor.slot) ?? 0) <= now,
      );
      const before = this.widgetSignature();
      for (let at = 0; at < due.length; at += CONCURRENCY) {
        await Promise.all(due.slice(at, at + CONCURRENCY).map((sensor) => this.readSensor(sensor)));
      }
      await this.publishAll(before, { publish });
    };
    // One cycle at a time: a cycle asked during another one runs after it.
    const cycle = (this.cycle ?? Promise.resolve()).catch(() => {}).then(run);
    this.cycle = cycle;
    try {
      await cycle;
    } finally {
      if (this.cycle === cycle) {
        this.cycle = null;
      }
      this.schedule();
    }
  }

  /** Send to Gladys what the readings changed. */
  async publishAll(widgetBefore, { publish = false } = {}) {
    await this.publishStates();
    await this.publishDevices({ force: publish });
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (widgetBefore !== this.widgetSignature()) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  /**
   * Read some sensors now, outside the queue of the timer cycles: a scene
   * action or the widget button must not wait for a cycle of slow sensors
   * (their deadline is 30 s). A sensor already being read shares its request.
   */
  async readSlots(slots) {
    const before = this.widgetSignature();
    const sensors = slots.map((slot) => this.sensors.get(slot)).filter(Boolean);
    await Promise.all(sensors.map((sensor) => this.readSensor(sensor)));
    await this.publishAll(before);
    this.schedule();
  }

  /** Read one sensor now (concurrent calls share the request) and apply the outcome. */
  readSensor(sensor) {
    const running = this.inProgress.get(sensor.slot);
    if (running) {
      return running;
    }
    const reading = fetchValue(this.request, sensor)
      .then((outcome) => this.apply(sensor, outcome))
      .finally(() => this.inProgress.delete(sensor.slot));
    this.inProgress.set(sensor.slot, reading);
    return reading;
  }

  /** The outcome of a reading: the new reading of the slot, events fired. */
  async apply(sensor, outcome) {
    if (this.sensors.get(sensor.slot)?.signature !== sensor.signature) {
      return null; // the configuration changed meanwhile
    }
    const now = this.now();
    const previous = this.readings.get(sensor.slot);
    const name = sensorName(sensor, 'en');
    let reading;
    if (outcome.error) {
      const failures = (previous?.failures ?? 0) + 1;
      // A configuration error does not heal by itself: no grace.
      const failing = outcome.error.kind === 'config' || failures >= FAILED_AFTER;
      reading = {
        ...previous,
        value: previous?.value ?? null,
        error: outcome.error,
        failures,
        failing,
      };
      if (failing && !previous?.failing) {
        logger.warn(
          `Sensor ${sensor.slot} (${name}, ${hostOf(sensor.url)}): ${errorText(outcome.error, 'en')}`,
        );
      } else {
        logger.debug(`Sensor ${sensor.slot}: ${errorText(outcome.error, 'en')}`);
      }
      const retry = failing ? sensor.intervalMs : Math.min(sensor.intervalMs, this.timings.retryMs);
      this.dueAt.set(sensor.slot, now + retry);
    } else {
      if (previous?.failing) {
        logger.info(`Sensor ${sensor.slot} (${name}) works again`);
      }
      reading = { value: outcome.value, error: null, failures: 0, failing: false };
      this.dueAt.set(sensor.slot, now + sensor.intervalMs);
    }
    reading.status = outcome.status;
    reading.readAt = now;
    reading.okAt = outcome.error ? previous?.okAt : now;
    this.readings.set(sensor.slot, reading);
    await this.sensorEvents(sensor, reading);
    return reading;
  }

  /** What the widget shows: it is refreshed when this changes. */
  widgetSignature() {
    return JSON.stringify(
      [...this.readings].map(([slot, reading]) => [slot, reading.value, reading.failing]),
    );
  }

  // --- Scene events ----------------------------------------------------------

  async sensorEvents(sensor, reading) {
    const slot = sensor.slot;
    const language = this.config.language;
    const externalId = sensorIds(this.gladys, slot).device;
    const announced = this.events.failing[slot] === sensor.signature;
    if (reading.failing && !announced) {
      const accepted = await this.fireEvent(TRIGGERS.FAILED, {
        sensor: externalId,
        name: sensorName(sensor, language),
        error: errorText(reading.error, language),
        error_kind: reading.error.kind,
        status: reading.error.status ?? 0,
      });
      if (accepted) {
        this.events.failing[slot] = sensor.signature;
        this.save();
      }
    } else if (!reading.failing && !reading.error && announced) {
      delete this.events.failing[slot];
      this.save();
    }
    if (sensor.type !== 'text' || reading.error) {
      return;
    }
    const known = this.events.texts[slot];
    if (known?.signature === sensor.signature && known.value === reading.value) {
      return;
    }
    if (known?.signature === sensor.signature) {
      const accepted = await this.fireEvent(TRIGGERS.TEXT_CHANGED, {
        sensor: externalId,
        name: sensorName(sensor, language),
        value: reading.value,
        previous: known.value,
      });
      if (!accepted) {
        return; // tried again at the next reading
      }
    }
    this.events.texts[slot] = { signature: sensor.signature, value: reading.value };
    this.save();
  }

  /** @returns {Promise<boolean>} whether Gladys accepted the event */
  async fireEvent(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
      logger.debug(`${key} (sensor ${data.sensor})`);
      this.failureLog.recover('event', 'Scene events accepted again');
      return true;
    } catch (err) {
      this.failureLog.fail('event', `Scene event refused: ${err.message}`);
      return false;
    }
  }

  // --- Devices ---------------------------------------------------------------

  isCreated(externalId) {
    return (this.gladys.devices ?? []).some((device) => device.external_id === externalId);
  }

  /** The sensor of a device external id, or null. */
  sensorOf(externalId) {
    return this.sensors.get(parseSlotId(this.gladys, externalId)) ?? null;
  }

  async publishDevices({ force = false } = {}) {
    const devices = [...this.sensors.values()].map((sensor) =>
      buildSensorDevice(this.gladys, sensor, this.config.language),
    );
    const key = JSON.stringify(devices);
    if (!force && key === this.discovered) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.discovered = key;
      this.failureLog.recover('discovered', 'Discovered devices accepted again');
    } catch (err) {
      this.failureLog.fail('discovered', `Discovered devices refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: read everything again, publish the list again. */
  async rediscover() {
    await this.readDue({ force: true, publish: true });
  }

  /** The user added a device: its states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    const sensor = this.sensorOf(device.external_id);
    if (!sensor) {
      return;
    }
    await this.sendStates(sensorStates(this.gladys, sensor, this.readings.get(sensor.slot)), {
      force: true,
    });
    this.transports.delete(device.external_id);
    await this.publishTransports();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  // --- Publishing to Gladys --------------------------------------------------

  async publishStates() {
    const states = [];
    for (const sensor of this.sensors.values()) {
      if (this.isCreated(sensorIds(this.gladys, sensor.slot).device)) {
        states.push(...sensorStates(this.gladys, sensor, this.readings.get(sensor.slot)));
      }
    }
    await this.sendStates(states);
  }

  /** The states that changed, or are due for a heartbeat. */
  async sendStates(states, { force = false } = {}) {
    const now = this.now();
    const due = states.filter(
      ({ externalId, value }) =>
        force ||
        this.published.get(externalId) !== value ||
        now - (this.publishedAt.get(externalId) ?? 0) >= this.timings.heartbeatMs,
    );
    if (due.length === 0) {
      return;
    }
    const batch = due.map(({ externalId, value, text }) =>
      text
        ? { device_feature_external_id: externalId, text: value }
        : { device_feature_external_id: externalId, state: value },
    );
    try {
      await this.gladys.publishStates(batch);
      for (const { externalId, value } of due) {
        this.published.set(externalId, value);
        this.publishedAt.set(externalId, now);
      }
      this.failureLog.recover('states', 'States accepted again');
    } catch (err) {
      this.failureLog.fail('states', `States refused: ${err.message}`);
    }
  }

  /** The badge of the added devices: local or cloud, "unreachable" while failing. */
  async publishTransports() {
    const { LOCAL, CLOUD, UNREACHABLE } = DEVICE_TRANSPORTS;
    const entries = [];
    for (const sensor of this.sensors.values()) {
      const id = sensorIds(this.gladys, sensor.slot).device;
      const reading = this.readings.get(sensor.slot);
      if (!reading || !this.isCreated(id)) {
        continue;
      }
      const up = sensor.url && isLocalAddress(sensor.url) ? LOCAL : CLOUD;
      const transport = reading.failing ? UNREACHABLE : up;
      if (this.transports.get(id) !== transport) {
        entries.push({ external_id: id, transport });
      }
    }
    if (entries.length === 0) {
      return;
    }
    try {
      await this.gladys.publishTransports(entries);
      for (const entry of entries) {
        this.transports.set(entry.external_id, entry.transport);
      }
      this.failureLog.recover('transports', 'Transports accepted again');
    } catch (err) {
      this.failureLog.fail('transports', `Transports refused: ${err.message}`);
    }
  }

  /** The status under the integration name. */
  connectionStatus() {
    if (this.sensors.size === 0) {
      return { connected: false, message: CONNECTION_TEXT.noSensor };
    }
    const readings = [...this.sensors.keys()].map((slot) => this.readings.get(slot));
    if (readings.every((reading) => reading?.failing)) {
      return { connected: false, message: CONNECTION_TEXT.allFailing };
    }
    return { connected: true };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.failureLog.recover('connection', 'Connection status accepted again');
    } catch (err) {
      this.failureLog.fail('connection', `Connection status refused: ${err.message}`);
    }
  }

  // --- Views -----------------------------------------------------------------

  /** A value as text, for reports and scene outputs: "21.5", "on"… */
  static valueText(sensor, value, language) {
    if (value === null || value === undefined) {
      return '';
    }
    if (typeof value === 'string') {
      return value;
    }
    return new Intl.NumberFormat(language, { maximumFractionDigits: 3, useGrouping: false }).format(
      value,
    );
  }

  /** One line per sensor, in one language: "Name: 21.5" or "Name: no answer". */
  sensorLine(sensor, language) {
    const reading = this.readings.get(sensor.slot);
    const name = sensorName(sensor, language);
    if (reading?.error) {
      return labelled(name, errorText(reading.error, language), language);
    }
    return labelled(name, HttpHub.valueText(sensor, reading?.value, language) || '–', language);
  }

  // --- Configuration action ---------------------------------------------------

  /** "Test the sensors": read every sensor now, one line each. */
  async testSensors() {
    await this.readDue({ force: true, publish: true });
    return inEveryLanguage((language) => {
      const text = REPORT_TEXT[language];
      if (this.sensors.size === 0) {
        return text.none;
      }
      const lines = [...this.sensors.values()].map(
        (sensor) => `• ${this.sensorLine(sensor, language)}`,
      );
      return [`${text.sensors(this.sensors.size)}:`, ...lines].join('\n');
    });
  }

  /** A sensor read now for a scene action: the reading, published like the others. */
  async readNow(sensor) {
    await this.readSlots([sensor.slot]);
    return this.readings.get(sensor.slot) ?? null;
  }

  /** A short excerpt of an answer body, for a scene. */
  static excerpt(body) {
    return cut(String(body ?? '').trim(), MAX_EXCERPT);
  }

  /**
   * The secret header of a sensor, for a call to `url`: only towards the
   * origin of that sensor (null otherwise); undefined when the slot has none.
   */
  secretOf(slot, url) {
    const sensor = this.sensors.get(slot);
    if (!sensor?.url || Object.keys(sensor.secretHeaders ?? {}).length === 0) {
      return undefined;
    }
    // The origin (scheme, host and port): never in clear over http, never to another service.
    return new URL(sensor.url).origin === new URL(url).origin ? sensor.secretHeaders : null;
  }

  /** The error of a reading, in the configured language. */
  errorLine(error) {
    return error ? errorText(error, this.config.language) : '';
  }
}
