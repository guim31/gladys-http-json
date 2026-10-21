// -----------------------------------------------------------------------------
// A test world: the SDK's fake Gladys, the real wiring (src/app.js), an
// in-memory store and an in-memory web (`routes`: URL → answer), so a test
// says what each address answers and checks what Gladys received.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { readFileSync } from 'node:fs';
import { registerHandlers } from '../../src/app.js';
import { HttpError } from '../../src/http.js';

export const fixture = (name) =>
  readFileSync(new URL(`../fixtures/real/${name}`, import.meta.url), 'utf8');

export class MemoryStore {
  constructor(data = {}) {
    this.data = structuredClone(data);
  }
  async load() {
    return structuredClone(this.data);
  }
  save(data) {
    this.data = structuredClone(data);
    return Promise.resolve();
  }
  flush() {
    return Promise.resolve();
  }
}

/** A JSON answer. */
export const json = (value, status = 200) => ({
  status,
  headers: { 'content-type': 'application/json' },
  body: typeof value === 'string' ? value : JSON.stringify(value),
});

/** A slot of the configuration, as Gladys stores it. */
export const slot = (n, fields) =>
  Object.fromEntries(Object.entries(fields).map(([key, value]) => [`sensor_${n}_${key}`, value]));

export async function createWorld({
  config = {},
  routes = {},
  store = new MemoryStore(),
  devices,
  timers = false,
} = {}) {
  let clock = Date.parse('2026-10-21T12:00:00Z');
  const web = {
    routes: { ...routes },
    calls: [],
    async request(url, options) {
      web.calls.push({ url, ...options });
      const answer = web.routes[url];
      if (answer === undefined) {
        throw new HttpError('unreachable', 'ECONNREFUSED');
      }
      if (answer instanceof Error) {
        throw answer;
      }
      const value = typeof answer === 'function' ? await answer(url, options) : answer;
      return { headers: {}, ...value, url };
    },
  };
  const fake = createFakeGladys({ config: { language: 'en', ...config }, devices });
  const gladys = fake;
  const app = registerHandlers(gladys, {
    store,
    request: web.request,
    timers,
    now: () => clock,
  });
  await gladys.connect();
  await app.ready;
  return {
    gladys,
    fake: gladys.fake,
    app,
    hub: app.hub,
    web,
    store,
    tick(ms) {
      clock += ms;
    },
    now: () => clock,
    /** "Add to Gladys" on a discovered device. */
    async add(externalId) {
      const device = gladys.fake.discoveredDevices.find((d) => d.external_id === externalId);
      await gladys.fake.deviceCreated(device);
      return device;
    },
  };
}
