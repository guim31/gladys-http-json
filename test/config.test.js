// The configuration slots (src/config.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG,
  MAX_SENSORS,
  normalizeConfig,
  parseHeaders,
  parseUrl,
  secretHeader,
} from '../src/config.js';
import { slot } from './helpers/world.js';

test('the defaults: every slot empty, French names', () => {
  const config = normalizeConfig(DEFAULT_CONFIG);
  assert.deepEqual(config.sensors, []);
  assert.equal(config.language, 'fr');
  assert.equal(Object.keys(DEFAULT_CONFIG).length, MAX_SENSORS * 11 + 1);
});

test('a slot with an address is a sensor, with its defaults', () => {
  const [sensor] = normalizeConfig(slot(3, { url: '192.0.2.10/api' })).sensors;
  assert.equal(sensor.slot, 3);
  assert.equal(sensor.url, 'http://192.0.2.10/api');
  assert.equal(sensor.method, 'GET');
  assert.equal(sensor.type, 'number');
  assert.equal(sensor.intervalMs, 60_000);
  assert.equal(sensor.verifyTls, true);
  assert.deepEqual([sensor.scale, sensor.offset], [1, 0]);
  assert.deepEqual(sensor.extraction, { kind: 'whole' });
  assert.equal(sensor.error, null);
});

test('every field of a slot', () => {
  const [sensor] = normalizeConfig(
    slot(1, {
      name: '  Pool   temperature ',
      url: 'https://192.0.2.10:8443/api/v1/pool?x=1',
      method: 'POST',
      headers: 'Accept: application/json | X-Room: pool',
      secret: 'abc123',
      body: '{"q":1}',
      path: 'data.temp',
      type: 'temperature',
      scale: '0,1',
      offset: '-2',
      interval: '300',
      verify_tls: false,
    }),
  ).sensors;
  assert.equal(sensor.name, 'Pool temperature');
  assert.deepEqual(sensor.headers, {
    Accept: 'application/json',
    'X-Room': 'pool',
    Authorization: 'Bearer abc123',
  });
  assert.deepEqual(sensor.secretHeaders, { Authorization: 'Bearer abc123' });
  assert.equal(sensor.body, '{"q":1}');
  assert.deepEqual([sensor.scale, sensor.offset], [0.1, -2]);
  assert.equal(sensor.intervalMs, 300_000);
  assert.equal(sensor.verifyTls, false);
});

test('a body is only sent with POST', () => {
  const [sensor] = normalizeConfig(slot(1, { url: 'http://h/', body: 'x' })).sensors;
  assert.equal(sensor.body, '');
});

test('wrong fields mark the sensor, they do not drop it', () => {
  const error = (fields) =>
    normalizeConfig(slot(1, { url: 'http://h/', ...fields })).sensors[0].error;
  assert.equal(error({ url: 'ftp://h/' }), 'url');
  assert.equal(error({ url: 'http://user:pass@h/' }), 'url', 'credentials go to the secret field');
  assert.equal(error({ path: 'a..b' }), 'path');
  assert.equal(error({ path: '/(/' }), 'path');
  assert.equal(error({ headers: 'no colon' }), 'headers');
  assert.equal(error({ secret: 'tok€n' }), 'secret');
  assert.equal(error({ scale: 'ten' }), 'number');
  assert.equal(error({ scale: 'ten', type: 'text' }), null, 'no scale on a text');
  assert.equal(error({ type: 'unknown' }), null, 'an unknown type falls back to number');
});

test('headers: lines or " | ", forbidden names refused', () => {
  assert.deepEqual(parseHeaders('A: 1\nB: x:y'), { A: '1', B: 'x:y' });
  assert.deepEqual(parseHeaders('Cookie: a=1; b=2 | X-T: 2'), { Cookie: 'a=1; b=2', 'X-T': '2' });
  assert.deepEqual(parseHeaders(''), {});
  assert.equal(parseHeaders('Host: other'), null);
  assert.equal(parseHeaders('Bad Name: 1'), null);
  assert.equal(parseHeaders('X-Price: 5 €'), null, 'beyond Latin-1');
  assert.equal(parseHeaders('X-A: a\u0001'), null, 'control character');
});

test('the secret header: a bare token, a scheme, a whole header', () => {
  assert.deepEqual(secretHeader('abc'), { Authorization: 'Bearer abc' });
  assert.deepEqual(secretHeader('Basic dXNlcjpwYXNz'), { Authorization: 'Basic dXNlcjpwYXNz' });
  assert.deepEqual(secretHeader('Token abc'), { Authorization: 'Token abc' });
  assert.deepEqual(secretHeader('X-Api-Key: abc'), { 'X-Api-Key': 'abc' });
  assert.deepEqual(secretHeader('Authorization: Bearer x'), { Authorization: 'Bearer x' });
  assert.deepEqual(secretHeader('user:pass'), { Authorization: 'Bearer user:pass' });
  assert.deepEqual(secretHeader('X-Api-Key:abc'), { 'X-Api-Key': 'abc' });
  assert.equal(secretHeader('tok\u0000en'), null, 'node:http would throw');
  assert.equal(secretHeader('jeton€'), null);
  assert.deepEqual(secretHeader(undefined), {});
});

test('addresses: http by default, http(s) only', () => {
  assert.equal(parseUrl('example.org/x'), 'http://example.org/x');
  assert.equal(parseUrl('HTTPS://Example.org'), 'https://example.org/');
  assert.equal(parseUrl('file:///etc/passwd'), null);
  assert.equal(parseUrl(''), null);
});
