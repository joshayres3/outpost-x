'use strict';

const assert = require('node:assert/strict');
const { parseWelcomePackUse } = require('../welcomePackNudgeParser');

const parsed = parseWelcomePackUse({
  t: 123456,
  line: "'76561198825729897:Josh Ayres(42)' 'Global: /welcomepack'",
});

assert.deepEqual(parsed && {
  steamId: parsed.steamId,
  playerName: parsed.playerName,
  command: parsed.command,
  timestamp: parsed.timestamp,
}, {
  steamId: '76561198825729897',
  playerName: 'Josh Ayres',
  command: '/welcomepack',
  timestamp: 123456,
});

assert.equal(parseWelcomePackUse({ line: "'76561198825729897:Josh Ayres(42)' 'Global: hello'" }), null);
assert.equal(parseWelcomePackUse({ line: "Global: /welcomepack" }), null);

console.log('welcome-pack-nudge tests passed');
