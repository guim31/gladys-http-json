// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import {
  DEFAULT_CONFIG,
  INTERVALS,
  LANGUAGES,
  MAX_SENSORS,
  SENSOR_METHODS,
  slotKey,
} from '../src/config.js';
import { METHODS } from '../src/http.js';
import { TRIGGERS, WIDGET_KEY } from '../src/hub.js';
import { SCENE_ACTIONS, SECRET_SOURCES } from '../src/scenes.js';
import { SENSOR_TYPE_KEYS } from '../src/sensors.js';
import { WIDGETS } from '../src/widgets.js';
import { createWorld, json, slot } from './helpers/world.js';

const MANIFEST = new URL('../gladys-assistant-integration.json', import.meta.url);
const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];
const keysOf = (list) => (list ?? []).map((entry) => entry.key);
const field = (key) => manifest.config_schema.find((f) => f.key === key);
const values = (f) => f.options.map((o) => o.value);

const API = 'http://192.0.2.50/api';
const CONFIG = {
  ...slot(1, { name: 'Mode', url: API, path: 'mode', type: 'text' }),
  ...slot(2, { name: 'Power', url: API, path: 'power', type: 'power' }),
};

test('identity: name, image, cover, local and cloud transports, category', () => {
  assert.equal(manifest.name, 'HTTP / JSON sensors');
  assert.equal(manifest.type, 'device');
  assert.match(manifest.docker_image, /^ghcr\.io\/guim31\/gladys-http-json:/);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/guim31/gladys-http-json/main/cover.png',
  );
  // An address at home, or an API on the Internet.
  assert.deepEqual(manifest.transports, ['local', 'cloud']);
  assert.deepEqual(manifest.categories, ['services']);
  assert.match(manifest.gladys_version, />=\s*5\.1\.0/, 'widgets, triggers and scene actions');
});

test('the manifest stays well under the 100 KB of the store', async () => {
  assert.ok((await stat(MANIFEST)).size < 95 * 1024);
});

test('every manifest action has a handler', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  assert.deepEqual(keysOf(manifest.actions), ['test_sensors']);
  const ack = await world.fake.action('test_sensors', {});
  assert.equal(ack.success, true, ack.error);
});

test('every scene_actions key has a handler, and returns the declared outputs', async (t) => {
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(SCENE_ACTIONS).sort());
  const world = await createWorld({
    config: CONFIG,
    routes: { [API]: json({ mode: 'eco', power: 3 }) },
  });
  t.after(() => world.app.stop());
  const fields = {
    call_url: { url: API, path: 'power' },
    read_sensor: { sensor: world.gladys.externalIds('sensor', '2').device },
  };
  for (const action of manifest.scene_actions) {
    const ack = await world.fake.sceneAction(action.key, fields[action.key]);
    assert.equal(ack.success, true, `${action.key}: ${ack.error}`);
    assert.deepEqual(
      Object.keys(ack.data.outputs).sort(),
      keysOf(action.outputs).sort(),
      action.key,
    );
    for (const output of action.outputs) {
      assert.equal(typeof ack.data.outputs[output.key], output.type, `${action.key}.${output.key}`);
    }
  }
  const call = manifest.scene_actions.find((a) => a.key === 'call_url');
  assert.deepEqual(values(call.fields.find((f) => f.key === 'method')), METHODS);
  assert.deepEqual(values(call.fields.find((f) => f.key === 'secret_from')), SECRET_SOURCES);
});

test('the scene triggers are the ones the hub fires, with their filters and variables', async (t) => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), Object.values(TRIGGERS).sort());
  const world = await createWorld({
    config: CONFIG,
    routes: { [API]: json({ mode: 'eco', power: 3 }) },
  });
  t.after(() => world.app.stop());
  world.web.routes[API] = json({ mode: 'boost' });
  for (let i = 0; i < 2; i += 1) {
    world.tick(60_000);
    await world.hub.readDue();
  }
  const fired = new Map(world.fake.sceneEvents.map((event) => [event.key, event.data]));
  for (const trigger of manifest.scene_triggers) {
    const data = fired.get(trigger.key);
    assert.ok(data, `${trigger.key} was fired`);
    for (const key of [...keysOf(trigger.fields), ...keysOf(trigger.variables)]) {
      assert.ok(key in data, `${trigger.key}: "${key}" is in the event data`);
    }
    for (const [key, value] of Object.entries(data)) {
      const variable = trigger.variables.find((v) => v.key === key);
      assert.ok(variable || keysOf(trigger.fields).includes(key), `${trigger.key}: "${key}"`);
      if (variable) {
        assert.equal(typeof value, variable.type, `${trigger.key}.${key}`);
      }
    }
  }
});

test('every widgets key has a handler', async (t) => {
  assert.deepEqual(keysOf(manifest.widgets), [WIDGET_KEY]);
  assert.deepEqual(Object.keys(WIDGETS), [WIDGET_KEY]);
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await world.fake.widgetGet(WIDGET_KEY, { settings: {} });
  assert.equal(ack.success, true, ack.error);
});

test('config_schema: ten identical slots, defaults and options as in the code', () => {
  const stored = manifest.config_schema.filter((f) => f.type !== 'section');
  assert.deepEqual(
    stored.filter((f) => f.default !== undefined).map((f) => [f.key, f.default]),
    Object.entries(DEFAULT_CONFIG).filter(
      ([key]) => stored.find((f) => f.key === key)?.default !== undefined,
    ),
  );
  assert.deepEqual(
    Object.keys(DEFAULT_CONFIG).sort(),
    stored
      .filter((f) => f.type !== 'secret')
      .map((f) => f.key)
      .sort(),
  );
  for (let n = 1; n <= MAX_SENSORS; n += 1) {
    assert.deepEqual(values(field(slotKey(n, 'type'))), SENSOR_TYPE_KEYS);
    assert.deepEqual(values(field(slotKey(n, 'interval'))), INTERVALS);
    assert.deepEqual(values(field(slotKey(n, 'method'))), SENSOR_METHODS);
    const secret = field(slotKey(n, 'secret'));
    assert.equal(secret.type, 'secret');
    assert.equal(secret.default, undefined, 'a secret field takes no default');
  }
  assert.equal(field(slotKey(MAX_SENSORS + 1, 'url')), undefined);
  assert.deepEqual(values(field('language')), LANGUAGES);
});

test('section fields are purely presentational', () => {
  const sections = manifest.config_schema.filter((f) => f.type === 'section');
  assert.equal(sections.length, MAX_SENSORS + 2);
  for (const section of sections) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    assert.equal(section.placeholder, undefined);
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
  }
});

test('the dynamic selects are the devices of the integration', () => {
  const dynamic = allFields.filter((f) => f.source !== undefined);
  assert.deepEqual(
    dynamic.map((f) => [f.key, f.source, f.type]),
    [
      ['sensor', 'devices', 'select'],
      ['sensor', 'devices', 'select'],
      ['sensor', 'devices', 'select'],
      ['sensors', 'devices', 'multi_select'],
    ],
  );
});

test('trigger filters are never boolean, scene fields never secret', () => {
  for (const trigger of manifest.scene_triggers) {
    for (const f of trigger.fields ?? []) {
      assert.notEqual(f.type, 'boolean');
    }
  }
  for (const item of [...manifest.scene_triggers, ...manifest.scene_actions]) {
    assert.ok((item.fields ?? []).length <= 10);
    for (const f of item.fields ?? []) {
      assert.notEqual(f.type, 'secret');
    }
  }
});

test('number fields have integer bounds and defaults (the form has no step)', () => {
  for (const f of allFields.filter((f) => f.type === 'number')) {
    for (const key of ['min', 'max', 'default']) {
      if (f[key] !== undefined) {
        assert.ok(Number.isInteger(f[key]), `field "${f.key}".${key} must be an integer`);
      }
    }
  }
});

test('actions declare no secret field, no required field (no default is applied)', () => {
  for (const action of manifest.actions ?? []) {
    for (const f of action.fields ?? []) {
      assert.notEqual(f.type, 'secret');
      assert.notEqual(f.required, true);
    }
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version);
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`));
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `description.${lang}: ${text.length}`);
  }
});
