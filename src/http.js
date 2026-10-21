// -----------------------------------------------------------------------------
// The one module that talks to the network: an HTTP(S) request on node:http /
// node:https. Not on fetch: fetch cannot accept the self-signed certificate of
// one address only (a router or a NAS at home often has one), node:https can,
// per request. (Adapted from guim31/gladys-influxdb.)
//
// Bounded on purpose, since the address is anything the user typed:
//   - a deadline for the whole answer (a slow one that trickles in too);
//   - 1 MB of answer at most, cut while it arrives;
//   - redirects followed on the same host only (3 at most), never from
//     https to http: a redirect elsewhere is refused and says where it went,
//     so a token never leaves for an address the user did not type.
// Private addresses are allowed: they are the main use.
// -----------------------------------------------------------------------------

import http from 'node:http';
import https from 'node:https';

export const MAX_BODY_BYTES = 1024 * 1024;
export const TIMEOUT_MS = 10_000;
export const MAX_REDIRECTS = 3;
export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
export const USER_AGENT = 'gladys-http-json (+https://github.com/guim31/gladys-http-json)';

// Error kinds, shared with src/sensors.js (VALUE_ERRORS) in the texts.
export const HTTP_ERRORS = Object.freeze({
  UNREACHABLE: 'unreachable',
  TIMEOUT: 'timeout',
  TLS: 'tls',
  STATUS: 'status',
  TOO_LARGE: 'too_large',
  REDIRECT: 'redirect',
});

export class HttpError extends Error {
  /**
   * @param {string} kind one of HTTP_ERRORS
   * @param {string} [detail] safe to show: never a URL with its path or query
   * @param {number} [status] the HTTP status, when there was an answer
   */
  constructor(kind, detail = '', status = 0) {
    super(detail ? `${kind}: ${detail}` : kind);
    this.kind = kind;
    this.detail = detail;
    this.status = status;
  }
}

const sizeText = (bytes) =>
  bytes >= 1024 * 1024 ? `${Math.round(bytes / 1024 / 1024)} MB` : `${Math.round(bytes / 1024)} KB`;

const TLS_CODES =
  /CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_(GET|VERIFY)|ERR_TLS|EPROTO|HOSTNAME_MISMATCH/i;

/** A network error as an HttpError, with no address in it. */
function networkError(err) {
  if (err instanceof HttpError) {
    return err;
  }
  const code = String(err?.code ?? '');
  if (code === 'ETIMEDOUT') {
    return new HttpError(HTTP_ERRORS.TIMEOUT);
  }
  if (TLS_CODES.test(code) || /certificate|ssl|tls/i.test(String(err?.message))) {
    return new HttpError(HTTP_ERRORS.TLS, code || 'TLS');
  }
  return new HttpError(HTTP_ERRORS.UNREACHABLE, code || 'error');
}

/**
 * One request, no redirect.
 * @returns {Promise<{ status: number, headers: object, body: string }>}
 */
function requestOnce(target, { method, headers, body, verifyTls, timeoutMs, maxBytes }) {
  const isHttps = target.protocol === 'https:';
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        fn(value);
      }
    };
    const request = (isHttps ? https : http).request(
      target,
      {
        method,
        headers: body ? { ...headers, 'Content-Length': Buffer.byteLength(body) } : headers,
        ...(isHttps ? { rejectUnauthorized: verifyTls } : {}),
      },
      (response) => {
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            finish(reject, new HttpError(HTTP_ERRORS.TOO_LARGE, sizeText(maxBytes)));
            request.destroy();
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () =>
          finish(resolve, {
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
        response.on('error', (err) => finish(reject, networkError(err)));
      },
    );
    // The deadline covers the whole answer, not only a silent socket.
    const timer = setTimeout(() => {
      finish(reject, new HttpError(HTTP_ERRORS.TIMEOUT, `${Math.round(timeoutMs / 1000)} s`));
      request.destroy();
    }, timeoutMs);
    request.on('error', (err) => finish(reject, networkError(err)));
    request.end(body || undefined);
  });
}

/**
 * @param {string} url absolute http(s) URL
 * @param {object} [options]
 * @param {string} [options.method] GET by default
 * @param {Record<string, string>} [options.headers]
 * @param {string} [options.body]
 * @param {boolean} [options.verifyTls] check the certificate (true by default)
 * @param {number} [options.timeoutMs] for the whole exchange, redirects included
 * @param {number} [options.maxBytes]
 * @returns {Promise<{ status: number, headers: object, body: string, url: string }>}
 *   any status: a 4xx/5xx is an answer, the caller decides
 */
export async function httpRequest(
  url,
  {
    method = 'GET',
    headers = {},
    body = '',
    verifyTls = true,
    timeoutMs = TIMEOUT_MS,
    maxBytes = MAX_BODY_BYTES,
  } = {},
) {
  let target = new URL(url);
  const host = target.hostname;
  const deadline = Date.now() + timeoutMs;
  const sent = {
    'User-Agent': USER_AGENT,
    Accept: 'application/json, text/plain, */*',
    ...headers,
  };
  let current = { method, body };
  for (let hop = 0; ; hop += 1) {
    const left = deadline - Date.now();
    if (left <= 0) {
      throw new HttpError(HTTP_ERRORS.TIMEOUT, `${Math.round(timeoutMs / 1000)} s`);
    }
    const answer = await requestOnce(target, {
      ...current,
      headers: sent,
      verifyTls,
      timeoutMs: left,
      maxBytes,
    });
    const location = answer.headers.location;
    if (![301, 302, 303, 307, 308].includes(answer.status) || !location) {
      return { ...answer, url: target.href };
    }
    let next;
    try {
      next = new URL(location, target);
    } catch {
      return { ...answer, url: target.href };
    }
    // Same host only, and never from https down to http (the headers would travel in clear).
    const downgrade = target.protocol === 'https:' && next.protocol === 'http:';
    if (next.hostname !== host || downgrade || !['http:', 'https:'].includes(next.protocol)) {
      throw new HttpError(HTTP_ERRORS.REDIRECT, next.host, answer.status);
    }
    if (hop >= MAX_REDIRECTS) {
      throw new HttpError(HTTP_ERRORS.REDIRECT, `${MAX_REDIRECTS}+`, answer.status);
    }
    // 303, and 301/302 after a POST as browsers do: the body is not sent again.
    if (
      answer.status === 303 ||
      ([301, 302].includes(answer.status) && current.method === 'POST')
    ) {
      current = { method: 'GET', body: '' };
    }
    target = next;
  }
}

/** The host to show in logs and messages: never the path nor the query (they may hold a key). */
export function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return '?';
  }
}

// Addresses that stay at home: the transport badge says "local".
const PRIVATE_V4 = [
  /^10\./,
  /^127\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  // The documentation ranges (RFC 5737) are routed nowhere on the Internet.
  /^(192\.0\.2|198\.51\.100|203\.0\.113)\./,
];
const LOCAL_NAMES = /(?:^|\.)(?:local|lan|home|internal|localdomain|home\.arpa|localhost)$/i;

/** Whether an address is on the local network (private IP, .local name, bare host name). */
export function isLocalAddress(url) {
  let hostname;
  try {
    hostname = new URL(url).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return false;
  }
  if (PRIVATE_V4.some((range) => range.test(hostname))) {
    return true;
  }
  if (hostname.includes(':')) {
    return /^(::1$|fe80:|f[cd][0-9a-f]{2}:)/i.test(hostname);
  }
  return LOCAL_NAMES.test(hostname) || !hostname.includes('.');
}
