'use strict';

const { WatcherError } = require('../lib/result');
const log = require('../lib/logger');

const DEFAULT_BASE_URL = 'https://ggcon.gghost.games/s/2788404';
const READ_TIMEOUT_MS = Math.max(3000, Number(process.env.GGCON_READ_TIMEOUT_MS || 10000));
const WRITE_TIMEOUT_MS = Math.max(3000, Number(process.env.GGCON_WRITE_TIMEOUT_MS || 15000));
const AUTH_COOLDOWN_MS = Math.max(60000, Number(process.env.GGCON_AUTH_COOLDOWN_MS || 300000));
let authBlockedUntil = 0;

function baseUrl() { return (process.env.GGCON_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''); }
function password() {
  if (!process.env.GGCON_PASSWORD) throw new WatcherError('Missing server API password Railway variable.', { code: 'GGCON_PASSWORD_MISSING', source: 'ggcon' });
  return process.env.GGCON_PASSWORD;
}
function hasPasswordConfigured() { return !!process.env.GGCON_PASSWORD; }
function classify(endpoint, method, status, data) {
  const message = data?.reason || data?.message || data?.error || `HTTP ${status || 0}`;
  if (status === 401) {
    authBlockedUntil = Date.now() + AUTH_COOLDOWN_MS;
    return new WatcherError(`Server authentication failed: ${message}`, { code: 'GGCON_AUTH_FAILED', source: 'ggcon', status, retryable: false });
  }
  if (/not online|offline|no admin player|no live controller/i.test(message)) return new WatcherError(message, { code: 'PLAYER_OFFLINE', source: 'ggcon', status, retryable: false });
  if (/blocked|cannot be spawned|invalid item|not found/i.test(message)) return new WatcherError(message, { code: 'GGCON_REJECTED', source: 'ggcon', status, retryable: false });
  const retryable = method === 'GET' && (status === 0 || status >= 500 || status === 429);
  return new WatcherError(`Server request failed: ${message}`, { code: status ? `GGCON_HTTP_${status}` : 'GGCON_NETWORK_ERROR', source: 'ggcon', status, retryable, details: { endpoint } });
}

async function request(endpoint, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  if (Date.now() < authBlockedUntil) throw new WatcherError('GGCON requests are paused after an authentication failure. Check the password and allowlist before retrying.', { code: 'GGCON_AUTH_COOLDOWN', source: 'ggcon' });
  const controller = new AbortController();
  const timeoutMs = Number(options.timeoutMs || (method === 'GET' ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS));
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  const rid = options.requestId || log.requestId('ggcon');
  const started = Date.now();
  try {
    const response = await fetch(`${baseUrl()}${endpoint}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(method === 'GET' ? {} : { 'Content-Type': 'application/json' }),
        'X-Password': password(),
      },
      body: method === 'GET' ? undefined : JSON.stringify(options.body || {}),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || data?.ok === false) throw classify(endpoint, method, response.status, data);
    if (options.requireConfirmed === true && data?.ok !== true) throw new WatcherError('GGCON did not confirm the operation.', { code: 'GGCON_UNCONFIRMED', source: 'ggcon', retryable: false, details: { endpoint, data } });
    log.info('ggcon.request.completed', { requestId: rid, method, endpoint, status: response.status, durationMs: Date.now() - started });
    return data ?? { ok: true };
  } catch (error) {
    const normalized = error?.name === 'AbortError'
      ? new WatcherError(`GGCON request timed out after ${timeoutMs}ms.`, { code: 'GGCON_TIMEOUT', source: 'ggcon', retryable: method === 'GET' })
      : (error instanceof WatcherError ? error : classify(endpoint, method, 0, { error: error?.message || String(error) }));
    log.error('ggcon.request.failed', { requestId: rid, method, endpoint, code: normalized.code, retryable: normalized.retryable, durationMs: Date.now() - started, message: normalized.message });
    throw normalized;
  } finally {
    clearTimeout(timeout);
  }
}

async function get(endpoint, options = {}) {
  const attempts = Math.max(1, Math.min(3, Number(options.attempts || 1)));
  let last;
  for (let i = 0; i < attempts; i += 1) {
    try { return await request(endpoint, { ...options, method: 'GET' }); }
    catch (error) {
      last = error;
      if (!error.retryable || i === attempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * (i + 1)));
    }
  }
  throw last;
}
function post(endpoint, body = {}, options = {}) { return request(endpoint, { ...options, method: 'POST', body, requireConfirmed: options.requireConfirmed ?? ['/spawn','/spawn-vehicle','/spawn-entity'].includes(endpoint) }); }
async function rawPost(endpoint, body = {}, options = {}) {
  try { return { httpOk: true, status: 200, data: await request(endpoint, { ...options, method: 'POST', body }), error: null }; }
  catch (error) { return { httpOk: false, status: error.status || 0, data: null, error: error.message, code: error.code }; }
}
function authState() { return { blockedUntil: authBlockedUntil ? new Date(authBlockedUntil).toISOString() : null, blocked: Date.now() < authBlockedUntil }; }

module.exports = { get, post, rawPost, request, baseUrl, hasPasswordConfigured, authState };
