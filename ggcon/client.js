'use strict';

const { WatcherError } = require('../lib/result');
const log = require('../lib/logger');

const DEFAULT_BASE_URL = 'https://ggcon.gghost.games/s/2788404';
const READ_TIMEOUT_MS = Math.max(3000, Number(process.env.GGCON_READ_TIMEOUT_MS || 10000));
const WRITE_TIMEOUT_MS = Math.max(3000, Number(process.env.GGCON_WRITE_TIMEOUT_MS || 15000));
const AUTH_COOLDOWN_MS = Math.max(60000, Number(process.env.GGCON_AUTH_COOLDOWN_MS || 300000));
const MESSAGE_COOLDOWN_MS = Math.max(30000, Number(process.env.GGCON_MESSAGE_COOLDOWN_MS || 120000));
const OPTIONAL_PLUGIN_COOLDOWN_MS = Math.max(300000, Number(process.env.GGCON_OPTIONAL_PLUGIN_COOLDOWN_MS || 21600000));
const ERROR_LOG_COOLDOWN_MS = Math.max(30000, Number(process.env.GGCON_ERROR_LOG_COOLDOWN_MS || 300000));

let authBlockedUntil = 0;
let messageBlockedUntil = 0;
let lastMessageBlockLogAt = 0;
const inflightGets = new Map();
const responseCache = new Map();
const endpointBackoff = new Map();
const optionalUnavailable = new Map();
const recentErrorLogs = new Map();
const metrics = { requests: 0, networkRequests: 0, cacheHits: 0, inflightHits: 0, staleHits: 0, successes: 0, failures: 0, suppressedErrors: 0 };

function baseUrl() { return (process.env.GGCON_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''); }
function password() {
  if (!process.env.GGCON_PASSWORD) throw new WatcherError('Missing server API password Railway variable.', { code: 'GGCON_PASSWORD_MISSING', source: 'ggcon' });
  return process.env.GGCON_PASSWORD;
}
function hasPasswordConfigured() { return !!process.env.GGCON_PASSWORD; }
function endpointPath(endpoint) { return String(endpoint || '').split('?')[0]; }

function normalizeAdjustmentBody(endpoint, body) {
  const path = endpointPath(endpoint);
  if (!/^\/players\/[^/]+\/(currency|fame)$/.test(path)) return body;
  const input = body && typeof body === 'object' ? { ...body } : {};
  const action = String(input.action || '').trim().toLowerCase();
  const amount = Number(input.amount);
  if (!Number.isFinite(amount)) return input;
  if (action === 'set') return { ...input, action: 'set', amount: Math.max(0, amount) };
  if (action === 'remove') return { ...input, action: 'change', amount: -Math.abs(amount) };
  if (action === 'add') return { ...input, action: 'change', amount: Math.abs(amount) };
  if (action === 'change') return { ...input, action: 'change', amount };
  return input;
}
function isOptionalPlugin(endpoint) { return /^\/(kill-feed|npc-tracker|trap-alerts|analyzer|drops|shop|taxi|gghaul|stash-n-dash)(\/|$)/.test(endpointPath(endpoint)); }
function optionalFallback(endpoint) {
  const p = endpointPath(endpoint);
  if (p.includes('/leaderboard')) return { ok: true, count: 0, rows: [], unavailable: true };
  if (p.includes('/stats')) return { ok: true, total: 0, pvp: 0, npc: 0, suicide: 0, trap: 0, topWeapons: [], topKillers: [], unavailable: true };
  if (p.includes('/history') || p.includes('/events')) return { ok: true, events: [], lines: [], next: 0, total: 0, unavailable: true };
  if (p.includes('/npcs')) return { ok: true, npcs: [], kills: [], unavailable: true };
  return { ok: true, unavailable: true };
}
function cacheTtl(endpoint) {
  const p = endpointPath(endpoint);
  if (p === '/players.json') return 3000;
  if (p === '/server.json') return 5000;
  if (p === '/vehicles.json') return 5000;
  if (p === '/weather.json') return 30000;
  if (p === '/flags.json' || p === '/squads.json') return 15000;
  if (p === '/vehicle-types.json') return 6 * 60 * 60 * 1000;
  if (p === '/items.json') return 30 * 60 * 1000;
  return 0;
}
function classify(endpoint, method, status, data) {
  const message = data?.reason || data?.message || data?.error || `HTTP ${status || 0}`;
  if (status === 401) {
    authBlockedUntil = Date.now() + AUTH_COOLDOWN_MS;
    return new WatcherError(`Server authentication failed: ${message}`, { code: 'GGCON_AUTH_FAILED', source: 'ggcon', status, retryable: false });
  }
  if (/game thread|busy or shutting down|could not reach the game thread/i.test(message)) {
    if (endpoint === '/message') messageBlockedUntil = Date.now() + MESSAGE_COOLDOWN_MS;
    return new WatcherError(message, { code: 'GGCON_GAME_THREAD_BUSY', source: 'ggcon', status, retryable: false });
  }
  if (/not online|offline|no admin player|no live controller/i.test(message)) return new WatcherError(message, { code: 'PLAYER_OFFLINE', source: 'ggcon', status, retryable: false });
  if (/blocked|cannot be spawned|invalid item|not found/i.test(message)) return new WatcherError(message, { code: 'GGCON_REJECTED', source: 'ggcon', status, retryable: false });
  const retryable = method === 'GET' && (status === 0 || status >= 500 || status === 429);
  return new WatcherError(`Server request failed: ${message}`, { code: status ? `GGCON_HTTP_${status}` : 'GGCON_NETWORK_ERROR', source: 'ggcon', status, retryable, details: { endpoint } });
}
function recordBackoff(endpoint, error) {
  if (!error?.retryable) return;
  const key = endpointPath(endpoint);
  const previous = endpointBackoff.get(key) || { failures: 0 };
  const failures = Math.min(6, previous.failures + 1);
  const delayMs = Math.min(60000, 2000 * (2 ** (failures - 1)));
  endpointBackoff.set(key, { failures, until: Date.now() + delayMs });
}
function clearBackoff(endpoint) { endpointBackoff.delete(endpointPath(endpoint)); }
function shouldLogError(endpoint, code) {
  const key = `${endpointPath(endpoint)}:${code}`;
  const now = Date.now();
  const last = recentErrorLogs.get(key) || 0;
  if (now - last < ERROR_LOG_COOLDOWN_MS) { metrics.suppressedErrors += 1; return false; }
  recentErrorLogs.set(key, now);
  return true;
}

async function requestNetwork(endpoint, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const controller = new AbortController();
  const timeoutMs = Number(options.timeoutMs || (method === 'GET' ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS));
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  const rid = options.requestId || log.requestId('ggcon');
  const started = Date.now();
  metrics.networkRequests += 1;
  try {
    const response = await fetch(`${baseUrl()}${endpoint}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(method === 'GET' ? {} : { 'Content-Type': 'application/json' }),
        'X-Password': password(),
      },
      body: method === 'GET' ? undefined : JSON.stringify(normalizeAdjustmentBody(endpoint, options.body || {})),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || data?.ok === false) throw classify(endpoint, method, response.status, data);
    if (options.requireConfirmed === true && data?.ok !== true) throw new WatcherError('GGCON did not confirm the operation.', { code: 'GGCON_UNCONFIRMED', source: 'ggcon', retryable: false, details: { endpoint, data } });
    metrics.successes += 1;
    clearBackoff(endpoint);
    if (method === 'POST') {
      log.info('ggcon.request.completed', { requestId: rid, method, endpoint, status: response.status, durationMs: Date.now() - started });
    } else if (process.env.WATCHER_TRACE_POLLS === 'true') {
      log.debug('ggcon.request.completed', { requestId: rid, method, endpoint, status: response.status, durationMs: Date.now() - started });
    }
    return data ?? { ok: true };
  } catch (error) {
    const normalized = error?.name === 'AbortError'
      ? new WatcherError(`GGCON request timed out after ${timeoutMs}ms.`, { code: 'GGCON_TIMEOUT', source: 'ggcon', retryable: method === 'GET' })
      : (error instanceof WatcherError ? error : classify(endpoint, method, 0, { error: error?.message || String(error) }));
    metrics.failures += 1;
    recordBackoff(endpoint, normalized);
    if (method === 'GET' && normalized.status === 404 && isOptionalPlugin(endpoint)) {
      optionalUnavailable.set(endpointPath(endpoint), Date.now() + OPTIONAL_PLUGIN_COOLDOWN_MS);
      if (shouldLogError(endpoint, 'OPTIONAL_PLUGIN_404')) log.warn('ggcon.optional_plugin.unavailable', { endpoint: endpointPath(endpoint), retryAfter: new Date(Date.now() + OPTIONAL_PLUGIN_COOLDOWN_MS).toISOString() });
      return optionalFallback(endpoint);
    }
    if (shouldLogError(endpoint, normalized.code)) log.error('ggcon.request.failed', { requestId: rid, method, endpoint, code: normalized.code, retryable: normalized.retryable, durationMs: Date.now() - started, message: normalized.message });
    throw normalized;
  } finally {
    clearTimeout(timeout);
  }
}

async function request(endpoint, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  metrics.requests += 1;
  if (Date.now() < authBlockedUntil) throw new WatcherError('GGCON requests are paused after an authentication failure. Check the password and allowlist before retrying.', { code: 'GGCON_AUTH_COOLDOWN', source: 'ggcon' });
  if (endpoint === '/message' && method === 'POST' && Date.now() < messageBlockedUntil) {
    if (Date.now() - lastMessageBlockLogAt > 30000) {
      lastMessageBlockLogAt = Date.now();
      log.warn('ggcon.message.circuit_open', { blockedUntil: new Date(messageBlockedUntil).toISOString() });
    }
    throw new WatcherError('In-game messages are temporarily paused because the SCUM game thread is busy or shutting down.', { code: 'GGCON_MESSAGE_CIRCUIT_OPEN', source: 'ggcon', retryable: false });
  }
  if (method !== 'GET') return requestNetwork(endpoint, options);

  const path = endpointPath(endpoint);
  const unavailableUntil = optionalUnavailable.get(path) || 0;
  if (Date.now() < unavailableUntil) return optionalFallback(endpoint);

  const ttl = options.cacheTtlMs ?? cacheTtl(endpoint);
  const cached = responseCache.get(endpoint);
  if (ttl > 0 && cached && Date.now() - cached.at < ttl) { metrics.cacheHits += 1; return cached.data; }

  const backoff = endpointBackoff.get(path);
  if (backoff && Date.now() < backoff.until) {
    if (cached) { metrics.staleHits += 1; return cached.data; }
    throw new WatcherError('GGCON read is temporarily paused after repeated server errors.', { code: 'GGCON_READ_BACKOFF', source: 'ggcon', retryable: true, details: { endpoint, retryAt: new Date(backoff.until).toISOString() } });
  }

  if (inflightGets.has(endpoint)) { metrics.inflightHits += 1; return inflightGets.get(endpoint); }
  const promise = requestNetwork(endpoint, options).then((data) => {
    if (ttl > 0) responseCache.set(endpoint, { data, at: Date.now() });
    return data;
  }).finally(() => inflightGets.delete(endpoint));
  inflightGets.set(endpoint, promise);
  return promise;
}

async function get(endpoint, options = {}) {
  const attempts = Math.max(1, Math.min(3, Number(options.attempts || 1)));
  let last;
  for (let i = 0; i < attempts; i += 1) {
    try { return await request(endpoint, { ...options, method: 'GET' }); }
    catch (error) {
      last = error;
      if (!error.retryable || i === attempts - 1 || error.code === 'GGCON_READ_BACKOFF') throw error;
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
function authState() { return { blockedUntil: authBlockedUntil ? new Date(authBlockedUntil).toISOString() : null, blocked: Date.now() < authBlockedUntil, messageBlocked: Date.now() < messageBlockedUntil, messageBlockedUntil: messageBlockedUntil ? new Date(messageBlockedUntil).toISOString() : null }; }
function metricsSnapshot({ reset = false } = {}) { const out = { ...metrics, inflight: inflightGets.size, cacheEntries: responseCache.size, backoffEndpoints: endpointBackoff.size, optionalPluginsPaused: optionalUnavailable.size }; if (reset) for (const key of Object.keys(metrics)) metrics[key] = 0; return out; }
function clearCaches() { responseCache.clear(); inflightGets.clear(); endpointBackoff.clear(); optionalUnavailable.clear(); }

module.exports = { get, post, rawPost, request, baseUrl, hasPasswordConfigured, authState, metricsSnapshot, clearCaches, normalizeAdjustmentBody };
