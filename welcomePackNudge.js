'use strict';

const ggcon = require('./ggcon/client');
const { registerChatRowConsumer } = require('./popupEvents');
const { parseWelcomePackUse } = require('./welcomePackNudgeParser');

const MESSAGE_DURATION_SECONDS = Math.max(8, Math.min(30, Number(process.env.WELCOME_PACK_NUDGE_DURATION_SECONDS || '15')));
const PLAYER_COOLDOWN_MS = Math.max(60, Number(process.env.WELCOME_PACK_NUDGE_COOLDOWN_MINUTES || '360')) * 60_000;
const DEFAULT_MESSAGE = 'Your welcome pack was delivered! Join our Discord and use Player Registration to unlock the Command Center, insurance, events, shops, rentals, and player services.';
const MESSAGE = String(process.env.WELCOME_PACK_NUDGE_MESSAGE || DEFAULT_MESSAGE).trim().slice(0, 500);

let unregisterConsumer = null;
const recentlyNotified = new Map();
const processedRows = new Map();

function cleanupMaps(now = Date.now()) {
  const playerCutoff = now - PLAYER_COOLDOWN_MS;
  for (const [steamId, at] of recentlyNotified) if (at < playerCutoff) recentlyNotified.delete(steamId);

  const rowCutoff = now - 30 * 60_000;
  for (const [key, at] of processedRows) if (at < rowCutoff) processedRows.delete(key);
}

function eventKey(parsed) {
  return `${parsed.timestamp || 0}:${parsed.steamId}:${parsed.command.toLowerCase()}`;
}

async function sendPrivateWelcomePackNudge(steamId) {
  return ggcon.post('/message', {
    method: 'warning',
    steamId: String(steamId),
    text: MESSAGE,
    color: '#3d97ff',
    duration: MESSAGE_DURATION_SECONDS,
  }, { requireConfirmed: true });
}

async function consumeChatRows(rows) {
  const now = Date.now();
  cleanupMaps(now);

  for (const row of rows || []) {
    const parsed = parseWelcomePackUse(row);
    if (!parsed) continue;

    const key = eventKey(parsed);
    if (processedRows.has(key)) continue;
    processedRows.set(key, now);

    const lastSent = recentlyNotified.get(parsed.steamId) || 0;
    if (now - lastSent < PLAYER_COOLDOWN_MS) continue;

    try {
      await sendPrivateWelcomePackNudge(parsed.steamId);
      recentlyNotified.set(parsed.steamId, now);
      console.log(`🎁 Welcome-pack registration reminder sent privately to ${parsed.playerName} (${parsed.steamId}).`);
    } catch (err) {
      console.error(`❌ Welcome-pack private registration reminder failed for ${parsed.steamId}:`, err.message);
    }
  }
}

async function startWelcomePackNudgeOnBoot() {
  if (unregisterConsumer) return;
  unregisterConsumer = registerChatRowConsumer(consumeChatRows);
  console.log('🎁 Private /welcomepack registration reminders enabled.');
}

module.exports = {
  startWelcomePackNudgeOnBoot,
  parseWelcomePackUse,
  consumeChatRows,
};
