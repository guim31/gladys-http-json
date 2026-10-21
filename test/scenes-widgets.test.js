// Scene actions (src/scenes.js) and the widget (src/widgets.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { HttpError } from '../src/http.js';
import { createWorld, json, slot } from './helpers/world.js';

const API = 'http://192.0.2.40/api/state';
const RELAY = 'http://192.0.2.41/relay/0?turn=on';
const CONFIG = {
  ...slot(1, { name: 'Pool', url: API, path: 'pool.temp', type: 'temperature', secret: 'TKN' }),
  ...slot(2, { name: 'Door', url: API, path: 'door', type: 'binary' }),
  ...slot(3, { name: 'Mode', url: API, path: 'mode', type: 'text' }),
};
const ROUTES = { [API]: json({ pool: { temp: 26.4 }, door: 'open?', mode: 'eco' }) };

test('"Call an address": method, headers, JSON body, the answer as outputs', async (t) => {
  const w = await createWorld({ config: CONFIG, routes: ROUTES });
  t.after(() => w.app.stop());
  w.web.routes[RELAY] = json({ ison: true, source: 'http' });
  const ack = await w.fake.sceneAction('call_url', {
    url: RELAY,
    method: 'POST',
    headers: 'X-Room: pool',
    body: '{"from":"gladys"}',
    path: 'ison',
  });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.outputs, {
    success: true,
    status: 200,
    value: 'true',
    number: 1,
    error: '',
    response: '{"ison":true,"source":"http"}',
  });
  const call = w.web.calls.at(-1);
  assert.equal(call.method, 'POST');
  assert.equal(call.body, '{"from":"gladys"}');
  assert.deepEqual(call.headers, { 'X-Room': 'pool', 'Content-Type': 'application/json' });
});

test('"Call an address": a failed request is an outcome, a wrong field an error', async (t) => {
  const w = await createWorld({ config: CONFIG, routes: ROUTES });
  t.after(() => w.app.stop());
  w.web.routes[RELAY] = json({ error: 'nope' }, 404);
  let ack = await w.fake.sceneAction('call_url', { url: RELAY });
  assert.equal(ack.success, true);
  assert.equal(ack.data.outputs.success, false);
  assert.equal(ack.data.outputs.status, 404);
  assert.equal(ack.data.outputs.response, '{"error":"nope"}');
  w.web.routes[RELAY] = new HttpError('timeout', '20 s');
  ack = await w.fake.sceneAction('call_url', { url: RELAY });
  assert.equal(ack.data.outputs.status, 0);
  assert.equal(ack.data.outputs.error, 'no answer in time (20 s)');
  ack = await w.fake.sceneAction('call_url', { url: 'ftp://x' });
  assert.equal(ack.success, false);
  assert.match(ack.error, /Address not understood/);
  await w.fake.sceneAction('call_url', { url: RELAY, body: 'x', method: 'GET' });
  assert.equal(w.web.calls.at(-1).body, '', 'no body with GET');
});

test('"Call an address": the secret of a sensor, to the origin of that sensor only', async (t) => {
  const w = await createWorld({ config: CONFIG, routes: ROUTES });
  t.after(() => w.app.stop());
  const same = 'http://192.0.2.40/api/boost';
  w.web.routes[same] = json({ ok: 1 });
  const ack = await w.fake.sceneAction('call_url', { url: same, secret_from: '1' });
  assert.equal(ack.data.outputs.success, true);
  assert.equal(w.web.calls.at(-1).headers.Authorization, 'Bearer TKN');
  const calls = w.web.calls.length;
  for (const url of [RELAY, 'https://192.0.2.40/api/boost', 'http://192.0.2.40:8080/api']) {
    const elsewhere = await w.fake.sceneAction('call_url', { url, secret_from: '1' });
    assert.equal(elsewhere.success, false, url);
    assert.match(elsewhere.error, /only sent to its address/);
  }
  assert.equal(w.web.calls.length, calls, 'nothing sent');
  const none = await w.fake.sceneAction('call_url', { url: same, secret_from: '2' });
  assert.equal(none.success, false, 'a sensor without secret: said, not sent without it');
  assert.match(none.error, /no secret header/);
});

test('"Read a sensor now": a fresh value, published, or the reason', async (t) => {
  const w = await createWorld({ config: CONFIG, routes: ROUTES });
  t.after(() => w.app.stop());
  const pool = w.gladys.externalIds('sensor', '1');
  await w.add(pool.device);
  w.web.routes[API] = json({ pool: { temp: 27 }, door: true, mode: 'boost' });
  let ack = await w.fake.sceneAction('read_sensor', { sensor: pool.device });
  assert.deepEqual(ack.data.outputs, {
    success: true,
    status: 200,
    value: '27',
    number: 27,
    error: '',
  });
  assert.equal(w.fake.lastState(pool.feature('value_temperature')), 27);
  ack = await w.fake.sceneAction('read_sensor', {
    sensor: w.gladys.externalIds('sensor', '3').device,
  });
  assert.deepEqual(ack.data.outputs, {
    success: true,
    status: 200,
    value: 'boost',
    number: 0,
    error: '',
  });
  ack = await w.fake.sceneAction('read_sensor', {
    sensor: w.gladys.externalIds('sensor', '2').device,
  });
  assert.equal(ack.data.outputs.number, 1);
  w.web.routes[API] = json({}, 503);
  ack = await w.fake.sceneAction('read_sensor', { sensor: pool.device });
  assert.equal(ack.data.outputs.success, false);
  assert.equal(ack.data.outputs.error, 'error answer (HTTP 503)');
  ack = await w.fake.sceneAction('read_sensor', { sensor: 'ext:other:x' });
  assert.equal(ack.success, false);
  assert.match(ack.error, /Unknown sensor/);
});

test('the widget: one row per sensor, valid content, the chosen ones', async (t) => {
  const w = await createWorld({
    config: { ...CONFIG, language: 'fr' },
    routes: { [API]: json({ pool: { temp: 26.4 }, door: 0, mode: 'eco' }) },
  });
  t.after(() => w.app.stop());
  const ack = await w.fake.widgetGet('values', { settings: {}, language: 'fr' });
  const { content } = ack.data;
  validateWidgetContent(content);
  const [status, button] = content.components;
  assert.deepEqual(
    status.items.map((item) => [item.label, item.value]),
    [
      ['Pool', '26,4 °C'],
      ['Door', 'Non'],
      ['Mode', 'eco'],
    ],
  );
  assert.equal(button.label, 'Actualiser');
  const chosen = await w.fake.widgetGet('values', {
    settings: { sensors: [w.gladys.externalIds('sensor', '3').device] },
    language: 'en',
  });
  assert.deepEqual(
    chosen.data.content.components[0].items.map((item) => item.label),
    ['Mode'],
  );
  w.web.routes[API] = json({}, 500);
  const refresh = await w.fake.widgetAction('values', 'refresh', {}, { settings: {} });
  assert.equal(refresh.success, true);
  await w.fake.widgetAction('values', 'refresh', {}, { settings: {} });
  const failing = await w.fake.widgetGet('values', { settings: {}, language: 'en' });
  assert.equal(failing.data.content.components[0].items[0].value, 'Error');
  const empty = await createWorld();
  t.after(() => empty.app.stop());
  const nothing = await empty.fake.widgetGet('values', { settings: {}, language: 'de' });
  assert.match(nothing.data.content.components[0].text, /Gib die Adresse/);
});
