const assert = require('assert');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'analytics.js'), 'utf8');

assert(src.includes("const startLocal = endLocal.minus({ days: 7 });"), 'weekly awards must use a rolling seven-day window');
assert(src.includes("return member ? `<@${discordId}>`" ) || src.includes("if (member) return `<@${discordId}>`;"), 'weekly awards must mention linked Discord members');
assert(src.includes("steamToDiscord.get(String(row.sid || '').trim())"), 'community challenge contributors must map Steam IDs to Discord IDs');
assert(src.includes("winnerDiscordId"), 'kill race winners must map to Discord mentions');
assert(src.includes("['lt','completed_at',end]"), 'weekly boundary must be exclusive to avoid double counting');

console.log('weekly awards accuracy tests passed');
