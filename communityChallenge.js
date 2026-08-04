const crypto = require('crypto');
const { EmbedBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const { DateTime } = require('luxon');
const { ggconGet, getOnlinePlayers, ggconPost } = require('./ggcon');
const { isPopupEventActive } = require('./popupEvents');
const { awardChallengePack } = require('./lottery');

const TZ = process.env.WATCHER_TIMEZONE || 'America/Toronto';
const MAIN_CHAT_ID = process.env.MAIN_CHAT_CHANNEL_ID || '1516269437932670977';
const RUNTIME_TABLE = process.env.WATCHER_RUNTIME_STATE_TABLE || 'watcher_runtime_state';
const POLL_SECONDS = Math.max(20, Number(process.env.WATCHER_COMMUNITY_CHALLENGE_POLL_SECONDS || '30'));
const DEFAULT_TARGET = Math.max(1, Number(process.env.WATCHER_COMMUNITY_CHALLENGE_TARGET || '350'));
const MAX_SEEN = Math.max(1000, Number(process.env.WATCHER_COMMUNITY_CHALLENGE_MAX_SEEN || '5000'));
// Temporary safety switch: this build runs only the private 3-part owner test.
// Set WATCHER_COMMUNITY_CHALLENGE_PRIVATE_TEST_ONLY=false after verification.
const PRIVATE_TEST_ONLY = String(process.env.WATCHER_COMMUNITY_CHALLENGE_PRIVATE_TEST_ONLY || 'false').toLowerCase() === 'true';
const PLAYER_LINKS_TABLE = process.env.WATCHER_PLAYER_LINKS_TABLE || 'watcher_player_links';
const RACE_DURATION_HOURS = Math.min(6, Math.max(1, Number(process.env.WATCHER_KILL_RACE_DURATION_HOURS || '3')));
const RACE_MIN_PLAYERS = Math.max(1, Number(process.env.WATCHER_KILL_RACE_MIN_PLAYERS || '3'));
const RACE_COOLDOWN_MINUTES = Math.max(30, Number(process.env.WATCHER_KILL_RACE_COOLDOWN_MINUTES || '90'));
const RACE_MAX_PER_DAY = Math.max(1, Number(process.env.WATCHER_KILL_RACE_MAX_PER_DAY || '3'));
const RACE_ROTATION = [
  { id: 'puppet_purge', title: 'Puppet Purge', target: 20, category: 'zombie', label: 'puppets/zombies' },
  { id: 'wild_hunt', title: 'Wild Hunt', target: 15, category: 'animal', label: 'animals' },
  { id: 'hostile_cleanup', title: 'Hostile Cleanup', target: 15, category: 'npc', label: 'guards/drifters/hostile NPCs' },
  { id: 'island_sweep', title: 'Island Sweep', target: 25, category: 'all', label: 'mixed NPCs' },
];


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
function raceDayId(dt = nowEt()) { return dt.toISODate(); }
function raceStateKey(guildId) { return `kill_race_active:${guildId}`; }
function raceDailyKey(guildId, day = raceDayId()) { return `kill_race_daily:${guildId}:${day}`; }
function raceHistoryKey(guildId, week = weekId()) { return `kill_race_history:${guildId}:${week}`; }


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

function raceDefinitionForDay(dt = nowEt(), sequence = 0) {
  const base = Math.abs(Math.floor(dt.startOf('day').toSeconds() / 86400));
  return RACE_ROTATION[(base + Number(sequence || 0)) % RACE_ROTATION.length];
}

function raceEventCategory(event) {
  return npcTestCategory(event);
}

function raceMatches(event, category) {
  if (!isPlayerNpcKill(event)) return false;
  if (category === 'all') return true;
  return raceEventCategory(event) === category;
}

function raceRows(race) {
  return Object.entries(race?.players || {})
    .map(([sid, value]) => ({ sid, name: value?.name || sid, count: Number(value?.count || 0) }))
    .filter(row => row.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function raceTimeText(race, dt = nowEt()) {
  const end = DateTime.fromISO(race.endsAt, { zone: 'utc' }).setZone(TZ);
  const mins = Math.max(0, Math.ceil(end.diff(dt, 'minutes').minutes));
  if (mins >= 60) return `${Math.floor(mins / 60)}h ${mins % 60}m remaining`;
  return `${mins}m remaining`;
}

function buildRaceEmbed(race, heading = '🏁 Watcher Kill Race') {
  const leaders = raceRows(race).slice(0, 3);
  const leaderText = leaders.length
    ? leaders.map((row, index) => `${index + 1}. **${row.name}** — ${row.count}/${race.target}`).join('\n')
    : 'No qualifying kills yet.';
  const status = race.status === 'won'
    ? `🏆 **${race.winner?.name || 'Winner'}** reached ${race.target}/${race.target}`
    : race.status === 'expired'
      ? '⌛ Challenge expired without a winner.'
      : `First player to eliminate **${race.target} ${race.label}** wins a random lottery pack.\n${raceTimeText(race)}`;
  return new EmbedBuilder()
    .setTitle(`${heading} — ${race.title}`)
    .setDescription(status)
    .addFields({ name: 'Current Leaders', value: leaderText })
    .setFooter({ text: `Starts automatically when at least ${RACE_MIN_PLAYERS} players are online. Trivia continues independently.` });
}

async function loadRace(guildId) {
  const key = raceStateKey(guildId);
  return { key, race: await stateGet(key).catch(() => null) };
}

async function loadRaceDaily(guildId, dt = nowEt()) {
  const key = raceDailyKey(guildId, raceDayId(dt));
  const daily = await stateGet(key).catch(() => null) || { day: raceDayId(dt), started: 0, lastEndedAt: null };
  return { key, daily };
}

async function saveRaceHistory(guildId, race) {
  const key = raceHistoryKey(guildId, weekId(DateTime.fromISO(race.startedAt, { zone: 'utc' }).setZone(TZ)));
  const history = await stateGet(key).catch(() => null) || { races: [] };
  const races = Array.isArray(history.races) ? history.races.filter(item => item.id !== race.id) : [];
  races.push({
    id: race.id, day: race.day, title: race.title, target: race.target, category: race.category,
    status: race.status, winner: race.winner || null, endedAt: race.endedAt || null,
    leaders: raceRows(race).slice(0, 3), prize: race.prize || null,
  });
  history.races = races.slice(-14);
  await stateSet(key, history);
}

function raceScumText(race, heading) {
  const leader = raceRows(race)[0];
  const time = raceTimeText(race).replace(/[*_`~]/g, '');
  if (race.status === 'won') {
    return `[Watcher] ${heading}: ${race.winner?.name || 'A survivor'} won ${race.title} with ${race.target}/${race.target}. Prize: ${race.prize?.name || 'lottery pack'}.`;
  }
  if (race.status === 'expired') {
    return `[Watcher] ${heading}: ${race.title} ended.${leader ? ` Top survivor: ${leader.name} ${leader.count}/${race.target}.` : ' No qualifying kills were recorded.'}`;
  }
  return `[Watcher] ${heading}: First to ${race.target} ${race.label} wins a random lottery pack.${leader ? ` Leader: ${leader.name} ${leader.count}/${race.target}.` : ''} ${time}`;
}

async function sendRacePost(guild, race, heading) {
  // Trivia owns the public attention window. Counting continues, but both the
  // Discord and SCUM announcements wait until the active trivia question ends.
  if (isPopupEventActive()) return false;
  const channel = await guild.channels.fetch(MAIN_CHAT_ID).catch(() => null);
  if (!channel?.isTextBased()) return false;
  await channel.send({ embeds: [buildRaceEmbed(race, heading)] });
  await ggconPost('/command', { command: `#Broadcast Cyan ${raceScumText(race, heading)}` }, { requireConfirmed: true });
  return true;
}

async function createRace(guild, dt = nowEt(), forcedDefinition = null) {
  const { key: dailyKey, daily } = await loadRaceDaily(guild.id, dt);
  const definition = forcedDefinition || raceDefinitionForDay(dt, daily.started);
  const sequence = Number(daily.started || 0) + 1;
  const data = await ggconGet('/kill-feed/history.json?range=session');
  const events = Array.isArray(data?.events) ? data.events : [];
  const start = dt;
  const race = {
    version: 1,
    id: `${raceDayId(dt)}:${sequence}:${definition.id}`,
    guildId: String(guild.id),
    day: raceDayId(dt),
    title: definition.title,
    target: definition.target,
    category: definition.category,
    label: definition.label,
    status: 'active',
    players: {},
    seen: events.map(eventFingerprint).slice(-MAX_SEEN),
    startedAt: start.toUTC().toISO(),
    endsAt: start.plus({ hours: RACE_DURATION_HOURS }).toUTC().toISO(),
    startPosted: false,
    oneHourPosted: false,
    finalPosted: false,
    resultPosted: false,
    winner: null,
    prize: null,
    updatedAt: new Date().toISOString(),
  };
  const key = raceStateKey(guild.id);
  daily.started = sequence;
  daily.lastStartedAt = race.startedAt;
  await stateSet(dailyKey, daily);
  await stateSet(key, race);
  return { key, race };
}

async function maybeStartOnlineRace(guild, dt = nowEt()) {
  const { key, race } = await loadRace(guild.id);
  if (race?.status === 'active') return { key, race };

  const { key: dailyKey, daily } = await loadRaceDaily(guild.id, dt);
  if (Number(daily.started || 0) >= RACE_MAX_PER_DAY) return { key, race: null };

  if (race && race.status !== 'active') {
    if (!race.resultPosted) return { key, race };
    const ended = DateTime.fromISO(race.endedAt || race.endsAt, { zone: 'utc' }).setZone(TZ);
    if (dt < ended.plus({ minutes: RACE_COOLDOWN_MINUTES })) return { key, race: null };
    await stateDelete(key).catch(() => {});
  } else if (daily.lastEndedAt) {
    const ended = DateTime.fromISO(daily.lastEndedAt, { zone: 'utc' }).setZone(TZ);
    if (dt < ended.plus({ minutes: RACE_COOLDOWN_MINUTES })) return { key, race: null };
  }

  const online = await getOnlinePlayers().catch(() => []);
  if (online.length < RACE_MIN_PLAYERS) return { key, race: null };
  return createRace(guild, dt);
}

async function processRace(guild) {
  const dt = nowEt();
  let { key, race } = await maybeStartOnlineRace(guild, dt);
  if (!race) return;

  const data = await ggconGet('/kill-feed/history.json?range=session');
  const events = Array.isArray(data?.events) ? data.events : [];
  const seen = new Set(Array.isArray(race.seen) ? race.seen : []);
  let changed = false;

  if (race.status === 'active') {
    for (const event of events) {
      const fingerprint = eventFingerprint(event);
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      changed = true;
      if (!raceMatches(event, race.category)) continue;
      const sid = String(event.killer.sid || '').trim();
      const name = String(event.killer.name || sid).trim();
      const current = race.players[sid] || { name, count: 0 };
      current.name = name || current.name;
      current.count = Number(current.count || 0) + 1;
      race.players[sid] = current;
      if (current.count >= race.target && race.status === 'active') {
        race.status = 'won';
        race.winner = { sid, name: current.name, count: current.count };
        race.endedAt = new Date().toISOString();
        try {
          const award = await awardChallengePack(guild.id, sid);
          race.prize = { id: award.pack.id, name: award.pack.name };
        } catch (err) {
          race.prize = { name: 'Lottery pack pending manual delivery', error: err.message };
          console.error('❌ Kill race prize delivery failed:', err.message);
        }
        break;
      }
    }
  }

  race.seen = [...seen].slice(-MAX_SEEN);
  const end = DateTime.fromISO(race.endsAt, { zone: 'utc' }).setZone(TZ);
  const start = DateTime.fromISO(race.startedAt, { zone: 'utc' }).setZone(TZ);
  if (race.status === 'active' && dt >= end) {
    race.status = 'expired';
    race.endedAt = new Date().toISOString();
    changed = true;
  }

  if (!race.startPosted && await sendRacePost(guild, race, '🏁 New 3-Hour Kill Race')) {
    race.startPosted = true;
    changed = true;
  }
  if (race.status === 'active' && !race.oneHourPosted && dt >= start.plus({ hours: 1 })
      && await sendRacePost(guild, race, '⏱️ Kill Race Update')) {
    race.oneHourPosted = true;
    changed = true;
  }
  if (race.status === 'active' && !race.finalPosted && dt >= end.minus({ minutes: 30 })
      && await sendRacePost(guild, race, '⚠️ 30 Minutes Remaining')) {
    race.finalPosted = true;
    changed = true;
  }
  if (race.status !== 'active' && !race.resultPosted
      && await sendRacePost(guild, race, race.status === 'won' ? '🏆 Kill Race Complete' : '⌛ Kill Race Ended')) {
    race.resultPosted = true;
    changed = true;
  }

  if (changed) {
    race.updatedAt = new Date().toISOString();
    await stateSet(key, race);
    if (race.status !== 'active') {
      await saveRaceHistory(guild.id, race).catch(() => {});
      const { key: dailyKey, daily } = await loadRaceDaily(guild.id, dt);
      daily.lastEndedAt = race.endedAt || new Date().toISOString();
      await stateSet(dailyKey, daily).catch(() => {});
    }
  }
}

async function getKillRaceSummary(guildId, dt = nowEt()) {
  const { race } = await loadRace(guildId, dt);
  const history = await stateGet(raceHistoryKey(guildId, weekId(dt))).catch(() => null);
  return { race, history: Array.isArray(history?.races) ? history.races : [] };
}

async function handleRaceChallengeCommand(message) {
  if (!message.guild || !message.content?.toLowerCase().startsWith('!racechallenge')) return false;
  const isStaff = !!message.member?.roles?.cache?.some(r => ['Owner', 'Owners', 'Admin'].includes(r.name));
  if (!isStaff) { await message.reply('Kill race controls are for staff only.'); return true; }
  const parts = message.content.trim().split(/\s+/);
  const action = String(parts[1] || 'status').toLowerCase();
  if (action === 'start') {
    const existing = (await loadRace(message.guild.id)).race;
    if (existing?.status === 'active') { await message.reply('A kill race is already active.'); return true; }
    const type = String(parts[2] || '').toLowerCase();
    const definition = RACE_ROTATION.find(item => item.id.includes(type) || item.category === type) || raceDefinitionForDay(nowEt(), (await loadRaceDaily(message.guild.id)).daily.started);
    const { race } = await createRace(message.guild, nowEt(), definition);
    await message.reply(`Kill race started: **${race.title}** — first to ${race.target} ${race.label}.`);
    return true;
  }
  if (action === 'stop') {
    const { key, race } = await loadRace(message.guild.id);
    if (!race?.status || race.status !== 'active') { await message.reply('No active kill race.'); return true; }
    race.status = 'expired'; race.endedAt = new Date().toISOString(); race.updatedAt = race.endedAt;
    await stateSet(key, race); await saveRaceHistory(message.guild.id, race).catch(() => {});
    await message.reply('Kill race stopped.'); return true;
  }
  const { race } = await loadRace(message.guild.id);
  if (!race) { await message.reply('No kill race has run today.'); return true; }
  await message.reply({ embeds: [buildRaceEmbed(race, '🏁 Kill Race Status')] });
  return true;
}


async function getKillRaceAdminStatus(guildId) {
  const { race } = await loadRace(guildId);
  return {
    race: race || null,
    rotation: RACE_ROTATION.map(item => ({ ...item })),
    durationHours: RACE_DURATION_HOURS,
  };
}

async function startKillRaceFromPortal(guild, type = '') {
  const existing = (await loadRace(guild.id)).race;
  if (existing?.status === 'active') throw new Error(`A kill race is already active: ${existing.title}.`);
  const normalized = String(type || '').trim().toLowerCase();
  const definition = RACE_ROTATION.find(item => item.id === normalized || item.category === normalized || item.id.includes(normalized))
    || raceDefinitionForDay(nowEt(), (await loadRaceDaily(guild.id)).daily.started);
  const { race } = await createRace(guild, nowEt(), definition);
  // The normal processor performs the dual Discord + in-game announcement and
  // will defer it safely if trivia is active.
  await processRace(guild);
  return { ok: true, race: (await loadRace(guild.id)).race || race };
}

async function stopKillRaceFromPortal(guild) {
  const { key, race } = await loadRace(guild.id);
  if (!race || race.status !== 'active') throw new Error('No active kill race.');
  race.status = 'expired';
  race.endedAt = new Date().toISOString();
  race.updatedAt = race.endedAt;
  await stateSet(key, race);
  await processRace(guild);
  return { ok: true, race: (await loadRace(guild.id)).race || race };
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
      await processRace(guild).catch(err => console.error('❌ Kill race scan failed:', err.message));
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
  handleRaceChallengeCommand,
  getKillRaceSummary,
  buildRaceEmbed,
  getKillRaceAdminStatus,
  startKillRaceFromPortal,
  stopKillRaceFromPortal,
};
