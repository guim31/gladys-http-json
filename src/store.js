// -----------------------------------------------------------------------------
// Small persistence under /data (the only writable path of the container):
// what was announced to the scenes, so that a restart neither announces a
// failing sensor twice nor reports a text "change" that is only a restart:
//   - the sensors whose failure was announced;
//   - the last text read by each text sensor.
// The sensors themselves are configuration fields: losing the file loses
// nothing but these memories. (Adapted from guim31/gladys-influxdb.)
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';
import { FailureLog } from './logs.js';

const logger = createLogger({ name: 'http-json-store' });
const FILE_NAME = 'http-json-state.json';

export class Store {
  constructor(directory = process.env.HTTP_JSON_DATA_DIR || '/data') {
    this.directory = directory;
    this.path = join(directory, FILE_NAME);
    this.pending = null;
    this.writing = null;
    // Saved after every read: a /data that cannot be written is reported once.
    this.failures = new FailureLog(logger);
  }

  async load() {
    try {
      const data = JSON.parse(await readFile(this.path, 'utf8'));
      return data && typeof data === 'object' ? data : {};
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.warn(`Cannot read ${this.path}: ${err.message}`);
      }
      return {};
    }
  }

  // Writes are coalesced and atomic (temporary file + rename): a crash never
  // leaves half a JSON file behind.
  save(data) {
    this.latest = data;
    if (!this.pending) {
      // Chained after the write in progress, if any: one writer at a time.
      this.pending = (this.writing ?? Promise.resolve()).then(async () => {
        const snapshot = this.latest;
        this.pending = null;
        try {
          await mkdir(this.directory, { recursive: true });
          const temporary = `${this.path}.tmp`;
          await writeFile(temporary, JSON.stringify(snapshot));
          await rename(temporary, this.path);
          this.failures.recover('write', `${this.path} written again`);
        } catch (err) {
          this.failures.fail('write', `Cannot write ${this.path}: ${err.message}`);
        }
      });
      this.writing = this.pending;
    }
    return this.pending;
  }

  /** Resolves once every write requested so far is on disk. */
  flush() {
    return this.writing ?? Promise.resolve();
  }
}
