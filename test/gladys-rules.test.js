// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered: a sensor of
// every type, in every feature-name language, with and without a name.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SENSOR_TYPE_KEYS } from '../src/sensors.js';
import { createWorld, fixture, json, slot } from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

const API = 'https://api.open-meteo.com/v1/forecast?current=temperature_2m';

async function discover(language) {
  const config = { language };
  SENSOR_TYPE_KEYS.forEach((type, index) => {
    Object.assign(
      config,
      slot(index + 1, {
        name: index % 2 ? `${type} sensor` : '',
        url: API,
        path: type === 'text' ? 'current_units.temperature_2m' : 'current.is_day',
        type,
      }),
    );
  });
  const world = await createWorld({
    config,
    routes: { [API]: json(fixture('open-meteo-current.json')) },
  });
  await world.app.stop();
  return world.fake.discoveredDevices;
}

for (const language of ['en', 'fr', 'de', 'es']) {
  test(`every discovered device follows the Gladys rules (${language} names)`, async () => {
    const devices = await discover(language);
    assert.equal(devices.length, SENSOR_TYPE_KEYS.length, 'a device per type');
    assert.equal(new Set(devices.map((d) => d.external_id)).size, devices.length);

    for (const device of devices) {
      const where = device.name;
      if (device.poll_frequency === undefined) {
        assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
      } else {
        assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
        assert.ok(table.poll_frequencies_ms.includes(device.poll_frequency), where);
      }
      assert.ok(device.features.length > 0, `${where}: no feature`);
      const externalIds = new Set();
      const names = new Set();
      for (const feature of device.features) {
        const at = `${where} / ${feature.name}`;
        const pair = table.pairs[`${feature.category}/${feature.type}`];
        assert.ok(pair, `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`);
        assert.ok(
          pair.label_en && pair.label_fr && pair.icon,
          `${at}: couple without label or icon`,
        );
        assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
        assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
        assert.ok(
          Number.isFinite(feature.min) && Number.isFinite(feature.max),
          `${at}: finite min/max`,
        );
        assert.ok(feature.min <= feature.max, `${at}: min > max`);
        assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
        assert.equal(
          typeof feature.has_feedback,
          'boolean',
          `${at}: has_feedback must be a boolean`,
        );
        if (feature.unit !== undefined) {
          assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
          const allowed = table.units_by_category[feature.category];
          if (allowed) {
            assert.ok(
              allowed.flat().includes(feature.unit),
              `${at}: ${feature.unit} not for ${feature.category}`,
            );
          }
        }
        assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
        externalIds.add(feature.external_id);
        assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
        names.add(feature.name);
      }
    }
  });
}

test('the states of every type are accepted by the fake Gladys (numbers, texts)', async () => {
  const config = {};
  SENSOR_TYPE_KEYS.forEach((type, index) => {
    Object.assign(
      config,
      slot(index + 1, {
        url: API,
        path: type === 'text' ? 'current_units.temperature_2m' : 'current.is_day',
        type,
      }),
    );
  });
  const world = await createWorld({
    config,
    routes: { [API]: json(fixture('open-meteo-current.json')) },
  });
  for (const device of world.fake.discoveredDevices) {
    await world.add(device.external_id);
  }
  await world.app.stop();
  assert.equal(world.fake.requests.filter((r) => r.status >= 400).length, 0);
  assert.equal(world.fake.states.length, SENSOR_TYPE_KEYS.length * 2);
});
