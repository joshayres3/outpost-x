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

  console.log('ggcon-client tests passed');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
