'use strict';

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { getOnlinePlayers, services: ggconServices } = require('./ggcon');
const log = require('./lib/logger');

const TABLE = process.env.WATCHER_RUNTIME_STATE_TABLE || 'watcher_runtime_state';
const PREFIX = 'popup_reward:';
const MAX_ATTEMPTS = Math.max(1, Number(process.env.POPUP_REWARD_MAX_ATTEMPTS || 12));
const RETRY_DELAY_MS = Math.max(60_000, Number(process.env.POPUP_REWARD_RETRY_MINUTES || 5) * 60_000);
const PROCESSING_STALE_MS = Math.max(5 * 60_000, Number(process.env.POPUP_REWARD_PROCESSING_STALE_MINUTES || 15) * 60_000);
let db;

function getDb() {
  if (db) return db;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) throw new Error('Supabase is not configured.');
  db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, { auth: { persistSession: false } });
  return db;
}
function key(id) { return `${PREFIX}${id}`; }
function now() { return new Date().toISOString(); }
function rewardId(eventId, steamId) {
  return crypto.createHash('sha256').update(`${eventId}:${steamId}`).digest('hex').slice(0, 32);
}
async function save(record) {
  const { error } = await getDb().from(TABLE).upsert({ key: key(record.id), value: record, updated_at: now() }, { onConflict: 'key' });
  if (error) throw error;
  return record;
}
async function get(id) {
  const { data, error } = await getDb().from(TABLE).select('value').eq('key', key(id)).maybeSingle();
  if (error) throw error;
  return data?.value || null;
}
async function list(limit = 100) {
  const { data, error } = await getDb().from(TABLE).select('key,value,updated_at').like('key', `${PREFIX}%`).order('updated_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data || []).map((row) => row.value).filter(Boolean);
}
async function enqueue({ eventId, eventType, winner, reward, error }) {
  const id = rewardId(eventId, winner.steamId);
  const existing = await get(id);
  if (existing?.status === 'completed') return existing;
  const record = {
    id,
    eventId,
    eventType,
    steamId: String(winner.steamId),
    playerName: String(winner.name || winner.steamId),
    reward: { type: reward.type, amount: Number(reward.amount || 0), label: String(reward.label || reward.type) },
    status: 'pending',
    attempts: Number(existing?.attempts || 0),
    createdAt: existing?.createdAt || now(),
    updatedAt: now(),
    nextAttemptAt: new Date(Date.now() + RETRY_DELAY_MS).toISOString(),
    lastError: String(error?.message || error || '').slice(0, 500),
  };
  await save(record);
  log.warn('popup.reward.queued', { rewardId: id, eventId, steamId: record.steamId, rewardType: record.reward.type, message: record.lastError });
  return record;
}
async function playerOnline(steamId) {
  const players = await getOnlinePlayers();
  return players.some((player) => String(player.userId || player.steamId || '') === String(steamId));
}

async function deliver(record) {
  if (!record || record.status === 'completed' || record.status === 'manual_review') return record;
  if (record.reward?.type === 'bonus_lottery' || record.reward?.type === 'none') {
    record.status = 'manual_review';
    record.lastError = 'This reward type cannot be retried automatically.';
    record.updatedAt = now();
    return save(record);
  }
  if (!(await playerOnline(record.steamId))) {
    record.status = 'pending';
    record.nextAttemptAt = new Date(Date.now() + RETRY_DELAY_MS).toISOString();
    record.lastError = 'Player is offline.';
    record.updatedAt = now();
    return save(record);
  }
  record.status = 'processing';
  record.processingStartedAt = now();
  record.attempts = Number(record.attempts || 0) + 1;
  record.updatedAt = now();
  await save(record);
  try {
    const endpoint = record.reward.type === 'cash' ? 'currency' : 'fame';
    const data = await ggconServices.client.post(`/players/${encodeURIComponent(record.steamId)}/${endpoint}`, { action: 'change', amount: Math.abs(Number(record.reward.amount || 0)) }, { requireConfirmed: true });
    record.status = 'completed';
    record.completedAt = now();
    record.updatedAt = now();
    record.lastError = null;
    record.ggcon = { ok: data?.ok === true, accepted: data?.accepted, dispatched: data?.dispatched };
    await save(record);
    log.info('popup.reward.completed', { rewardId: record.id, steamId: record.steamId, rewardType: record.reward.type, attempts: record.attempts });
    return record;
  } catch (error) {
    record.status = record.attempts >= MAX_ATTEMPTS ? 'manual_review' : 'pending';
    record.lastError = String(error?.message || error).slice(0, 500);
    record.nextAttemptAt = new Date(Date.now() + RETRY_DELAY_MS).toISOString();
    record.updatedAt = now();
    await save(record);
    log.warn('popup.reward.retry_failed', { rewardId: record.id, steamId: record.steamId, attempts: record.attempts, status: record.status, message: record.lastError });
    return record;
  }
}
async function processPending() {
  const records = await list(200);
  const due = records.filter((r) => {
    if (r.status === 'pending') return !r.nextAttemptAt || Date.parse(r.nextAttemptAt) <= Date.now();
    if (r.status === 'processing' && Date.now() - Date.parse(r.processingStartedAt || r.updatedAt || 0) > PROCESSING_STALE_MS) {
      r.status = 'manual_review';
      r.lastError = 'Delivery result is uncertain after an interrupted processing attempt. Manual review required to prevent a duplicate reward.';
      r.updatedAt = now();
      save(r).catch(() => {});
    }
    return false;
  });
  for (const record of due.slice(0, 10)) await deliver(record);
  return { checked: records.length, processed: due.length };
}
async function retry(id) {
  const record = await get(id);
  if (!record) throw new Error('Pending reward not found.');
  if (record.status === 'completed') return record;
  record.status = 'pending';
  record.nextAttemptAt = now();
  record.lastError = null;
  await save(record);
  return deliver(record);
}
module.exports = { enqueue, processPending, list, retry, deliver, rewardId };
