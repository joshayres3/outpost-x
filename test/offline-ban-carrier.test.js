'use strict';

const assert = require('assert');
const path = require('path');

const ggconPath = require.resolve('../ggcon');
const moderationPath = require.resolve('../moderationActions');

async function loadWithFake(fake) {
  delete require.cache[moderationPath];
  require.cache[ggconPath] = {
    id: ggconPath,
    filename: ggconPath,
    loaded: true,
    exports: fake,
    children: [],
    paths: module.paths,
  };
  return require('../moderationActions');
}

(async () => {
  {
    const calls = [];
    const mod = await loadWithFake({
      getOnlinePlayers: async () => [{ steamId: '76561198000000001' }],
      ggconPost: async (endpoint, body) => {
        calls.push({ endpoint, body });
        return { ok: true };
      },
    });
    const result = await mod.runScumBan('76561198000000002');
    assert.strictEqual(result.ok, true);
    assert.strictEqual(calls[0].endpoint, '/players/76561198000000002/ban');
  }

  {
    const mod = await loadWithFake({
      getOnlinePlayers: async () => [],
      ggconPost: async () => { throw new Error('should not be called'); },
    });
    await assert.rejects(
      () => mod.runScumBan('76561198000000002'),
      (err) => err && err.code === 'GGCON_NO_COMMAND_CARRIER' && /No players are currently online/.test(err.message)
    );
  }

  {
    const calls = [];
    const mod = await loadWithFake({
      getOnlinePlayers: async () => { throw new Error('temporary lookup failure'); },
      ggconPost: async (endpoint, body) => {
        calls.push({ endpoint, body });
        return { ok: true };
      },
    });
    const result = await mod.runScumUnban('76561198000000003');
    assert.strictEqual(result.ok, true);
    assert.strictEqual(calls[0].endpoint, '/players/76561198000000003/unban');
  }

  delete require.cache[moderationPath];
  delete require.cache[ggconPath];
  console.log('offline ban carrier tests passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
