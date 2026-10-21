// Field paths, regular expressions and conversions (src/sensors.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ValueError,
  convert,
  extract,
  htmlText,
  parsePath,
  regexOf,
  runRegex,
  toBinary,
  toNumber,
  toText,
  walkPath,
} from '../src/sensors.js';
import { parseExtraction } from '../src/config.js';
import { fixture } from './helpers/world.js';

const at = (data, path) => walkPath(data, parsePath(path));

test('field paths: dotted, indexes, quoted keys, minimal JSONPath', () => {
  const data = {
    data: {
      items: [
        { temp: 21.5, name: 'living' },
        { temp: 19.2, name: 'kitchen', ok: true },
      ],
    },
    'key.with dots': 3,
    list: [1, 2, 3],
  };
  assert.equal(at(data, 'data.items[0].temp'), 21.5);
  assert.equal(at(data, '$.data.items[1].temp'), 19.2);
  assert.equal(at(data, 'data.items.1.name'), 'kitchen');
  assert.equal(at(data, 'data.items[-1].name'), 'kitchen');
  assert.equal(at(data, "['key.with dots']"), 3);
  assert.equal(at(data, '$["key.with dots"]'), 3);
  assert.equal(at(data, "data.items[?(@.name=='kitchen')].temp"), 19.2);
  assert.equal(at(data, 'data.items[?(@.ok==true)].name'), 'kitchen');
  assert.equal(at(data, "data.items[?(@.name!='living')].temp"), 19.2);
  assert.deepEqual(at(data, '$.list'), [1, 2, 3]);
  assert.equal(at(data, '$'), data);
  assert.equal(at(data, 'data.missing'), undefined);
  assert.equal(at(data, 'data.items[5].temp'), undefined);
  assert.equal(at(data, 'list.length'), undefined, 'no property of the JavaScript array');
  assert.equal(at(data, 'data.constructor'), undefined, 'own keys only');
  for (const bad of ['data..x', 'a[', 'a[b]', 'a[?(@.x=y)]', '.']) {
    assert.equal(parsePath(bad), null, bad);
  }
});

test('the real answer of Open-Meteo (current weather)', () => {
  const body = fixture('open-meteo-current.json');
  const value = (path) => extract(parseExtraction(path), { body, contentType: 'application/json' });
  assert.equal(value('current.temperature_2m'), 10.9);
  assert.equal(value('current_units.temperature_2m'), '°C');
  assert.equal(value('current.relative_humidity_2m'), 67);
});

test('regular expressions: first group, whole match, flags, deadline', () => {
  assert.deepEqual(regexOf('/Temp: (\\d+)/i'), { source: 'Temp: (\\d+)', flags: 'i' });
  assert.equal(regexOf('data.temp'), null);
  assert.equal(runRegex(regexOf('/Temp: ([0-9.]+)/i'), 'temp: 21.5 °C'), '21.5');
  assert.equal(runRegex(regexOf('/\\d+/'), 'abc 42 def'), '42');
  assert.equal(runRegex(regexOf('/nothing/'), 'abc'), null);
  assert.equal(parseExtraction('/(/'), null, 'does not compile');
  assert.equal(parseExtraction('/a/g'), null, 'global flag refused');
  // A catastrophic expression is stopped, the integration goes on.
  assert.throws(
    () => runRegex(regexOf('/(a+)+$/'), `${'a'.repeat(40)}b`, 100),
    (err) => err instanceof ValueError && err.kind === 'regex_timeout',
  );
});

test('an HTML page: the text of the match, entities decoded', () => {
  const body = fixture('status-page.html');
  const extraction = parseExtraction('/<td id="water">([^<]+)<\\/td>/');
  assert.equal(extract(extraction, { body, contentType: 'text/html' }), '1 234,5 m³');
  assert.equal(
    htmlText('<b>5&nbsp;&deg;C</b> &amp; &#x41;&#66; &unknown;'),
    ' 5 °C  & AB &unknown;',
  );
});

test('the whole answer: JSON when it is, text otherwise', () => {
  const whole = parseExtraction('');
  assert.equal(extract(whole, { body: '42\n' }), 42);
  assert.equal(extract(whole, { body: 'ON' }), 'ON');
  assert.throws(
    () => extract(parseExtraction('a.b'), { body: '<html>' }),
    (err) => err.kind === 'not_json',
  );
  assert.throws(
    () => extract(parseExtraction('a.b'), { body: '{"a":{}}' }),
    (err) => err.kind === 'not_found',
  );
  assert.throws(
    () => extract(parseExtraction('/x(\\d)/'), { body: 'abc' }),
    (err) => err.kind === 'no_match',
  );
});

test('numbers: JSON numbers, texts with a unit, a decimal comma', () => {
  assert.equal(toNumber(21.5), 21.5);
  assert.equal(toNumber('21,5 °C'), 21.5);
  assert.equal(toNumber('-3.2e2'), -320);
  assert.equal(toNumber('Temperature: 19'), 19);
  assert.equal(toNumber(true), 1);
  assert.equal(toNumber('none'), null);
  assert.equal(toNumber({}), null);
  assert.equal(toNumber(Infinity), null);
});

test('binary values: booleans, numbers, words of four languages', () => {
  for (const yes of [true, 1, 5, '1', 'on', 'ON', 'true', 'yes', 'up', 'oui', 'ja', 'sí']) {
    assert.equal(toBinary(yes), 1, String(yes));
  }
  for (const no of [false, 0, '0', 'off', 'false', 'no', 'down', 'non', 'nein']) {
    assert.equal(toBinary(no), 0, String(no));
  }
  for (const neither of ['maybe', null, {}, '12 apples']) {
    assert.equal(toBinary(neither), null, String(neither));
  }
});

test('texts: one line, objects as JSON, cut at 250 characters', () => {
  assert.equal(toText('  two\n lines '), 'two lines');
  assert.equal(toText({ a: 1 }), '{"a":1}');
  assert.equal(toText(12), '12');
  assert.equal(toText('x'.repeat(400)).length, 250);
});

test('convert: scale and offset on numbers only, errors by type', () => {
  const sensor = (type, scale = 1, offset = 0) => ({ type, scale, offset });
  assert.equal(convert(sensor('energy', 0.001), 123456), 123.456);
  assert.equal(convert(sensor('temperature', 1, -0.5), '21.7'), 21.2);
  assert.equal(convert(sensor('temperature', 1.8, 32), 20), 68);
  assert.equal(convert(sensor('number', -1), 0), 0, 'no negative zero');
  assert.equal(convert(sensor('binary', 10, 5), 'on'), 1, 'no scale on a binary');
  assert.equal(convert(sensor('text', 10), 21), '21', 'no scale on a text');
  const kind = (type, raw) => {
    try {
      convert(sensor(type), raw);
    } catch (err) {
      return err.kind;
    }
    return null;
  };
  assert.equal(kind('number', 'abc'), 'not_number');
  assert.equal(kind('binary', 'maybe'), 'not_binary');
  assert.equal(kind('number', null), 'empty');
  assert.equal(kind('text', '  '), 'empty');
});
