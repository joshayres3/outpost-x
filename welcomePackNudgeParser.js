'use strict';

function rowText(row) {
  return String(row?.line || row?.message || row?.text || row?.raw || '').trim();
}

function parseWelcomePackUse(row) {
  const raw = rowText(row);
  if (!raw || !/\/welcomepack\b/i.test(raw)) return null;

  const globalMatch = raw.match(/'([0-9]{17}):(.+?)\(\d+\)'\s+'Global:\s*(\/welcomepack\b[^']*)'/i);
  if (globalMatch) {
    return {
      steamId: globalMatch[1],
      playerName: globalMatch[2].trim(),
      command: globalMatch[3].trim(),
      timestamp: Number(row?.t || row?.timestamp || row?.time || 0),
      raw,
    };
  }

  const steamId = (raw.match(/\b(7656119\d{10})\b/) || raw.match(/steam(?:id)?\s*[:=]\s*(\d{15,20})/i) || [])[1];
  if (!steamId) return null;

  const commandMatch = raw.match(/(?:Global:\s*)?(\/welcomepack\b[^'"\r\n]*)/i);
  if (!commandMatch) return null;

  const playerName = (
    raw.match(/(?:CharacterName|PlayerName|Name)\s*[:=]\s*["']?([^,"'|\]]+)/i)
    || raw.match(/\b\d{15,20}\b\s*[-|:]\s*([^:|]+)\s*[:|]\s*\/welcomepack/i)
  )?.[1]?.trim() || steamId;

  return {
    steamId: String(steamId),
    playerName,
    command: commandMatch[1].trim(),
    timestamp: Number(row?.t || row?.timestamp || row?.time || 0),
    raw,
  };
}

module.exports = { parseWelcomePackUse };
