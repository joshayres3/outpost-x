'use strict';

const { ggconPost } = require('./ggcon');

function cleanSteamId(value) {
  const steamId = String(value || '').trim();
  if (!/^\d{17}$/.test(steamId)) throw new Error('A valid 17-digit Steam64 ID is required.');
  return steamId;
}

async function runScumBan(steamId) {
  const id = cleanSteamId(steamId);
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

module.exports = { runScumBan, runScumUnban, cleanSteamId };
