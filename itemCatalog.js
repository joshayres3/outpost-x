'use strict';

const { createClient } = require('@supabase/supabase-js');

const DEFAULT_SERVER_BASE_URL = 'https://ggcon.gghost.games/s/2788404';
const RUNTIME_STATE_TABLE = process.env.WATCHER_RUNTIME_STATE_TABLE || 'watcher_runtime_state';
const CATALOG_STATE_KEY = process.env.WATCHER_ITEM_CATALOG_STATE_KEY || 'ggcon_item_catalog_v2';
const SYNC_INTERVAL_MS = Math.max(60 * 60 * 1000, Number(process.env.WATCHER_ITEM_CATALOG_SYNC_HOURS || '24') * 60 * 60 * 1000);
const MEMORY_CACHE_MS = Math.max(60 * 1000, Number(process.env.WATCHER_ITEM_CATALOG_MEMORY_MINUTES || '30') * 60 * 1000);

let db = null;
let memory = { items: [], syncedAt: null, loadedAt: 0, version: null, source: null };
let activeLoad = null;
let activeSync = null;

function getDb() {
  if (db) return db;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) throw new Error('Supabase is not configured.');
  db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, { auth: { persistSession: false } });
  return db;
}

function serverBaseUrl() {
  return String(process.env.GGCON_BASE_URL || DEFAULT_SERVER_BASE_URL).trim().replace(/\/+$/, '');
}

function serverPassword() {
  const password = String(process.env.GGCON_PASSWORD || '').trim();
  if (!password) throw new Error('GGCON password is not configured.');
  return password;
}

function normalizeCatalogItem(item) {
  const itemClass = String(item?.i || item?.itemClass || item?.class || item?.item || item?.id || '').trim();
  if (!itemClass) return null;
  const icon = String(item?.ico || item?.icon || '').trim() || null;
  return {
    i: itemClass,
    ...(icon ? { ico: icon } : {}),
    ...(String(item?.c || item?.category || '').trim() ? { c: String(item?.c || item?.category).trim() } : {}),
    ...(String(item?.dn || item?.displayName || item?.display_name || item?.name || item?.label || '').trim()
      ? { dn: String(item?.dn || item?.displayName || item?.display_name || item?.name || item?.label).trim() }
      : {}),
  };
}

function normalizePayload(payload) {
  const sourceItems = Array.isArray(payload?.items) ? payload.items : Array.isArray(payload) ? payload : [];
  const items = sourceItems.map(normalizeCatalogItem).filter(Boolean);
  if (!items.length) throw new Error('GGCON returned an empty item catalog.');
  return {
    version: Number(payload?.v || 2),
    source: String(payload?.source || 'engine'),
    count: items.length,
    syncedAt: new Date().toISOString(),
    items,
  };
}

async function fetchLiveCatalog() {
  const response = await fetch(`${serverBaseUrl()}/items.json`, {
    method: 'GET',
    headers: { Accept: 'application/json', 'X-Password': serverPassword() },
    signal: AbortSignal.timeout?.(30_000),
  });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : {}; } catch { throw new Error('GGCON item catalog returned invalid JSON.'); }
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.reason || payload?.message || payload?.error || `Item catalog failed (${response.status}).`);
  }
  return normalizePayload(payload);
}

function remember(catalog) {
  memory = {
    items: Array.isArray(catalog?.items) ? catalog.items : [],
    syncedAt: catalog?.syncedAt || null,
    loadedAt: Date.now(),
    version: catalog?.version ?? null,
    source: catalog?.source || null,
  };
  return memory.items;
}

async function saveCatalog(catalog) {
  const { error } = await getDb().from(RUNTIME_STATE_TABLE).upsert({
    key: CATALOG_STATE_KEY,
    value: catalog,
    updated_at: catalog.syncedAt,
  }, { onConflict: 'key' });
  if (error) throw error;
  remember(catalog);
  return catalog;
}

async function loadStoredCatalog() {
  const { data, error } = await getDb().from(RUNTIME_STATE_TABLE).select('value,updated_at').eq('key', CATALOG_STATE_KEY).maybeSingle();
  if (error) throw error;
  const value = data?.value;
  if (!Array.isArray(value?.items) || !value.items.length) return null;
  return {
    version: value.version ?? value.v ?? 2,
    source: value.source || 'supabase-cache',
    count: Number(value.count || value.items.length),
    syncedAt: value.syncedAt || data?.updated_at || null,
    items: value.items.map(normalizeCatalogItem).filter(Boolean),
  };
}

function isFresh(syncedAt) {
  const time = Date.parse(String(syncedAt || ''));
  return Number.isFinite(time) && Date.now() - time < SYNC_INTERVAL_MS;
}

async function syncItemCatalog(options = {}) {
  if (activeSync) return activeSync;
  activeSync = (async () => {
    if (!options.force) {
      const stored = await loadStoredCatalog().catch(() => null);
      if (stored && isFresh(stored.syncedAt)) {
        remember(stored);
        return { ok: true, refreshed: false, count: stored.items.length, syncedAt: stored.syncedAt, source: 'supabase' };
      }
    }
    const live = await fetchLiveCatalog();
    await saveCatalog(live);
    console.log(`✅ GGCON item catalog synced to Supabase (${live.count.toLocaleString('en-US')} items).`);
    return { ok: true, refreshed: true, count: live.count, syncedAt: live.syncedAt, source: live.source };
  })().finally(() => { activeSync = null; });
  return activeSync;
}

async function getItemCatalog(options = {}) {
  if (!options.forceReload && memory.items.length && Date.now() - memory.loadedAt < MEMORY_CACHE_MS) return memory.items;
  if (activeLoad) return activeLoad;
  activeLoad = (async () => {
    const stored = await loadStoredCatalog().catch((error) => {
      console.warn('⚠️ Could not load the Supabase item catalog cache:', error.message);
      return null;
    });
    if (stored?.items?.length) {
      remember(stored);
      if (!isFresh(stored.syncedAt) && options.refreshStale !== false) {
        syncItemCatalog({ force: true }).catch((error) => console.error('❌ Background item catalog refresh failed:', error.message));
      }
      return memory.items;
    }

    // First deployment fallback: fetch once immediately so the picker still works before the scheduled task runs.
    const live = await fetchLiveCatalog();
    try { await saveCatalog(live); }
    catch (error) {
      console.warn('⚠️ Item catalog is available from GGCON but could not be cached in Supabase:', error.message);
      remember(live);
    }
    return memory.items;
  })().finally(() => { activeLoad = null; });
  return activeLoad;
}

function getItemCatalogStatus() {
  return {
    count: memory.items.length,
    syncedAt: memory.syncedAt,
    loadedAt: memory.loadedAt ? new Date(memory.loadedAt).toISOString() : null,
    version: memory.version,
    source: memory.source,
    syncEveryHours: SYNC_INTERVAL_MS / 3_600_000,
  };
}

module.exports = {
  getItemCatalog,
  syncItemCatalog,
  getItemCatalogStatus,
  ITEM_CATALOG_SYNC_INTERVAL_MS: SYNC_INTERVAL_MS,
};
