const { createClient } = require("@supabase/supabase-js");
const { triggerBonusLottery } = require("./lottery");

const DEFAULT_SERVER_BASE_URL = "https://ggcon.gghost.games/s/2788404";
const RUNTIME_STATE_TABLE = process.env.WATCHER_RUNTIME_STATE_TABLE || "watcher_runtime_state";
const PLAYER_LINKS_TABLE = process.env.WATCHER_PLAYER_LINKS_TABLE || "watcher_player_links";
const STATE_KEY = "popup_events_config";
const PREFIX = "[The Watcher]";

const CHECK_MINUTES = Math.max(1, Number(process.env.POPUP_ELIGIBILITY_CHECK_MINUTES || "15"));
const CHAT_SCAN_SECONDS = Math.max(5, Number(process.env.POPUP_CHAT_SCAN_SECONDS || "10"));
const MIN_ELIGIBLE = Math.max(1, Number(process.env.POPUP_MIN_ELIGIBLE_PLAYERS || "4"));
const QUICK_COOLDOWN_MS = Math.max(1, Number(process.env.POPUP_QUICK_COOLDOWN_MINUTES || "60")) * 60_000;
const TASK_COOLDOWN_MS = Math.max(1, Number(process.env.POPUP_TASK_COOLDOWN_MINUTES || "120")) * 60_000;
const SHARED_QUIET_MS = Math.max(0, Number(process.env.POPUP_SHARED_QUIET_MINUTES || "10")) * 60_000;
const RESTART_BLOCK_MINUTES = Math.max(0, Number(process.env.POPUP_RESTART_BLOCK_MINUTES || "20"));
const QUICK_CHANCE = clampProbability(process.env.POPUP_QUICK_CHANCE || "0.20");
const TASK_CHANCE = clampProbability(process.env.POPUP_TASK_CHANCE || "0.10");
const STAFF_ROLE_NAMES = new Set(["owner", "owners", "admin", "trial admin"]);

let dbClient = null;
let schedulerTimer = null;
let chatTimer = null;
let killTimer = null;
let tickRunning = false;
let chatRunning = false;
let killRunning = false;
let activeEvent = null;
let botRef = null;

const QUICK_QUESTIONS = [
  {
    prompt: "What is required for the admin screwdriver trade? 1) 35 red screwdrivers 2) 25 toolboxes 3) 50 batteries",
    correct: 1,
  },
  {
    prompt: "Which role is the normal Outpost X player role? 1) Fresh Meat 2) The Exiles 3) Survivors",
    correct: 2,
  },
  {
    prompt: "What is the Outpost X server type? 1) PvE 2) PvP only 3) Battle Royale",
    correct: 1,
  },
  {
    prompt: "What should players open when they need staff help? 1) A ticket 2) A public argument 3) A vehicle claim",
    correct: 1,
  },
];

const TEXT_QUESTIONS = [
  { prompt: "Unscramble this SCUM item: RIRWECSDREV", answers: ["screwdriver"] },
  { prompt: "Unscramble this SCUM item: XOLTOOB", answers: ["toolbox", "tool box"] },
  { prompt: "I open locks, have limited uses, and come in several colors. What am I?", answers: ["screwdriver", "a screwdriver"] },
];

function clampProbability(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function getDb() {
  if (dbClient) return dbClient;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) throw new Error("Supabase is not configured.");
  dbClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, { auth: { persistSession: false } });
  return dbClient;
}

function serverBaseUrl() {
  return String(process.env.GGCON_BASE_URL || DEFAULT_SERVER_BASE_URL).replace(/\/+$/, "");
}

function serverPassword() {
  const password = process.env.GGCON_PASSWORD;
  if (!password) throw new Error("GGCON_PASSWORD is not configured.");
  return password;
}

async function serverGet(path) {
  const res = await fetch(`${serverBaseUrl()}${path}`, {
    headers: { Accept: "application/json", "X-Password": serverPassword() },
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok || data?.ok === false) throw new Error(data?.message || data?.error || `Server GET failed: ${res.status}`);
  return data;
}

async function serverPost(path, body = {}) {
  const res = await fetch(`${serverBaseUrl()}${path}`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "X-Password": serverPassword() },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok || data?.ok === false || data?.accepted === false) {
    throw new Error(data?.message || data?.error || `Server POST failed: ${res.status}`);
  }
  return data || { ok: true };
}

async function sendGame(text, steamId = null) {
  const body = { text: `${PREFIX} ${String(text || "").trim()}`, type: "ServerMessage" };
  if (steamId) body.steamId = String(steamId);
  return serverPost("/message", body);
}

async function loadState() {
  const { data, error } = await getDb().from(RUNTIME_STATE_TABLE).select("value").eq("key", STATE_KEY).maybeSingle();
  if (error) throw error;
  return normalizeState(data?.value || {});
}

async function saveState(state) {
  const value = normalizeState(state || {});
  const { error } = await getDb().from(RUNTIME_STATE_TABLE).upsert(
    { key: STATE_KEY, value, updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );
  if (error) throw error;
  return value;
}

function normalizeState(value) {
  return {
    enabled: value.enabled === true,
    guildId: value.guildId || null,
    logChannelId: value.logChannelId || null,
    lastQuickEndedAt: Number(value.lastQuickEndedAt || 0),
    lastTaskEndedAt: Number(value.lastTaskEndedAt || 0),
    lastAnyEndedAt: Number(value.lastAnyEndedAt || 0),
    chatCursor: Number(value.chatCursor || 0),
    killCursor: Number(value.killCursor || 0),
    lastResult: value.lastResult || null,
  };
}

function playerSteamId(player) {
  return String(player?.userId || player?.steamId || player?.steam_id || player?.id || "").trim();
}

function playerName(player) {
  return String(player?.characterName || player?.name || player?.steamName || playerSteamId(player) || "Unknown").trim();
}

async function getOnlinePlayers() {
  const data = await serverGet("/players.json");
  return Array.isArray(data?.players) ? data.players : [];
}

async function getStaffSteamIds(bot, guildId) {
  const staff = new Set();
  if (!guildId) return staff;
  const guild = await bot.guilds.fetch(String(guildId)).catch(() => null);
  if (!guild) return staff;
  const { data, error } = await getDb()
    .from(PLAYER_LINKS_TABLE)
    .select("steam_id,discord_id")
    .eq("guild_id", String(guildId))
    .not("steam_id", "is", null)
    .not("discord_id", "is", null)
    .limit(2500);
  if (error) throw error;

  for (const row of data || []) {
    const member = await guild.members.fetch(String(row.discord_id)).catch(() => null);
    if (!member) continue;
    const isStaff = member.roles?.cache?.some((role) => STAFF_ROLE_NAMES.has(String(role.name || "").toLowerCase()));
    if (isStaff) staff.add(String(row.steam_id));
  }
  return staff;
}

async function getEligibleOnline(bot, guildId) {
  const [players, staffIds] = await Promise.all([getOnlinePlayers(), getStaffSteamIds(bot, guildId)]);
  return players
    .map((player) => ({ player, steamId: playerSteamId(player), name: playerName(player) }))
    .filter((entry) => entry.steamId && !staffIds.has(entry.steamId));
}

function isStaffMember(member) {
  return !!member?.roles?.cache?.some((role) => STAFF_ROLE_NAMES.has(String(role.name || "").toLowerCase()));
}

function pick(values) {
  return values[Math.floor(Math.random() * values.length)];
}

function randomId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeAnswer(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ").replace(/[.!?]+$/g, "");
}

function parseChatIdentity(line) {
  const text = String(line || "");
  const match = text.match(/'?(\d{15,20}):([^('\n]+)\((\d+)\)'?/);
  if (!match) return null;
  return { steamId: match[1], name: match[2].trim(), profileId: match[3] };
}

function parseCommand(line) {
  const text = String(line || "");
  const match = text.match(/(?:^|\s)!(answer|join|a|b|c|one|two|three|1|2|3)(?:\s+([^\r\n]*))?/i);
  if (!match) return null;
  return { command: match[1].toLowerCase(), value: String(match[2] || "").trim() };
}

function answerNumber(command) {
  const map = { "1": 1, a: 1, one: 1, "2": 2, b: 2, two: 2, "3": 3, c: 3, three: 3 };
  return map[command] || null;
}

function restartHours() {
  return String(process.env.GGCON_CARGO_SCHEDULE_HOURS || "0,4,8,12,16,20")
    .split(/[\s,]+/)
    .map((v) => Number(v))
    .filter((v) => Number.isInteger(v) && v >= 0 && v <= 23);
}

function minutesToNearestRestart(now = new Date()) {
  const hours = restartHours();
  if (!hours.length) return null;
  const timeZone = process.env.WATCHER_LOTTERY_TIMEZONE || "America/Toronto";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now).reduce((out, part) => ({ ...out, [part.type]: part.value }), {});
  const currentMinutes = Number(parts.hour) * 60 + Number(parts.minute);
  let best = Infinity;
  for (const hour of hours) {
    const target = hour * 60;
    const forward = (target - currentMinutes + 1440) % 1440;
    best = Math.min(best, forward);
  }
  return best;
}

function cooldownRemaining(state, type) {
  const now = Date.now();
  const category = type === "quick"
    ? Math.max(0, QUICK_COOLDOWN_MS - (now - state.lastQuickEndedAt))
    : Math.max(0, TASK_COOLDOWN_MS - (now - state.lastTaskEndedAt));
  const shared = Math.max(0, SHARED_QUIET_MS - (now - state.lastAnyEndedAt));
  return Math.max(category, shared);
}

function formatRemaining(ms) {
  if (ms <= 0) return "ready";
  const minutes = Math.ceil(ms / 60_000);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

async function logToDiscord(bot, state, text) {
  if (!state?.logChannelId) return;
  const channel = await bot.channels.fetch(String(state.logChannelId)).catch(() => null);
  if (channel?.send) await channel.send(text).catch(() => {});
}

function chooseReward() {
  const roll = Math.random();
  if (roll < 0.30) return { type: "fame", amount: 25, label: "25 Fame Points" };
  if (roll < 0.58) return { type: "cash", amount: 500, label: "$500 bank credit" };
  if (roll < 0.83) return { type: "cash", amount: 1000, label: "$1,000 bank credit" };
  if (roll < 0.95) return { type: "bonus_lottery", amount: 0, label: "an extra small lottery" };
  return { type: "none", amount: 0, label: "nothing" };
}

async function deliverReward(event, winner, state) {
  const reward = event.reward || chooseReward();
  if (reward.type === "fame") {
    await serverPost(`/players/${encodeURIComponent(winner.steamId)}/fame`, { action: "change", amount: reward.amount });
  } else if (reward.type === "cash") {
    await serverPost(`/players/${encodeURIComponent(winner.steamId)}/currency`, { action: "change", amount: reward.amount });
  } else if (reward.type === "bonus_lottery") {
    await triggerBonusLottery(botRef, state.guildId);
  }
  return reward;
}

async function finishEvent(result = {}) {
  const event = activeEvent;
  if (!event) return;
  if (event.timeout) clearTimeout(event.timeout);
  activeEvent = null;

  const state = await loadState();
  const now = Date.now();
  if (event.category === "quick") state.lastQuickEndedAt = now;
  if (event.category === "task") state.lastTaskEndedAt = now;
  state.lastAnyEndedAt = now;
  state.lastResult = { eventId: event.id, type: event.type, endedAt: new Date(now).toISOString(), ...result };
  await saveState(state);
}

async function completeWithWinner(winner, extra = {}) {
  const event = activeEvent;
  if (!event || event.finished) return;
  event.finished = true;
  const state = await loadState();
  let reward;
  try {
    reward = await deliverReward(event, winner, state);
    if (reward.type === "bonus_lottery") {
      await sendGame(`${winner.name} selected the signal that triggered an extra lottery.`);
    } else if (reward.type === "none") {
      await sendGame(`${winner.name} was selected. Reward: nothing. The choice was statistically valid.`);
    } else {
      await sendGame(`${winner.name} wins ${reward.label}.`);
    }
    await logToDiscord(botRef, state, `✅ **Pop-Up Event Completed**\nType: ${event.type}\nWinner: **${winner.name}** (${winner.steamId})\nReward: ${reward.label}`);
    await finishEvent({ status: "completed", winner, reward, ...extra });
  } catch (err) {
    await sendGame(`${winner.name} won, but reward delivery failed. Staff has been notified.`).catch(() => {});
    await logToDiscord(botRef, state, `⚠️ **Pop-Up Reward Failed**\nType: ${event.type}\nWinner: **${winner.name}** (${winner.steamId})\nIntended reward: ${event.reward?.label || "random reward"}\nError: ${err.message}`);
    await finishEvent({ status: "reward_failed", winner, error: err.message, ...extra });
  }
}

async function expireQuickEvent() {
  const event = activeEvent;
  if (!event || event.category !== "quick" || event.finished) return;
  event.finished = true;

  if (event.type === "mystery") {
    const choices = [1, 2, 3];
    const winningChoice = pick(choices);
    const candidates = [...event.entries.values()].filter((entry) => entry.choice === winningChoice);
    if (!candidates.length) {
      await sendGame(`Signal ${winningChoice} contained the reward, but nobody selected it. The reward was left unclaimed.`);
      await finishEvent({ status: "unclaimed", winningChoice, entries: event.entries.size });
      return;
    }
    const winner = pick(candidates);
    event.finished = false;
    await completeWithWinner(winner, { winningChoice, entries: event.entries.size });
    return;
  }

  await sendGame("Time expired. No acceptable answer was received.");
  await finishEvent({ status: "expired" });
}

async function startQuickEvent({ forceType = null } = {}) {
  if (activeEvent) throw new Error("Another pop-up event is already active.");
  const type = forceType || pick(["multiple_choice", "text_answer", "mystery"]);
  const event = {
    id: randomId(), category: "quick", type, startedAt: Date.now(), finished: false,
    entries: new Map(), answered: new Set(), reward: chooseReward(),
  };
  activeEvent = event;

  if (type === "multiple_choice") {
    const question = pick(QUICK_QUESTIONS);
    event.correct = question.correct;
    event.timeout = setTimeout(() => expireQuickEvent().catch(console.error), 120_000);
    await sendGame(`RAPID ASSESSMENT: ${question.prompt}. Reply !1, !2 or !3. !a, !b or !c also work. First correct answer wins. You have 2 minutes to answer.`);
  } else if (type === "text_answer") {
    const question = pick(TEXT_QUESTIONS);
    event.answers = question.answers.map(normalizeAnswer);
    event.timeout = setTimeout(() => expireQuickEvent().catch(console.error), 120_000);
    await sendGame(`ITEM IDENTIFICATION: ${question.prompt}. Reply with !answer followed by your answer. Example: !answer screwdriver. First correct answer wins. You have 2 minutes to answer.`);
  } else {
    event.timeout = setTimeout(() => expireQuickEvent().catch(console.error), 120_000);
    await sendGame("THREE SIGNALS DETECTED: 1) Signal One 2) Signal Two 3) Signal Three. Choose with !1, !2 or !3. !one, !two or !three also work. One choice per player. You have 2 minutes to choose.");
  }

  return event;
}

async function startTaskEvent({ forceType = null } = {}) {
  if (activeEvent) throw new Error("Another pop-up event is already active.");
  const type = forceType || pick(["most_kills", "community_kills"]);
  const durationMinutes = type === "community_kills" ? 20 : 15;
  const event = {
    id: randomId(), category: "task", type, phase: "registration", startedAt: Date.now(), finished: false,
    participants: new Map(), scores: new Map(), target: type === "community_kills" ? 40 : null,
    durationMinutes, reward: chooseReward(),
  };
  activeEvent = event;

  if (type === "community_kills") {
    await sendGame(`COMMUNITY DIRECTIVE: Registered players must eliminate ${event.target} puppets in ${durationMinutes} minutes. Type !join within 2 minutes. One contributor will be randomly rewarded if the target is completed.`);
  } else {
    await sendGame(`EXTERMINATION WINDOW: The registered player with the most puppet kills in ${durationMinutes} minutes wins. Type !join within 2 minutes.`);
  }

  event.registrationTimeout = setTimeout(() => beginTask().catch(console.error), 120_000);
  return event;
}

async function beginTask() {
  const event = activeEvent;
  if (!event || event.category !== "task" || event.finished || event.phase !== "registration") return;
  if (event.registrationTimeout) clearTimeout(event.registrationTimeout);
  if (event.participants.size === 0) {
    await sendGame("Task cancelled. No eligible players joined.");
    await finishEvent({ status: "no_participants" });
    return;
  }
  event.phase = "active";
  event.taskStartedAt = Date.now();
  const baselineState = await loadState();
  await saveState({ ...baselineState, killCursor: event.taskStartedAt });
  await sendGame(`Registration closed. ${event.participants.size} player${event.participants.size === 1 ? "" : "s"} joined. The task is now active for ${event.durationMinutes} minutes.`);
  event.timeout = setTimeout(() => finishTask().catch(console.error), event.durationMinutes * 60_000);
}

async function finishTask() {
  const event = activeEvent;
  if (!event || event.category !== "task" || event.finished) return;
  event.finished = true;
  const scores = [...event.participants.values()].map((entry) => ({ ...entry, kills: event.scores.get(entry.steamId) || 0 }));

  if (event.type === "community_kills") {
    const total = scores.reduce((sum, entry) => sum + entry.kills, 0);
    const contributors = scores.filter((entry) => entry.kills > 0);
    if (total < event.target || contributors.length === 0) {
      await sendGame(`Community directive failed. Final progress: ${total}/${event.target} puppet kills.`);
      await finishEvent({ status: "failed", total, target: event.target });
      return;
    }
    event.finished = false;
    await completeWithWinner(pick(contributors), { total, target: event.target });
    return;
  }

  const high = Math.max(0, ...scores.map((entry) => entry.kills));
  if (high <= 0) {
    await sendGame("Extermination window closed. No qualifying puppet kills were recorded.");
    await finishEvent({ status: "no_kills" });
    return;
  }
  const tied = scores.filter((entry) => entry.kills === high);
  const winner = pick(tied);
  event.finished = false;
  await sendGame(tied.length > 1 ? `The task ended in a ${tied.length}-way tie at ${high} kills. The Watcher selected ${winner.name}.` : `${winner.name} recorded the most puppet kills: ${high}.`);
  await completeWithWinner(winner, { highScore: high, tied: tied.length });
}

async function fetchChatLogsSince(since) {
  const params = new URLSearchParams({ since: String(Math.max(0, Number(since || 0))), sources: "chat" });
  return serverGet(`/logs?${params.toString()}`);
}

async function scanChat() {
  if (chatRunning) return;
  chatRunning = true;
  try {
    const state = await loadState();
    if (!state.enabled || !state.guildId) return;
    const since = state.chatCursor || Math.max(0, Date.now() - 120_000);
    const data = await fetchChatLogsSince(since);
    const lines = Array.isArray(data?.lines) ? data.lines.slice().sort((a, b) => Number(a?.t || 0) - Number(b?.t || 0)) : [];
    const next = Number(data?.next || lines.reduce((max, row) => Math.max(max, Number(row?.t || 0)), since) || Date.now());
    const event = activeEvent;

    if (event) {
      const [staffIds, onlinePlayers] = await Promise.all([
        getStaffSteamIds(botRef, state.guildId),
        getOnlinePlayers().catch(() => []),
      ]);
      const onlineIds = new Set(onlinePlayers.map(playerSteamId).filter(Boolean));
      for (const row of lines) {
        if (!activeEvent || activeEvent.id !== event.id || event.finished) break;
        const identity = parseChatIdentity(row?.line);
        const parsed = parseCommand(row?.line);
        if (!identity || !parsed || staffIds.has(identity.steamId)) continue;
        if (!onlineIds.has(identity.steamId)) continue;

        if (event.category === "quick") {
          if (event.type === "multiple_choice") {
            const choice = answerNumber(parsed.command);
            if (!choice || event.answered.has(identity.steamId)) continue;
            event.answered.add(identity.steamId);
            if (choice === event.correct) await completeWithWinner(identity);
          } else if (event.type === "text_answer") {
            if (parsed.command !== "answer" || event.answered.has(identity.steamId)) continue;
            event.answered.add(identity.steamId);
            if (event.answers.includes(normalizeAnswer(parsed.value))) await completeWithWinner(identity);
          } else if (event.type === "mystery") {
            const choice = answerNumber(parsed.command);
            if (!choice || event.entries.has(identity.steamId)) continue;
            event.entries.set(identity.steamId, { ...identity, choice });
          }
        } else if (event.category === "task" && event.phase === "registration" && parsed.command === "join") {
          if (event.participants.has(identity.steamId)) {
            await sendGame(`${identity.name}, you are already registered.`, identity.steamId).catch(() => {});
          } else {
            event.participants.set(identity.steamId, identity);
            event.scores.set(identity.steamId, 0);
            await sendGame(`${identity.name} joined the task.`).catch(() => {});
          }
        }
      }
    }

    await saveState({ ...state, chatCursor: next });
  } catch (err) {
    console.error("❌ Pop-up chat scan failed:", err.message);
  } finally {
    chatRunning = false;
  }
}

function isQualifyingPuppetKill(event) {
  const type = String(event?.type || "").toLowerCase();
  const killerSteam = String(event?.killer?.sid || event?.killer?.steamId || event?.killer?.steam_id || "");
  const victimSteam = String(event?.victim?.sid || event?.victim?.steamId || event?.victim?.steam_id || "");
  if (!killerSteam || victimSteam) return false;
  if (type === "npc") return true;
  const victim = `${event?.victim?.name || ""} ${event?.cat || ""}`.toLowerCase();
  return /puppet|zombie|razor|brener|beeper/.test(victim);
}

async function scanKills() {
  if (killRunning) return;
  killRunning = true;
  try {
    const event = activeEvent;
    if (!event || event.category !== "task" || event.phase !== "active" || event.finished) return;
    const state = await loadState();
    const cursor = state.killCursor || Math.max(0, event.taskStartedAt - 5000);
    const data = await serverGet(`/kill-feed/events.json?since=${encodeURIComponent(String(cursor))}`);
    const events = Array.isArray(data?.events) ? data.events : [];
    const next = Number(data?.next || events.reduce((max, row) => Math.max(max, Number(row?.t || 0)), cursor));
    let totalChanged = false;

    for (const kill of events) {
      if (!isQualifyingPuppetKill(kill)) continue;
      const steamId = String(kill?.killer?.sid || kill?.killer?.steamId || kill?.killer?.steam_id || "");
      if (!event.participants.has(steamId)) continue;
      event.scores.set(steamId, (event.scores.get(steamId) || 0) + 1);
      totalChanged = true;
    }

    await saveState({ ...state, killCursor: next });

    if (event.type === "community_kills" && totalChanged) {
      const total = [...event.scores.values()].reduce((sum, n) => sum + n, 0);
      const milestones = [0.25, 0.5, 0.75].map((ratio) => Math.ceil(event.target * ratio));
      event.postedMilestones ||= new Set();
      for (const milestone of milestones) {
        if (total >= milestone && !event.postedMilestones.has(milestone)) {
          event.postedMilestones.add(milestone);
          await sendGame(`Community directive progress: ${Math.min(total, event.target)}/${event.target} puppet kills.`);
        }
      }
      if (total >= event.target && !event.finished) {
        await finishTask();
      }
    }
  } catch (err) {
    console.error("❌ Pop-up kill scan failed:", err.message);
  } finally {
    killRunning = false;
  }
}

async function canLaunch(bot, state, category, { force = false } = {}) {
  if (!state.enabled && !force) return { ok: false, reason: "disabled" };
  if (!state.guildId) return { ok: false, reason: "not configured" };
  if (activeEvent) return { ok: false, reason: "another event is active" };
  if (!force && cooldownRemaining(state, category) > 0) return { ok: false, reason: "cooldown" };
  const restartMinutes = minutesToNearestRestart();
  if (!force && restartMinutes !== null && restartMinutes <= RESTART_BLOCK_MINUTES) return { ok: false, reason: "restart window" };
  const eligible = await getEligibleOnline(bot, state.guildId);
  if (eligible.length < (force ? 1 : MIN_ELIGIBLE)) return { ok: false, reason: `only ${eligible.length} eligible players online`, eligible };
  return { ok: true, eligible };
}

async function schedulerTick(bot) {
  if (tickRunning) return;
  tickRunning = true;
  try {
    const state = await loadState();
    if (!state.enabled || !state.guildId || activeEvent) return;
    const quickReady = cooldownRemaining(state, "quick") <= 0;
    const taskReady = cooldownRemaining(state, "task") <= 0;
    if (!quickReady && !taskReady) return;
    const eligible = await getEligibleOnline(bot, state.guildId);
    if (eligible.length < MIN_ELIGIBLE) return;
    const restartMinutes = minutesToNearestRestart();
    if (restartMinutes !== null && restartMinutes <= RESTART_BLOCK_MINUTES) return;

    const roll = Math.random();
    if (taskReady && roll < TASK_CHANCE) {
      await startTaskEvent();
      await logToDiscord(bot, state, `🎯 **Timed Task Event Started**\nEligible non-staff online: ${eligible.length}`);
    } else if (quickReady && roll < TASK_CHANCE + QUICK_CHANCE) {
      await startQuickEvent();
      await logToDiscord(bot, state, `💬 **Quick Chat Event Started**\nEligible non-staff online: ${eligible.length}`);
    }
  } catch (err) {
    console.error("❌ Pop-up event scheduler failed:", err.message);
  } finally {
    tickRunning = false;
  }
}

function startTimers(bot) {
  botRef = bot;
  if (schedulerTimer) clearInterval(schedulerTimer);
  if (chatTimer) clearInterval(chatTimer);
  if (killTimer) clearInterval(killTimer);
  schedulerTimer = setInterval(() => schedulerTick(bot), CHECK_MINUTES * 60_000);
  chatTimer = setInterval(() => scanChat(), CHAT_SCAN_SECONDS * 1000);
  killTimer = setInterval(() => scanKills(), 15_000);
  schedulerTick(bot).catch(() => {});
  scanChat().catch(() => {});
}

async function startPopupEventsOnBoot(bot) {
  botRef = bot;
  const state = await loadState().catch((err) => {
    console.error("❌ Pop-up event startup read failed:", err.message);
    return null;
  });
  if (!state?.enabled) return;
  startTimers(bot);
  await logToDiscord(bot, state, "👁️ Watcher Pop-Up Events scheduler is online.").catch(() => {});
}

async function cancelActiveEvent(reason = "Cancelled by staff") {
  if (!activeEvent) return false;
  const event = activeEvent;
  if (event.timeout) clearTimeout(event.timeout);
  if (event.registrationTimeout) clearTimeout(event.registrationTimeout);
  await sendGame(`Event cancelled. ${reason}`);
  await finishEvent({ status: "cancelled", reason });
  return true;
}

async function handlePopupEventCommand(message, bot) {
  if (!message.guild || !message.content) return false;
  const parts = message.content.trim().split(/\s+/);
  const command = String(parts.shift() || "").toLowerCase();
  if (command !== "!popupevent" && command !== "!popupeventsetup") return false;
  if (!isStaffMember(message.member)) {
    await message.reply("The Watcher sees the request. Pop-up event controls are for staff only.").catch(() => {});
    return true;
  }

  const action = command === "!popupeventsetup" ? "setup" : String(parts.shift() || "status").toLowerCase();
  const force = parts.some((part) => part.toLowerCase() === "force");

  try {
    let state = await loadState();
    if (action === "setup" || action === "enable") {
      state = await saveState({ ...state, enabled: true, guildId: message.guild.id, logChannelId: message.channel.id });
      startTimers(bot);
      await message.reply("✅ Watcher Pop-Up Events are enabled. This channel is now the private event log channel.").catch(() => {});
      return true;
    }
    if (action === "disable") {
      state = await saveState({ ...state, enabled: false });
      await cancelActiveEvent("Automatic pop-up events were disabled by staff.").catch(() => {});
      await message.reply("⛔ Watcher Pop-Up Events are disabled. Cooldown history was preserved.").catch(() => {});
      return true;
    }
    if (action === "cancel") {
      const cancelled = await cancelActiveEvent();
      await message.reply(cancelled ? "Active pop-up event cancelled." : "No pop-up event is active.").catch(() => {});
      return true;
    }
    if (action === "quick" || action === "task") {
      const check = await canLaunch(bot, state, action === "quick" ? "quick" : "task", { force });
      if (!check.ok) {
        await message.reply(`Cannot launch: ${check.reason}.${force ? "" : " Add `force` to bypass player minimum, cooldown, and restart-window checks for testing."}`).catch(() => {});
        return true;
      }
      if (action === "quick") await startQuickEvent(); else await startTaskEvent();
      await message.reply(`${action === "quick" ? "Quick Chat" : "Timed Task"} event launched in SCUM chat.`).catch(() => {});
      return true;
    }

    const eligible = state.guildId ? await getEligibleOnline(bot, state.guildId).catch(() => []) : [];
    const restartMinutes = minutesToNearestRestart();
    await message.reply([
      "👁️ **Watcher Pop-Up Events**",
      `Status: **${state.enabled ? "Enabled" : "Disabled"}**`,
      `Active Event: **${activeEvent ? `${activeEvent.type} (${activeEvent.category})` : "None"}**`,
      `Eligible Non-Staff Online: **${eligible.length}** / ${MIN_ELIGIBLE} required`,
      `Quick Chat Cooldown: **${formatRemaining(cooldownRemaining(state, "quick"))}**`,
      `Timed Task Cooldown: **${formatRemaining(cooldownRemaining(state, "task"))}**`,
      `Restart Check: **${restartMinutes === null ? "Not configured" : `${restartMinutes} minutes` }**`,
      "Commands: `!popupevent quick`, `!popupevent task`, `!popupevent cancel`, `!popupevent enable`, `!popupevent disable`",
      "Testing: add `force` to quick/task.",
    ].join("\n")).catch(() => {});
  } catch (err) {
    console.error("❌ Pop-up event command failed:", err);
    await message.reply(`Pop-up event error: ${err.message}`).catch(() => {});
  }
  return true;
}

module.exports = {
  handlePopupEventCommand,
  startPopupEventsOnBoot,
};
