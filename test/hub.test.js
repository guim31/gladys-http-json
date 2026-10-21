// The hub (src/hub.js), through the real wiring and the SDK's fake Gladys:
// devices, states, the reading timer of the container, failures, scene
// events, restarts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore, createWorld, fixture, json, slot } from './helpers/world.js';
import { HttpError } from '../src/http.js';

const METEO = 'https://api.open-meteo.com/v1/forecast?latitude=48.85&current=temperature_2m';
const PLUG = 'http://192.0.2.20/rpc/Switch.GetStatus?id=0';
const STATUS = 'http://192.0.2.30/status.txt';

const CONFIG = {
  ...slot(1, { name: 'Outdoor', url: METEO, path: 'current.temperature_2m', type: 'temperature' }),
  ...slot(2, { name: 'Plug power', url: PLUG, path: 'apower', type: 'power', interval: '30' }),
  ...slot(4, { name: 'Box', url: STATUS, path: '/state=(\\w+)/', type: 'text' }),
};
const ROUTES = {
  [METEO]: json(fixture('open-meteo-current.json')),
  [PLUG]: json({ id: 0, output: true, apower: 151.3, voltage: 231.2 }),
  [STATUS]: { status: 200, body: 'uptime=3d\nstate=online\n' },
};

const world = (options = {}) => createWorld({ config: CONFIG, routes: ROUTES, ...options });
const ids = (w, n) => w.gladys.externalIds('sensor', String(n));

test('one device per configured slot, identity = the slot', async (t) => {
  const w = await world();
  t.after(() => w.app.stop());
  const devices = w.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((d) => [d.name, d.external_id, d.should_poll, d.features.length]),
    [
      ['Outdoor', ids(w, 1).device, false, 2],
      ['Plug power', ids(w, 2).device, false, 2],
      ['Box', ids(w, 4).device, false, 2],
    ],
  );
  assert.deepEqual(
    devices[0].features.map((f) => [f.external_id, f.category, f.type, f.unit]),
    [
      [ids(w, 1).feature('value_temperature'), 'temperature-sensor', 'decimal', 'celsius'],
      [ids(w, 1).feature('error'), 'input', 'binary', undefined],
    ],
  );
  assert.equal(w.fake.connectionStatus.connected, true);
});

test('states only for the added devices, all of them again at "Add"', async (t) => {
  const w = await world();
  t.after(() => w.app.stop());
  assert.equal(w.fake.states.length, 0, 'nothing added yet');
  await w.add(ids(w, 1).device);
  assert.equal(w.fake.lastState(ids(w, 1).feature('value_temperature')), 10.9);
  assert.equal(w.fake.lastState(ids(w, 1).feature('error')), 0);
  assert.deepEqual(w.fake.widgetRefreshes.at(-1), 'values');
  await w.add(ids(w, 4).device);
  const text = w.fake.states.find(
    (s) => s.device_feature_external_id === ids(w, 4).feature('value_text'),
  );
  assert.equal(text.text, 'online');
  assert.deepEqual(
    w.fake.transports
      .flat()
      .map((e) => [e.device_external_id, e.transport])
      .slice(-1),
    [[ids(w, 4).device, 'local']],
  );
  assert.ok(
    w.fake.transports
      .flat()
      .some((e) => e.device_external_id === ids(w, 1).device && e.transport === 'cloud'),
  );
});

test('the container reads each sensor at its own interval, changes only', async (t) => {
  const w = await world({ devices: [] });
  t.after(() => w.app.stop());
  await w.add(ids(w, 1).device);
  await w.add(ids(w, 2).device);
  const calls = () => w.web.calls.map((c) => c.url);
  const before = calls().length;
  w.tick(30_000);
  await w.hub.readDue();
  assert.deepEqual(calls().slice(before), [PLUG], 'only the 30 s sensor is due');
  const published = w.fake.states.length;
  w.tick(30_000);
  await w.hub.readDue();
  assert.equal(w.fake.states.length, published, 'nothing changed, nothing sent');
  w.web.routes[PLUG] = json({ apower: 12 });
  w.tick(30_000);
  await w.hub.readDue();
  assert.equal(w.fake.lastState(ids(w, 2).feature('value_power')), 12);
  // Every 6 h, an unchanged value is sent again (Gladys: "no recent value" after 48 h).
  const count = w.fake.states.length;
  w.tick(6 * 3600_000);
  await w.hub.readDue();
  assert.ok(w.fake.states.length > count);
});

test('a failure: retried after 30 s, "in error" and the trigger at the second one, once', async (t) => {
  const w = await world();
  t.after(() => w.app.stop());
  await w.add(ids(w, 1).device);
  w.web.routes[METEO] = json({ error: true, reason: 'Too many requests' }, 429);
  w.tick(60_000);
  await w.hub.readDue();
  assert.equal(w.fake.lastState(ids(w, 1).feature('error')), 0, 'one failure is forgiven');
  assert.equal(w.fake.sceneEvents.length, 0);
  w.tick(30_000);
  await w.hub.readDue();
  assert.equal(w.fake.lastState(ids(w, 1).feature('error')), 1);
  assert.deepEqual(w.fake.sceneEvents.at(-1), {
    key: 'request_failed',
    data: {
      sensor: ids(w, 1).device,
      name: 'Outdoor',
      error: 'error answer (HTTP 429)',
      error_kind: 'status',
      status: 429,
    },
  });
  assert.equal(w.fake.lastState(ids(w, 1).feature('value_temperature')), 10.9, 'last value kept');
  assert.equal(w.fake.transports.flat().at(-1).transport, 'unreachable');
  w.tick(60_000);
  await w.hub.readDue();
  assert.equal(w.fake.sceneEvents.length, 1, 'announced once');
  w.web.routes[METEO] = ROUTES[METEO];
  w.tick(60_000);
  await w.hub.readDue();
  assert.equal(w.fake.lastState(ids(w, 1).feature('error')), 0);
  w.web.routes[METEO] = new HttpError('timeout', '10 s');
  for (let i = 0; i < 2; i += 1) {
    w.tick(60_000);
    await w.hub.readDue();
  }
  assert.equal(w.fake.sceneEvents.length, 2, 'announced again after it worked');
  assert.equal(w.fake.sceneEvents.at(-1).data.status, 0);
});

test('a value not found is a failure too', async (t) => {
  const w = await world();
  t.after(() => w.app.stop());
  w.web.routes[PLUG] = json({ id: 0 });
  w.tick(30_000);
  await w.hub.readDue();
  w.tick(30_000);
  await w.hub.readDue();
  assert.equal(w.fake.sceneEvents.at(-1).data.error_kind, 'not_found');
});

test('a slot with a wrong field fails at once, and says why', async (t) => {
  const w = await world({ config: slot(1, { url: 'http://192.0.2.9/', path: 'a..b' }) });
  t.after(() => w.app.stop());
  assert.equal(w.web.calls.length, 0, 'nothing is requested');
  assert.equal(w.fake.sceneEvents.at(-1).data.error_kind, 'config');
  assert.equal(w.fake.connectionStatus.connected, false);
  const ack = await w.fake.action('test_sensors', {});
  assert.match(
    ack.data.message.en,
    /HTTP sensor 1: field path or regular expression not understood/,
  );
});

test('"A text value changes": not at the first reading, not at a restart', async (t) => {
  const store = new MemoryStore();
  const w = await world({ store });
  assert.equal(w.fake.sceneEvents.length, 0);
  w.web.routes[STATUS] = { status: 200, body: 'state=offline' };
  w.tick(60_000);
  await w.hub.readDue();
  assert.deepEqual(w.fake.sceneEvents.at(-1), {
    key: 'text_changed',
    data: { sensor: ids(w, 4).device, name: 'Box', value: 'offline', previous: 'online' },
  });
  await w.app.stop();
  const again = await world({ store, routes: { ...ROUTES, [STATUS]: w.web.routes[STATUS] } });
  t.after(() => again.app.stop());
  assert.equal(again.fake.sceneEvents.length, 0, 'same text after the restart');
  again.web.routes[STATUS] = ROUTES[STATUS];
  again.tick(60_000);
  await again.hub.readDue();
  assert.equal(again.fake.sceneEvents.at(-1).data.previous, 'offline');
});

test('a restart does not announce a failure twice; a new address forgets it', async (t) => {
  const store = new MemoryStore();
  const failing = { ...ROUTES, [PLUG]: json({}, 500) };
  const w = await world({ store, routes: failing });
  w.tick(30_000);
  await w.hub.readDue();
  assert.equal(w.fake.sceneEvents.length, 1);
  await w.app.stop();
  const again = await world({ store, routes: failing });
  t.after(() => again.app.stop());
  again.tick(30_000);
  await again.hub.readDue();
  assert.equal(again.fake.sceneEvents.length, 0, 'already announced before the restart');
  const moved = 'http://192.0.2.21/rpc/Switch.GetStatus?id=0';
  again.web.routes[moved] = json({}, 500);
  await again.fake.configUpdated({
    ...CONFIG,
    ...slot(2, { url: moved, path: 'apower', type: 'power' }),
  });
  again.tick(60_000);
  await again.hub.readDue();
  assert.equal(again.fake.sceneEvents.length, 1, 'another address, another announcement');
});

test('a new type is a new feature; an emptied slot leaves the list', async (t) => {
  const w = await world();
  t.after(() => w.app.stop());
  await w.fake.configUpdated({
    ...CONFIG,
    ...slot(2, { type: 'number' }),
    ...slot(4, { url: '' }),
  });
  const plug = w.fake.discoveredDevices.find((d) => d.external_id === ids(w, 2).device);
  assert.equal(plug.features[0].external_id, ids(w, 2).feature('value_number'));
  assert.equal(w.fake.discoveredDevices.length, 2);
});

/** Every line the SDK loggers write (console.log and console.error). */
function captureLogs(t) {
  const lines = [];
  for (const method of ['log', 'error']) {
    t.mock.method(console, method, (...args) => lines.push(args.map(String).join(' ')));
  }
  return lines;
}

test('the secrets and the paths of the addresses never reach the logs, debug included', async (t) => {
  const level = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'debug';
  t.after(() => {
    process.env.LOG_LEVEL = level;
  });
  const lines = captureLogs(t);
  const secretUrl = 'https://api.example.org/v1/data?apikey=SECRET-IN-URL';
  const config = {
    ...CONFIG,
    ...slot(5, { url: secretUrl, secret: 'SECRET-TOKEN', path: 'x' }),
  };
  const w = await createWorld({ config, routes: { ...ROUTES, [secretUrl]: json({}, 401) } });
  for (let i = 0; i < 2; i += 1) {
    w.tick(30_000);
    await w.hub.readDue();
  }
  await w.fake.action('test_sensors', {});
  await w.fake.sceneAction('call_url', { url: secretUrl, secret_from: '5' });
  await w.app.stop();
  assert.ok(
    lines.some((line) => /Sensor 5 .*api\.example\.org/.test(line)),
    'the failure is logged',
  );
  assert.doesNotMatch(lines.join('\n'), /SECRET/);
  assert.ok(w.web.calls.some((c) => c.headers.Authorization === 'Bearer SECRET-TOKEN'));
});

test('a normal cycle writes nothing at the info level', async (t) => {
  const w = await world();
  t.after(() => w.app.stop());
  const lines = captureLogs(t);
  await w.add(ids(w, 2).device);
  for (let i = 0; i < 3; i += 1) {
    w.tick(30_000);
    await w.hub.readDue();
  }
  await w.fake.widgetGet('values', { settings: {} });
  assert.deepEqual(lines, []);
});

test('"Test the sensors": one line per sensor, in every language', async (t) => {
  const w = await world({ config: { ...CONFIG, language: 'fr' } });
  t.after(() => w.app.stop());
  const ack = await w.fake.action('test_sensors', {});
  assert.equal(ack.success, true);
  assert.equal(
    ack.data.message.fr,
    '3 capteur(s):\n• Outdoor : 10,9\n• Plug power : 151,3\n• Box : online',
  );
  assert.match(ack.data.message.de, /Outdoor: 10,9/);
  const none = await createWorld();
  t.after(() => none.app.stop());
  const empty = await none.fake.action('test_sensors', {});
  assert.match(empty.data.message.en, /No sensor yet/);
  assert.equal(none.fake.connectionStatus.connected, false);
});

test('every sensor failing: the integration says so', async (t) => {
  const w = await createWorld({ config: slot(1, { url: 'http://192.0.2.99/' }) });
  t.after(() => w.app.stop());
  w.tick(30_000);
  await w.hub.readDue();
  assert.deepEqual(w.fake.connectionStatus, {
    connected: false,
    message: w.hub.connectionStatus().message,
  });
  assert.match(w.fake.connectionStatus.message.en, /Every sensor fails/);
});

test('onPoll reads the sensor (should Gladys poll anyway)', async (t) => {
  const w = await world();
  t.after(() => w.app.stop());
  const device = await w.add(ids(w, 2).device);
  w.web.routes[PLUG] = json({ apower: 99 });
  assert.deepEqual(await w.fake.poll(device), { success: true });
  assert.equal(w.fake.lastState(ids(w, 2).feature('value_power')), 99);
});

test('the timer of the container reads the added sensors, without any onPoll', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const w = await world({ timers: true });
  t.after(() => w.app.stop());
  await w.add(ids(w, 2).device);
  w.web.routes[PLUG] = json({ apower: 42 });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  for (let i = 0; i < 2; i += 1) {
    w.tick(15_000);
    t.mock.timers.tick(15_000);
    for (let j = 0; j < 10; j += 1) {
      await settle();
    }
  }
  assert.equal(w.fake.lastState(ids(w, 2).feature('value_power')), 42);
});
