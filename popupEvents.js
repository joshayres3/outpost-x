const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");
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
const SHARED_QUIET_MS = Math.max(0, Number(process.env.POPUP_SHARED_QUIET_MINUTES || "10")) * 60_000;
const RESTART_BLOCK_MINUTES = Math.max(0, Number(process.env.POPUP_RESTART_BLOCK_MINUTES || "20"));
const QUICK_CHANCE = clampProbability(process.env.POPUP_QUICK_CHANCE || "0.20");
const STAFF_ROLE_NAMES = new Set(["owner", "owners", "admin", "trial admin"]);
const EVENT_DURATION_MS = 120_000;
const ANGRY_STORM_CHANCE = clampProbability(process.env.POPUP_ANGRY_STORM_CHANCE || "0.03");
const ANGRY_STORM_MINUTES = Math.max(1, Number(process.env.POPUP_ANGRY_STORM_MINUTES || "5"));

let dbClient = null;
let schedulerTimer = null;
let chatTimer = null;
let tickRunning = false;
let chatRunning = false;
let activeEvent = null;
let botRef = null;
let stormTimer = null;
let stormActive = false;

const MULTIPLE_CHOICE = [
  { prompt: "What is required for the admin screwdriver trade? 1) 35 red screwdrivers 2) 25 toolboxes 3) 50 batteries", correct: 1 },
  { prompt: "Which role is the normal Outpost X player role? 1) Fresh Meat 2) The Exiles 3) Survivors", correct: 2 },
  { prompt: "What is the Outpost X server type? 1) PvE 2) PvP only 3) Battle Royale", correct: 1 },
  { prompt: "What should players open when they need staff help? 1) A ticket 2) A public argument 3) A vehicle claim", correct: 1 },
  { prompt: "Which item is used during lockpicking? 1) Screwdriver 2) Crowbar 3) Wrench", correct: 1 },
  { prompt: "Which command joins a Watcher event when registration is requested? 1) !shop 2) !join 3) !ticket", correct: 2 },
  { prompt: "Which tool is mainly used to repair base elements? 1) Toolbox 2) Compass 3) Binoculars", correct: 1 },
  { prompt: "Which item helps repair a damaged vehicle tire? 1) Tire repair kit 2) Sewing kit 3) Canteen", correct: 1 },
  { prompt: "Which vehicle has two wheels? 1) Dirtbike 2) Laika 3) Rager", correct: 1 },
  { prompt: "Which item is used to carry gasoline? 1) Gasoline canister 2) Quiver 3) Holster", correct: 1 },
  { prompt: "Which tool is used to cut down trees? 1) Axe 2) Compass 3) Lockpick", correct: 1 },
  { prompt: "Which item is used to navigate direction? 1) Compass 2) Toolbox 3) Crowbar", correct: 1 },
  { prompt: "Which item is used to start a fire? 1) Lighter 2) Tire repair kit 3) Binoculars", correct: 1 },
  { prompt: "Which container is designed to hold water? 1) Canteen 2) Quiver 3) Holster", correct: 1 },
  { prompt: "Which tool can pry open or force objects? 1) Crowbar 2) Compass 3) Canteen", correct: 1 },
  { prompt: "Which item is commonly used to patch clothing? 1) Sewing kit 2) Gas canister 3) Car jack", correct: 1 },
  { prompt: "Which item lets you see distant objects more clearly? 1) Binoculars 2) Toolbox 3) Lockpick", correct: 1 },
  { prompt: "Which item is worn to reduce fall speed from the sky? 1) Parachute 2) Raincoat 3) Quiver", correct: 1 },
  { prompt: "Which vehicle is a compact car? 1) Laika 2) Dirtbike 3) Wheelbarrow", correct: 1 },
  { prompt: "Which vehicle is a larger off-road SUV? 1) Rager 2) Bicycle 3) Tractor", correct: 1 },
  { prompt: "Which item holds arrows? 1) Quiver 2) Holster 3) Canteen", correct: 1 },
  { prompt: "Which item holds a handgun on your body? 1) Holster 2) Quiver 3) Toolbox", correct: 1 },
  { prompt: "Which item can help lift a vehicle for repairs? 1) Car jack 2) Compass 3) Sewing kit", correct: 1 },
  { prompt: "Which material is commonly cut into rags for basic treatment? 1) Clothing 2) Gasoline 3) Metal scrap", correct: 1 },
  { prompt: "Which skill is associated with lockpicking? 1) Thievery 2) Cooking 3) Driving", correct: 1 },
  { prompt: "Which skill is associated with constructing and repairing base elements? 1) Engineering 2) Running 3) Camouflage", correct: 1 },
  { prompt: "Which place is used to buy and sell goods with NPCs? 1) Trader 2) Bunker 3) Watchtower", correct: 1 },
  { prompt: "Which location is known for underground military loot areas? 1) Bunker 2) Fishing pier 3) Farm field", correct: 1 },
  { prompt: "What should you do before using the Airlift Taxi? 1) Equip the provided parachute 2) Drop all clothing 3) Enter a vehicle", correct: 1 },
  { prompt: "How long does an Outpost X dirtbike rental last? 1) 30 minutes 2) 10 minutes 3) 2 hours", correct: 1 },
  { prompt: "How much does the Outpost X Airlift Taxi cost? 1) $1,000 2) $100 3) $10,000", correct: 1 },
];

const TEXT_QUESTIONS = [
  { prompt: "Unscramble this SCUM item: RIRWECSDREV", answers: ["screwdriver"] },
  { prompt: "Unscramble this SCUM item: XOLTOOB", answers: ["toolbox", "tool box"] },
  { prompt: "Unscramble this SCUM item: TABYTER", answers: ["battery"] },
  { prompt: "Unscramble this SCUM item: WROCRAB", answers: ["crowbar"] },
  { prompt: "I open locks, have limited uses, and come in several colors. What am I?", answers: ["screwdriver", "a screwdriver"] },
  { prompt: "I repair damaged tires and fit inside your inventory. What am I?", answers: ["tire repair kit", "tire kit"] },
  { prompt: "Complete the Outpost X slogan: Survive Together, Die ____.", answers: ["stupid"] },
  { prompt: "Unscramble this SCUM item: XEA", answers: ["axe", "an axe"] },
  { prompt: "Unscramble this SCUM item: SACPOMS", answers: ["compass", "a compass"] },
  { prompt: "Unscramble this SCUM item: GILTHER", answers: ["lighter", "a lighter"] },
  { prompt: "Unscramble this SCUM item: NETCANE", answers: ["canteen", "a canteen"] },
  { prompt: "Unscramble this SCUM item: VQREIU", answers: ["quiver", "a quiver"] },
  { prompt: "Unscramble this SCUM item: TSERHOL", answers: ["holster", "a holster"] },
  { prompt: "Unscramble this SCUM item: HCETPRAAU", answers: ["parachute", "a parachute"] },
  { prompt: "Unscramble this SCUM vehicle: AIKAL", answers: ["laika"] },
  { prompt: "Unscramble this SCUM vehicle: GRAER", answers: ["rager"] },
  { prompt: "Unscramble this SCUM vehicle: TIDRBKIE", answers: ["dirtbike", "dirt bike"] },
  { prompt: "I point north and help you navigate. What am I?", answers: ["compass", "a compass"] },
  { prompt: "I carry fuel when your vehicle is running dry. What am I?", answers: ["gas canister", "gasoline canister", "fuel can", "gas can"] },
  { prompt: "I help fix torn clothing and come with thread. What am I?", answers: ["sewing kit", "a sewing kit"] },
  { prompt: "I let you look far across the island using two lenses. What am I?", answers: ["binoculars", "binocular"] },
  { prompt: "I hold arrows on your body. What am I?", answers: ["quiver", "a quiver"] },
  { prompt: "I hold a handgun at your hip. What am I?", answers: ["holster", "a holster"] },
  { prompt: "I lift a vehicle so repairs can be made underneath. What am I?", answers: ["car jack", "jack", "a car jack"] },
  { prompt: "I am used to repair damaged base elements and many crafted objects. What am I?", answers: ["toolbox", "tool box", "a toolbox"] },
  { prompt: "I am used to chop wood and trees. What am I?", answers: ["axe", "an axe"] },
  { prompt: "I slow your fall after an Airlift Taxi launch. What am I?", answers: ["parachute", "a parachute"] },
  { prompt: "What skill is used for lockpicking?", answers: ["thievery", "thievery skill"] },
  { prompt: "What skill is used for advanced base construction?", answers: ["engineering", "engineering skill"] },
  { prompt: "What do players open when they need help from Outpost X staff?", answers: ["ticket", "a ticket", "support ticket"] },
  { prompt: "What is the normal Outpost X player role called?", answers: ["the exiles", "exiles"] },
  { prompt: "What vehicle can players rent from The Watcher for 30 minutes?", answers: ["dirtbike", "dirt bike"] },
];

const TRUE_FALSE = [
  { prompt: "Outpost X is a PvE server.", correct: true },
  { prompt: "Staff members can win Watcher pop-up events.", correct: false },
  { prompt: "A red screwdriver can have different remaining uses.", correct: true },
  { prompt: "Players need Discord open to answer Watcher pop-up events.", correct: false },
  { prompt: "The normal player role is called The Exiles.", correct: true },
];

const ODD_ONE_OUT = [
  { prompt: "Which one does NOT belong with lockpicking supplies? 1) Screwdriver 2) Lockpick 3) Gas canister", correct: 3 },
  { prompt: "Which one is NOT a vehicle? 1) Laika 2) Rager 3) Toolbox", correct: 3 },
  { prompt: "Which one is NOT an accepted answer command? 1) !1 2) !a 3) just typing the number in a sentence", correct: 3 },
  { prompt: "Which one is NOT a small Watcher reward? 1) 25 fame 2) $1,000 bank credit 3) A fully loaded vehicle", correct: 3 },
];

const HIGHER_LOWER = [
  { prompt: "Is 35 higher or lower than the number of red screwdrivers needed for the admin trade?", correct: "same", allowSame: true },
  { prompt: "Is 50 higher or lower than the 35 red screwdrivers needed for the admin trade?", correct: "higher" },
  { prompt: "Is 20 higher or lower than the 35 red screwdrivers needed for the admin trade?", correct: "lower" },
  { prompt: "Is 4 higher or lower than the minimum number of non-staff players needed for a pop-up event?", correct: "same", allowSame: true },
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
  const res = await fetch(`${serverBaseUrl()}${path}`, { headers: { Accept: "application/json", "X-Password": serverPassword() } });
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
  if (!res.ok || data?.ok === false || data?.accepted === false) throw new Error(data?.message || data?.error || `Server POST failed: ${res.status}`);
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
    lastAnyEndedAt: Number(value.lastAnyEndedAt || 0),
    chatCursor: Number(value.chatCursor || 0),
    lastResult: value.lastResult || null,
    stormEndsAt: Number(value.stormEndsAt || 0),
    usedQuestionIds: normalizeUsedQuestionIds(value.usedQuestionIds),
  };
}


function normalizeUsedQuestionIds(value) {
  const source = value && typeof value === "object" ? value : {};
  const legacy = ["multiple_choice", "text_answer", "true_false", "odd_one_out", "higher_lower"]
    .flatMap((key) => Array.isArray(source[key]) ? source[key] : []);
  const current = Array.isArray(source.all) ? source.all : [];
  return { all: [...new Set([...current, ...legacy].map((id) => String(id || "").trim()).filter(Boolean))] };
}

function questionId(type, question) {
  const seed = `${type}|${String(question?.prompt || "").trim()}`;
  return crypto.createHash("sha256").update(seed).digest("hex").slice(0, 20);
}

function questionBanks() {
  return {
    multiple_choice: MULTIPLE_CHOICE,
    text_answer: TEXT_QUESTIONS,
    true_false: TRUE_FALSE,
    odd_one_out: ODD_ONE_OUT,
    higher_lower: HIGHER_LOWER,
  };
}

async function pickUnusedQuestion(requestedType) {
  const banks = questionBanks();
  if (!banks[requestedType]) throw new Error(`No question bank configured for ${requestedType}.`);

  const state = await loadState();
  const usedQuestionIds = normalizeUsedQuestionIds(state.usedQuestionIds);
  const used = new Set(usedQuestionIds.all);
  const all = Object.entries(banks).flatMap(([type, questions]) =>
    questions.map((question) => ({ type, question, id: questionId(type, question) }))
  );

  // Reset only after every fixed trivia question has appeared once.
  if (all.every((entry) => used.has(entry.id))) used.clear();

  let available = all.filter((entry) => entry.type === requestedType && !used.has(entry.id));
  // If that format is exhausted, use another unused trivia format rather than repeat.
  if (!available.length) available = all.filter((entry) => !used.has(entry.id));

  const selected = pick(available);
  used.add(selected.id);
  await saveState({ ...state, usedQuestionIds: { all: [...used] } });
  return selected;
}

function playerSteamId(player) { return String(player?.userId || player?.steamId || player?.steam_id || player?.id || "").trim(); }
function playerName(player) { return String(player?.characterName || player?.name || player?.steamName || playerSteamId(player) || "Unknown").trim(); }

async function getOnlinePlayers() {
  const data = await serverGet("/players.json");
  return Array.isArray(data?.players) ? data.players : [];
}

async function getStaffSteamIds(bot, guildId) {
  const staff = new Set();
  if (!guildId) return staff;
  const guild = await bot.guilds.fetch(String(guildId)).catch(() => null);
  if (!guild) return staff;
  const { data, error } = await getDb().from(PLAYER_LINKS_TABLE)
    .select("steam_id,discord_id").eq("guild_id", String(guildId))
    .not("steam_id", "is", null).not("discord_id", "is", null).limit(2500);
  if (error) throw error;
  for (const row of data || []) {
    const member = await guild.members.fetch(String(row.discord_id)).catch(() => null);
    if (!member) continue;
    if (member.roles?.cache?.some((role) => STAFF_ROLE_NAMES.has(String(role.name || "").toLowerCase()))) staff.add(String(row.steam_id));
  }
  return staff;
}

async function getEligibleOnline(bot, guildId) {
  const [players, staffIds] = await Promise.all([getOnlinePlayers(), getStaffSteamIds(bot, guildId)]);
  return players.map((player) => ({ player, steamId: playerSteamId(player), name: playerName(player) }))
    .filter((entry) => entry.steamId && !staffIds.has(entry.steamId));
}

function isStaffMember(member) {
  return !!member?.roles?.cache?.some((role) => STAFF_ROLE_NAMES.has(String(role.name || "").toLowerCase()));
}

function pick(values) { return values[Math.floor(Math.random() * values.length)]; }
function randomId() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`; }
function normalizeAnswer(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/^\s*!answer\s+/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseChatIdentity(row) {
  const directSteamId = String(
    row?.steamId || row?.steam_id || row?.userId || row?.user_id || row?.playerSteamId || ""
  ).trim();
  const directName = String(row?.playerName || row?.characterName || row?.name || "").trim();
  if (/^\d{15,20}$/.test(directSteamId)) {
    return { steamId: directSteamId, name: directName || directSteamId, profileId: row?.profileId || row?.profile_id || null };
  }

  const text = String(row?.line ?? row ?? "");
  const match = text.match(/'?(\d{15,20})\s*:\s*([^('\n\r]+?)\s*\((\d+)\)'?/);
  if (match) return { steamId: match[1], name: match[2].trim(), profileId: match[3] };

  const steamOnly = text.match(/\b(\d{15,20})\b/);
  if (steamOnly) return { steamId: steamOnly[1], name: directName || steamOnly[1], profileId: null };
  return null;
}

function parseCommand(line) {
  const match = String(line || "").match(/(?:^|\s)!(answer|guess|join|a|b|c|one|two|three|1|2|3|true|false|t|f|higher|lower|same)(?:\s+([^\r\n]*))?/i);
  if (!match) return null;
  return { command: match[1].toLowerCase(), value: String(match[2] || "").trim() };
}

function answerNumber(command) {
  return ({ "1": 1, a: 1, one: 1, "2": 2, b: 2, two: 2, "3": 3, c: 3, three: 3 })[command] || null;
}

function restartHours() {
  return String(process.env.GGCON_CARGO_SCHEDULE_HOURS || "0,4,8,12,16,20").split(/[\s,]+/)
    .map(Number).filter((v) => Number.isInteger(v) && v >= 0 && v <= 23);
}

function minutesToNearestRestart(now = new Date()) {
  const hours = restartHours();
  if (!hours.length) return null;
  const timeZone = process.env.WATCHER_LOTTERY_TIMEZONE || "America/Toronto";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(now).reduce((out, part) => ({ ...out, [part.type]: part.value }), {});
  const currentMinutes = Number(parts.hour) * 60 + Number(parts.minute);
  return Math.min(...hours.map((hour) => (hour * 60 - currentMinutes + 1440) % 1440));
}

function cooldownRemaining(state) {
  const now = Date.now();
  const quick = Math.max(0, QUICK_COOLDOWN_MS - (now - state.lastQuickEndedAt));
  const shared = Math.max(0, SHARED_QUIET_MS - (now - state.lastAnyEndedAt));
  return Math.max(quick, shared);
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
  if (roll < 0.18) return { type: "fame", amount: 25, label: "25 Fame Points" };
  if (roll < 0.28) return { type: "fame", amount: 50, label: "50 Fame Points" };
  if (roll < 0.43) return { type: "cash", amount: 250, label: "$250 bank credit" };
  if (roll < 0.65) return { type: "cash", amount: 500, label: "$500 bank credit" };
  if (roll < 0.83) return { type: "cash", amount: 1000, label: "$1,000 bank credit" };
  if (roll < 0.90) return { type: "cash", amount: 1500, label: "$1,500 bank credit" };
  if (roll < 0.98) return { type: "bonus_lottery", amount: 0, label: "an extra small lottery" };
  return { type: "none", amount: 0, label: "nothing" };
}

async function setServerWeather(value) {
  return serverPost("/command", { command: `#setweather ${value}` });
}

async function endAngryStorm({ announce = true } = {}) {
  if (stormTimer) clearTimeout(stormTimer);
  stormTimer = null;
  try {
    await setServerWeather(0);
    if (announce) await sendGame("The Watcher has calmed down. The storm is ending.");
  } finally {
    stormActive = false;
    const state = await loadState().catch(() => null);
    if (state) await saveState({ ...state, stormEndsAt: 0 }).catch(() => {});
  }
}

async function startAngryStorm(state) {
  if (stormActive || Number(state?.stormEndsAt || 0) > Date.now()) return false;
  stormActive = true;
  const durationMs = ANGRY_STORM_MINUTES * 60_000;
  const stormEndsAt = Date.now() + durationMs;
  try {
    await sendGame(`The Watcher is displeased. A storm has been initiated for ${ANGRY_STORM_MINUTES} minutes.`);
    await setServerWeather(1);
    await saveState({ ...state, stormEndsAt });
    stormTimer = setTimeout(() => {
      endAngryStorm().catch((err) => console.error("❌ Failed to end Watcher storm:", err.message));
    }, durationMs);
    await logToDiscord(botRef, state, `⛈️ **Watcher Anger Event**\nStorm activated for ${ANGRY_STORM_MINUTES} minutes.`);
    return true;
  } catch (err) {
    stormActive = false;
    await logToDiscord(botRef, state, `⚠️ **Watcher Storm Failed**\n${err.message}`).catch(() => {});
    return false;
  }
}

async function maybeTriggerAngryStorm(state) {
  if (ANGRY_STORM_CHANCE <= 0 || Math.random() >= ANGRY_STORM_CHANCE) return false;
  return startAngryStorm(state);
}

async function restoreStormState(state) {
  const endsAt = Number(state?.stormEndsAt || 0);
  if (!endsAt) return;
  if (endsAt <= Date.now()) {
    await endAngryStorm({ announce: false }).catch(() => {});
    return;
  }
  stormActive = true;
  if (stormTimer) clearTimeout(stormTimer);
  stormTimer = setTimeout(() => {
    endAngryStorm().catch((err) => console.error("❌ Failed to end restored Watcher storm:", err.message));
  }, endsAt - Date.now());
}

async function deliverReward(event, winner, state) {
  const reward = event.reward || chooseReward();
  if (reward.type === "fame") await serverPost(`/players/${encodeURIComponent(winner.steamId)}/fame`, { action: "change", amount: reward.amount });
  else if (reward.type === "cash") await serverPost(`/players/${encodeURIComponent(winner.steamId)}/currency`, { action: "change", amount: reward.amount });
  else if (reward.type === "bonus_lottery") await triggerBonusLottery(botRef, state.guildId);
  return reward;
}

async function finishEvent(result = {}) {
  const event = activeEvent;
  if (!event) return;
  if (event.timeout) clearTimeout(event.timeout);
  activeEvent = null;
  const state = await loadState();
  const now = Date.now();
  state.lastQuickEndedAt = now;
  state.lastAnyEndedAt = now;
  state.lastResult = { eventId: event.id, type: event.type, endedAt: new Date(now).toISOString(), ...result };
  await saveState(state);
}

async function completeWithWinner(winner, extra = {}) {
  const event = activeEvent;
  if (!event || event.finished) return;
  event.finished = true;
  const state = await loadState();
  try {
    const reward = await deliverReward(event, winner, state);
    if (reward.type === "bonus_lottery") await sendGame(`${winner.name} triggered an extra lottery.`);
    else if (reward.type === "none") await sendGame(`${winner.name} was selected. Reward: nothing. The choice was statistically valid.`);
    else await sendGame(`${winner.name} wins ${reward.label}.`);
    await logToDiscord(botRef, state, `✅ **Chat Event Completed**\nType: ${event.type}\nWinner: **${winner.name}** (${winner.steamId})\nReward: ${reward.label}`);
    await finishEvent({ status: "completed", winner, reward, ...extra });
  } catch (err) {
    await sendGame(`${winner.name} won, but reward delivery failed. Staff has been notified.`).catch(() => {});
    await logToDiscord(botRef, state, `⚠️ **Pop-Up Reward Failed**\nType: ${event.type}\nWinner: **${winner.name}** (${winner.steamId})\nError: ${err.message}`);
    await finishEvent({ status: "reward_failed", winner, error: err.message, ...extra });
  }
}

async function expireQuickEvent() {
  const event = activeEvent;
  if (!event || event.finished) return;
  event.finished = true;

  if (event.type === "mystery") {
    const winningChoice = pick([1, 2, 3]);
    const candidates = [...event.entries.values()].filter((entry) => entry.choice === winningChoice);
    if (!candidates.length) {
      await sendGame(`Signal ${winningChoice} held the reward, but nobody selected it. The reward was left unclaimed.`);
      await finishEvent({ status: "unclaimed", winningChoice, entries: event.entries.size });
      return;
    }
    event.finished = false;
    await completeWithWinner(pick(candidates), { winningChoice, entries: event.entries.size });
    return;
  }

  if (event.type === "number_guess") {
    const guesses = [...event.entries.values()];
    if (!guesses.length) {
      await sendGame(`The number was ${event.target}. No valid guesses were received.`);
      await finishEvent({ status: "expired", target: event.target });
      return;
    }
    const closestDistance = Math.min(...guesses.map((g) => Math.abs(g.guess - event.target)));
    const closest = guesses.filter((g) => Math.abs(g.guess - event.target) === closestDistance);
    const winner = pick(closest);
    event.finished = false;
    await sendGame(`The number was ${event.target}. ${winner.name} had the closest guess: ${winner.guess}.`);
    await completeWithWinner(winner, { target: event.target, guess: winner.guess, tied: closest.length });
    return;
  }

  await sendGame("Time expired. No correct answer was received.");
  await finishEvent({ status: "expired" });
}

async function startQuickEvent({ forceType = null } = {}) {
  if (activeEvent) throw new Error("Another pop-up event is already active.");
  const type = forceType || pick(["multiple_choice", "text_answer", "true_false", "odd_one_out", "higher_lower", "number_guess", "mystery"]);
  const event = { id: randomId(), category: "quick", type, startedAt: Date.now(), finished: false, entries: new Map(), answered: new Set(), reward: chooseReward() };
  activeEvent = event;
  event.timeout = setTimeout(() => expireQuickEvent().catch(console.error), EVENT_DURATION_MS);

  if (["multiple_choice", "text_answer", "true_false", "odd_one_out", "higher_lower"].includes(type)) {
    const selected = await pickUnusedQuestion(type);
    const q = selected.question;
    event.type = selected.type;

    if (event.type === "multiple_choice") {
      event.correct = q.correct;
      await sendGame(`RAPID ASSESSMENT: ${q.prompt}. Reply !1, !2 or !3. !a, !b or !c also work. First correct answer wins. You have 2 minutes.`);
    } else if (event.type === "text_answer") {
      event.answers = q.answers.map(normalizeAnswer);
      await sendGame(`IDENTIFY IT: ${q.prompt}. Reply with !answer followed by your answer. Example: !answer screwdriver. First correct answer wins. You have 2 minutes.`);
    } else if (event.type === "true_false") {
      event.correct = q.correct;
      await sendGame(`TRUE OR FALSE: ${q.prompt} Reply !true or !false. !t or !f also work. First correct answer wins. You have 2 minutes.`);
    } else if (event.type === "odd_one_out") {
      event.correct = q.correct;
      await sendGame(`ODD ONE OUT: ${q.prompt}. Reply !1, !2 or !3. !a, !b or !c also work. First correct answer wins. You have 2 minutes.`);
    } else {
      event.correct = q.correct;
      const formats = q.allowSame ? "!higher, !lower or !same" : "!higher or !lower";
      await sendGame(`HIGHER OR LOWER: ${q.prompt} Reply ${formats}. First correct answer wins. You have 2 minutes.`);
    }
  } else if (type === "number_guess") {
    event.target = 1 + Math.floor(Math.random() * 20);
    await sendGame("NUMBER SIGNAL: The Watcher selected a number from 1 to 20. Reply with !guess followed by one number. Example: !guess 12. Exact or closest guess wins. One guess each. You have 2 minutes.");
  } else {
    await sendGame("THREE SIGNALS DETECTED: 1) Signal One 2) Signal Two 3) Signal Three. Choose with !1, !2 or !3. !one, !two or !three also work. One choice each. A winner is drawn from the rewarding signal after 2 minutes.");
  }
  return event;
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
      const staffIds = await getStaffSteamIds(botRef, state.guildId);
      for (const row of lines) {
        if (!activeEvent || activeEvent.id !== event.id || event.finished) break;
        const identity = parseChatIdentity(row);
        const parsed = parseCommand(row?.line ?? row);
        // A fresh chat-log entry already proves the player was in game when they answered.
        // Do not reject valid answers because the live-player endpoint briefly lagged behind.
        if (!identity || !parsed || staffIds.has(identity.steamId)) continue;

        if (["multiple_choice", "odd_one_out"].includes(event.type)) {
          const choice = answerNumber(parsed.command);
          if (!choice || event.answered.has(identity.steamId)) continue;
          event.answered.add(identity.steamId);
          if (choice === event.correct) await completeWithWinner(identity);
        } else if (event.type === "text_answer") {
          if (parsed.command !== "answer" || event.answered.has(identity.steamId)) continue;
          event.answered.add(identity.steamId);
          if (event.answers.includes(normalizeAnswer(parsed.value))) await completeWithWinner(identity);
        } else if (event.type === "true_false") {
          if (!["true", "false", "t", "f"].includes(parsed.command) || event.answered.has(identity.steamId)) continue;
          event.answered.add(identity.steamId);
          const answer = parsed.command === "true" || parsed.command === "t";
          if (answer === event.correct) await completeWithWinner(identity);
        } else if (event.type === "higher_lower") {
          if (!["higher", "lower", "same"].includes(parsed.command) || event.answered.has(identity.steamId)) continue;
          event.answered.add(identity.steamId);
          if (parsed.command === event.correct) await completeWithWinner(identity);
        } else if (event.type === "number_guess") {
          if (parsed.command !== "guess" || event.entries.has(identity.steamId)) continue;
          const guess = Number.parseInt(parsed.value, 10);
          if (!Number.isInteger(guess) || guess < 1 || guess > 20) {
            await sendGame(`${identity.name}, use !guess followed by a number from 1 to 20.`, identity.steamId).catch(() => {});
            continue;
          }
          event.entries.set(identity.steamId, { ...identity, guess });
          if (guess === event.target) await completeWithWinner({ ...identity, guess }, { target: event.target, exact: true });
        } else if (event.type === "mystery") {
          const choice = answerNumber(parsed.command);
          if (!choice || event.entries.has(identity.steamId)) continue;
          event.entries.set(identity.steamId, { ...identity, choice });
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

async function canLaunch(bot, state, { force = false } = {}) {
  if (!state.enabled && !force) return { ok: false, reason: "disabled" };
  if (!state.guildId) return { ok: false, reason: "not configured" };
  if (activeEvent) return { ok: false, reason: "another event is active" };
  if (!force && cooldownRemaining(state) > 0) return { ok: false, reason: "cooldown" };
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
    if (!state.enabled || !state.guildId || activeEvent || cooldownRemaining(state) > 0) return;
    const eligible = await getEligibleOnline(bot, state.guildId);
    if (eligible.length < MIN_ELIGIBLE) return;
    const restartMinutes = minutesToNearestRestart();
    if (restartMinutes !== null && restartMinutes <= RESTART_BLOCK_MINUTES) return;
    if (Math.random() < QUICK_CHANCE) {
      const event = await startQuickEvent();
      await logToDiscord(bot, state, `💬 **In-Game Chat Event Started**\nType: ${event.type}\nEligible non-staff online: ${eligible.length}`);
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
  schedulerTimer = setInterval(() => schedulerTick(bot), CHECK_MINUTES * 60_000);
  chatTimer = setInterval(() => scanChat(), CHAT_SCAN_SECONDS * 1000);
  schedulerTick(bot).catch(() => {});
  scanChat().catch(() => {});
}

async function startPopupEventsOnBoot(bot) {
  botRef = bot;
  const state = await loadState().catch((err) => { console.error("❌ Pop-up event startup read failed:", err.message); return null; });
  if (!state?.enabled) return;
  await restoreStormState(state).catch((err) => console.error("❌ Watcher storm restore failed:", err.message));
  startTimers(bot);
  await logToDiscord(bot, state, "👁️ Watcher in-game chat event scheduler is online.").catch(() => {});
}

async function cancelActiveEvent(reason = "Cancelled by staff") {
  if (!activeEvent) return false;
  if (activeEvent.timeout) clearTimeout(activeEvent.timeout);
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
  const requestedType = parts.find((part) => ["multiple_choice", "text_answer", "true_false", "odd_one_out", "higher_lower", "number_guess", "mystery"].includes(part.toLowerCase()));

  try {
    let state = await loadState();
    if (action === "setup" || action === "enable") {
      state = await saveState({ ...state, enabled: true, guildId: message.guild.id, logChannelId: message.channel.id });
      startTimers(bot);
      await message.reply("✅ Watcher in-game chat events are enabled. This channel is the private event log channel.").catch(() => {});
      return true;
    }
    if (action === "disable") {
      await saveState({ ...state, enabled: false });
      await cancelActiveEvent("Automatic chat events were disabled by staff.").catch(() => {});
      await message.reply("⛔ Watcher in-game chat events are disabled. Cooldown history was preserved.").catch(() => {});
      return true;
    }
    if (action === "cancel") {
      const cancelled = await cancelActiveEvent();
      await message.reply(cancelled ? "Active chat event cancelled." : "No chat event is active.").catch(() => {});
      return true;
    }
    if (action === "quick" || action === "chat") {
      const check = await canLaunch(bot, state, { force });
      if (!check.ok) {
        await message.reply(`Cannot launch: ${check.reason}.${force ? "" : " Add `force` to bypass player minimum, cooldown, and restart-window checks for testing."}`).catch(() => {});
        return true;
      }
      const event = await startQuickEvent({ forceType: requestedType ? requestedType.toLowerCase() : null });
      await message.reply(`In-game chat event launched: **${event.type}**.`).catch(() => {});
      return true;
    }

    const eligible = state.guildId ? await getEligibleOnline(bot, state.guildId).catch(() => []) : [];
    const restartMinutes = minutesToNearestRestart();
    await message.reply([
      "👁️ **Watcher In-Game Chat Events**",
      `Status: **${state.enabled ? "Enabled" : "Disabled"}**`,
      `Active Event: **${activeEvent ? activeEvent.type : "None"}**`,
      `Eligible Non-Staff Online: **${eligible.length}** / ${MIN_ELIGIBLE} required`,
      `Chat Event Cooldown: **${formatRemaining(cooldownRemaining(state))}**`,
      `Restart Check: **${restartMinutes === null ? "Not configured" : `${restartMinutes} minutes`}**`,
      "Event Pool: multiple choice, SCUM trivia, item identification, true/false, odd-one-out, higher/lower, number guess, mystery signals",
      `Reward Pool: 25–50 fame, $250–$1,500 cash, bonus lottery, or a rare empty result`,
      `Watcher Anger: ${Math.round(ANGRY_STORM_CHANCE * 100)}% chance of a ${ANGRY_STORM_MINUTES}-minute storm after a winner`,
      "Commands: `!popupevent quick`, `!popupevent cancel`, `!popupevent enable`, `!popupevent disable`",
      "Testing: `!popupevent quick force` or add an event type, such as `!popupevent quick force number_guess`.",
    ].join("\n")).catch(() => {});
  } catch (err) {
    console.error("❌ Pop-up event command failed:", err);
    await message.reply(`Pop-up event error: ${err.message}`).catch(() => {});
  }
  return true;
}

module.exports = { handlePopupEventCommand, startPopupEventsOnBoot };
