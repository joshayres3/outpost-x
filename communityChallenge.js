const crypto = require('crypto');
const { EmbedBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const { DateTime } = require('luxon');
const { ggconGet } = require('./ggcon');

const TZ = process.env.WATCHER_TIMEZONE || 'America/Toronto';
const MAIN_CHAT_ID = process.env.MAIN_CHAT_CHANNEL_ID || '1516269437932670977';
const RUNTIME_TABLE = process.env.WATCHER_RUNTIME_STATE_TABLE || 'watcher_runtime_state';
const POLL_SECONDS = Math.max(20, Number(process.env.WATCHER_COMMUNITY_CHALLENGE_POLL_SECONDS || '30'));
const DEFAULT_TARGET = Math.max(1, Number(process.env.WATCHER_COMMUNITY_CHALLENGE_TARGET || '350'));
const MAX_SEEN = Math.max(1000, Number(process.env.WATCHER_COMMUNITY_CHALLENGE_MAX_SEEN || '5000'));
// Temporary safety switch: this build runs only the private 3-part owner test.
// Set WATCHER_COMMUNITY_CHALLENGE_PRIVATE_TEST_ONLY=false after verification.
const PRIVATE_TEST_ONLY = String(process.env.WATCHER_COMMUNITY_CHALLENGE_PRIVATE_TEST_ONLY || 'true').toLowerCase() !== 'false';
const PLAYER_LINKS_TABLE = process.env.WATCHER_PLAYER_LINKS_TABLE || 'watcher_player_links';

let db;
let pollTimer;
let pollBusy = false;

function getDb() {
  if (!db) db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, { auth: { persistSession: false } });
  return db;
}

function nowEt() { return DateTime.now().setZone(TZ); }
function weekId(dt = nowEt()) { return dt.toFormat("kkkk-'W'WW"); }
function stateKey(guildId, week = weekId()) { return `community_challenge:${guildId}:${week}`; }

function challengeWindow(dt = nowEt()) {
  return {
    startsAt: dt.startOf('week').toUTC().toISO(),
    endsAt: dt.endOf('week').toUTC().toISO(),
  };
}

function newChallenge(guildId, dt = nowEt()) {
  const window = challengeWindow(dt);
  return {
    version: 1,
    guildId: String(guildId),
    week: weekId(dt),
    title: process.env.WATCHER_COMMUNITY_CHALLENGE_TITLE || 'Island Cleanup',
    description: process.env.WATCHER_COMMUNITY_CHALLENGE_DESCRIPTION || 'Work together to eliminate hostile NPCs across the island.',
    target: DEFAULT_TARGET,
    category: 'all',
    progress: 0,
    contributors: {},
    initialized: false,
    seen: [],
    startedAt: window.startsAt,
    endsAt: window.endsAt,
    announcedAt: null,
    updatedAt: new Date().toISOString(),
  };
}

async function stateGet(key) {
  const { data, error } = await getDb().from(RUNTIME_TABLE).select('value').eq('key', key).maybeSingle();
  if (error) throw error;
  return data?.value || null;
}

async function stateDelete(key) {
  const { error } = await getDb().from(RUNTIME_TABLE).delete().eq('key', key);
  if (error) throw error;
}

async function stateSet(key, value) {
  const { error } = await getDb().from(RUNTIME_TABLE).upsert({
    key,
    value,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'key' });
  if (error) throw error;
}

async function loadChallenge(guildId, dt = nowEt()) {
  const key = stateKey(guildId, weekId(dt));
  const saved = await stateGet(key).catch(() => null);
  return { key, challenge: saved || newChallenge(guildId, dt) };
}

function eventFingerprint(event) {
  const raw = [
    event?.t,
    event?.type,
    event?.killer?.sid,
    event?.killer?.name,
    event?.victim?.sid,
    event?.victim?.name,
    event?.victim?.x,
    event?.victim?.y,
    event?.victim?.z,
    event?.dist,
  ].join('|');
  return crypto.createHash('sha1').update(raw).digest('hex');
}

function isPlayerNpcKill(event) {
  return String(event?.type || '').toLowerCase() === 'npc'
    && !!String(event?.killer?.sid || '').trim()
    && !String(event?.victim?.sid || '').trim();
}

function contributorRows(challenge) {
  return Object.entries(challenge?.contributors || {})
    .map(([sid, value]) => ({ sid, name: value?.name || 'Unknown Exile', count: Number(value?.count || 0) }))
    .filter(row => row.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function progressText(challenge) {
  const progress = Number(challenge?.progress || 0);
  const target = Math.max(1, Number(challenge?.target || DEFAULT_TARGET));
  const pct = Math.min(100, Math.floor((progress / target) * 100));
  const remaining = Math.max(0, target - progress);
  return `**${progress.toLocaleString('en-CA')} / ${target.toLocaleString('en-CA')}** NPCs eliminated (${pct}%)${remaining ? ` • **${remaining.toLocaleString('en-CA')}** remaining` : ' • **Challenge complete!**'}`;
}

function buildChallengeEmbed(challenge, heading = '🎯 Weekly Community Challenge') {
  const leaders = contributorRows(challenge).slice(0, 3);
  const leaderText = leaders.length
    ? leaders.map((row, index) => `${index + 1}. **${row.name}** — ${row.count}`).join('\n')
    : 'No qualifying kills recorded yet.';
  return new EmbedBuilder()
    .setTitle(heading)
    .setDescription(`**${challenge.title}**\n${challenge.description}\n\n${progressText(challenge)}`)
    .addFields({ name: 'Top Contributors', value: leaderText, inline: false })
    .setFooter({ text: `Tracking began when this weekly challenge was activated • Week ${challenge.week}` });
}

async function announceChallenge(guild, challenge, key) {
  if (challenge.announcedAt) return;
  const channel = await guild.channels.fetch(MAIN_CHAT_ID).catch(() => null);
  if (!channel?.isTextBased()) return;
  await channel.send({ embeds: [buildChallengeEmbed(challenge)] });
  challenge.announcedAt = new Date().toISOString();
  challenge.updatedAt = challenge.announcedAt;
  await stateSet(key, challenge);
}


function privateTestKey(guildId) { return `community_challenge_test:${guildId}`; }

function npcTestCategory(event) {
  const rawCat = String(event?.cat || '').trim().toLowerCase();
  const victimName = String(event?.victim?.name || '').trim().toLowerCase();
  if (rawCat.includes('zombie') || victimName.includes('zombie') || victimName.includes('puppet')) return 'zombie';
  if (rawCat.includes('animal') || ['rabbit','bear','wolf','boar','goat','horse','donkey','deer','buck','doe','chicken'].some(v => victimName.includes(v))) return 'animal';
  return 'npc';
}

function privateTestProgressText(test) {
  const done = test?.counts || {};
  const mark = value => Number(value || 0) >= 1 ? '✅' : '⬜';
  return [
    `${mark(done.npc)} 1 hostile NPC/guard`,
    `${mark(done.zombie)} 1 puppet/zombie`,
    `${mark(done.animal)} 1 animal`,
  ].join('\n');
}

function privateTestComplete(test) {
  return Number(test?.counts?.npc || 0) >= 1
    && Number(test?.counts?.zombie || 0) >= 1
    && Number(test?.counts?.animal || 0) >= 1;
}

async function loadPrivateTest(guildId) {
  return stateGet(privateTestKey(guildId)).catch(() => null);
}

async function resolveLinkedSteamId(guildId, discordId) {
  const { data, error } = await getDb()
    .from(PLAYER_LINKS_TABLE)
    .select('steam_id, scum_name')
    .eq('guild_id', String(guildId))
    .eq('discord_id', String(discordId))
    .not('steam_id', 'is', null)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function startPrivateTest(message) {
  const link = await resolveLinkedSteamId(message.guild.id, message.author.id);
  if (!link?.steam_id) throw new Error('Your Discord account is not linked to a Steam64 ID.');
  const data = await ggconGet('/kill-feed/history.json?range=session');
  const events = Array.isArray(data?.events) ? data.events : [];
  const test = {
    version: 1,
    guildId: String(message.guild.id),
    discordId: String(message.author.id),
    steamId: String(link.steam_id),
    scumName: String(link.scum_name || message.author.username),
    channelId: String(message.channel.id),
    active: true,
    counts: { npc: 0, zombie: 0, animal: 0 },
    seen: events.map(eventFingerprint).slice(-MAX_SEEN),
    startedAt: new Date().toISOString(),
    completedAt: null,
    notifiedComplete: false,
  };
  await stateSet(privateTestKey(message.guild.id), test);
  return test;
}

async function processPrivateTest(guild) {
  const key = privateTestKey(guild.id);
  const test = await loadPrivateTest(guild.id);
  if (!test?.active) return;
  const data = await ggconGet('/kill-feed/history.json?range=session');
  const events = Array.isArray(data?.events) ? data.events : [];
  const seen = new Set(Array.isArray(test.seen) ? test.seen : []);
  let changed = false;
  for (const event of events) {
    const fingerprint = eventFingerprint(event);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    changed = true;
    if (!isPlayerNpcKill(event)) continue;
    if (String(event.killer.sid || '').trim() !== String(test.steamId || '').trim()) continue;
    const category = npcTestCategory(event);
    if (Number(test.counts?.[category] || 0) < 1) test.counts[category] = 1;
  }
  test.seen = [...seen].slice(-MAX_SEEN);
  if (privateTestComplete(test) && !test.completedAt) test.completedAt = new Date().toISOString();
  if (changed || test.completedAt) await stateSet(key, test);

  if (test.completedAt && !test.notifiedComplete) {
    const member = await guild.members.fetch(test.discordId).catch(() => null);
    const text = `✅ **Private community challenge test complete**\n${privateTestProgressText(test)}\n\nNo public challenge post was sent.`;
    await member?.send(text).catch(() => {});
    const channel = await guild.channels.fetch(test.channelId).catch(() => null);
    if (channel?.isTextBased()) await channel.send(`<@${test.discordId}> ${text}`).catch(() => {});
    test.notifiedComplete = true;
    test.active = false;
    await stateSet(key, test);
  }
}

async function handlePrivateTestCommand(message) {
  if (!message.guild || !message.content?.toLowerCase().startsWith('!challengetest')) return false;
  const isOwner = !!message.member?.roles?.cache?.some(r => ['Owner','Owners'].includes(r.name));
  if (!isOwner) { await message.reply('Only an Owner can use the private challenge test.'); return true; }
  const action = String(message.content.trim().split(/\s+/)[1] || 'status').toLowerCase();
  if (action === 'start') {
    const test = await startPrivateTest(message);
    await message.reply(`🧪 **Private test started for ${test.scumName}**\n${privateTestProgressText(test)}\n\nOnly your Steam64 is counted. Nothing will be posted in Main Chat or included in the real weekly totals.`);
    return true;
  }
  if (action === 'reset' || action === 'stop') {
    await stateDelete(privateTestKey(message.guild.id));
    await message.reply(action === 'reset' ? 'Private challenge test reset.' : 'Private challenge test stopped and removed.');
    return true;
  }
  const test = await loadPrivateTest(message.guild.id);
  if (!test) { await message.reply('No private challenge test is active. Use `!challengetest start`.'); return true; }
  await message.reply(`🧪 **Private test ${test.active ? 'in progress' : 'finished'} — ${test.scumName}**\n${privateTestProgressText(test)}`);
  return true;
}

async function processGuild(guild) {
  const { key, challenge } = await loadChallenge(guild.id);
  const data = await ggconGet('/kill-feed/history.json?range=session');
  const events = Array.isArray(data?.events) ? data.events : [];
  const fingerprints = events.map(eventFingerprint);

  // A new weekly challenge starts from the moment Watcher activates it. Existing
  // session history is used as the baseline so last week's kills are not counted.
  if (!challenge.initialized) {
    challenge.seen = fingerprints.slice(-MAX_SEEN);
    challenge.initialized = true;
    challenge.updatedAt = new Date().toISOString();
    await stateSet(key, challenge);
    await announceChallenge(guild, challenge, key);
    return;
  }

  const seen = new Set(Array.isArray(challenge.seen) ? challenge.seen : []);
  let changed = false;
  for (const event of events) {
    const fingerprint = eventFingerprint(event);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    changed = true;
    if (!isPlayerNpcKill(event)) continue;

    const sid = String(event.killer.sid).trim();
    const name = String(event.killer.name || sid).trim();
    const current = challenge.contributors[sid] || { name, count: 0 };
    current.name = name || current.name;
    current.count = Number(current.count || 0) + 1;
    challenge.contributors[sid] = current;
    challenge.progress = Number(challenge.progress || 0) + 1;
  }

  if (changed) {
    challenge.seen = [...seen].slice(-MAX_SEEN);
    challenge.updatedAt = new Date().toISOString();
    await stateSet(key, challenge);
  }
  await announceChallenge(guild, challenge, key);
}

async function poll(bot) {
  if (pollBusy) return;
  pollBusy = true;
  try {
    for (const guild of bot.guilds.cache.values()) {
      await processPrivateTest(guild).catch(err => console.error('❌ Private community challenge test scan failed:', err.message));
      if (!PRIVATE_TEST_ONLY) await processGuild(guild).catch(err => console.error('❌ Community challenge scan failed:', err.message));
    }
  } finally {
    pollBusy = false;
  }
}

function startCommunityChallengeOnBoot(bot) {
  clearInterval(pollTimer);
  poll(bot).catch(() => {});
  pollTimer = setInterval(() => poll(bot).catch(() => {}), POLL_SECONDS * 1000);
}

async function getCommunityChallenge(guildId, dt = nowEt()) {
  if (PRIVATE_TEST_ONLY) return null;
  const { challenge } = await loadChallenge(guildId, dt);
  return challenge;
}

async function postCommunityChallenge(guild) {
  if (PRIVATE_TEST_ONLY) throw new Error('The public community challenge is paused while private testing is enabled.');
  const { challenge } = await loadChallenge(guild.id);
  const channel = await guild.channels.fetch(MAIN_CHAT_ID).catch(() => null);
  if (!channel?.isTextBased()) throw new Error('Main Chat is unavailable.');
  await channel.send({ embeds: [buildChallengeEmbed(challenge, '🎯 Community Challenge Progress')] });
  return challenge;
}

module.exports = {
  startCommunityChallengeOnBoot,
  getCommunityChallenge,
  postCommunityChallenge,
  progressText,
  contributorRows,
  handlePrivateTestCommand,
};
