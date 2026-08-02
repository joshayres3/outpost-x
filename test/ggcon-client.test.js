'use strict';

const assert = require('assert');

async function withFetch(fake, fn) {
  const oldFetch = global.fetch;
  global.fetch = fake;
  try { await fn(); } finally { global.fetch = oldFetch; }
}

async function main() {
  process.env.GGCON_PASSWORD = 'test-password';
  process.env.GGCON_BASE_URL = 'https://example.invalid/s/test';
  delete require.cache[require.resolve('../ggcon/client')];
  const client = require('../ggcon/client');

  await withFetch(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, accepted: true, dispatched: true }) }), async () => {
    const result = await client.post('/spawn', { steamId: '1', item: 'Knife', qty: 1 });
    assert.strictEqual(result.ok, true);
  });


  const adjustmentBodies = [];
  await withFetch(async (_url, options) => {
    adjustmentBodies.push(JSON.parse(options.body));
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  }, async () => {
    await client.post('/players/1/currency', { action: 'add', amount: 500 });
    await client.post('/players/1/currency', { action: 'remove', amount: 250 });
    await client.post('/players/1/fame', { action: 'change', amount: -25 });
    await client.post('/players/1/fame', { action: 'set', amount: 1000 });
  });
  assert.deepStrictEqual(adjustmentBodies, [
    { action: 'change', amount: 500 },
    { action: 'change', amount: -250 },
    { action: 'change', amount: -25 },
    { action: 'set', amount: 1000 },
  ], 'cash and fame requests should use GGCON set/change semantics');

  await withFetch(async () => ({ ok: true, status: 200, json: async () => ({ ok: false, error: 'Player not online' }) }), async () => {
    await assert.rejects(() => client.post('/spawn', {}), (error) => error.code === 'PLAYER_OFFLINE');
  });

  let messageFetches = 0;
  await withFetch(async () => { messageFetches += 1; return { ok: true, status: 200, json: async () => ({ ok: false, message: 'Message dispatch could not reach the game thread (busy or shutting down)' }) }; }, async () => {
    await assert.rejects(() => client.post('/message', { text: 'test' }), (error) => error.code === 'GGCON_GAME_THREAD_BUSY');
    await assert.rejects(() => client.post('/message', { text: 'test again' }), (error) => error.code === 'GGCON_MESSAGE_CIRCUIT_OPEN');
    assert.strictEqual(messageFetches, 1, 'message circuit breaker should prevent repeated requests');
  });

  await withFetch(async () => ({ ok: false, status: 401, json: async () => ({ ok: false, error: 'unauthorized', reason: 'Authentication failed' }) }), async () => {
    await assert.rejects(() => client.get('/players.json'), (error) => error.code === 'GGCON_AUTH_FAILED');
  });


  delete require.cache[require.resolve('../ggcon/client')];
  const cachedClient = require('../ggcon/client');
  let playerFetches = 0;
  await withFetch(async () => { playerFetches += 1; return { ok: true, status: 200, json: async () => ({ ok: true, players: [] }) }; }, async () => {
    await Promise.all([cachedClient.get('/players.json'), cachedClient.get('/players.json')]);
    await cachedClient.get('/players.json');
    assert.strictEqual(playerFetches, 1, 'concurrent and near-term player reads should share one network request');
  });

  delete require.cache[require.resolve('../ggcon/client')];
  const optionalClient = require('../ggcon/client');
  let killFeedFetches = 0;
  await withFetch(async () => { killFeedFetches += 1; return { ok: false, status: 404, json: async () => ({ ok: false, error: 'not found' }) }; }, async () => {
    const first = await optionalClient.get('/kill-feed/events.json?since=0');
    const second = await optionalClient.get('/kill-feed/events.json?since=1');
    assert.strictEqual(first.unavailable, true);
    assert.strictEqual(second.unavailable, true);
    assert.strictEqual(killFeedFetches, 1, 'missing optional plugins should be paused instead of polled repeatedly');
  });

  console.log('ggcon-client tests passed');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
