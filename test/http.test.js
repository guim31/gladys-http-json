// The HTTP client (src/http.js) against a real server on the loopback
// interface: bounded size and time, redirects on the same host only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { HttpError, hostOf, httpRequest, isLocalAddress } from '../src/http.js';
import { fixture } from './helpers/world.js';

async function serve(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  server.closeAllConnections?.();
  return `http://127.0.0.1:${server.address().port}`;
}

const kindOf = async (promise) => {
  try {
    await promise;
  } catch (err) {
    assert.ok(err instanceof HttpError, String(err));
    return err.kind;
  }
  return null;
};

test('an answer: status, headers, body, the request as sent', async (t) => {
  let seen;
  const base = await serve(t, (req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      seen = { method: req.method, headers: req.headers, body };
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end('{"error":"boom"}');
    });
  });
  const answer = await httpRequest(`${base}/x`, {
    method: 'POST',
    headers: { Authorization: 'Bearer t' },
    body: '{"a":1}',
  });
  assert.equal(answer.status, 500, 'an error status is an answer');
  assert.equal(answer.body, '{"error":"boom"}');
  assert.equal(seen.method, 'POST');
  assert.equal(seen.body, '{"a":1}');
  assert.equal(seen.headers.authorization, 'Bearer t');
  assert.match(seen.headers['user-agent'], /gladys-http-json/);
});

test('an answer over 1 MB is refused while it arrives', async (t) => {
  const base = await serve(t, (req, res) => {
    res.writeHead(200);
    res.end('x'.repeat(2 * 1024 * 1024));
  });
  assert.equal(await kindOf(httpRequest(base)), 'too_large');
  const small = await serve(t, (req, res) => res.end('x'.repeat(1000)));
  assert.equal((await httpRequest(small, { maxBytes: 2000 })).body.length, 1000);
});

test('a slow answer, even one that trickles in, times out', async (t) => {
  const base = await serve(t, (req, res) => {
    res.writeHead(200);
    const timer = setInterval(() => res.write('.'), 20);
    res.on('close', () => clearInterval(timer));
  });
  const started = Date.now();
  assert.equal(await kindOf(httpRequest(base, { timeoutMs: 200 })), 'timeout');
  assert.ok(Date.now() - started < 1000);
});

test('nobody listening: unreachable', async () => {
  assert.equal(await kindOf(httpRequest('http://127.0.0.1:1/')), 'unreachable');
});

test('redirects: followed on the same host, refused to another one', async (t) => {
  const base = await serve(t, (req, res) => {
    if (req.url === '/old') {
      res.writeHead(301, { Location: '/new' });
    } else if (req.url === '/post') {
      res.writeHead(303, { Location: '/new' });
    } else if (req.url === '/away') {
      res.writeHead(302, { Location: 'http://198.51.100.7/steal' });
    } else if (req.url === '/down') {
      res.writeHead(302, { Location: `http://127.0.0.1:${req.socket.localPort}/new` });
    } else if (req.url === '/loop') {
      res.writeHead(302, { Location: '/loop' });
    } else {
      res.writeHead(200);
      res.write(`${req.method} ${req.headers.authorization ?? ''}`);
    }
    res.end();
  });
  const moved = await httpRequest(`${base}/old`, { headers: { Authorization: 'k' } });
  assert.equal(moved.body, 'GET k');
  assert.equal(moved.url, `${base}/new`);
  const posted = await httpRequest(`${base}/post`, { method: 'POST', body: 'x' });
  assert.equal(posted.body, 'GET ', 'a 303 goes on with GET');
  const away = httpRequest(`${base}/away`, { headers: { Authorization: 'k' } });
  await assert.rejects(away, (err) => err.kind === 'redirect' && err.detail === '198.51.100.7');
  assert.equal(await kindOf(httpRequest(`${base}/loop`)), 'redirect');
  assert.equal(
    await kindOf(httpRequest(`${base}/down`)),
    null,
    'http to http on the same host is followed',
  );
});

test('https: the certificate is checked, and never followed down to http', async (t) => {
  // A self-signed certificate made for these tests only (CN=127.0.0.1).
  const server = https.createServer(
    { key: fixture('test-key.pem'), cert: fixture('test-cert.pem') },
    (req, res) => {
      if (req.url === '/down') {
        res.writeHead(302, { Location: `http://127.0.0.1:${server.address().port}/x` });
      } else {
        res.writeHead(200);
        res.write('secure');
      }
      res.end();
    },
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `https://127.0.0.1:${server.address().port}`;
  assert.equal(await kindOf(httpRequest(base)), 'tls', 'self-signed refused by default');
  assert.equal((await httpRequest(base, { verifyTls: false })).body, 'secure');
  await assert.rejects(
    httpRequest(`${base}/down`, { verifyTls: false, headers: { Authorization: 'k' } }),
    (err) => err.kind === 'redirect',
  );
});

test('what is shown of an address: the host only', () => {
  assert.equal(hostOf('https://api.example.org:8443/v1/x?apikey=SECRET'), 'api.example.org:8443');
});

test('local addresses: private ranges, local names', () => {
  for (const url of [
    'http://192.168.1.2/',
    'http://10.0.0.1/',
    'http://172.20.0.1/',
    'http://127.0.0.1/',
    'http://nas.local/',
    'http://router.lan/',
    'http://homeassistant:8123/',
    'http://[fd00::1]/',
  ]) {
    assert.equal(isLocalAddress(url), true, url);
  }
  for (const url of ['https://api.open-meteo.com/', 'http://172.32.0.1/', 'http://8.8.8.8/']) {
    assert.equal(isLocalAddress(url), false, url);
  }
});
