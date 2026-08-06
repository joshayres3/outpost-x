'use strict';

const { ggconPost, getOnlinePlayers } = require('./ggcon');

function cleanSteamId(value) {
  const steamId = String(value || '').trim();
  if (!/^\d{17}$/.test(steamId)) throw new Error('A valid 17-digit Steam64 ID is required.');
  return steamId;
}


async function ensureCommandCarrierOnline() {
  // SCUM's native moderation command may target an offline Steam64, but ggCON
  // still needs at least one player connected to carry the command into the server.
  // A failed online-player lookup should not falsely block moderation; the actual
  // command attempt remains the final source of truth in that case.
  const onlinePlayers = await getOnlinePlayers().catch(() => null);
  if (Array.isArray(onlinePlayers) && onlinePlayers.length === 0) {
    const err = new Error('No players are currently online. GGCON cannot send the SCUM moderation command until at least one player is connected.');
    err.code = 'GGCON_NO_COMMAND_CARRIER';
    throw err;
  }
  return onlinePlayers;
}

async function runScumBan(steamId) {
  const id = cleanSteamId(steamId);
  await ensureCommandCarrierOnline();
  try {
    const result = await ggconPost(`/players/${encodeURIComponent(id)}/ban`, {});
    return { ok: true, method: 'direct', result };
  } catch (directError) {
    try {
      const result = await ggconPost('/command', { command: `#Ban ${id}` });
      return { ok: true, method: 'command', result, directError: directError.message };
    } catch (commandError) {
      const err = new Error(`SCUM ban failed. Direct endpoint: ${directError.message}. Native command: ${commandError.message}`);
      err.directError = directError;
      err.commandError = commandError;
      throw err;
    }
  }
}

async function runScumUnban(steamId) {
  const id = cleanSteamId(steamId);
  await ensureCommandCarrierOnline();
  try {
    const result = await ggconPost(`/players/${encodeURIComponent(id)}/unban`, {});
    return { ok: true, method: 'direct', result };
  } catch (directError) {
    try {
      const result = await ggconPost('/command', { command: `#Unban ${id}` });
      return { ok: true, method: 'command', result, directError: directError.message };
    } catch (commandError) {
      const err = new Error(`SCUM unban failed. Direct endpoint: ${directError.message}. Native command: ${commandError.message}`);
      err.directError = directError;
      err.commandError = commandError;
      throw err;
    }
  }
}

module.exports = { runScumBan, runScumUnban, cleanSteamId, ensureCommandCarrierOnline };
