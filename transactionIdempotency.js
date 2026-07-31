'use strict';

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const TABLE = process.env.WATCHER_RUNTIME_STATE_TABLE || 'watcher_runtime_state';
const TTL_MS = Math.max(60000, Number(process.env.WATCHER_IDEMPOTENCY_TTL_MS || 15 * 60 * 1000));
let db;
function getDb() { if (!db) db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, { auth: { persistSession: false } }); return db; }
function safePart(value) { return String(value || '').replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 120); }
function makeKey(scope, identity, supplied) { return `idempotency:${safePart(scope)}:${safePart(identity)}:${safePart(supplied || crypto.randomUUID())}`; }
async function read(key) { const { data, error } = await getDb().from(TABLE).select('value,updated_at').eq('key', key).maybeSingle(); if (error) throw error; return data; }
async function write(key, value) { const { error } = await getDb().from(TABLE).upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' }); if (error) throw error; }
async function begin({ scope, identity, requestId }) {
  const key = makeKey(scope, identity, requestId);
  const existing = await read(key).catch(() => null);
  const age = Date.now() - Date.parse(existing?.updated_at || 0);
  if (existing?.value?.status === 'completed') return { key, duplicate: true, result: existing.value.result };
  if (existing?.value?.status === 'processing' && age < TTL_MS) return { key, duplicate: true, processing: true };
  await write(key, { status: 'processing', requestId, startedAt: new Date().toISOString() });
  return { key, duplicate: false };
}
async function stage(key, status, details = {}) { await write(key, { status: 'processing', stage: status, updatedStageAt: new Date().toISOString(), ...details }); }
async function complete(key, result) { await write(key, { status: 'completed', completedAt: new Date().toISOString(), result }); }
async function fail(key, error) { await write(key, { status: 'failed', failedAt: new Date().toISOString(), error: error?.message || String(error) }); }
module.exports = { begin, stage, complete, fail, makeKey };
