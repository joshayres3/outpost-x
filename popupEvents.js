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
  { prompt: "Which attribute governs the Thievery skill? 1) Dexterity 2) Strength 3) Intelligence", correct: 1 },
  { prompt: "Which attribute governs Engineering? 1) Constitution 2) Intelligence 3) Strength", correct: 2 },
  { prompt: "Which attribute governs Melee Weapons? 1) Strength 2) Dexterity 3) Intelligence", correct: 1 },
  { prompt: "Which attribute governs Running? 1) Constitution 2) Intelligence 3) Dexterity", correct: 1 },
  { prompt: "Which attribute governs Driving? 1) Dexterity 2) Strength 3) Constitution", correct: 1 },
  { prompt: "Which attribute governs Medical? 1) Intelligence 2) Dexterity 3) Constitution", correct: 1 },
  { prompt: "Which attribute governs Awareness? 1) Intelligence 2) Strength 3) Dexterity", correct: 1 },
  { prompt: "Which attribute governs Brawling? 1) Intelligence 2) Strength 3) Constitution", correct: 2 },
  { prompt: "Which skill directly affects lockpicking? 1) Engineering 2) Thievery 3) Awareness", correct: 2 },
  { prompt: "Which skill is improved by performing lockpicking? 1) Thievery 2) Survival 3) Stealth", correct: 1 },
  { prompt: "Which skill determines many crafting unlocks and crafting speed? 1) Survival 2) Driving 3) Medical", correct: 1 },
  { prompt: "Which skill is associated with higher-level base construction? 1) Engineering 2) Archery 3) Running", correct: 1 },
  { prompt: "At Advanced Engineering, which lock can be crafted? 1) Rusty Lock 2) Gold Lock 3) Plastic Lock", correct: 2 },
  { prompt: "At Basic Engineering, which lock can be crafted? 1) Iron Lock 2) Gold Lock 3) Silver Lock", correct: 1 },
  { prompt: "At Medium Engineering, which lock can be crafted? 1) Gold Lock 2) Silver Lock 3) Iron Lock only", correct: 2 },
  { prompt: "Which tool is needed when removing or installing vehicle tires? 1) Car Jack 2) Compass 3) Canteen", correct: 1 },
  { prompt: "Which kit repairs vehicle chassis damage? 1) Sewing Kit 2) Car Repair Kit 3) Weapon Cleaning Kit", correct: 2 },
  { prompt: "Which kit repairs a damaged tire? 1) Tire Repair Kit 2) Toolbox 3) First Aid Kit", correct: 1 },
  { prompt: "Which item carries gasoline? 1) Gasoline Canister 2) Canteen 3) Quiver", correct: 1 },
  { prompt: "Which item is designed to carry water? 1) Holster 2) Canteen 3) Car Jack", correct: 2 },
  { prompt: "Which tool is best suited for chopping trees? 1) Axe 2) Screwdriver 3) Compass", correct: 1 },
  { prompt: "Which tool is primarily used with lockpicking? 1) Screwdriver 2) Car Jack 3) Binoculars", correct: 1 },
  { prompt: "Which item helps you see distant objects? 1) Binoculars 2) Sewing Kit 3) Toolbox", correct: 1 },
  { prompt: "Which item holds arrows? 1) Holster 2) Quiver 3) Canteen", correct: 2 },
  { prompt: "Which item holds a handgun on your body? 1) Holster 2) Quiver 3) Compass", correct: 1 },
  { prompt: "Which of these is a car in SCUM? 1) Laika 2) Canteen 3) Quiver", correct: 1 },
  { prompt: "Which of these is a car in SCUM? 1) WolfsWagen 2) Toolbox 3) Parachute", correct: 1 },
  { prompt: "Which of these is a two-wheeled motor vehicle? 1) Dirt Bike 2) Laika 3) Wheelbarrow", correct: 1 },
  { prompt: "Which skill affects car driving performance? 1) Driving 2) Survival 3) Medical", correct: 1 },
  { prompt: "Which skill affects motorcycle handling? 1) Motorcycling 2) Engineering 3) Camouflage", correct: 1 },
  { prompt: "Which vehicle is known as a compact 4x4-style car? 1) Laika 2) Dirt Bike 3) SUP", correct: 1 },
  { prompt: "Which vehicle is a modular car found around the island? 1) WolfsWagen 2) Quiver 3) Crowbar", correct: 1 },
  { prompt: "Which of these is a water vehicle? 1) Big Improvised Raft 2) Laika 3) Dirt Bike", correct: 1 },
  { prompt: "Which of these is a water vehicle? 1) Wooden Motorboat 2) WolfsWagen 3) Mountain Bike", correct: 1 },
  { prompt: "Which of these is an air vehicle? 1) Kinglet Duster 2) Laika 3) Quad", correct: 1 },
  { prompt: "What can multiple players do together to move a broken vehicle faster? 1) Push it 2) Repair it remotely 3) Teleport it", correct: 1 },
  { prompt: "What may happen to loose vehicle parts left on the ground? 1) They may despawn 2) They become permanent 3) They turn into scrap automatically", correct: 1 },
  { prompt: "Which skill can improve ignition success and braking behavior while driving? 1) Driving 2) Medical 3) Thievery", correct: 1 },
  { prompt: "Which skill can affect a vehicle's top speed while driving? 1) Driving 2) Engineering 3) Survival", correct: 1 },
  { prompt: "Which item can be used to pry or force objects? 1) Crowbar 2) Compass 3) Canteen", correct: 1 },
  { prompt: "Which item is used to patch damaged clothing? 1) Sewing Kit 2) Car Jack 3) Gasoline Canister", correct: 1 },
  { prompt: "Which item helps start a fire? 1) Lighter 2) Quiver 3) Binoculars", correct: 1 },
  { prompt: "Which skill is tied to sneaking quietly? 1) Stealth 2) Medical 3) Engineering", correct: 1 },
  { prompt: "Which skill is tied to spotting things around you? 1) Awareness 2) Driving 3) Brawling", correct: 1 },
  { prompt: "Which skill is tied to hiding your presence visually? 1) Camouflage 2) Thievery 3) Handguns", correct: 1 },
  { prompt: "Which skill is tied to long-range precision shooting? 1) Sniping 2) Running 3) Engineering", correct: 1 },
  { prompt: "Which skill is tied to treating injuries? 1) Medical 2) Motorcycling 3) Throwing", correct: 1 },
  { prompt: "Which skill is tied to bows? 1) Archery 2) Driving 3) Thievery", correct: 1 },
  { prompt: "Which skill is tied to hand-to-hand fighting without a weapon? 1) Brawling 2) Survival 3) Awareness", correct: 1 },
  { prompt: "Which skill is tied to throwing objects? 1) Throwing 2) Engineering 3) Medical", correct: 1 },
  { prompt: "What is the skill level above Advanced called? 1) Advanced+ 2) Elite 3) Master", correct: 1 },
  { prompt: "What comes after Basic skill level? 1) Medium 2) Advanced+ 3) No Skill", correct: 1 },
  { prompt: "What comes after Medium skill level? 1) Basic 2) Advanced 3) No Skill", correct: 2 },
  { prompt: "Which location commonly contains underground military areas? 1) Bunker 2) Farm field 3) Fishing pier", correct: 1 },
  { prompt: "Where do players normally buy and sell goods with NPCs? 1) Trader 2) Watchtower 3) River", correct: 1 },
  { prompt: "Which item should you equip before a parachute drop? 1) Parachute 2) Toolbox 3) Car Jack", correct: 1 },
  { prompt: "Which server service gives a temporary Dirt Bike? 1) Dirtbike Rental 2) Vehicle Insurance 3) Rules Acceptance", correct: 1 },
  { prompt: "How long does an Outpost X dirtbike rental last? 1) 30 minutes 2) 2 hours 3) 10 minutes", correct: 1 },
  { prompt: "How much does the Outpost X Airlift Taxi cost? 1) $1,000 2) $100 3) $10,000", correct: 1 },
  { prompt: "Which sector is excluded from the Outpost X Airlift Taxi? 1) C0 2) A0 3) D4", correct: 1 },
  { prompt: "What is the Outpost X admin screwdriver trade? 1) 35 red screwdrivers for 1 yellow 2) 10 reds for 1 yellow 3) 35 yellows for 1 red", correct: 1 },
  { prompt: "For the screwdriver trade, do the red screwdrivers need to be full-use? 1) Yes 2) No 3) Only on weekends", correct: 2 },
  { prompt: "What is Outpost X primarily configured as? 1) PvE 2) PvP-only 3) Battle Royale", correct: 1 },
  { prompt: "Which phrase completes the Outpost X tagline: Survive Together, Die ____? 1) Quietly 2) Stupid 3) Alone", correct: 2 },
  { prompt: "Which of these is NOT a player vehicle? 1) Dirt Bike 2) Laika 3) Toolbox", correct: 3 },
  { prompt: "Which of these is NOT a Dexterity skill? 1) Driving 2) Thievery 3) Engineering", correct: 3 },
  { prompt: "Which of these is NOT an Intelligence skill? 1) Medical 2) Awareness 3) Brawling", correct: 3 },
  { prompt: "Which of these is NOT a Strength skill? 1) Archery 2) Melee Weapons 3) Driving", correct: 3 },
  { prompt: "Which of these is NOT a Constitution skill? 1) Running 2) Endurance 3) Engineering", correct: 3 },
  { prompt: "Which item is most useful if a vehicle has a flat tire? 1) Tire Repair Kit 2) Sewing Kit 3) Compass", correct: 1 },
];

const TEXT_QUESTIONS = [
  { prompt: "Unscramble this SCUM item: RIRWECSDREV", answers: ["screwdriver"] },
  { prompt: "Unscramble this SCUM item: XOLTOOB", answers: ["toolbox", "tool box"] },
  { prompt: "Unscramble this SCUM item: WROCRAB", answers: ["crowbar"] },
  { prompt: "Unscramble this SCUM item: XEA", answers: ["axe", "an axe"] },
  { prompt: "Unscramble this SCUM item: SACPOMS", answers: ["compass", "a compass"] },
  { prompt: "Unscramble this SCUM item: GILTHER", answers: ["lighter", "a lighter"] },
  { prompt: "Unscramble this SCUM item: NETCANE", answers: ["canteen", "a canteen"] },
  { prompt: "Unscramble this SCUM item: VQREIU", answers: ["quiver", "a quiver"] },
  { prompt: "Unscramble this SCUM item: TSERHOL", answers: ["holster", "a holster"] },
  { prompt: "Unscramble this SCUM item: HCETPRAAU", answers: ["parachute", "a parachute"] },
  { prompt: "Unscramble this SCUM vehicle: AIKAL", answers: ["laika"] },
  { prompt: "Unscramble this SCUM vehicle: FNWOSWAEGL", answers: ["wolfswagen", "wolfs wagen"] },
  { prompt: "Unscramble this SCUM vehicle: TIDRBKIE", answers: ["dirtbike", "dirt bike"] },
  { prompt: "I am used with lockpicks and come in different colors. What am I?", answers: ["screwdriver", "a screwdriver"] },
  { prompt: "I repair damaged vehicle tires. What am I?", answers: ["tire repair kit", "tire kit"] },
  { prompt: "I repair a vehicle chassis. What am I?", answers: ["car repair kit", "vehicle repair kit"] },
  { prompt: "I lift a vehicle so tires can be serviced. What am I?", answers: ["car jack", "jack", "a car jack"] },
  { prompt: "I carry fuel when your vehicle is running dry. What am I?", answers: ["gasoline canister", "gas canister", "fuel can", "gas can"] },
  { prompt: "I point north and help with navigation. What am I?", answers: ["compass", "a compass"] },
  { prompt: "I help repair torn clothing. What am I?", answers: ["sewing kit", "a sewing kit"] },
  { prompt: "I let you look far across the island using two lenses. What am I?", answers: ["binoculars", "binocular"] },
  { prompt: "I hold arrows on your body. What am I?", answers: ["quiver", "a quiver"] },
  { prompt: "I hold a handgun on your body. What am I?", answers: ["holster", "a holster"] },
  { prompt: "I slow your fall from the sky. What am I?", answers: ["parachute", "a parachute"] },
  { prompt: "I am used to chop trees and wood. What am I?", answers: ["axe", "an axe"] },
  { prompt: "I can pry and force objects. What am I?", answers: ["crowbar", "a crowbar"] },
  { prompt: "What skill is used for lockpicking?", answers: ["thievery", "thievery skill"] },
  { prompt: "What skill is used for higher-level base construction?", answers: ["engineering", "engineering skill"] },
  { prompt: "What skill is associated with treating injuries?", answers: ["medical", "medical skill"] },
  { prompt: "What skill is associated with driving cars?", answers: ["driving", "driving skill"] },
  { prompt: "What skill is associated with motorcycles?", answers: ["motorcycling", "motorcycle", "motorcycling skill"] },
  { prompt: "What skill is associated with sneaking quietly?", answers: ["stealth", "stealth skill"] },
  { prompt: "What skill is associated with spotting things around you?", answers: ["awareness", "awareness skill"] },
  { prompt: "What skill is associated with bows?", answers: ["archery", "archery skill"] },
  { prompt: "What skill is associated with unarmed fighting?", answers: ["brawling", "brawling skill"] },
  { prompt: "What skill is associated with crafting unlocks and crafting speed?", answers: ["survival", "survival skill"] },
  { prompt: "Name the compact 4x4-style SCUM car beginning with L.", answers: ["laika"] },
  { prompt: "Name the SCUM car whose name begins with Wolfs.", answers: ["wolfswagen", "wolfs wagen"] },
  { prompt: "Name the two-wheeled motor vehicle available through Outpost X rentals.", answers: ["dirtbike", "dirt bike"] },
  { prompt: "Complete the Outpost X tagline: Survive Together, Die ____.", answers: ["stupid"] },
  { prompt: "What color screwdriver does the Outpost X admin trade give you?", answers: ["yellow", "yellow screwdriver"] },
  { prompt: "How many red screwdrivers are needed for the Outpost X admin trade?", answers: ["35", "thirty five", "thirty-five"] },
  { prompt: "What is the Outpost X player role called?", answers: ["the exiles", "exiles"] },
  { prompt: "What is the name of the Outpost X server intelligence?", answers: ["the watcher", "watcher"] },
  { prompt: "What is the name of the NPC trading location in SCUM?", answers: ["trader", "traders", "trader outpost", "outpost"] },
];

const TRUE_FALSE = [
  { prompt: "Thievery directly affects lockpicking.", correct: true },
  { prompt: "Engineering is an Intelligence skill.", correct: true },
  { prompt: "Driving is a Strength skill.", correct: false },
  { prompt: "Running is a Constitution skill.", correct: true },
  { prompt: "Brawling is a Strength skill.", correct: true },
  { prompt: "Medical is an Intelligence skill.", correct: true },
  { prompt: "A Car Jack is useful when servicing vehicle tires.", correct: true },
  { prompt: "A Sewing Kit is the normal tool for repairing a vehicle chassis.", correct: false },
  { prompt: "A Tire Repair Kit is used to repair damaged tires.", correct: true },
  { prompt: "A Gasoline Canister is used to carry fuel.", correct: true },
  { prompt: "A Quiver is used to carry arrows.", correct: true },
  { prompt: "A Holster is used to carry water.", correct: false },
  { prompt: "The Laika is a vehicle in SCUM.", correct: true },
  { prompt: "The WolfsWagen is a vehicle in SCUM.", correct: true },
  { prompt: "Driving skill can affect vehicle handling and top speed.", correct: true },
  { prompt: "Survival skill can be improved by crafting.", correct: true },
  { prompt: "Outpost X is primarily a PvE server.", correct: true },
  { prompt: "Outpost X dirtbike rentals last 30 minutes.", correct: true },
  { prompt: "The Outpost X Airlift Taxi costs $1,000.", correct: true },
  { prompt: "The Outpost X screwdriver trade requires 35 red screwdrivers.", correct: true },
];

const ODD_ONE_OUT = [
  { prompt: "Which one does NOT belong with lockpicking? 1) Screwdriver 2) Lockpick 3) Gasoline Canister", correct: 3 },
  { prompt: "Which one is NOT a vehicle? 1) Laika 2) WolfsWagen 3) Toolbox", correct: 3 },
  { prompt: "Which one is NOT a vehicle repair item? 1) Car Repair Kit 2) Tire Repair Kit 3) Quiver", correct: 3 },
  { prompt: "Which one is NOT a Strength skill? 1) Brawling 2) Melee Weapons 3) Driving", correct: 3 },
  { prompt: "Which one is NOT an Intelligence skill? 1) Medical 2) Engineering 3) Running", correct: 3 },
  { prompt: "Which one is NOT a Dexterity skill? 1) Thievery 2) Driving 3) Awareness", correct: 3 },
  { prompt: "Which one is NOT normally used for navigation or observation? 1) Compass 2) Binoculars 3) Car Jack", correct: 3 },
  { prompt: "Which one is NOT used with vehicles? 1) Car Jack 2) Gasoline Canister 3) Quiver", correct: 3 },
  { prompt: "Which one is NOT part of the Outpost X player services? 1) Airlift Taxi 2) Dirtbike Rental 3) Gold Lock Factory", correct: 3 },
  { prompt: "Which one is NOT a watercraft? 1) Wooden Motorboat 2) Improvised Raft 3) Laika", correct: 3 },
];

const HIGHER_LOWER = [
  { prompt: "Is 35 higher or lower than the number of red screwdrivers needed for the Outpost X trade?", correct: "same", allowSame: true },
  { prompt: "Is 50 higher or lower than the 35 red screwdrivers needed for the Outpost X trade?", correct: "higher" },
  { prompt: "Is 20 higher or lower than the 35 red screwdrivers needed for the Outpost X trade?", correct: "lower" },
  { prompt: "Is 60 minutes higher or lower than the 30-minute Outpost X dirtbike rental duration?", correct: "higher" },
  { prompt: "Is $500 higher or lower than the $1,000 Outpost X Airlift Taxi price?", correct: "lower" },
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
      "Event Pool: 150 fixed SCUM/Outpost X trivia questions + number guess and mystery signals",
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
