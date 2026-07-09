const fs = require("fs");
const path = require("path");
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { createClient } = require("@supabase/supabase-js");

const DEFAULT_GGCON_BASE_URL = "https://ggcon.gghost.games/s/2788404";
const STATUS_FILE = path.join(__dirname, "data", "ggcon-status.json");
const VEHICLE_WATCH_FILE = path.join(__dirname, "data", "ggcon-vehicle-watch.json");
const VEHICLE_STATE_FILE = path.join(__dirname, "data", "ggcon-vehicle-state.json");
const KILL_LOG_FILE = path.join(__dirname, "data", "ggcon-kill-log.json");
const KILL_STATE_FILE = path.join(__dirname, "data", "ggcon-kill-state.json");
const CARGO_SCHEDULE_FILE = path.join(__dirname, "data", "ggcon-cargo-schedule.json");
const JAIL_STATE_FILE = path.join(__dirname, "data", "ggcon-jail-state.json");
const JAIL_RETURNS_TABLE = process.env.GGCON_JAIL_RETURNS_TABLE || "watcher_jail_returns";
const RUNTIME_STATE_TABLE = process.env.WATCHER_RUNTIME_STATE_TABLE || "watcher_runtime_state";
const JAIL_LOCATION = { x: 231926.016, y: -289455.094, z: 16877.357, pitch: 308.556671, yaw: 1.584615, roll: 0 };
const STAFF_ROLE_NAMES = new Set(["Owner", "Owners", "Admin", "Trial Admin"]);
const MAX_PLAYER_SCAN_PAGES = Number(process.env.GGCON_PLAYER_SCAN_PAGES || "10");
const DEFAULT_FLAG_PAGE_SIZE = 5;
const CARGO_FRENZY_COUNT = Number(process.env.GGCON_CARGO_FRENZY_COUNT || "10");
const CARGO_FRENZY_Z = Number(process.env.GGCON_CARGO_FRENZY_Z || "25000");
const CARGO_FRENZY_SAFE_DISTANCE_UNITS = Number(process.env.GGCON_CARGO_SAFE_DISTANCE_UNITS || "30000");
const CARGO_FRENZY_FLAG_BUFFER_UNITS = Number(process.env.GGCON_CARGO_FLAG_BUFFER_UNITS || "25000");
const CARGO_FRENZY_DROP_SPACING_UNITS = Number(process.env.GGCON_CARGO_DROP_SPACING_UNITS || "75000");
const CARGO_FRENZY_GRID_STEP_UNITS = Number(process.env.GGCON_CARGO_GRID_STEP_UNITS || "80000");
const CARGO_FRENZY_EVENT_NAME = process.env.GGCON_CARGO_EVENT_NAME || "BP_CargoDropEvent";
const CARGO_SCHEDULE_TIMEZONE = process.env.GGCON_CARGO_SCHEDULE_TIMEZONE || "America/Toronto";
const CARGO_SCHEDULE_HOURS = String(process.env.GGCON_CARGO_SCHEDULE_HOURS || "0,4,8,12,16,20")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value) && value >= 0 && value <= 23);
const CARGO_SCHEDULE_MINUTE = Number(process.env.GGCON_CARGO_SCHEDULE_MINUTE || "30");
const CARGO_SCHEDULE_WINDOW_MINUTES = Number(process.env.GGCON_CARGO_SCHEDULE_WINDOW_MINUTES || "4");
const CARGO_SCHEDULE_WAKE_BUFFER_MS = Number(process.env.GGCON_CARGO_SCHEDULE_WAKE_BUFFER_MS || "3000");
const CARGO_FRENZY_HAND_PICKED_POINTS = [
  { x: -560000, y: -660000 }, { x: -480000, y: -650000 }, { x: -400000, y: -640000 }, { x: -320000, y: -630000 },
  { x: -240000, y: -650000 }, { x: -160000, y: -640000 }, { x: -80000, y: -625000 }, { x: 0, y: -645000 },
  { x: 80000, y: -625000 }, { x: 160000, y: -650000 }, { x: 240000, y: -620000 }, { x: 320000, y: -600000 },
  { x: 400000, y: -570000 }, { x: 500000, y: -530000 }, { x: 560000, y: -460000 },

  { x: -570000, y: -520000 }, { x: -490000, y: -500000 }, { x: -410000, y: -485000 }, { x: -330000, y: -470000 },
  { x: -250000, y: -500000 }, { x: -170000, y: -470000 }, { x: -90000, y: -500000 }, { x: -10000, y: -465000 },
  { x: 70000, y: -500000 }, { x: 150000, y: -470000 }, { x: 230000, y: -500000 }, { x: 310000, y: -460000 },
  { x: 390000, y: -430000 }, { x: 470000, y: -400000 }, { x: 550000, y: -360000 },

  { x: -580000, y: -360000 }, { x: -500000, y: -340000 }, { x: -420000, y: -320000 }, { x: -340000, y: -350000 },
  { x: -260000, y: -320000 }, { x: -180000, y: -350000 }, { x: -100000, y: -320000 }, { x: -20000, y: -350000 },
  { x: 60000, y: -320000 }, { x: 140000, y: -350000 }, { x: 220000, y: -320000 }, { x: 300000, y: -350000 },
  { x: 380000, y: -315000 }, { x: 460000, y: -285000 }, { x: 540000, y: -250000 },

  { x: -560000, y: -180000 }, { x: -480000, y: -150000 }, { x: -400000, y: -190000 }, { x: -320000, y: -140000 },
  { x: -240000, y: -180000 }, { x: -160000, y: -140000 }, { x: -80000, y: -180000 }, { x: 0, y: -130000 },
  { x: 80000, y: -180000 }, { x: 160000, y: -140000 }, { x: 240000, y: -180000 }, { x: 320000, y: -130000 },
  { x: 400000, y: -170000 }, { x: 480000, y: -120000 }, { x: 560000, y: -90000 },

  { x: -540000, y: 20000 }, { x: -460000, y: 50000 }, { x: -380000, y: 10000 }, { x: -300000, y: 60000 },
  { x: -220000, y: 20000 }, { x: -140000, y: 65000 }, { x: -60000, y: 20000 }, { x: 20000, y: 70000 },
  { x: 100000, y: 20000 }, { x: 180000, y: 70000 }, { x: 260000, y: 25000 }, { x: 340000, y: 75000 },
  { x: 420000, y: 35000 }, { x: 500000, y: 90000 }, { x: 580000, y: 130000 },

  { x: -520000, y: 210000 }, { x: -440000, y: 240000 }, { x: -360000, y: 200000 }, { x: -280000, y: 250000 },
  { x: -200000, y: 210000 }, { x: -120000, y: 260000 }, { x: -40000, y: 220000 }, { x: 40000, y: 270000 },
  { x: 120000, y: 230000 }, { x: 200000, y: 280000 }, { x: 280000, y: 240000 }, { x: 360000, y: 290000 },
  { x: 440000, y: 250000 }, { x: 520000, y: 300000 },

  { x: -500000, y: 410000 }, { x: -420000, y: 440000 }, { x: -340000, y: 400000 }, { x: -260000, y: 450000 },
  { x: -180000, y: 410000 }, { x: -100000, y: 460000 }, { x: -20000, y: 420000 }, { x: 60000, y: 470000 },
  { x: 140000, y: 430000 }, { x: 220000, y: 480000 }, { x: 300000, y: 440000 }, { x: 380000, y: 490000 },
  { x: 460000, y: 450000 }, { x: 540000, y: 500000 },

  { x: -420000, y: 620000 }, { x: -320000, y: 650000 }, { x: -220000, y: 610000 }, { x: -120000, y: 660000 },
  { x: -20000, y: 620000 }, { x: 80000, y: 670000 }, { x: 180000, y: 630000 }, { x: 280000, y: 660000 },
  { x: 380000, y: 620000 }, { x: 480000, y: 650000 },
];

const SIMPLE_VEHICLE_ALIASES = {
  duster: ["BPC_Duster", "Duster"],
  tractor: ["BPC_Tractor", "Tractor"],
  laika: ["BPC_Laika", "Laika"],
  mariner: ["BPC_Mariner", "Mariner"],
  rager: ["BPC_Rager", "Rager"],
  ww: ["BPC_WolfsWagen", "BPC_Wolfswagen", "BPC_WolfsWagon", "BPC_Wolfswagon", "WolfsWagen", "Wolfswagen", "Wolfswagon"],
  wolfswagon: ["BPC_WolfsWagen", "BPC_Wolfswagen", "BPC_WolfsWagon", "BPC_Wolfswagon", "WolfsWagen", "Wolfswagon"],
  wolfswagen: ["BPC_WolfsWagen", "BPC_Wolfswagen", "WolfsWagen", "Wolfswagen"],
  volkswagen: ["BPC_WolfsWagen", "BPC_Wolfswagen", "BPC_WolfsWagon", "BPC_Wolfswagon", "WolfsWagen", "Wolfswagen", "Wolfswagon"],
  wolf: ["BPC_WolfsWagen", "BPC_Wolfswagen", "WolfsWagen", "Wolfswagen"],
};

const SIMPLE_VEHICLE_NAMES = "duster, tractor, laika, mariner, rager, ww/wolfswagon";

let statusTimer = null;
let vehicleWatchTimer = null;
let killLogTimer = null;
let cargoScheduleTimer = null;
let cargoScheduleNextSlot = null;
let cargoScheduleRunning = false;
let supabaseForGgcon = null;

function getSupabaseForGgcon() {
  if (supabaseForGgcon) return supabaseForGgcon;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!url || !key) return null;

  supabaseForGgcon = createClient(url, key, {
    auth: { persistSession: false },
  });

  return supabaseForGgcon;
}

function getGuildIdFromContext(context) {
  return context?.guild?.id || context?.guildId || "default";
}

function getDiscordActorId(context) {
  return context?.user?.id || context?.author?.id || context?.member?.user?.id || null;
}

function getDiscordActorName(context) {
  return context?.member?.displayName || context?.user?.tag || context?.author?.tag || "Unknown";
}

function getBaseUrl() {
  return (process.env.GGCON_BASE_URL || DEFAULT_GGCON_BASE_URL).replace(/\/+$/, "");
}

function getPassword() {
  const password = process.env.GGCON_PASSWORD;
  if (!password) {
    throw new Error("Missing server API password Railway variable.");
  }
  return password;
}

function hasPasswordConfigured() {
  return !!process.env.GGCON_PASSWORD;
}

async function ggconGet(endpoint) {
  const url = `${getBaseUrl()}${endpoint}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-Password": getPassword(),
    },
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const reason = data?.reason || data?.message || data?.error || `HTTP ${res.status}`;
    throw new Error(`Server request failed: ${reason}`);
  }

  if (data && data.ok === false) {
    const reason = data.reason || data.message || data.error || "Unknown server API error";
    throw new Error(`Server request failed: ${reason}`);
  }

  return data;
}

async function ggconPost(endpoint, body = {}) {
  const url = `${getBaseUrl()}${endpoint}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Password": getPassword(),
    },
    body: JSON.stringify(body || {}),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const reason = data?.reason || data?.message || data?.error || `HTTP ${res.status}`;
    throw new Error(`Server request failed: ${reason}`);
  }

  if (data && data.ok === false) {
    const reason = data.reason || data.message || data.error || "Unknown server API error";
    throw new Error(`Server request failed: ${reason}`);
  }

  return data || { ok: true };
}

async function ggconPostRaw(endpoint, body = {}) {
  const url = `${getBaseUrl()}${endpoint}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Password": getPassword(),
      },
      body: JSON.stringify(body || {}),
    });

    const data = await res.json().catch(() => null);

    return {
      httpOk: res.ok,
      status: res.status,
      data,
      error: null,
    };
  } catch (err) {
    return {
      httpOk: false,
      status: 0,
      data: null,
      error: err?.message || String(err),
    };
  }
}

function hasStaffRole(member) {
  const roles = member?.roles?.cache;
  if (!roles) return false;

  return roles.some((role) => STAFF_ROLE_NAMES.has(role.name));
}

function isStaff(message) {
  if (!message.guild || !message.member) return false;
  return hasStaffRole(message.member);
}

function isOwner(message) {
  if (!message.guild || !message.member) return false;
  const roles = message.member.roles?.cache;
  if (!roles) return false;
  return roles.some((role) => role.name === "Owner" || role.name === "Owners");
}

function isStaffInteraction(interaction) {
  if (!interaction.guild || !interaction.member) return false;
  return hasStaffRole(interaction.member);
}

function ensureDataFolder() {
  const folder = path.dirname(STATUS_FILE);
  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
}

function runtimeKey(name) {
  return String(name || "").trim();
}

async function loadRuntimeValue(key) {
  const db = getSupabaseForGgcon();
  if (!db) return null;

  const { data, error } = await db
    .from(RUNTIME_STATE_TABLE)
    .select("value")
    .eq("key", runtimeKey(key))
    .maybeSingle();

  if (error) {
    console.warn(`⚠️ Persistent state read failed for ${key}: ${error.message}`);
    return null;
  }

  return data?.value ?? null;
}

async function saveRuntimeValue(key, value) {
  const db = getSupabaseForGgcon();
  if (!db) return false;

  const { error } = await db
    .from(RUNTIME_STATE_TABLE)
    .upsert(
      {
        key: runtimeKey(key),
        value: value || {},
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" }
    );

  if (error) {
    console.warn(`⚠️ Persistent state write failed for ${key}: ${error.message}`);
    return false;
  }

  return true;
}

async function clearRuntimeValue(key) {
  const db = getSupabaseForGgcon();
  if (!db) return false;

  const { error } = await db
    .from(RUNTIME_STATE_TABLE)
    .delete()
    .eq("key", runtimeKey(key));

  if (error) {
    console.warn(`⚠️ Persistent state clear failed for ${key}: ${error.message}`);
    return false;
  }

  return true;
}

function writeJsonFile(file, value) {
  ensureDataFolder();
  fs.writeFileSync(file, JSON.stringify(value || {}, null, 2));
}

async function loadVehicleWatchConfigPersistent() {
  const remote = await loadRuntimeValue("vehicle_watch_config");
  if (remote) {
    saveVehicleWatchConfig(remote);
    return remote;
  }
  return loadVehicleWatchConfig();
}

async function saveVehicleWatchConfigPersistent(config) {
  saveVehicleWatchConfig(config);
  await saveRuntimeValue("vehicle_watch_config", config);
}

async function clearVehicleWatchConfigPersistent() {
  clearVehicleWatchConfig();
  await clearRuntimeValue("vehicle_watch_config");
}

async function loadVehicleStatePersistent() {
  const remote = await loadRuntimeValue("vehicle_watch_state");
  if (remote) {
    saveVehicleState(remote);
    return remote;
  }
  return loadVehicleState();
}

async function saveVehicleStatePersistent(state) {
  saveVehicleState(state);
  await saveRuntimeValue("vehicle_watch_state", state);
}

async function loadKillLogConfigPersistent() {
  const remote = await loadRuntimeValue("kill_log_config");
  if (remote) {
    saveKillLogConfig(remote);
    return remote;
  }
  return loadKillLogConfig();
}

async function saveKillLogConfigPersistent(config) {
  saveKillLogConfig(config);
  await saveRuntimeValue("kill_log_config", config);
}

async function clearKillLogConfigPersistent() {
  clearKillLogConfig();
  await clearRuntimeValue("kill_log_config");
}

async function loadKillStatePersistent() {
  const remote = await loadRuntimeValue("kill_log_state");
  if (remote) {
    saveKillState(remote);
    return remote;
  }
  return loadKillState();
}

async function saveKillStatePersistent(state) {
  saveKillState(state);
  await saveRuntimeValue("kill_log_state", state);
}


function loadStatusRef() {
  try {
    if (!fs.existsSync(STATUS_FILE)) return null;
    return JSON.parse(fs.readFileSync(STATUS_FILE, "utf8"));
  } catch {
    return null;
  }
}

function saveStatusRef(ref) {
  ensureDataFolder();
  fs.writeFileSync(STATUS_FILE, JSON.stringify(ref, null, 2));
}

function loadVehicleWatchConfig() {
  try {
    if (!fs.existsSync(VEHICLE_WATCH_FILE)) return null;
    return JSON.parse(fs.readFileSync(VEHICLE_WATCH_FILE, "utf8"));
  } catch {
    return null;
  }
}

function saveVehicleWatchConfig(config) {
  ensureDataFolder();
  fs.writeFileSync(VEHICLE_WATCH_FILE, JSON.stringify(config, null, 2));
}

function loadVehicleState() {
  try {
    if (!fs.existsSync(VEHICLE_STATE_FILE)) return null;
    return JSON.parse(fs.readFileSync(VEHICLE_STATE_FILE, "utf8"));
  } catch {
    return null;
  }
}

function saveVehicleState(state) {
  ensureDataFolder();
  fs.writeFileSync(VEHICLE_STATE_FILE, JSON.stringify(state, null, 2));
}

function clearVehicleWatchConfig() {
  try {
    if (fs.existsSync(VEHICLE_WATCH_FILE)) fs.unlinkSync(VEHICLE_WATCH_FILE);
  } catch {}
}

function loadKillLogConfig() {
  try {
    if (!fs.existsSync(KILL_LOG_FILE)) return null;
    return JSON.parse(fs.readFileSync(KILL_LOG_FILE, "utf8"));
  } catch {
    return null;
  }
}

function saveKillLogConfig(config) {
  ensureDataFolder();
  fs.writeFileSync(KILL_LOG_FILE, JSON.stringify(config, null, 2));
}

function clearKillLogConfig() {
  try {
    if (fs.existsSync(KILL_LOG_FILE)) fs.unlinkSync(KILL_LOG_FILE);
  } catch {}
}

function loadKillState() {
  try {
    if (!fs.existsSync(KILL_STATE_FILE)) return null;
    return JSON.parse(fs.readFileSync(KILL_STATE_FILE, "utf8"));
  } catch {
    return null;
  }
}

function saveKillState(state) {
  ensureDataFolder();
  fs.writeFileSync(KILL_STATE_FILE, JSON.stringify(state, null, 2));
}

function loadCargoScheduleConfig() {
  try {
    if (!fs.existsSync(CARGO_SCHEDULE_FILE)) return null;
    return JSON.parse(fs.readFileSync(CARGO_SCHEDULE_FILE, "utf8"));
  } catch {
    return null;
  }
}

function saveCargoScheduleConfig(config) {
  ensureDataFolder();
  fs.writeFileSync(CARGO_SCHEDULE_FILE, JSON.stringify(config, null, 2));
}

function clearCargoScheduleConfig() {
  try {
    if (fs.existsSync(CARGO_SCHEDULE_FILE)) fs.unlinkSync(CARGO_SCHEDULE_FILE);
  } catch {}
}

function normalizeJailState(state) {
  if (!state || typeof state !== "object") return { players: {}, guilds: {} };
  if (!state.players || typeof state.players !== "object") state.players = {};
  if (!state.guilds || typeof state.guilds !== "object") state.guilds = {};
  return state;
}

function getLocalJailBucket(state, guildId) {
  const normalized = normalizeJailState(state);
  const key = String(guildId || "default");
  if (!normalized.guilds[key]) normalized.guilds[key] = { players: {} };
  if (!normalized.guilds[key].players || typeof normalized.guilds[key].players !== "object") {
    normalized.guilds[key].players = {};
  }
  return normalized.guilds[key].players;
}

function loadJailStateLocal() {
  try {
    if (!fs.existsSync(JAIL_STATE_FILE)) return { players: {}, guilds: {} };
    const parsed = JSON.parse(fs.readFileSync(JAIL_STATE_FILE, "utf8"));
    return normalizeJailState(parsed);
  } catch {
    return { players: {}, guilds: {} };
  }
}

function saveJailStateLocal(state) {
  ensureDataFolder();
  fs.writeFileSync(JAIL_STATE_FILE, JSON.stringify(normalizeJailState(state || { players: {}, guilds: {} }), null, 2));
}

function rowToJailEntry(row) {
  if (!row) return null;
  return {
    steamId: row.steam_id,
    displayName: row.player_name || row.steam_name || row.steam_id,
    steamName: row.steam_name || null,
    location: {
      x: Number(row.return_x),
      y: Number(row.return_y),
      z: Number(row.return_z),
    },
    rotation: {
      pitch: row.return_pitch === null || row.return_pitch === undefined ? null : Number(row.return_pitch),
      yaw: row.return_yaw === null || row.return_yaw === undefined ? null : Number(row.return_yaw),
      roll: row.return_roll === null || row.return_roll === undefined ? null : Number(row.return_roll),
    },
    jailedAt: row.created_at || null,
    jailedBy: row.jailed_by_name || null,
    jailedByDiscordId: row.jailed_by_discord_id || null,
    source: "supabase",
  };
}

async function getJailReturnFromSupabase(guildId, steamId) {
  const db = getSupabaseForGgcon();
  if (!db) return null;

  const { data, error } = await db
    .from(JAIL_RETURNS_TABLE)
    .select("*")
    .eq("guild_id", String(guildId || "default"))
    .eq("steam_id", String(steamId || ""))
    .maybeSingle();

  if (error) throw error;
  return rowToJailEntry(data);
}

async function saveJailReturnToSupabase(guildId, steamId, entry) {
  const db = getSupabaseForGgcon();
  if (!db) return false;

  const location = cloneLocation(entry?.location);
  if (!location) return false;

  const { error } = await db
    .from(JAIL_RETURNS_TABLE)
    .upsert(
      {
        guild_id: String(guildId || "default"),
        steam_id: String(steamId || ""),
        player_name: entry.displayName || null,
        steam_name: entry.steamName || null,
        return_x: location.x,
        return_y: location.y,
        return_z: location.z,
        return_pitch: entry.rotation?.pitch ?? null,
        return_yaw: entry.rotation?.yaw ?? null,
        return_roll: entry.rotation?.roll ?? null,
        jailed_by_discord_id: entry.jailedByDiscordId || null,
        jailed_by_name: entry.jailedBy || null,
      },
      { onConflict: "guild_id,steam_id" }
    );

  if (error) throw error;
  return true;
}

async function deleteJailReturnFromSupabase(guildId, steamId) {
  const db = getSupabaseForGgcon();
  if (!db) return false;

  const { error } = await db
    .from(JAIL_RETURNS_TABLE)
    .delete()
    .eq("guild_id", String(guildId || "default"))
    .eq("steam_id", String(steamId || ""));

  if (error) throw error;
  return true;
}

function isUsableLocation(location) {
  if (!location) return false;
  return [location.x, location.y, location.z].every((value) => Number.isFinite(Number(value)));
}

function cloneLocation(location) {
  if (!isUsableLocation(location)) return null;
  return {
    x: Number(location.x),
    y: Number(location.y),
    z: Number(location.z),
  };
}

function getKillLogChannelId() {
  return process.env.GGCON_KILL_LOG_CHANNEL_ID || loadKillLogConfig()?.channelId || null;
}

function getVehicleLogChannelId() {
  return process.env.GGCON_VEHICLE_LOG_CHANNEL_ID || loadVehicleWatchConfig()?.channelId || null;
}

async function getKillLogChannelIdAsync() {
  if (process.env.GGCON_KILL_LOG_CHANNEL_ID) return process.env.GGCON_KILL_LOG_CHANNEL_ID;
  return (await loadKillLogConfigPersistent())?.channelId || null;
}

async function getVehicleLogChannelIdAsync() {
  if (process.env.GGCON_VEHICLE_LOG_CHANNEL_ID) return process.env.GGCON_VEHICLE_LOG_CHANNEL_ID;
  return (await loadVehicleWatchConfigPersistent())?.channelId || null;
}

function formatGameTime(timeOfDay) {
  if (timeOfDay === null || timeOfDay === undefined || Number.isNaN(Number(timeOfDay))) {
    return "Unknown";
  }

  const totalMinutes = Math.round(Number(timeOfDay) * 60);
  const hours = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatDate(value) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleString("en-CA", {
    timeZone: process.env.SERVER_TIMEZONE || "America/Toronto",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatLocation(location) {
  if (!location) return "Unknown";

  return `X: ${Math.round(Number(location.x || 0))} | Y: ${Math.round(Number(location.y || 0))} | Z: ${Math.round(Number(location.z || 0))}`;
}

function distanceUnrealUnits(a, b) {
  if (!a || !b) return null;
  const ax = Number(a.x);
  const ay = Number(a.y);
  const az = Number(a.z || 0);
  const bx = Number(b.x);
  const by = Number(b.y);
  const bz = Number(b.z || 0);

  if (![ax, ay, az, bx, by, bz].every(Number.isFinite)) return null;

  const dx = ax - bx;
  const dy = ay - by;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function distance2DUnrealUnits(a, b) {
  if (!a || !b) return null;
  const ax = Number(a.x);
  const ay = Number(a.y);
  const bx = Number(b.x);
  const by = Number(b.y);

  if (![ax, ay, bx, by].every(Number.isFinite)) return null;

  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

function formatApproxDistance(unrealUnits) {
  if (unrealUnits === null || unrealUnits === undefined || !Number.isFinite(Number(unrealUnits))) return "Unknown";
  const metres = Number(unrealUnits) / 100;
  if (metres >= 1000) return `${(metres / 1000).toFixed(2)} km approx`;
  return `${Math.round(metres)} m approx`;
}

function formatHealth(health) {
  if (health === null || health === undefined) return "Offline / Unknown";
  return `${Math.round(Number(health) * 100)}%`;
}

function formatMoney(value) {
  if (value === null || value === undefined) return "Unknown";
  return Number(value).toLocaleString("en-CA");
}

function formatBodyEffects(effects) {
  if (!Array.isArray(effects) || effects.length === 0) return "None";

  return effects
    .slice(0, 8)
    .map((effect) => {
      const name = effect.name || "Unknown";
      const severity = effect.severity !== undefined && effect.maxSeverity !== undefined
        ? ` ${effect.severity}/${effect.maxSeverity}`
        : "";
      const stage = effect.stage && effect.stage !== "none" ? `, ${effect.stage}` : "";
      return `• ${name}${severity}${stage}`;
    })
    .join("\n");
}

function formatAttributes(attributes) {
  if (!attributes) return "Unknown";

  return [
    `STR: ${attributes.strength ?? "?"}`,
    `CON: ${attributes.constitution ?? "?"}`,
    `DEX: ${attributes.dexterity ?? "?"}`,
    `INT: ${attributes.intelligence ?? "?"}`,
  ].join(" | ");
}

function formatSkills(skills) {
  if (!Array.isArray(skills) || skills.length === 0) return "Offline / Unknown";

  return skills
    .slice(0, 12)
    .map((skill) => `• ${skill.name || `Skill ${skill.id}`}: ${skill.levelName || skill.level || "Unknown"}`)
    .join("\n");
}

function clampDiscord(text, max = 1900) {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 40)}\n\n_Output trimmed to fit Discord._`;
}

function buildStatusMessage(server) {
  const updated = new Date().toLocaleString("en-CA", {
    timeZone: process.env.SERVER_TIMEZONE || "America/Toronto",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  return [
    "🛰️ **Outpost X Server Status**",
    "",
    `**Players Online:** ${server.onlinePlayers ?? "Unknown"}`,
    `**SCUM Version:** ${server.scumVersion || "Unknown"}`,
    `**In-Game Time:** ${formatGameTime(server.timeOfDay)}`,
    "",
    `_Last updated: ${updated} ET_`,
  ].join("\n");
}

async function updateStatusMessage(bot) {
  const ref = loadStatusRef();
  if (!ref?.channelId || !ref?.messageId) return;

  const server = await ggconGet("/server.json");
  const content = buildStatusMessage(server);

  const channel = await bot.channels.fetch(ref.channelId).catch(() => null);
  if (!channel?.messages) return;

  const statusMessage = await channel.messages.fetch(ref.messageId).catch(() => null);
  if (!statusMessage) return;

  await statusMessage.edit(content);
}

function ensureStatusLoop(bot) {
  if (statusTimer) return;

  const seconds = Number(process.env.GGCON_STATUS_INTERVAL_SECONDS || "120");
  const intervalMs = Math.max(60, Number.isFinite(seconds) ? seconds : 120) * 1000;

  statusTimer = setInterval(() => {
    updateStatusMessage(bot).catch((err) => {
      console.error("❌ Server status update failed:", err.message);
    });
  }, intervalMs);
}

async function handlePostStatus(message, bot) {
  const server = await ggconGet("/server.json");
  const content = buildStatusMessage(server);
  const existing = loadStatusRef();

  if (existing?.channelId && existing?.messageId) {
    const oldChannel = await bot.channels.fetch(existing.channelId).catch(() => null);
    const oldMessage = oldChannel?.messages
      ? await oldChannel.messages.fetch(existing.messageId).catch(() => null)
      : null;

    if (oldMessage) {
      await oldMessage.edit(content);
      await message.reply("Status post updated. I edited the saved status message instead of creating another one.").catch(() => {});
      ensureStatusLoop(bot);
      return;
    }
  }

  const sent = await message.channel.send(content);
  saveStatusRef({ channelId: message.channel.id, messageId: sent.id });
  ensureStatusLoop(bot);

  await message.reply("Status post created. I will keep editing that one message.").catch(() => {});
}

async function handleServerStatus(message) {
  const server = await ggconGet("/server.json");
  const fpsParts = [];
  if (server.fps !== null && server.fps !== undefined) fpsParts.push(`Current: ${Number(server.fps).toFixed(1)}`);
  if (server.avgFps !== null && server.avgFps !== undefined) fpsParts.push(`Avg: ${Number(server.avgFps).toFixed(1)}`);
  if (server.minFps !== null && server.minFps !== undefined) fpsParts.push(`Min: ${Number(server.minFps).toFixed(1)}`);

  const reply = [
    "🛰️ **Outpost X Server**",
    "",
    `**Status:** ${server.online ? "Online" : "Offline"}`,
    `**Players Online:** ${server.onlinePlayers ?? "Unknown"}`,
    `**SCUM Version:** ${server.scumVersion || "Unknown"}`,
    `**In-Game Time:** ${formatGameTime(server.timeOfDay)}`,
    `**Server FPS:** ${fpsParts.length ? fpsParts.join(" | ") : "Unknown"}`,
  ].join("\n");

  await message.reply(reply).catch(() => {});
}

function isSteamId(value) {
  return /^\d{17}$/.test(String(value || "").trim());
}

function normalizePlayerText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[`~!@#$%^&*()_+=\[\]{};:'"\\|,.<>/?-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getPlayerSearchFields(player) {
  return [
    player.characterName,
    player.steamName,
    player.realName,
    player.fakeName,
    player.userId,
  ].filter(Boolean).map(String);
}

function mergePlayers(primary, secondary) {
  return { ...(secondary || {}), ...(primary || {}) };
}

function dedupePlayers(players) {
  const bySteamId = new Map();
  const noSteam = [];

  for (const player of players || []) {
    const steamId = String(player.userId || player.steamId || "").trim();
    const normalized = steamId ? { ...player, userId: steamId } : player;

    if (!steamId) {
      noSteam.push(normalized);
      continue;
    }

    bySteamId.set(steamId, mergePlayers(normalized, bySteamId.get(steamId)));
  }

  return [...bySteamId.values(), ...noSteam];
}

function matchScore(player, query) {
  const rawQuery = String(query || "").trim();
  const q = normalizePlayerText(rawQuery);
  if (!q) return 0;

  if (isSteamId(rawQuery) && String(player.userId || player.steamId || "") === rawQuery) return 1000;

  let best = 0;

  for (const field of getPlayerSearchFields(player)) {
    const rawField = String(field || "").trim();
    const f = normalizePlayerText(rawField);
    if (!f) continue;

    if (f === q) best = Math.max(best, 900);
    else if (f.startsWith(q)) best = Math.max(best, 800);
    else if (f.includes(q)) best = Math.max(best, 650);

    const words = f.split(" ").filter(Boolean);
    if (words.some((word) => word === q)) best = Math.max(best, 850);
    else if (words.some((word) => word.startsWith(q))) best = Math.max(best, 775);
  }

  if (best > 0 && player.online) best += 25;
  return best;
}

async function getOnlinePlayers() {
  const data = await ggconGet("/players.json").catch(() => ({ players: [] }));
  return Array.isArray(data.players) ? data.players.map((player) => ({ ...player, online: true })) : [];
}

async function getAllPlayersByApiSearch(query) {
  const cleaned = String(query || "").trim();
  if (cleaned.length < 2) return [];

  const data = await ggconGet(`/players/all.json?search=${encodeURIComponent(cleaned)}&page=1`).catch(() => ({ players: [] }));
  return Array.isArray(data.players) ? data.players : [];
}

async function scanAllPlayerPages() {
  const players = [];
  let page = 1;
  let total = null;

  while (page <= Math.max(1, MAX_PLAYER_SCAN_PAGES)) {
    const data = await ggconGet(`/players/all.json?page=${page}`).catch(() => null);
    if (!data || !Array.isArray(data.players) || data.players.length === 0) break;

    players.push(...data.players);
    total = Number(data.total || total || 0);

    if (players.length >= total) break;
    page += 1;
  }

  return players;
}

async function searchPlayers(query) {
  const cleaned = String(query || "").trim();
  if (!cleaned) return [];

  const [onlinePlayers, apiSearchPlayers] = await Promise.all([
    getOnlinePlayers(),
    getAllPlayersByApiSearch(cleaned),
  ]);

  let combined = dedupePlayers([...onlinePlayers, ...apiSearchPlayers]);
  let matches = combined
    .map((player) => ({ player, score: matchScore(player, cleaned) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.player);

  // Fallback: if the server search did not find an offline player, scan the first player pages locally.
  // This lets staff use short partial names instead of full names or Steam IDs.
  if (matches.length === 0 || cleaned.length < 3) {
    const scannedPlayers = await scanAllPlayerPages();
    combined = dedupePlayers([...onlinePlayers, ...apiSearchPlayers, ...scannedPlayers]);
    matches = combined
      .map((player) => ({ player, score: matchScore(player, cleaned) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.player);
  }

  return matches;
}

function buildPlayerLabel(player, index) {
  const name = String(player.characterName || player.steamName || player.realName || "Unknown").slice(0, 70);
  return `${index + 1}. ${name}`;
}

function buildMatchButtons(matches, commandName) {
  const action = commandName === "!vehicle" || commandName === "!vehicles" ? "vehicle" : commandName === "!flag" || commandName === "!flags" ? "flag" : commandName === "!squad" ? "squad" : commandName === "!nearvehicles" ? "nearvehicles" : commandName === "!jail" ? "jail" : commandName === "!unjail" ? "unjail" : "player";
  const usable = matches.filter((player) => player.userId).slice(0, 10);
  const rows = [];

  for (let i = 0; i < usable.length; i += 5) {
    const row = new ActionRowBuilder();

    usable.slice(i, i + 5).forEach((player, offset) => {
      const index = i + offset;
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`ggcon:${action}:${player.userId}`)
          .setLabel(String(index + 1))
          .setStyle(ButtonStyle.Primary)
      );
    });

    rows.push(row);
  }

  return rows;
}

function buildMultipleMatchesReply(query, matches, commandName) {
  const rows = matches.slice(0, 10).map((player, index) => {
    const fieldHints = [];
    if (player.steamName && player.steamName !== player.characterName) fieldHints.push(`Steam: ${player.steamName}`);
    if (player.realName && player.realName !== player.characterName) fieldHints.push(`Real: ${player.realName}`);
    if (player.fakeName) fieldHints.push(`Alias: ${player.fakeName}`);

    return [
      `**${buildPlayerLabel(player, index)}**`,
      `Steam ID: \`${player.userId || "Unknown"}\``,
      `Status: ${player.online ? "Online" : "Offline"}`,
      fieldHints.length ? fieldHints.join(" | ") : null,
      player.lastLogin ? `Last login: ${formatDate(player.lastLogin)}` : null,
    ].filter(Boolean).join("\n");
  });

  const extra = matches.length > 10 ? `\n\nShowing 10 of ${matches.length} matches.` : "";

  return clampDiscord([
    `Multiple players matched **${query}**.`,
    "",
    rows.join("\n\n"),
    extra,
    "",
    "Click a number below. You do not need to type the full name or Steam ID.",
  ].join("\n"));
}

async function getPlayerForLookup(query) {
  const cleaned = String(query || "").trim();

  if (isSteamId(cleaned)) {
    const allMatches = await searchPlayers(cleaned).catch(() => []);
    const exact = allMatches.find((player) => String(player.userId) === cleaned);

    try {
      const live = await ggconGet(`/players/${encodeURIComponent(cleaned)}.json`);
      return { type: "single", player: { ...(exact || {}), ...(live.player || live), userId: cleaned } };
    } catch {
      if (exact) return { type: "single", player: exact };
      return { type: "none" };
    }
  }

  const matches = await searchPlayers(cleaned);

  if (matches.length === 0) return { type: "none" };
  if (matches.length > 1) return { type: "multiple", matches };

  const single = matches[0];

  if (single.userId) {
    try {
      const live = await ggconGet(`/players/${encodeURIComponent(single.userId)}.json`);
      return { type: "single", player: { ...single, ...(live.player || live) } };
    } catch {
      return { type: "single", player: single };
    }
  }

  return { type: "single", player: single };
}

async function handlePlayerLookup(message, args) {
  const query = args.join(" ").trim();

  if (!query) {
    await message.reply("Use: `!player <name or Steam ID>`").catch(() => {});
    return;
  }

  const result = await getPlayerForLookup(query);

  if (result.type === "none") {
    await message.reply(`No player found for **${query}**.`).catch(() => {});
    return;
  }

  if (result.type === "multiple") {
    await message.reply({
      content: buildMultipleMatchesReply(query, result.matches, "!player"),
      components: buildMatchButtons(result.matches, "!player"),
    }).catch(() => {});
    return;
  }

  const player = result.player;
  const online = player.online === true || player.ping !== undefined || player.health !== undefined;
  const squad = player.squad?.name
    ? `${player.squad.name}${player.squad.members !== undefined ? ` (${player.squad.members} members)` : ""}`
    : "None / Unknown";

  const reply = [
    `👤 **Player Lookup: ${player.characterName || player.realName || "Unknown"}**`,
    "",
    `**Status:** ${online ? "Online" : "Offline"}`,
    `**Steam ID:** \`${player.userId || "Unknown"}\``,
    `**Steam Name:** ${player.steamName || "Unknown"}`,
    `**Fame:** ${formatMoney(player.fame)}`,
    `**Cash:** ${formatMoney(player.accountBalance)}`,
    `**Gold:** ${formatMoney(player.goldBalance)}`,
    `**Ping:** ${player.ping !== null && player.ping !== undefined ? `${player.ping} ms` : "Offline / Unknown"}`,
    "",
    `**Location:** ${formatLocation(player.location)}`,
    `**Squad:** ${squad}`,
    `**Health:** ${formatHealth(player.health)}`,
    `**Body Effects:**\n${formatBodyEffects(player.bodyEffects)}`,
    "",
    `**Gear Weight:** ${player.gearWeightKg !== null && player.gearWeightKg !== undefined ? `${player.gearWeightKg} kg` : "Offline / Unknown"}`,
    `**Item in Hands:** ${player.itemInHands || "None / Unknown"}`,
    "",
    `**Attributes:** ${formatAttributes(player.attributes)}`,
    "",
    `**Skills:**\n${formatSkills(player.skills)}`,
  ].join("\n");

  await message.reply(clampDiscord(reply)).catch(() => {});
}

function buildVehicleLine(vehicle, index) {
  return [
    `**${index + 1}. ${vehicle.name || vehicle.class || "Vehicle"}**`,
    `ID: \`${vehicle.id}\``,
    `Class: ${vehicle.class || "Unknown"}`,
    `Owner: ${vehicle.owner || "Unknown"}`,
    `Owner Steam ID: ${vehicle.ownerSteamId ? `\`${vehicle.ownerSteamId}\`` : "Unknown"}`,
    `Location: ${formatLocation(vehicle.location)}`,
    `Rendered: ${vehicle.rendered ? "Yes" : "No"}`,
    `Spawned: ${formatDate(vehicle.spawnDate)}`,
  ].join("\n");
}

async function getSquadForSteamId(steamId) {
  const target = String(steamId || "").trim();
  if (!target) return null;

  const squadData = await ggconGet("/squads.json").catch(() => null);
  const squads = Array.isArray(squadData?.squads) ? squadData.squads : [];

  return squads.find((squad) => {
    const members = Array.isArray(squad.members) ? squad.members : [];
    return members.some((member) => String(member.steamId || member.userId || "") === target);
  }) || null;
}

function getSquadMemberSteamIds(squad) {
  const members = Array.isArray(squad?.members) ? squad.members : [];
  return new Set(
    members
      .map((member) => String(member.steamId || member.userId || "").trim())
      .filter(Boolean)
  );
}

function buildSquadMemberLine(member, index) {
  const statusBits = [];
  statusBits.push(member.online ? "Online" : "Offline");
  if (member.online && member.isAlive !== undefined) statusBits.push(member.isAlive ? "Alive" : "Dead");
  if (member.online && member.inDanger) statusBits.push("⚠️ In danger");

  return [
    `**${index + 1}. ${member.characterName || "Unknown"}**`,
    `Steam ID: ${member.steamId ? `\`${member.steamId}\`` : "Unknown"}`,
    `Rank: ${member.rankName || (member.rank ?? "Unknown")}`,
    `Status: ${statusBits.join(" | ")}`,
  ].join("\n");
}

function buildSquadReport(squad, lookedUpName = "Unknown") {
  const members = Array.isArray(squad?.members) ? squad.members : [];
  const onlineCount = members.filter((member) => member.online).length;
  const pending = squad.pendingCount ?? 0;

  const rows = members
    .slice()
    .sort((a, b) => {
      const rankDiff = Number(b.rank || 0) - Number(a.rank || 0);
      if (rankDiff !== 0) return rankDiff;
      if (a.online !== b.online) return a.online ? -1 : 1;
      return String(a.characterName || "").localeCompare(String(b.characterName || ""));
    })
    .slice(0, 20)
    .map(buildSquadMemberLine);

  const extra = members.length > 20 ? `\n\nShowing 20 of ${members.length} members.` : "";

  return clampDiscord([
    `👥 **Squad: ${squad.name || "Unknown Squad"}**`,
    `Looked up from: **${lookedUpName}**`,
    "",
    `**Members:** ${members.length}/${squad.memberLimit ?? "?"}`,
    `**Online:** ${onlineCount}`,
    `**Pending Requests:** ${pending}`,
    `**Score:** ${squad.score ?? "Unknown"}`,
    squad.message ? `**Message:** ${squad.message}` : null,
    squad.information ? `**Info:** ${squad.information}` : null,
    "",
    rows.length ? rows.join("\n\n") : "No members listed.",
    extra,
  ].filter(Boolean).join("\n"));
}

async function handleSquadLookup(message, args) {
  const query = args.join(" ").trim();

  if (!query) {
    await message.reply("Use: `!squad <player name or Steam ID>`").catch(() => {});
    return;
  }

  const playerResult = await getPlayerForLookup(query);

  if (playerResult.type === "none") {
    await message.reply(`No player found for **${query}**.`).catch(() => {});
    return;
  }

  if (playerResult.type === "multiple") {
    await message.reply({
      content: buildMultipleMatchesReply(query, playerResult.matches, "!squad"),
      components: buildMatchButtons(playerResult.matches, "!squad"),
    }).catch(() => {});
    return;
  }

  const player = playerResult.player;
  const steamId = String(player.userId || "").trim();
  const squad = await getSquadForSteamId(steamId);

  if (!squad) {
    await message.reply(`No squad found for **${player.characterName || player.steamName || query}** / \`${steamId || "unknown Steam ID"}\`.`).catch(() => {});
    return;
  }

  await message.reply(buildSquadReport(squad, player.characterName || player.steamName || query)).catch(() => {});
}

async function buildVehicleReportForPlayer(player, fallbackLabel) {
  const playerSteamId = String(player.userId || "").trim();
  const vehicleData = await ggconGet("/vehicles.json");
  const vehicles = Array.isArray(vehicleData.vehicles) ? vehicleData.vehicles : [];

  const squad = await getSquadForSteamId(playerSteamId);
  const squadMemberSteamIds = getSquadMemberSteamIds(squad);
  const hasSquad = squad && squadMemberSteamIds.size > 0;

  const matchingVehicles = hasSquad
    ? vehicles.filter((vehicle) => squadMemberSteamIds.has(String(vehicle.ownerSteamId || "")))
    : vehicles.filter((vehicle) => String(vehicle.ownerSteamId || "") === playerSteamId);

  const targetName = player.characterName || player.steamName || fallbackLabel || "Unknown";
  const ownershipNote = vehicleData.ownershipResolved === false
    ? "\n\n⚠️ Vehicle ownership is not fully resolved right now. Live ownership data may require at least one player online."
    : "";

  if (matchingVehicles.length === 0) {
    if (hasSquad) {
      return [
        `No vehicles found for squad **${squad.name || "Unknown Squad"}**.`,
        `Searched because **${targetName}** is in that squad.`,
        `Squad Members Checked: ${squadMemberSteamIds.size}`,
        ownershipNote,
      ].join("\n");
    }

    return `No vehicles found for **${targetName}** / \`${playerSteamId || "unknown Steam ID"}\`.${ownershipNote}`;
  }

  const sorted = matchingVehicles.sort((a, b) => {
    const ownerA = String(a.owner || "").localeCompare(String(b.owner || ""));
    if (ownerA !== 0) return ownerA;
    return String(a.name || a.class || "").localeCompare(String(b.name || b.class || ""));
  });

  const rows = sorted.slice(0, 15).map(buildVehicleLine);
  const extra = sorted.length > 15 ? `\n\nShowing 15 of ${sorted.length} vehicles.` : "";

  if (hasSquad) {
    return clampDiscord([
      `🚗 **Squad Vehicles: ${squad.name || "Unknown Squad"}**`,
      `Looked up from: **${targetName}**`,
      `Squad Members Checked: ${squadMemberSteamIds.size}`,
      `Total Vehicles Found: ${sorted.length}`,
      "",
      rows.join("\n\n"),
      extra,
      ownershipNote,
    ].join("\n"));
  }

  return clampDiscord([
    `🚗 **Vehicles for ${targetName}**`,
    `Steam ID: \`${playerSteamId || "Unknown"}\``,
    "Squad: None found, showing only this player's vehicles.",
    `Total: ${sorted.length}`,
    "",
    rows.join("\n\n"),
    extra,
    ownershipNote,
  ].join("\n"));
}

async function handleVehiclesLookup(message, args) {
  const query = args.join(" ").trim();

  if (!query) {
    await message.reply("Use: `!vehicle <player name or Steam ID>`").catch(() => {});
    return;
  }

  const playerResult = await getPlayerForLookup(query);

  if (playerResult.type === "none") {
    await message.reply(`No player found for **${query}**.`).catch(() => {});
    return;
  }

  if (playerResult.type === "multiple") {
    await message.reply({
      content: buildMultipleMatchesReply(query, playerResult.matches, "!vehicle"),
      components: buildMatchButtons(playerResult.matches, "!vehicle"),
    }).catch(() => {});
    return;
  }

  const reply = await buildVehicleReportForPlayer(playerResult.player, query);
  await message.reply(reply).catch(() => {});
}



async function buildPlayerDetailsBySteamId(steamId) {
  const result = await getPlayerForLookup(String(steamId || ""));
  if (result.type !== "single") return `No player found for \`${steamId}\`.`;

  const player = result.player;
  const online = player.online === true || player.ping !== undefined || player.health !== undefined;
  const squad = player.squad?.name
    ? `${player.squad.name}${player.squad.members !== undefined ? ` (${player.squad.members} members)` : ""}`
    : "None / Unknown";

  return clampDiscord([
    `👤 **Player Lookup: ${player.characterName || player.realName || player.steamName || "Unknown"}**`,
    "",
    `**Status:** ${online ? "Online" : "Offline"}`,
    `**Steam ID:** \`${player.userId || steamId || "Unknown"}\``,
    `**Steam Name:** ${player.steamName || "Unknown"}`,
    `**Fame:** ${formatMoney(player.fame)}`,
    `**Cash:** ${formatMoney(player.accountBalance)}`,
    `**Gold:** ${formatMoney(player.goldBalance)}`,
    `**Ping:** ${player.ping !== null && player.ping !== undefined ? `${player.ping} ms` : "Offline / Unknown"}`,
    "",
    `**Location:** ${formatLocation(player.location)}`,
    `**Squad:** ${squad}`,
    `**Health:** ${formatHealth(player.health)}`,
    `**Body Effects:**\n${formatBodyEffects(player.bodyEffects)}`,
    "",
    `**Gear Weight:** ${player.gearWeightKg !== null && player.gearWeightKg !== undefined ? `${player.gearWeightKg} kg` : "Offline / Unknown"}`,
    `**Item in Hands:** ${player.itemInHands || "None / Unknown"}`,
    "",
    `**Attributes:** ${formatAttributes(player.attributes)}`,
    "",
    `**Skills:**\n${formatSkills(player.skills)}`,
  ].join("\n"));
}

async function buildVehiclesBySteamId(steamId) {
  const playerResult = await getPlayerForLookup(String(steamId || ""));
  if (playerResult.type !== "single") return `No player found for \`${steamId}\`.`;

  return buildVehicleReportForPlayer(playerResult.player, String(steamId || ""));
}

async function buildSquadBySteamId(steamId) {
  const playerResult = await getPlayerForLookup(String(steamId || ""));
  if (playerResult.type !== "single") return `No player found for \`${steamId}\`.`;

  const player = playerResult.player;
  const squad = await getSquadForSteamId(player.userId || steamId);
  if (!squad) return `No squad found for **${player.characterName || player.steamName || "Unknown"}** / \`${player.userId || steamId}\`.`;

  return buildSquadReport(squad, player.characterName || player.steamName || String(steamId || ""));
}



function isFlagOverLimit(flag) {
  const elementCount = Number(flag.elementCount);
  const maxElements = Number(flag.maxElements);
  return Number.isFinite(elementCount) && Number.isFinite(maxElements) && elementCount > maxElements;
}

function buildFlagLine(flag, index) {
  const overLimit = isFlagOverLimit(flag);
  const overBy = overLimit ? Number(flag.elementCount) - Number(flag.maxElements) : 0;
  const baseLabel = flag.baseName || `Base #${flag.baseId || flag.flagId || "?"}`;

  return [
    `**${index + 1}. ${overLimit ? "⚠️ " : ""}${baseLabel}**`,
    `Flag ID: \`${flag.flagId ?? "Unknown"}\` | Base ID: \`${flag.baseId ?? "Unknown"}\``,
    `Owner: ${flag.owner || "Unknown"}`,
    `Owner Steam ID: ${flag.ownerSteamId ? `\`${flag.ownerSteamId}\`` : "Unknown"}`,
    `Location: ${formatLocation(flag.location)}`,
    `Elements: ${flag.elementCount ?? "?"}/${flag.maxElements ?? "?"}${overLimit ? ` — ⚠️ OVER CAP by ${overBy}` : ""}`,
    `Expanded Elements: ${flag.expandedElements ?? "?"}`,
  ].join("\n");
}

function buildFlagRulesSummary(flagData) {
  const bits = [];
  if (flagData.maxElementsPerFlag !== undefined) bits.push(`Max elements/flag: ${flagData.maxElementsPerFlag}`);
  if (flagData.maxExpandedPerFlag !== undefined) bits.push(`Max expanded: ${flagData.maxExpandedPerFlag}`);
  if (flagData.extraElementsPerSquadMember !== undefined) bits.push(`Extra per squad member: ${flagData.extraElementsPerSquadMember}`);
  if (flagData.flagInfluenceRadius !== undefined) bits.push(`Radius: ${flagData.flagInfluenceRadius}`);
  if (flagData.allowMultipleFlagsPerPlayer !== undefined) bits.push(`Multiple flags/player: ${flagData.allowMultipleFlagsPerPlayer ? "Yes" : "No"}`);
  return bits.length ? bits.join(" | ") : "Flag rule details unavailable.";
}

function getFlagPageSize() {
  const configured = Number(process.env.GGCON_FLAG_PAGE_SIZE || DEFAULT_FLAG_PAGE_SIZE);
  if (!Number.isFinite(configured)) return DEFAULT_FLAG_PAGE_SIZE;
  return Math.min(8, Math.max(3, Math.floor(configured)));
}

function sortFlags(flags) {
  return [...(flags || [])].sort((a, b) => {
    const baseA = Number(a.baseId ?? 0);
    const baseB = Number(b.baseId ?? 0);
    if (baseA !== baseB) return baseA - baseB;
    return Number(a.flagId ?? 0) - Number(b.flagId ?? 0);
  });
}

function buildFlagOverLimitSummary(flags) {
  const overLimit = (flags || []).filter(isFlagOverLimit);
  if (overLimit.length === 0) return "Over-limit flags: None";

  const rows = overLimit.slice(0, 5).map((flag) => {
    const baseLabel = flag.baseName || `Base #${flag.baseId || flag.flagId || "?"}`;
    const overBy = Number(flag.elementCount) - Number(flag.maxElements);
    return `• ${baseLabel} — ${flag.owner || "Unknown"}: ${flag.elementCount}/${flag.maxElements} (${overBy} over)`;
  });

  if (overLimit.length > 5) rows.push(`• +${overLimit.length - 5} more over-limit flag(s)`);

  return [`⚠️ Over-limit flags: ${overLimit.length}`, ...rows].join("\n");
}

function buildFlagAllComponents(page, totalPages) {
  if (totalPages <= 1) return [];

  const previousPage = Math.max(1, page - 1);
  const nextPage = Math.min(totalPages, page + 1);

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`ggcon:flagall:${previousPage}`)
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 1),
      new ButtonBuilder()
        .setCustomId(`ggcon:flagall:${nextPage}`)
        .setLabel("Next")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(page >= totalPages)
    ),
  ];
}

function buildAllFlagsPage(flagData, requestedPage = 1) {
  const allFlags = sortFlags(Array.isArray(flagData.flags) ? flagData.flags : []);
  const pageSize = getFlagPageSize();
  const totalPages = Math.max(1, Math.ceil(allFlags.length / pageSize));
  const page = Math.min(totalPages, Math.max(1, Number(requestedPage) || 1));
  const start = (page - 1) * pageSize;
  const pageFlags = allFlags.slice(start, start + pageSize);

  const content = clampDiscord([
    "🚩 **All Server Flags**",
    `Page ${page}/${totalPages} | Total Flags: ${flagData.count ?? allFlags.length}`,
    buildFlagRulesSummary(flagData),
    "",
    buildFlagOverLimitSummary(allFlags),
    "",
    pageFlags.length ? pageFlags.map((flag, index) => buildFlagLine(flag, start + index)).join("\n\n") : "No flags found.",
    totalPages > 1 ? "\nUse the buttons below to change pages." : "",
  ].filter(Boolean).join("\n"));

  return {
    content,
    components: buildFlagAllComponents(page, totalPages),
  };
}

async function buildFlagsBySteamId(steamId) {
  const playerResult = await getPlayerForLookup(String(steamId || ""));
  if (playerResult.type !== "single") return `No player found for \`${steamId}\`.`;

  const player = playerResult.player;
  const playerSteamId = String(player.userId || steamId || "");
  const flagData = await ggconGet("/flags.json");
  const flags = sortFlags(Array.isArray(flagData.flags) ? flagData.flags : []);
  const owned = flags.filter((flag) => String(flag.ownerSteamId || "") === playerSteamId);

  if (owned.length === 0) {
    return `No flags found for **${player.characterName || player.steamName || "Unknown"}** / \`${playerSteamId || "unknown Steam ID"}\`.`;
  }

  const overLimit = owned.filter(isFlagOverLimit);
  const duplicateBaseGroups = Object.values(owned.reduce((groups, flag) => {
    const key = String(flag.baseId ?? flag.baseName ?? "unknown");
    if (!groups[key]) groups[key] = [];
    groups[key].push(flag);
    return groups;
  }, {})).filter((group) => group.length > 1);

  const distanceRows = [];
  for (const group of duplicateBaseGroups.slice(0, 5)) {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const distance = distanceUnrealUnits(group[i].location, group[j].location);
        const baseLabel = group[i].baseName || `Base #${group[i].baseId || "?"}`;
        distanceRows.push(`• ${baseLabel}: Flag ${group[i].flagId ?? "?"} ↔ ${group[j].flagId ?? "?"}: ${formatApproxDistance(distance)}`);
      }
    }
  }

  const rows = owned.slice(0, 12).map(buildFlagLine);
  const extra = owned.length > 12 ? `\n\nShowing 12 of ${owned.length} flags.` : "";

  return clampDiscord([
    `🚩 **Flags for ${player.characterName || player.steamName || "Unknown"}**`,
    `Steam ID: \`${playerSteamId || "Unknown"}\``,
    `Total Flags: ${owned.length}`,
    `Over Cap: ${overLimit.length}`,
    duplicateBaseGroups.length ? `Duplicate Base IDs: ${duplicateBaseGroups.length}` : "Duplicate Base IDs: None",
    distanceRows.length ? ["", "**Duplicate Flag Distances:**", distanceRows.slice(0, 8).join("\n")].join("\n") : null,
    "",
    rows.join("\n\n"),
    extra,
  ].filter(Boolean).join("\n"));
}

function buildOvercapComponents(page, totalPages) {
  if (totalPages <= 1) return [];

  const previousPage = Math.max(1, page - 1);
  const nextPage = Math.min(totalPages, page + 1);

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`ggcon:overcap:${previousPage}`)
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 1),
      new ButtonBuilder()
        .setCustomId(`ggcon:overcap:${nextPage}`)
        .setLabel("Next")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(page >= totalPages)
    ),
  ];
}

function buildOvercapPage(flagData, requestedPage = 1) {
  const overLimit = sortFlags(Array.isArray(flagData.flags) ? flagData.flags : []).filter(isFlagOverLimit);
  const pageSize = getFlagPageSize();
  const totalPages = Math.max(1, Math.ceil(overLimit.length / pageSize));
  const page = Math.min(totalPages, Math.max(1, Number(requestedPage) || 1));
  const start = (page - 1) * pageSize;
  const pageFlags = overLimit.slice(start, start + pageSize);

  const content = clampDiscord([
    "⚠️ **Bases / Flags Over Element Cap**",
    `Page ${page}/${totalPages} | Over-cap flags: ${overLimit.length}`,
    "",
    pageFlags.length
      ? pageFlags.map((flag, index) => buildFlagLine(flag, start + index)).join("\n\n")
      : "No flags are currently over their displayed element cap.",
    totalPages > 1 ? "\nUse the buttons below to change pages." : "",
  ].filter(Boolean).join("\n"));

  return {
    content,
    components: buildOvercapComponents(page, totalPages),
  };
}

async function handleOvercapLookup(message, args) {
  const requestedPage = Number(args[0] || 1);
  const flagData = await ggconGet("/flags.json");
  const page = buildOvercapPage(flagData, requestedPage);

  await message.reply({
    content: page.content,
    components: page.components,
  }).catch(() => {});
}


async function handleFlagsLookup(message, args) {
  const query = args.join(" ").trim();

  if (!query) {
    await message.reply("Use: `!flag <player name or Steam ID>` or `!flag all`").catch(() => {});
    return;
  }

  if (query.toLowerCase().startsWith("all")) {
    const parts = query.split(/\s+/);
    const requestedPage = Number(parts[1] || 1);
    const flagData = await ggconGet("/flags.json");
    const page = buildAllFlagsPage(flagData, requestedPage);

    await message.reply({
      content: page.content,
      components: page.components,
    }).catch(() => {});
    return;
  }

  const playerResult = await getPlayerForLookup(query);

  if (playerResult.type === "none") {
    await message.reply(`No player found for **${query}**.`).catch(() => {});
    return;
  }

  if (playerResult.type === "multiple") {
    await message.reply({
      content: buildMultipleMatchesReply(query, playerResult.matches, "!flag"),
      components: buildMatchButtons(playerResult.matches, "!flag"),
    }).catch(() => {});
    return;
  }

  const content = await buildFlagsBySteamId(playerResult.player.userId);
  await message.reply(content).catch(() => {});
}

function buildVehicleSnapshot(vehicles) {
  const map = {};

  for (const vehicle of vehicles || []) {
    if (vehicle.id === null || vehicle.id === undefined) continue;
    map[String(vehicle.id)] = {
      id: vehicle.id,
      class: vehicle.class || "Unknown",
      name: vehicle.name || vehicle.class || "Vehicle",
      location: vehicle.location || null,
      rendered: !!vehicle.rendered,
      owner: vehicle.owner || null,
      ownerSteamId: vehicle.ownerSteamId || null,
      spawnDate: vehicle.spawnDate || null,
      seenAt: Date.now(),
    };
  }

  return map;
}

function vehicleOwnerKey(vehicle) {
  const steamId = String(vehicle?.ownerSteamId || "").trim();
  if (steamId) return `steam:${steamId}`;
  const owner = String(vehicle?.owner || "").trim().toLowerCase();
  if (owner) return `name:${owner}`;
  return "";
}

function hasVehicleOwner(vehicle) {
  return !!vehicleOwnerKey(vehicle);
}

function formatVehicleOwner(vehicle) {
  const owner = vehicle?.owner || "Unknown";
  const steamId = vehicle?.ownerSteamId ? ` (\`${vehicle.ownerSteamId}\`)` : "";
  return `${owner}${steamId}`;
}

function buildMissingVehicleAlert(vehicle) {
  return clampDiscord([
    "🚨 **Possible Missing Vehicle**",
    "",
    "The Watcher can no longer see this tracked player-owned vehicle in the live vehicle list.",
    "This alert only posts after the vehicle is missing for multiple scans.",
    "",
    `**Vehicle:** ${vehicle.name || vehicle.class || "Vehicle"}`,
    `**ID:** \`${vehicle.id}\``,
    `**Class:** ${vehicle.class || "Unknown"}`,
    `**Last Known Owner:** ${formatVehicleOwner(vehicle)}`,
    `**Last Known Location:** ${formatLocation(vehicle.location)}`,
    `**Spawned:** ${formatDate(vehicle.spawnDate)}`,
    "",
    "**Possible causes:** destroyed, deleted, cleaned up, or removed by the server.",
  ].join("\n"));
}

async function sendVehicleWatchAlerts(bot, channelId, alerts) {
  if (!alerts.length) return 0;

  const channel = await bot.channels.fetch(channelId).catch(() => null);
  if (!channel?.send) return 0;

  let sent = 0;
  for (const alert of alerts.slice(0, 10)) {
    await channel.send(alert.content).then(() => {
      sent += 1;
    }).catch((err) => {
      console.error("❌ Vehicle watch alert failed:", err.message);
    });
  }

  if (alerts.length > 10) {
    await channel.send(`⚠️ ${alerts.length - 10} more vehicle watch alerts happened in the same scan. Output was trimmed to avoid spam.`).catch(() => {});
  }

  return sent;
}

async function scanVehiclesAndAlert(bot, { baselineOnly = false } = {}) {
  const channelId = await getVehicleLogChannelIdAsync();
  if (!channelId) return { scanned: false, reason: "No vehicle log channel set." };

  const data = await ggconGet("/vehicles.json");
  const vehicles = Array.isArray(data.vehicles) ? data.vehicles : [];
  const current = buildVehicleSnapshot(vehicles);
  const previousState = await loadVehicleStatePersistent();
  const previous = previousState?.vehicles || null;
  const now = Date.now();

  if (baselineOnly || !previous) {
    await saveVehicleStatePersistent({
      updatedAt: now,
      count: vehicles.length,
      ownershipResolved: data.ownershipResolved,
      vehicles: current,
    });

    return {
      scanned: true,
      baselineOnly: true,
      vehicleCount: vehicles.length,
      ownedTracked: Object.values(current).filter(hasVehicleOwner).length,
      alerts: 0,
    };
  }

  const alerts = [];
  const confirmScansValue = Number(process.env.GGCON_VEHICLE_MISSING_CONFIRMATION_SCANS || "2");
  const confirmScans = Math.max(1, Number.isFinite(confirmScansValue) ? Math.floor(confirmScansValue) : 2);
  const priorPending = previousState?.pendingMissing && typeof previousState.pendingMissing === "object"
    ? previousState.pendingMissing
    : {};
  const pendingMissing = { ...priorPending };

  const trackedVehicles = {};
  for (const previousVehicle of Object.values(previous || {})) {
    if (previousVehicle?.id === null || previousVehicle?.id === undefined) continue;
    trackedVehicles[String(previousVehicle.id)] = previousVehicle;
  }
  for (const [id, pending] of Object.entries(priorPending)) {
    if (pending?.vehicle && !trackedVehicles[id]) trackedVehicles[id] = pending.vehicle;
  }

  const normalizedCurrent = {};
  for (const [id, currentVehicle] of Object.entries(current)) {
    const previousVehicle = previous?.[id] || priorPending?.[id]?.vehicle || null;

    if (!hasVehicleOwner(currentVehicle) && hasVehicleOwner(previousVehicle)) {
      normalizedCurrent[id] = {
        ...currentVehicle,
        owner: previousVehicle.owner || currentVehicle.owner || null,
        ownerSteamId: previousVehicle.ownerSteamId || currentVehicle.ownerSteamId || null,
        lastOwnerCarriedForward: true,
      };
    } else {
      normalizedCurrent[id] = currentVehicle;
    }

    if (pendingMissing[id]) delete pendingMissing[id];
  }

  for (const previousVehicle of Object.values(trackedVehicles)) {
    const id = String(previousVehicle.id);
    const currentVehicle = current[id];
    const pendingVehicle = priorPending?.[id]?.vehicle || null;
    const wasTrackedOwned = hasVehicleOwner(previousVehicle) || hasVehicleOwner(pendingVehicle);

    if (currentVehicle || !wasTrackedOwned) continue;

    const existing = priorPending[id] || {};
    const missedScans = Number(existing.missedScans || 0) + 1;
    const entry = {
      vehicle: existing.vehicle || previousVehicle,
      firstMissingAt: existing.firstMissingAt || now,
      lastMissingAt: now,
      missedScans,
      alertedAt: existing.alertedAt || null,
    };

    if (missedScans >= confirmScans && !entry.alertedAt) {
      alerts.push({ type: "missing", content: buildMissingVehicleAlert(entry.vehicle) });
      entry.alertedAt = now;
    }

    pendingMissing[id] = entry;
  }

  const sent = await sendVehicleWatchAlerts(bot, channelId, alerts);

  await saveVehicleStatePersistent({
    updatedAt: now,
    count: vehicles.length,
    ownershipResolved: data.ownershipResolved,
    vehicles: normalizedCurrent,
    pendingMissing,
    missingConfirmationScans: confirmScans,
  });

  return {
    scanned: true,
    vehicleCount: vehicles.length,
    ownedTracked: Object.values(normalizedCurrent).filter(hasVehicleOwner).length,
    pendingMissing: Object.keys(pendingMissing).length,
    confirmationScans: confirmScans,
    alerts: alerts.length,
    sent,
  };
}

function ensureVehicleWatchLoop(bot) {
  const channelId = getVehicleLogChannelId();
  if (!channelId) {
    getVehicleLogChannelIdAsync().then((resolvedChannelId) => {
      if (resolvedChannelId && !vehicleWatchTimer) ensureVehicleWatchLoop(bot);
    }).catch(() => {});
    return;
  }
  if (vehicleWatchTimer) return;

  const seconds = Number(process.env.GGCON_VEHICLE_WATCH_INTERVAL_SECONDS || "180");
  const intervalMs = Math.max(60, Number.isFinite(seconds) ? seconds : 180) * 1000;

  vehicleWatchTimer = setInterval(() => {
    scanVehiclesAndAlert(bot).catch((err) => {
      console.error("❌ Vehicle watch failed:", err.message);
    });
  }, intervalMs);
}

async function handleVehicleLogSetup(message, bot) {
  await saveVehicleWatchConfigPersistent({
    channelId: message.channel.id,
    setBy: message.author.id,
    setAt: Date.now(),
  });

  await scanVehiclesAndAlert(bot, { baselineOnly: true });
  ensureVehicleWatchLoop(bot);

  await message.reply([
    "Vehicle watch is now active in this channel.",
    "I saved the current vehicle list as the baseline.",
    "Alerts only post when a tracked player-owned vehicle disappears and stays missing for multiple scans.",
    "Owner flicker, owner changes, and temporary unknown owner data are ignored.",
    "Use `!vehiclelogscan` to force an immediate check instead of waiting for the timer.",
  ].join("\n")).catch(() => {});
}

async function handleVehicleLogOff(message) {
  await clearVehicleWatchConfigPersistent();
  if (vehicleWatchTimer) {
    clearInterval(vehicleWatchTimer);
    vehicleWatchTimer = null;
  }
  await message.reply("Vehicle watch is now disabled.").catch(() => {});
}

async function handleVehicleLogStatus(message) {
  const channelId = await getVehicleLogChannelIdAsync();
  const state = await loadVehicleStatePersistent();

  if (!channelId) {
    await message.reply("Vehicle watch is not set up. Run `!vehiclelogsetup` in the channel where alerts should post.").catch(() => {});
    return;
  }

  const vehicles = state?.vehicles ? Object.values(state.vehicles) : [];
  const ownedTracked = vehicles.filter(hasVehicleOwner).length;
  const unownedTracked = vehicles.length - ownedTracked;
  const seconds = Number(process.env.GGCON_VEHICLE_WATCH_INTERVAL_SECONDS || "180");

  await message.reply([
    "🚗 **Vehicle Watch Status**",
    `Alert Channel: <#${channelId}>`,
    `Tracking Active: ${vehicleWatchTimer ? "Yes" : "Will start on next bot boot/setup"}`,
    `Scan Interval: ${Math.max(60, Number.isFinite(seconds) ? seconds : 180)} seconds`,
    `Tracked Vehicles: ${vehicles.length}`,
    `Owned Vehicles Tracked: ${ownedTracked}`,
    `Unowned Vehicles Ignored for Alerts: ${unownedTracked}`,
    `Pending Missing Confirmations: ${state?.pendingMissing ? Object.keys(state.pendingMissing).length : 0}`,
    `Confirm Missing After: ${state?.missingConfirmationScans || 2} scans`,
    `Last Scan: ${state?.updatedAt ? formatDate(state.updatedAt) : "Never"}`,
    "Alerts only post for vehicles that disappear from the live list and stay missing.",
    "Owner flicker, owner changes, and temporary unknown owner data are ignored.",
  ].join("\n")).catch(() => {});
}

async function handleVehicleLogScan(message, bot) {
  const result = await scanVehiclesAndAlert(bot);

  if (!result?.scanned) {
    await message.reply(result?.reason || "Vehicle watch scan could not run.").catch(() => {});
    return;
  }

  await message.reply([
    "🚗 **Vehicle Watch Manual Scan Complete**",
    `Tracked Vehicles: ${result.vehicleCount ?? "Unknown"}`,
    `Owned Vehicles Tracked: ${result.ownedTracked ?? "Unknown"}`,
    `Pending Missing Confirmations: ${result.pendingMissing ?? 0}`,
    `Confirm Missing After: ${result.confirmationScans ?? 2} scans`,
    `Alerts Found: ${result.alerts ?? 0}`,
    `Alerts Sent: ${result.sent ?? 0}`,
  ].join("\n")).catch(() => {});
}

function startVehicleWatchOnBoot(bot) {
  if (!hasPasswordConfigured()) return;
  loadVehicleWatchConfigPersistent().then(async (config) => {
    const channelId = process.env.GGCON_VEHICLE_LOG_CHANNEL_ID || config?.channelId || null;
    if (!channelId) return;

    ensureVehicleWatchLoop(bot);
    const state = await loadVehicleStatePersistent();
    scanVehiclesAndAlert(bot, { baselineOnly: !state }).catch((err) => {
      console.error("❌ Boot vehicle watch failed:", err.message);
    });
  }).catch((err) => {
    console.error("❌ Boot vehicle watch failed:", err.message);
  });
}


function parsePlayerActionAmountArgs(args, commandName) {
  const actionIndex = args.findIndex((part) => ["add", "remove", "set"].includes(String(part || "").toLowerCase()));

  if (actionIndex <= 0 || actionIndex >= args.length - 1) {
    return {
      error: `Use: \`${commandName} <player name or Steam ID> add/remove/set <amount>\``,
    };
  }

  const playerQuery = args.slice(0, actionIndex).join(" ").trim();
  const action = String(args[actionIndex] || "").toLowerCase();
  const amountText = String(args[actionIndex + 1] || "").replace(/,/g, "").trim();
  const amount = Number(amountText);

  if (!playerQuery) {
    return { error: `Use: \`${commandName} <player name or Steam ID> add/remove/set <amount>\`` };
  }

  if (!Number.isFinite(amount) || amount < 0) {
    return { error: "Amount must be a valid number." };
  }

  return { playerQuery, action, amount: Math.floor(amount) };
}

function getPlayerDisplayName(player, fallback = "Unknown") {
  return player?.characterName || player?.steamName || player?.realName || fallback;
}

function buildAdminActionLog(title, rows) {
  return clampDiscord([
    title,
    "",
    ...rows.filter(Boolean),
  ].join("\n"));
}

async function sendGgconActionLog(bot, fallbackChannel, content) {
  const channelId = getVehicleLogChannelId();
  const channel = channelId
    ? await bot.channels.fetch(channelId).catch(() => null)
    : null;

  if (channel?.send) {
    await channel.send(content).catch(() => {});
    return;
  }

  if (fallbackChannel?.send) {
    await fallbackChannel.send(content).catch(() => {});
  }
}

function removeVehicleFromSavedState(vehicleId) {
  const state = loadVehicleState();
  if (!state?.vehicles) return;
  const key = String(vehicleId);
  if (!state.vehicles[key]) return;
  delete state.vehicles[key];
  state.updatedAt = Date.now();
  saveVehicleState(state);
}

function findVehicleById(vehicleData, vehicleId) {
  const vehicles = Array.isArray(vehicleData?.vehicles) ? vehicleData.vehicles : [];
  return vehicles.find((vehicle) => String(vehicle.id) === String(vehicleId)) || null;
}

function findFlagById(flagData, flagId) {
  const flags = Array.isArray(flagData?.flags) ? flagData.flags : [];
  return flags.find((flag) => String(flag.flagId) === String(flagId)) || null;
}

function buildDestroyVehicleConfirm(vehicle) {
  const content = clampDiscord([
    "⚠️ **Confirm Vehicle Destroy**",
    "",
    `Vehicle: **${vehicle.name || vehicle.class || "Vehicle"}**`,
    `ID: \`${vehicle.id}\``,
    `Class: ${vehicle.class || "Unknown"}`,
    `Owner: ${vehicle.owner || "Unknown"}`,
    `Owner Steam ID: ${vehicle.ownerSteamId ? `\`${vehicle.ownerSteamId}\`` : "Unknown"}`,
    `Location: ${formatLocation(vehicle.location)}`,
    "",
    "Click **Destroy Vehicle** to confirm.",
  ].join("\n"));

  return {
    content,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`ggcon:confirmDestroyVehicle:${vehicle.id}`)
          .setLabel("Destroy Vehicle")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId("ggcon:cancel:destroyvehicle")
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Secondary)
      ),
    ],
  };
}

function buildDestroyBaseConfirm(flag) {
  const content = clampDiscord([
    "⚠️ **Confirm Base Destroy by Flag**",
    "",
    `Base: **${flag.baseName || `Base #${flag.baseId || "?"}`}**`,
    `Flag ID: \`${flag.flagId}\` | Base ID: \`${flag.baseId ?? "Unknown"}\``,
    `Owner: ${flag.owner || "Unknown"}`,
    `Owner Steam ID: ${flag.ownerSteamId ? `\`${flag.ownerSteamId}\`` : "Unknown"}`,
    `Location: ${formatLocation(flag.location)}`,
    `Elements: ${flag.elementCount ?? "?"}/${flag.maxElements ?? "?"}`,
    "",
    "Click **Destroy Base** to confirm.",
  ].join("\n"));

  return {
    content,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`ggcon:confirmDestroyBase:${flag.flagId}`)
          .setLabel("Destroy Base")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId("ggcon:cancel:destroybase")
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Secondary)
      ),
    ],
  };
}

async function handleDestroyVehicleCommand(message, args) {
  const vehicleId = String(args[0] || "").trim();
  if (!vehicleId) {
    await message.reply("Use: `!destroyvehicle <vehicle ID>`").catch(() => {});
    return;
  }

  const vehicleData = await ggconGet("/vehicles.json");
  const vehicle = findVehicleById(vehicleData, vehicleId);

  if (!vehicle) {
    await message.reply(`No vehicle found with ID \`${vehicleId}\`.`).catch(() => {});
    return;
  }

  const confirm = buildDestroyVehicleConfirm(vehicle);
  await message.reply(confirm).catch(() => {});
}

async function handleDestroyBaseCommand(message, args) {
  const flagId = String(args[0] || "").trim();
  if (!flagId) {
    await message.reply("Use: `!destroybase <flag ID>`").catch(() => {});
    return;
  }

  const flagData = await ggconGet("/flags.json");
  const flag = findFlagById(flagData, flagId);

  if (!flag) {
    await message.reply(`No flag found with ID \`${flagId}\`.`).catch(() => {});
    return;
  }

  const confirm = buildDestroyBaseConfirm(flag);
  await message.reply(confirm).catch(() => {});
}

async function confirmDestroyVehicle(interaction) {
  const [, , vehicleId] = interaction.customId.split(":");
  const vehicleData = await ggconGet("/vehicles.json");
  const vehicle = findVehicleById(vehicleData, vehicleId);

  if (!vehicle) {
    await interaction.update({ content: `No vehicle found with ID \`${vehicleId}\`. It may already be gone.`, components: [] }).catch(() => {});
    return true;
  }

  await ggconPost(`/vehicles/${encodeURIComponent(vehicleId)}/destroy`, {});
  removeVehicleFromSavedState(vehicleId);

  const log = buildAdminActionLog("🚗 **Vehicle Destroyed by Admin**", [
    `Vehicle: **${vehicle.name || vehicle.class || "Vehicle"}**`,
    `Vehicle ID: \`${vehicle.id}\``,
    `Class: ${vehicle.class || "Unknown"}`,
    `Owner: ${vehicle.owner || "Unknown"}`,
    `Owner Steam ID: ${vehicle.ownerSteamId ? `\`${vehicle.ownerSteamId}\`` : "Unknown"}`,
    `Last Location: ${formatLocation(vehicle.location)}`,
    `Destroyed by: ${interaction.member?.displayName || interaction.user?.tag || "Unknown"}`,
  ]);

  await sendGgconActionLog(interaction.client, interaction.channel, log);
  await interaction.update({ content: `Vehicle \`${vehicleId}\` destroyed and logged.`, components: [] }).catch(() => {});
  return true;
}

async function confirmDestroyBase(interaction) {
  const [, , flagId] = interaction.customId.split(":");
  const flagData = await ggconGet("/flags.json");
  const flag = findFlagById(flagData, flagId);

  if (!flag) {
    await interaction.update({ content: `No flag found with ID \`${flagId}\`. It may already be gone.`, components: [] }).catch(() => {});
    return true;
  }

  const command = `#DestroyAllBaseBuildingElementsForFlag ${flagId} Please`;
  const result = await ggconPost("/command", { command });

  const log = buildAdminActionLog("🚩 **Base Destroyed by Flag**", [
    `Flag ID: \`${flag.flagId}\``,
    `Base ID: \`${flag.baseId ?? "Unknown"}\``,
    `Base Name: ${flag.baseName || "Unknown"}`,
    `Owner: ${flag.owner || "Unknown"}`,
    `Owner Steam ID: ${flag.ownerSteamId ? `\`${flag.ownerSteamId}\`` : "Unknown"}`,
    `Location: ${formatLocation(flag.location)}`,
    `Elements: ${flag.elementCount ?? "?"}/${flag.maxElements ?? "?"}`,
    `Destroyed by: ${interaction.member?.displayName || interaction.user?.tag || "Unknown"}`,
    `Command: \`${command}\``,
    result?.lines?.length ? `Output: ${result.lines.slice(0, 4).join(" | ")}` : result?.message ? `Output: ${result.message}` : null,
  ]);

  await sendGgconActionLog(interaction.client, interaction.channel, log);
  await interaction.update({ content: `Base destroy command sent for flag \`${flagId}\` and logged.`, components: [] }).catch(() => {});
  return true;
}

async function handleAnnounceCommand(message, args) {
  const text = args.join(" ").trim();
  if (!text) {
    await message.reply("Use: `!announce <message>`").catch(() => {});
    return;
  }

  await ggconPost("/message", { text, type: "ServerMessage" });
  await message.reply(`Announcement sent in-game:\n> ${text}`).catch(() => {});
}

async function applyPlayerBalanceChange(message, player, kind, action, amount) {
  const steamId = String(player.userId || "").trim();
  const endpoint = kind === "cash" ? "currency" : "fame";
  const label = kind === "cash" ? "Cash" : "Fame";

  if (!steamId) {
    await message.reply("That player does not have a usable Steam ID.").catch(() => {});
    return;
  }

  await ggconPost(`/players/${encodeURIComponent(steamId)}/${endpoint}`, { action, amount });

  await message.reply([
    `${label} updated for **${getPlayerDisplayName(player)}**.`,
    `Steam ID: \`${steamId}\``,
    `Action: **${action}** ${amount.toLocaleString("en-CA")}`,
  ].join("\n")).catch(() => {});
}

function buildPlayerOperationButtons(matches, commandName, action, amount) {
  const op = commandName === "!cash" ? "cashop" : "fameop";
  const usable = matches.filter((player) => player.userId).slice(0, 10);
  const rows = [];

  for (let i = 0; i < usable.length; i += 5) {
    const row = new ActionRowBuilder();

    usable.slice(i, i + 5).forEach((player, offset) => {
      const index = i + offset;
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`ggcon:${op}:${player.userId}:${action}:${amount}`)
          .setLabel(String(index + 1))
          .setStyle(ButtonStyle.Primary)
      );
    });

    rows.push(row);
  }

  return rows;
}

async function handleCashOrFameCommand(message, args, kind) {
  const commandName = kind === "cash" ? "!cash" : "!fame";
  const parsed = parsePlayerActionAmountArgs(args, commandName);
  if (parsed.error) {
    await message.reply(parsed.error).catch(() => {});
    return;
  }

  const playerResult = await getPlayerForLookup(parsed.playerQuery);

  if (playerResult.type === "none") {
    await message.reply(`No player found for **${parsed.playerQuery}**.`).catch(() => {});
    return;
  }

  if (playerResult.type === "multiple") {
    await message.reply({
      content: buildMultipleMatchesReply(parsed.playerQuery, playerResult.matches, commandName),
      components: buildPlayerOperationButtons(playerResult.matches, commandName, parsed.action, parsed.amount),
    }).catch(() => {});
    return;
  }

  await applyPlayerBalanceChange(message, playerResult.player, kind, parsed.action, parsed.amount);
}

async function handleOnlineCommand(message) {
  const onlinePlayers = await getOnlinePlayers();

  if (onlinePlayers.length === 0) {
    await message.reply("No players are currently online.").catch(() => {});
    return;
  }

  const sorted = onlinePlayers.sort((a, b) => String(a.characterName || a.steamName || "").localeCompare(String(b.characterName || b.steamName || "")));
  const rows = sorted.slice(0, 25).map((player, index) => {
    const squad = player.squad?.name || "No squad";
    return `**${index + 1}. ${getPlayerDisplayName(player)}** — Ping: ${player.ping ?? "?"} ms | Fame: ${formatMoney(player.fame)} | Cash: ${formatMoney(player.accountBalance)} | Squad: ${squad}\nSteam ID: \`${player.userId || "Unknown"}\` | Location: ${formatLocation(player.location)}`;
  });

  const extra = sorted.length > 25 ? `\n\nShowing 25 of ${sorted.length} online players.` : "";

  await message.reply(clampDiscord([
    `🟢 **Online Players (${sorted.length})**`,
    "",
    rows.join("\n\n"),
    extra,
  ].join("\n"))).catch(() => {});
}

function buildNearbyVehicleLine(entry, index) {
  const vehicle = entry.vehicle;
  return [
    `**${index + 1}. ${vehicle.name || vehicle.class || "Vehicle"}** — ${formatApproxDistance(entry.distance)} away`,
    `ID: \`${vehicle.id}\` | Class: ${vehicle.class || "Unknown"}`,
    `Owner: ${vehicle.owner || "Unknown"}${vehicle.ownerSteamId ? ` | \`${vehicle.ownerSteamId}\`` : ""}`,
    `Location: ${formatLocation(vehicle.location)}`,
  ].join("\n");
}

async function buildNearVehiclesBySteamId(steamId) {
  const playerResult = await getPlayerForLookup(String(steamId || ""));
  if (playerResult.type !== "single") return `No player found for \`${steamId}\`.`;

  const player = playerResult.player;
  if (!player.location) {
    return `No usable location found for **${getPlayerDisplayName(player)}**. They may need to be online or have a last-known server location.`;
  }

  const vehicleData = await ggconGet("/vehicles.json");
  const vehicles = Array.isArray(vehicleData.vehicles) ? vehicleData.vehicles : [];
  const nearby = vehicles
    .filter((vehicle) => vehicle.location)
    .map((vehicle) => ({ vehicle, distance: distanceUnrealUnits(player.location, vehicle.location) }))
    .filter((entry) => Number.isFinite(entry.distance))
    .sort((a, b) => a.distance - b.distance);

  if (nearby.length === 0) {
    return `No vehicles with usable locations found near **${getPlayerDisplayName(player)}**.`;
  }

  const rows = nearby.slice(0, 10).map(buildNearbyVehicleLine);
  const ownershipNote = vehicleData.ownershipResolved === false
    ? "\n\n⚠️ Vehicle ownership is not fully resolved right now."
    : "";

  return clampDiscord([
    `📍 **Nearest Vehicles to ${getPlayerDisplayName(player)}**`,
    `Player Location: ${formatLocation(player.location)}`,
    `Showing closest ${Math.min(10, nearby.length)} of ${nearby.length} vehicle(s).`,
    "",
    rows.join("\n\n"),
    ownershipNote,
  ].join("\n"));
}

async function handleNearVehiclesCommand(message, args) {
  const query = args.join(" ").trim();
  if (!query) {
    await message.reply("Use: `!nearvehicles <player name or Steam ID>`").catch(() => {});
    return;
  }

  const playerResult = await getPlayerForLookup(query);

  if (playerResult.type === "none") {
    await message.reply(`No player found for **${query}**.`).catch(() => {});
    return;
  }

  if (playerResult.type === "multiple") {
    await message.reply({
      content: buildMultipleMatchesReply(query, playerResult.matches, "!nearvehicles"),
      components: buildMatchButtons(playerResult.matches, "!nearvehicles"),
    }).catch(() => {});
    return;
  }

  const content = await buildNearVehiclesBySteamId(playerResult.player.userId);
  await message.reply(content).catch(() => {});
}

async function handleCashOrFameButton(interaction, kind, valueParts) {
  const [steamId, action, amountText] = valueParts;
  const amount = Number(amountText);
  const playerResult = await getPlayerForLookup(String(steamId || ""));

  if (playerResult.type !== "single") {
    await interaction.reply({ content: `No player found for \`${steamId}\`.`, ephemeral: true }).catch(() => {});
    return true;
  }

  await ggconPost(`/players/${encodeURIComponent(steamId)}/${kind === "cash" ? "currency" : "fame"}`, {
    action,
    amount,
  });

  await interaction.reply({
    content: `${kind === "cash" ? "Cash" : "Fame"} updated for **${getPlayerDisplayName(playerResult.player)}**: **${action}** ${Number(amount).toLocaleString("en-CA")}.`,
    ephemeral: true,
  }).catch(() => {});
  return true;
}


function getJailLocationText() {
  return `X: ${JAIL_LOCATION.x} | Y: ${JAIL_LOCATION.y} | Z: ${JAIL_LOCATION.z}`;
}

async function getSavedJailReturn(guildId, steamId) {
  const guildKey = String(guildId || "default");
  const steamKey = String(steamId || "");

  try {
    const supabaseEntry = await getJailReturnFromSupabase(guildKey, steamKey);
    if (supabaseEntry) {
      const localState = loadJailStateLocal();
      getLocalJailBucket(localState, guildKey)[steamKey] = supabaseEntry;
      saveJailStateLocal(localState);
      return supabaseEntry;
    }
  } catch (err) {
    console.error("❌ Failed to load jail return from Supabase. Using local fallback:", err.message);
  }

  const state = loadJailStateLocal();
  const guildBucket = getLocalJailBucket(state, guildKey);
  return guildBucket[steamKey] || state.players?.[steamKey] || null;
}

async function saveJailReturn(guildId, steamId, entry) {
  const guildKey = String(guildId || "default");
  const steamKey = String(steamId || "");
  const state = loadJailStateLocal();
  getLocalJailBucket(state, guildKey)[steamKey] = entry;
  state.updatedAt = Date.now();
  saveJailStateLocal(state);

  try {
    await saveJailReturnToSupabase(guildKey, steamKey, entry);
  } catch (err) {
    console.error("❌ Failed to save jail return to Supabase. Local backup saved:", err.message);
  }
}

async function clearJailReturn(guildId, steamId) {
  const guildKey = String(guildId || "default");
  const steamKey = String(steamId || "");
  const state = loadJailStateLocal();
  const guildBucket = getLocalJailBucket(state, guildKey);
  if (guildBucket[steamKey]) delete guildBucket[steamKey];
  if (state.players?.[steamKey]) delete state.players[steamKey];
  state.updatedAt = Date.now();
  saveJailStateLocal(state);

  try {
    await deleteJailReturnFromSupabase(guildKey, steamKey);
  } catch (err) {
    console.error("❌ Failed to clear jail return from Supabase. Local backup cleared:", err.message);
  }
}

async function jailPlayerBySteamId(messageOrInteraction, steamId) {
  const playerResult = await getPlayerForLookup(String(steamId || ""));
  if (playerResult.type !== "single") {
    const content = `No player found for \`${steamId}\`.`;
    if (messageOrInteraction.reply) await messageOrInteraction.reply({ content, ephemeral: true }).catch(() => {});
    return;
  }

  const player = playerResult.player;
  const realSteamId = String(player.userId || steamId || "").trim();
  if (!realSteamId) {
    const content = "That player does not have a usable Steam ID.";
    if (messageOrInteraction.reply) await messageOrInteraction.reply({ content, ephemeral: true }).catch(() => {});
    return;
  }

  const returnLocation = cloneLocation(player.location);
  const displayName = getPlayerDisplayName(player);
  const guildId = getGuildIdFromContext(messageOrInteraction);
  const jailedBy = getDiscordActorName(messageOrInteraction);
  const jailedByDiscordId = getDiscordActorId(messageOrInteraction);

  if (returnLocation) {
    await saveJailReturn(guildId, realSteamId, {
      steamId: realSteamId,
      displayName,
      steamName: player.steamName || null,
      location: returnLocation,
      jailedAt: Date.now(),
      jailedBy,
      jailedByDiscordId,
    });
  }

  await ggconPost(`/players/${encodeURIComponent(realSteamId)}/teleport`, {
    x: JAIL_LOCATION.x,
    y: JAIL_LOCATION.y,
    z: JAIL_LOCATION.z,
  });

  const content = [
    `🚔 **${displayName}** was sent to jail.`,
    `Steam ID: \`${realSteamId}\``,
    `Jail Location: ${getJailLocationText()}`,
    returnLocation ? `Return Point Saved: ${formatLocation(returnLocation)}` : "Return Point Saved: No usable player location was available.",
    "Use `!unjail <player>` to send them back to the saved return point.",
    "Note: teleport uses X/Y/Z only. Pitch/yaw/roll from the saved point are ignored.",
  ].join("\n");

  const log = buildAdminActionLog("🚔 **Player Jailed**", [
    `Player: **${displayName}**`,
    `Steam ID: \`${realSteamId}\``,
    `Jail Location: ${getJailLocationText()}`,
    returnLocation ? `Saved Return Point: ${formatLocation(returnLocation)}` : "Saved Return Point: None available",
    `Jailed by: ${jailedBy}`,
  ]);

  await sendGgconActionLog(messageOrInteraction.client || messageOrInteraction.bot, messageOrInteraction.channel, log).catch(() => {});

  if (messageOrInteraction.update) {
    await messageOrInteraction.update({ content, components: [] }).catch(() => {});
  } else {
    await messageOrInteraction.reply(content).catch(() => {});
  }
}

async function unjailPlayerBySteamId(messageOrInteraction, steamId) {
  const playerResult = await getPlayerForLookup(String(steamId || ""));
  if (playerResult.type !== "single") {
    const content = `No player found for \`${steamId}\`.`;
    if (messageOrInteraction.reply) await messageOrInteraction.reply({ content, ephemeral: true }).catch(() => {});
    return;
  }

  const player = playerResult.player;
  const realSteamId = String(player.userId || steamId || "").trim();
  if (!realSteamId) {
    const content = "That player does not have a usable Steam ID.";
    if (messageOrInteraction.reply) await messageOrInteraction.reply({ content, ephemeral: true }).catch(() => {});
    return;
  }

  const guildId = getGuildIdFromContext(messageOrInteraction);
  const saved = await getSavedJailReturn(guildId, realSteamId);
  const returnLocation = cloneLocation(saved?.location);
  const displayName = getPlayerDisplayName(player, saved?.displayName || "Unknown");

  if (!returnLocation) {
    const content = [
      `No saved jail return point found for **${displayName}**.`,
      "They may not have been jailed with the updated Watcher version, or there is no saved return row in Supabase.",
    ].join("\n");

    if (messageOrInteraction.update) await messageOrInteraction.update({ content, components: [] }).catch(() => {});
    else await messageOrInteraction.reply(content).catch(() => {});
    return;
  }

  await ggconPost(`/players/${encodeURIComponent(realSteamId)}/teleport`, {
    x: returnLocation.x,
    y: returnLocation.y,
    z: returnLocation.z,
  });

  await clearJailReturn(guildId, realSteamId);

  const unjailedBy = getDiscordActorName(messageOrInteraction);
  const content = [
    `🔓 **${displayName}** was released from jail.`,
    `Steam ID: \`${realSteamId}\``,
    `Returned To: ${formatLocation(returnLocation)}`,
  ].join("\n");

  const log = buildAdminActionLog("🔓 **Player Unjailed**", [
    `Player: **${displayName}**`,
    `Steam ID: \`${realSteamId}\``,
    `Returned To: ${formatLocation(returnLocation)}`,
    saved?.jailedAt ? `Original Jail Time: ${formatDate(saved.jailedAt)}` : null,
    saved?.jailedBy ? `Originally Jailed by: ${saved.jailedBy}` : null,
    `Unjailed by: ${unjailedBy}`,
  ]);

  await sendGgconActionLog(messageOrInteraction.client || messageOrInteraction.bot, messageOrInteraction.channel, log).catch(() => {});

  if (messageOrInteraction.update) {
    await messageOrInteraction.update({ content, components: [] }).catch(() => {});
  } else {
    await messageOrInteraction.reply(content).catch(() => {});
  }
}

async function handleJailCommand(message, args) {
  const query = args.join(" ").trim();
  if (!query) {
    await message.reply("Use: `!jail <player name or Steam ID>`").catch(() => {});
    return;
  }

  const playerResult = await getPlayerForLookup(query);

  if (playerResult.type === "none") {
    await message.reply(`No player found for **${query}**.`).catch(() => {});
    return;
  }

  if (playerResult.type === "multiple") {
    await message.reply({
      content: buildMultipleMatchesReply(query, playerResult.matches, "!jail"),
      components: buildMatchButtons(playerResult.matches, "!jail"),
    }).catch(() => {});
    return;
  }

  await jailPlayerBySteamId(message, playerResult.player.userId);
}

async function handleUnjailCommand(message, args) {
  const query = args.join(" ").trim();
  if (!query) {
    await message.reply("Use: `!unjail <player name or Steam ID>`").catch(() => {});
    return;
  }

  const playerResult = await getPlayerForLookup(query);

  if (playerResult.type === "none") {
    await message.reply(`No player found for **${query}**.`).catch(() => {});
    return;
  }

  if (playerResult.type === "multiple") {
    await message.reply({
      content: buildMultipleMatchesReply(query, playerResult.matches, "!unjail"),
      components: buildMatchButtons(playerResult.matches, "!unjail"),
    }).catch(() => {});
    return;
  }

  await unjailPlayerBySteamId(message, playerResult.player.userId);
}

function normalizeVehicleText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/^bpc[_-]?/g, "")
    .replace(/[`~!@#$%^&*()_+=\[\]{};:'"\\|,.<>/?-]/g, " ")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactVehicleText(value) {
  return normalizeVehicleText(value).replace(/\s+/g, "");
}

function getSimpleVehicleAliasTargets(query) {
  const compact = compactVehicleText(query);
  return SIMPLE_VEHICLE_ALIASES[compact] || null;
}

function vehicleTypeScore(vehicleType, query) {
  const rawQuery = String(query || "").trim();
  const q = normalizeVehicleText(rawQuery);
  const compactQ = compactVehicleText(rawQuery);
  if (!q) return 0;

  const rawClass = String(vehicleType.i || vehicleType.class || "").trim();
  const normalizedClass = normalizeVehicleText(rawClass);
  const normalizedNoPrefix = normalizeVehicleText(rawClass.replace(/^BPC[_-]?/i, ""));
  const compactClass = compactVehicleText(rawClass);
  const compactNoPrefix = compactVehicleText(rawClass.replace(/^BPC[_-]?/i, ""));
  const aliasTargets = getSimpleVehicleAliasTargets(rawQuery) || [];

  let best = 0;
  for (const alias of aliasTargets) {
    const compactAlias = compactVehicleText(alias);
    if (!compactAlias) continue;
    if (compactClass === compactAlias || compactNoPrefix === compactAlias) best = Math.max(best, 2000);
    else if (compactClass.includes(compactAlias) || compactNoPrefix.includes(compactAlias)) best = Math.max(best, 1700);
  }

  for (const field of [rawClass.toLowerCase(), normalizedClass, normalizedNoPrefix, compactClass, compactNoPrefix]) {
    if (!field) continue;
    if (field === rawQuery.toLowerCase() || field === q || field === compactQ) best = Math.max(best, 1000);
    else if (field.startsWith(q) || field.startsWith(compactQ)) best = Math.max(best, 850);
    else if (field.includes(q) || field.includes(compactQ)) best = Math.max(best, 650);
  }

  return best;
}

async function getVehicleTypes() {
  const data = await ggconGet("/vehicle-types.json");
  return Array.isArray(data.items) ? data.items : [];
}

async function searchVehicleTypes(query) {
  const types = await getVehicleTypes();
  return types
    .map((vehicleType) => ({ vehicleType, score: vehicleTypeScore(vehicleType, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || String(a.vehicleType.i || "").localeCompare(String(b.vehicleType.i || "")))
    .map((entry) => entry.vehicleType);
}

function buildVehicleTypeList(matches, query) {
  const rows = matches.slice(0, 10).map((vehicleType, index) => {
    return `**${index + 1}.** \`${vehicleType.i || "Unknown"}\``;
  });
  const extra = matches.length > 10 ? `\n\nShowing 10 of ${matches.length} vehicle type matches.` : "";

  return clampDiscord([
    `Multiple vehicle types matched **${query}**.`,
    "",
    rows.join("\n"),
    extra,
    "",
    "Click a number below, or rerun the command with the exact class.",
  ].join("\n"));
}

function buildGiveVehicleTypeButtons(steamId, matches) {
  const usable = matches.filter((vehicleType) => vehicleType.i).slice(0, 10);
  const rows = [];

  for (let i = 0; i < usable.length; i += 5) {
    const row = new ActionRowBuilder();
    usable.slice(i, i + 5).forEach((vehicleType, offset) => {
      const index = i + offset;
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`ggcon:givevehicleclass:${steamId}:${vehicleType.i}`)
          .setLabel(String(index + 1))
          .setStyle(ButtonStyle.Primary)
      );
    });
    rows.push(row);
  }

  return rows;
}

function buildGiveVehiclePlayerButtons(matches, vehicleQuery) {
  const usable = matches.filter((player) => player.userId).slice(0, 10);
  const safeQuery = encodeURIComponent(String(vehicleQuery || "").slice(0, 45));
  const rows = [];

  for (let i = 0; i < usable.length; i += 5) {
    const row = new ActionRowBuilder();
    usable.slice(i, i + 5).forEach((player, offset) => {
      const index = i + offset;
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`ggcon:givevehicleplayer:${player.userId}:${safeQuery}`)
          .setLabel(String(index + 1))
          .setStyle(ButtonStyle.Primary)
      );
    });
    rows.push(row);
  }

  return rows;
}

async function giveVehicleToSteamId(messageOrInteraction, steamId, vehicleClass) {
  const playerResult = await getPlayerForLookup(String(steamId || ""));
  const player = playerResult.type === "single" ? playerResult.player : { userId: steamId };
  const realSteamId = String(player.userId || steamId || "").trim();

  await ggconPost("/spawn-vehicle", {
    steamId: realSteamId,
    vehicle: vehicleClass,
  });

  const content = [
    `🚙 Vehicle spawned for **${getPlayerDisplayName(player, realSteamId)}**.`,
    `Steam ID: \`${realSteamId}\``,
    `Vehicle: \`${vehicleClass}\``,
  ].join("\n");

  const log = buildAdminActionLog("🚙 **Vehicle Spawned by Admin**", [
    `Player: **${getPlayerDisplayName(player, realSteamId)}**`,
    `Steam ID: \`${realSteamId}\``,
    `Vehicle: \`${vehicleClass}\``,
    `Spawned by: ${messageOrInteraction.member?.displayName || messageOrInteraction.user?.tag || messageOrInteraction.author?.tag || "Unknown"}`,
  ]);

  await sendGgconActionLog(messageOrInteraction.client || messageOrInteraction.bot, messageOrInteraction.channel, log).catch(() => {});

  if (messageOrInteraction.update) {
    await messageOrInteraction.update({ content, components: [] }).catch(() => {});
  } else if (messageOrInteraction.reply) {
    await messageOrInteraction.reply(content).catch(() => {});
  }
}

async function resolveGiveVehicleTarget(messageOrInteraction, steamId, vehicleQuery) {
  const matches = await searchVehicleTypes(vehicleQuery);
  if (matches.length === 0) {
    const content = `No vehicle found for **${vehicleQuery}**. Use one of: ${SIMPLE_VEHICLE_NAMES}.`;
    if (messageOrInteraction.update) await messageOrInteraction.update({ content, components: [] }).catch(() => {});
    else await messageOrInteraction.reply(content).catch(() => {});
    return;
  }

  const aliasTargets = getSimpleVehicleAliasTargets(vehicleQuery);
  if (aliasTargets && matches[0]?.i) {
    await giveVehicleToSteamId(messageOrInteraction, steamId, matches[0].i);
    return;
  }

  if (matches.length > 1) {
    const payload = {
      content: buildVehicleTypeList(matches, vehicleQuery),
      components: buildGiveVehicleTypeButtons(steamId, matches),
    };
    if (messageOrInteraction.update) await messageOrInteraction.update(payload).catch(() => {});
    else await messageOrInteraction.reply(payload).catch(() => {});
    return;
  }

  await giveVehicleToSteamId(messageOrInteraction, steamId, matches[0].i);
}

async function handleVehicleTypeCommand(message, args) {
  const query = args.join(" ").trim();
  if (!query) {
    await message.reply("Use: `!vehicletype <vehicle name or class>`").catch(() => {});
    return;
  }

  const matches = await searchVehicleTypes(query);
  if (matches.length === 0) {
    await message.reply(`No vehicle type found for **${query}**.`).catch(() => {});
    return;
  }

  const rows = matches.slice(0, 15).map((vehicleType, index) => `**${index + 1}.** \`${vehicleType.i || "Unknown"}\``);
  const extra = matches.length > 15 ? `\n\nShowing 15 of ${matches.length} matches.` : "";
  await message.reply(clampDiscord([`🚙 **Vehicle Type Search: ${query}**`, "", rows.join("\n"), extra].join("\n"))).catch(() => {});
}

async function handleGiveVehicleCommand(message, args) {
  if (args.length < 2) {
    await message.reply(`Use: \`!givevehicle <player name or Steam ID> <vehicle>\`\nVehicle options: ${SIMPLE_VEHICLE_NAMES}`).catch(() => {});
    return;
  }

  // Best-effort split: if the first token is a Steam ID, everything after is vehicle query.
  // Otherwise, try each possible player-name length until a player match is found.
  let playerQuery = "";
  let vehicleQuery = "";

  if (isSteamId(args[0])) {
    playerQuery = args[0];
    vehicleQuery = args.slice(1).join(" ").trim();
  } else {
    // Try the longest possible player name first so names like "Josh Ayres" work.
    for (let i = args.length - 1; i >= 1; i -= 1) {
      const possiblePlayer = args.slice(0, i).join(" ").trim();
      const possibleVehicle = args.slice(i).join(" ").trim();
      if (!possibleVehicle) continue;
      const result = await getPlayerForLookup(possiblePlayer);
      if (result.type !== "none") {
        playerQuery = possiblePlayer;
        vehicleQuery = possibleVehicle;
        break;
      }
    }
  }

  if (!playerQuery || !vehicleQuery) {
    await message.reply(`I could not split the player and vehicle. Use: \`!givevehicle <player> <vehicle>\`\nVehicle options: ${SIMPLE_VEHICLE_NAMES}`).catch(() => {});
    return;
  }

  const playerResult = await getPlayerForLookup(playerQuery);

  if (playerResult.type === "none") {
    await message.reply(`No player found for **${playerQuery}**.`).catch(() => {});
    return;
  }

  if (playerResult.type === "multiple") {
    await message.reply({
      content: buildMultipleMatchesReply(playerQuery, playerResult.matches, "!givevehicle"),
      components: buildGiveVehiclePlayerButtons(playerResult.matches, vehicleQuery),
    }).catch(() => {});
    return;
  }

  await resolveGiveVehicleTarget(message, playerResult.player.userId, vehicleQuery);
}

function getKillEventKey(event) {
  return String(event?.t || "") + ":" + String(event?.type || "") + ":" + String(event?.killer?.sid || event?.killer?.name || "") + ":" + String(event?.victim?.sid || event?.victim?.name || "");
}

function getKillEventLocation(event) {
  const victim = event?.victim || {};
  if ([victim.x, victim.y, victim.z].some((v) => v !== undefined && v !== null && Number.isFinite(Number(v)))) {
    return { x: victim.x, y: victim.y, z: victim.z };
  }

  const killer = event?.killer || {};
  if ([killer.x, killer.y, killer.z].some((v) => v !== undefined && v !== null && Number.isFinite(Number(v)))) {
    return { x: killer.x, y: killer.y, z: killer.z };
  }

  return null;
}

function formatKillPerson(person) {
  if (!person) return "Unknown";
  const name = person.name || "Unknown";
  const sid = person.sid ? ` (\`${person.sid}\`)` : "";
  return `${name}${sid}`;
}

function eventPersonHasSteamId(person) {
  return !!String(person?.sid || "").trim();
}

function isNpcCategoryAllowed(cat) {
  const value = String(cat || "").toLowerCase();
  if (!value) return false;
  return ["guard", "drifter", "armednpc", "armed npc", "brenner", "razor", "sentry", "drone"].some((term) => value.includes(term));
}

function isHostileNpcName(value) {
  const text = String(value || "").toLowerCase();
  if (!text) return false;
  return ["guard", "drifter", "armednpc", "armed npc", "brenner", "razor", "sentry", "drone", "suicide"].some((term) => text.includes(term));
}

function isCreatureOrPuppetName(value) {
  const text = String(value || "").toLowerCase();
  if (!text) return false;
  return [
    "bp_", "puppet", "zombie", "animal", "bear", "boar", "goat", "chicken", "cow", "donkey", "deer",
    "horse", "wolf", "crow", "seagull", "rabbit", "rat", "creature", "npc"
  ].some((term) => text.includes(term));
}

function isLikelyPlayerDeathWithoutSteamId(event) {
  const type = String(event?.type || "").toLowerCase();
  const killerName = String(event?.killer?.name || "");
  const victimName = String(event?.victim?.name || "");

  if (["pvp", "suicide", "trap", "death"].includes(type)) return true;

  // Some NPC-caused deaths can arrive with the player Steam ID missing from the event payload.
  // If the killer/cause looks like a creature or hostile NPC and the victim does not look like a creature, treat it as a player death.
  if (type === "npc" && !eventPersonHasSteamId(event?.killer) && victimName && !isCreatureOrPuppetName(victimName)) {
    return isCreatureOrPuppetName(killerName) || isHostileNpcName(killerName) || isHostileNpcName(event?.weaponRaw) || isHostileNpcName(event?.weapon);
  }

  return false;
}

function shouldPostKillEvent(event) {
  const type = String(event?.type || "").toLowerCase();
  const killerIsPlayer = eventPersonHasSteamId(event?.killer);
  const victimIsPlayer = eventPersonHasSteamId(event?.victim);

  // Log every player death type: PvP, suicide, trap, puppet, suicide puppet, vehicle, animal, NPC, drowning, falling, and unknown deaths.
  if (victimIsPlayer || isLikelyPlayerDeathWithoutSteamId(event)) return true;

  // Keep important hostile NPC kills, but do not spam normal puppet/animal farming kills.
  if (type === "npc" && killerIsPlayer && !victimIsPlayer) {
    return isNpcCategoryAllowed(event?.cat) || isHostileNpcName(event?.victim?.name) || isHostileNpcName(event?.weaponRaw);
  }

  return false;
}

function isVehicleLikeDeath(event) {
  const haystack = [
    event?.weapon,
    event?.weaponRaw,
    event?.dmgType,
    event?.killer?.name,
    event?.victim?.name,
  ].filter(Boolean).join(" ").toLowerCase();

  return ["vehicle", "collision", "crash", "car", "truck", "rager", "laika", "duster", "tractor", "mariner", "wolfs"].some((term) => haystack.includes(term));
}

function findNearestVehicleToLocation(vehicles, location) {
  if (!location || !Array.isArray(vehicles)) return null;

  let best = null;
  for (const vehicle of vehicles) {
    if (!vehicle?.location) continue;
    const distance = distanceUnrealUnits(location, vehicle.location);
    if (distance === null) continue;
    if (!best || distance < best.distance) best = { vehicle, distance };
  }

  return best;
}

function getKillAlertTitle(event) {
  const type = String(event.type || "unknown").toLowerCase();
  const victimIsPlayer = eventPersonHasSteamId(event?.victim);
  const killerIsPlayer = eventPersonHasSteamId(event?.killer);

  if (type === "pvp") return { emoji: "☠️", title: "Player Killed Player" };
  if (victimIsPlayer && type === "trap") return { emoji: "🪤", title: "Player Trap Death" };
  if (victimIsPlayer && type === "suicide") return { emoji: "💀", title: "Player Death / Suicide" };
  if (victimIsPlayer && isVehicleLikeDeath(event)) return { emoji: "🚗", title: "Player Vehicle / Collision Death" };
  if (victimIsPlayer) return { emoji: "⚰️", title: "Player Death" };
  if (killerIsPlayer && type === "npc") return { emoji: "🛡️", title: "Hostile NPC Killed" };
  return { emoji: "⚰️", title: "Kill Event" };
}

function buildKillAlert(event, vehicleData = null) {
  const { emoji, title } = getKillAlertTitle(event);
  const location = getKillEventLocation(event);
  const vehicleGuess = isVehicleLikeDeath(event)
    ? findNearestVehicleToLocation(vehicleData?.vehicles || [], location)
    : null;

  return clampDiscord([
    `${emoji} **${title}**`,
    "",
    `Type: ${event.type || "Unknown"}`,
    event.killer ? `Killer / Cause: ${formatKillPerson(event.killer)}` : null,
    event.victim ? `Victim / Death: ${formatKillPerson(event.victim)}` : null,
    event.weapon ? `Weapon / Cause: ${event.weapon}` : null,
    event.weaponRaw ? `Raw Cause: ${event.weaponRaw}` : null,
    event.cat ? `Category: ${event.cat}` : null,
    event.dist !== undefined && event.dist !== null ? `Distance: ${Number(event.dist).toFixed(1)} m` : null,
    event.tod ? `In-Game Time: ${event.tod}` : null,
    `Death Location: ${formatLocation(location)}`,
    vehicleGuess ? "" : null,
    vehicleGuess ? `Possible Vehicle: **${vehicleGuess.vehicle.name || vehicleGuess.vehicle.class || "Vehicle"}**` : null,
    vehicleGuess ? `Vehicle ID: \`${vehicleGuess.vehicle.id}\`` : null,
    vehicleGuess ? `Possible Owner: ${vehicleGuess.vehicle.owner || "Unknown"}` : null,
    vehicleGuess?.vehicle?.ownerSteamId ? `Owner Steam ID: \`${vehicleGuess.vehicle.ownerSteamId}\`` : null,
    vehicleGuess ? `Vehicle Distance from Death: ${formatApproxDistance(vehicleGuess.distance)}` : null,
    vehicleGuess ? "_Vehicle owner is a best guess from the nearest listed vehicle._" : null,
  ].filter(Boolean).join("\n"));
}

function getKillLogIntervalSeconds() {
  const seconds = Number(process.env.GGCON_KILL_LOG_INTERVAL_SECONDS || "30");
  return Math.max(15, Number.isFinite(seconds) ? seconds : 30);
}

async function fetchKillEventsSince(cursor) {
  const endpoint = `/kill-feed/events.json?since=${encodeURIComponent(String(cursor || 0))}`;
  return ggconGet(endpoint);
}

async function scanKillsAndAlert(bot, { baselineOnly = false } = {}) {
  const channelId = await getKillLogChannelIdAsync();
  if (!channelId) return;

  const previous = (await loadKillStatePersistent()) || {};
  const cursor = previous.cursor || 0;
  const data = await fetchKillEventsSince(cursor);
  const events = Array.isArray(data.events) ? data.events : [];
  const nextCursor = data.next || events.reduce((max, event) => Math.max(max, Number(event.t || 0)), Number(cursor || 0));

  await saveKillStatePersistent({
    updatedAt: Date.now(),
    cursor: nextCursor,
    total: data.total,
    lastEventCount: events.length,
  });

  if (baselineOnly || events.length === 0) return;

  const channel = await bot.channels.fetch(channelId).catch(() => null);
  if (!channel?.send) return;

  const unique = [];
  const seen = new Set(previous.seen || []);
  for (const event of events) {
    const key = getKillEventKey(event);
    if (seen.has(key)) continue;
    seen.add(key);
    if (shouldPostKillEvent(event)) unique.push(event);
  }

  await saveKillStatePersistent({
    updatedAt: Date.now(),
    cursor: nextCursor,
    total: data.total,
    lastEventCount: events.length,
    lastPostedCount: unique.length,
    seen: Array.from(seen).slice(-1000),
  });

  const needsVehicleData = unique.some(isVehicleLikeDeath);
  const vehicleData = needsVehicleData
    ? await ggconGet("/vehicles.json").catch((err) => {
        console.error("❌ Failed to fetch vehicles for kill log context:", err.message);
        return null;
      })
    : null;

  for (const event of unique.slice(0, 10)) {
    await channel.send(buildKillAlert(event, vehicleData)).catch((err) => {
      console.error("❌ Kill log alert failed:", err.message);
    });
  }

  if (unique.length > 10) {
    await channel.send(`⚠️ ${unique.length - 10} more kill/death event(s) occurred in the same scan. Output was trimmed to avoid spam.`).catch(() => {});
  }
}

function ensureKillLogLoop(bot) {
  const channelId = getKillLogChannelId();
  if (!channelId) {
    getKillLogChannelIdAsync().then((resolvedChannelId) => {
      if (resolvedChannelId && !killLogTimer) ensureKillLogLoop(bot);
    }).catch(() => {});
    return;
  }
  if (killLogTimer) return;

  const intervalMs = getKillLogIntervalSeconds() * 1000;
  killLogTimer = setInterval(() => {
    scanKillsAndAlert(bot).catch((err) => {
      console.error("❌ Kill log watch failed:", err.message);
    });
  }, intervalMs);
}

function shuffleArray(values) {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function dedupeCargoPoints(points) {
  const seen = new Set();
  const deduped = [];

  for (const point of points || []) {
    const x = Math.round(Number(point.x));
    const y = Math.round(Number(point.y));
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

    const key = `${x}:${y}`;
    if (seen.has(key)) continue;

    seen.add(key);
    deduped.push({ x, y });
  }

  return deduped;
}

function buildCargoGridPoints() {
  const step = Math.max(40000, Number.isFinite(CARGO_FRENZY_GRID_STEP_UNITS) ? Math.round(CARGO_FRENZY_GRID_STEP_UNITS) : 80000);
  const points = [];
  let row = 0;

  for (let y = -660000; y <= 660000; y += step) {
    const stagger = row % 2 === 0 ? 0 : Math.round(step / 2);
    for (let x = -560000 + stagger; x <= 560000; x += step) {
      points.push({ x, y });
    }
    row += 1;
  }

  return points;
}

function getCargoCandidatePoints() {
  return dedupeCargoPoints([
    ...CARGO_FRENZY_HAND_PICKED_POINTS,
    ...buildCargoGridPoints(),
  ]);
}

function getCargoSafeDistance(flagData) {
  const configured = Number.isFinite(CARGO_FRENZY_SAFE_DISTANCE_UNITS) ? CARGO_FRENZY_SAFE_DISTANCE_UNITS : 30000;
  const flagRadius = Number(flagData?.flagInfluenceRadius);
  const buffer = Number.isFinite(CARGO_FRENZY_FLAG_BUFFER_UNITS) ? CARGO_FRENZY_FLAG_BUFFER_UNITS : 25000;

  if (Number.isFinite(flagRadius) && flagRadius > 0) {
    return Math.max(configured, flagRadius + buffer);
  }

  return configured;
}

function findNearestFlagForPoint(point, flags) {
  let nearest = null;

  for (const flag of flags || []) {
    if (!flag?.location) continue;
    const distance = distance2DUnrealUnits(point, flag.location);
    if (distance === null) continue;

    if (!nearest || distance < nearest.distance) {
      nearest = { flag, distance };
    }
  }

  return nearest;
}

function isFarEnoughFromSelectedCargo(point, selected, minimumSpacing) {
  if (!selected.length) return true;
  if (!Number.isFinite(minimumSpacing) || minimumSpacing <= 0) return true;

  return selected.every((existing) => {
    const distance = distance2DUnrealUnits(point, existing);
    return distance === null || distance >= minimumSpacing;
  });
}

function selectSafeCargoFrenzyPoints(flagData, requestedCountOverride = null) {
  const configuredCount = requestedCountOverride ?? CARGO_FRENZY_COUNT;
  const count = Math.max(1, Math.min(25, Number.isFinite(configuredCount) ? Math.floor(configuredCount) : 10));
  const z = Math.round(Number.isFinite(CARGO_FRENZY_Z) ? CARGO_FRENZY_Z : 25000);
  const flags = Array.isArray(flagData?.flags) ? flagData.flags.filter((flag) => flag?.location) : [];
  const safeDistance = getCargoSafeDistance(flagData);
  const spacing = Number.isFinite(CARGO_FRENZY_DROP_SPACING_UNITS) ? CARGO_FRENZY_DROP_SPACING_UNITS : 75000;
  const candidates = shuffleArray(getCargoCandidatePoints());

  const safeCandidates = [];
  const blocked = [];

  for (const candidate of candidates) {
    const nearest = findNearestFlagForPoint(candidate, flags);
    if (nearest && nearest.distance < safeDistance) {
      blocked.push({ point: candidate, nearest });
      continue;
    }

    safeCandidates.push({
      ...candidate,
      z,
      nearestFlagDistance: nearest?.distance ?? null,
      nearestFlag: nearest?.flag ?? null,
    });
  }

  const selected = [];

  for (const candidate of safeCandidates) {
    if (selected.length >= count) break;
    if (!isFarEnoughFromSelectedCargo(candidate, selected, spacing)) continue;
    selected.push(candidate);
  }

  // If the spacing rule is the only thing preventing a full frenzy, fill the rest with safe points.
  for (const candidate of safeCandidates) {
    if (selected.length >= count) break;
    if (selected.some((existing) => existing.x === candidate.x && existing.y === candidate.y)) continue;
    selected.push(candidate);
  }

  return {
    requestedCount: count,
    selected,
    safeDistance,
    spacing,
    totalCandidates: candidates.length,
    safeCandidateCount: safeCandidates.length,
    blockedCount: blocked.length,
    flagsChecked: flags.length,
    closestBlocked: blocked.sort((a, b) => a.nearest.distance - b.nearest.distance).slice(0, 3),
  };
}

function summarizeCargoCommandRaw(raw) {
  if (!raw) return "No response from the server tools.";
  if (raw.error) return raw.error;

  const data = raw.data || {};
  const parts = [];

  if (!raw.httpOk) parts.push(`HTTP ${raw.status}`);
  if (data.ok === false) parts.push("ok=false");
  if (data.accepted === false) parts.push("accepted=false");
  if (data.dispatched === false) parts.push("dispatched=false");

  const message = data.message || data.reason || data.error;
  if (message) parts.push(message);

  if (Array.isArray(data.lines) && data.lines.length) {
    parts.push(data.lines.slice(0, 3).join(" | "));
  }

  if (!parts.length) {
    parts.push(`accepted=${data.accepted !== false ? "yes" : "no"}, dispatched=${data.dispatched !== false ? "yes" : "no"}`);
  }

  return parts.join(" | ");
}

function wasCargoCommandSuccessful(raw) {
  if (!raw?.httpOk) return false;
  const data = raw.data || {};
  if (data.ok === false) return false;
  if (data.accepted === false) return false;
  if (data.dispatched === false) return false;
  return true;
}

async function getCargoPreflightStatus() {
  const server = await ggconGet("/server.json");

  if (server?.online === false) {
    return {
      ok: false,
      server,
      reason: "SCUM world is offline. Cargo commands were not sent.",
    };
  }

  const fps = Number(server?.fps ?? server?.avgFps ?? server?.minFps);
  if (Number.isFinite(fps) && fps <= 1) {
    return {
      ok: false,
      server,
      reason: "Server FPS looks unavailable/too low. This can happen during startup/shutdown, so cargo commands were not sent.",
    };
  }

  return { ok: true, server, reason: "" };
}

async function runCargoFrenzy(message, options = {}) {
  const requestedCount = options.count || CARGO_FRENZY_COUNT;
  const isTest = options.isTest === true;

  let preflight;
  try {
    preflight = await getCargoPreflightStatus();
  } catch (err) {
    await message.reply(`Cargo ${isTest ? "test" : "frenzy"} cancelled. I could not confirm server status: ${err.message}`).catch(() => {});
    return;
  }

  if (!preflight.ok) {
    await message.reply(clampDiscord([
      `📦 **Cargo ${isTest ? "Test" : "Frenzy"} cancelled.**`,
      preflight.reason,
      `Players online: ${preflight.server?.onlinePlayers ?? "Unknown"}`,
      `FPS: ${preflight.server?.fps ?? "Unknown"}`,
      "",
      "Watcher cannot read GGHOST's restart countdown directly, so avoid running this within 10 minutes of a scheduled restart.",
    ].join("\n"))).catch(() => {});
    return;
  }

  let flagData;

  try {
    flagData = await ggconGet("/flags.json");
  } catch (err) {
    await message.reply(`Cargo ${isTest ? "test" : "frenzy"} cancelled. I could not read flags to verify base safety: ${err.message}`).catch(() => {});
    return;
  }

  const plan = selectSafeCargoFrenzyPoints(flagData, requestedCount);
  const points = plan.selected;

  if (points.length < plan.requestedCount) {
    const closestBlocked = plan.closestBlocked.length
      ? [
          "Closest blocked preset(s):",
          ...plan.closestBlocked.map((entry, index) => `${index + 1}. X: ${entry.point.x} | Y: ${entry.point.y} — ${formatApproxDistance(entry.nearest.distance)} from ${entry.nearest.flag?.baseName || `Flag ${entry.nearest.flag?.flagId || "?"}`} (${entry.nearest.flag?.owner || "Unknown"})`),
        ].join("\n")
      : "";

    await message.reply(clampDiscord([
      `📦 **Cargo ${isTest ? "Test" : "Frenzy"} cancelled.**`,
      `Needed ${plan.requestedCount} safe location(s), but only found ${points.length}.`,
      `Flags checked: ${plan.flagsChecked}`,
      `Safe distance from flags: ${formatApproxDistance(plan.safeDistance)}`,
      `Cargo event: ${CARGO_FRENZY_EVENT_NAME}`,
      `Candidate locations checked: ${plan.totalCandidates}`,
      `Blocked for being too close to flags: ${plan.blockedCount}`,
      closestBlocked,
      "",
      "No cargo drops were launched. Add more known-safe presets or lower the cargo safety distance if you are sure it is safe.",
    ].filter(Boolean).join("\n"))).catch(() => {});
    return;
  }

  if (!isTest) {
    await ggconPost("/message", {
      text: `Cargo Frenzy! ${points.length} cargo drops have been scattered across the island. Move fast, Exiles.`,
      type: "ServerMessage",
    });
  }

  const results = [];
  for (const point of points) {
    const command = `#ScheduleWorldEvent ${CARGO_FRENZY_EVENT_NAME} ${point.x} ${point.y} ${point.z}`;
    const raw = await ggconPostRaw("/command", { command });
    results.push({
      point,
      command,
      ok: wasCargoCommandSuccessful(raw),
      output: summarizeCargoCommandRaw(raw),
      raw,
    });
  }

  const successCount = results.filter((entry) => entry.ok).length;
  const failed = results.filter((entry) => !entry.ok);

  const safetyLines = [
    `Server status: online | players: ${preflight.server?.onlinePlayers ?? "Unknown"} | FPS: ${preflight.server?.fps ?? "Unknown"}`,
    `Flags checked: ${plan.flagsChecked}`,
    `Safe distance from flags: ${formatApproxDistance(plan.safeDistance)}`,
    `Cargo event: ${CARGO_FRENZY_EVENT_NAME}`,
    `Candidate locations checked: ${plan.totalCandidates}`,
    `Safe candidates found: ${plan.safeCandidateCount}`,
    `Blocked near flags: ${plan.blockedCount}`,
  ];

  const title = isTest ? "📦 **Cargo Test launched.**" : "📦 **Cargo Frenzy launched.**";
  const lines = [
    title,
    isTest ? "One cargo drop was requested for testing." : `Cargo drops sent: ${successCount}/${points.length}`,
    isTest ? `Command sent: ${successCount}/${points.length}` : null,
    ...safetyLines,
    "",
    "Locations:",
    ...results.slice(0, 10).map((entry, index) => {
      const nearest = entry.point.nearestFlagDistance !== null ? ` | nearest flag: ${formatApproxDistance(entry.point.nearestFlagDistance)}` : " | nearest flag: none found";
      return `${index + 1}. ${entry.ok ? "✅" : "❌"} X: ${entry.point.x} | Y: ${entry.point.y} | Z: ${entry.point.z}${nearest}`;
    }),
  ].filter(Boolean);

  if (failed.length) {
    lines.push("", "Failures / raw server result:");
    for (const entry of failed.slice(0, 5)) {
      lines.push(`• ${entry.command}`);
      lines.push(`  ${entry.output}`);
    }
  } else if (isTest) {
    lines.push("", `Server result: ${results[0]?.output || "sent"}`);
  }

  if (!isTest) {
    lines.push("", "Note: Watcher now uses `#ScheduleWorldEvent BP_CargoDropEvent X Y Z`, which current SCUM builds use for exact-coordinate cargo drops. The server accepting the command still means SCUM has to process the event, so avoid running this right before restart.");
  }

  await message.reply(clampDiscord(lines.join("\n"))).catch(() => {});
}

async function handleCargoFrenzyCommand(message) {
  await runCargoFrenzy(message, { count: CARGO_FRENZY_COUNT, isTest: false });
}

async function handleCargoTestCommand(message) {
  await runCargoFrenzy(message, { count: 1, isTest: true });
}

function getEasternScheduleParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: CARGO_SCHEDULE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second || 0),
    keyDate: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

function getCargoScheduleLabel() {
  const hours = CARGO_SCHEDULE_HOURS
    .slice()
    .sort((a, b) => a - b)
    .map((hour) => `${String(hour).padStart(2, "0")}:${String(CARGO_SCHEDULE_MINUTE).padStart(2, "0")}`)
    .join(", ");
  return `${hours} ${CARGO_SCHEDULE_TIMEZONE}`;
}

function buildCargoScheduleSlot(parts, hour = parts.hour) {
  return {
    key: `${parts.keyDate}-${String(hour).padStart(2, "0")}-${String(CARGO_SCHEDULE_MINUTE).padStart(2, "0")}`,
    label: `${parts.keyDate} ${String(hour).padStart(2, "0")}:${String(CARGO_SCHEDULE_MINUTE).padStart(2, "0")} ${CARGO_SCHEDULE_TIMEZONE}`,
  };
}

function getCargoScheduleSlot(parts = getEasternScheduleParts()) {
  if (!CARGO_SCHEDULE_HOURS.includes(parts.hour)) return null;
  if (parts.minute < CARGO_SCHEDULE_MINUTE) return null;
  if (parts.minute > CARGO_SCHEDULE_MINUTE + Math.max(0, CARGO_SCHEDULE_WINDOW_MINUTES)) return null;

  return buildCargoScheduleSlot(parts, parts.hour);
}

function getNextCargoScheduleSlot(date = new Date()) {
  const parts = getEasternScheduleParts(date);
  const currentSecondOfDay = (parts.hour * 3600) + (parts.minute * 60) + (parts.second || 0);
  const scheduledSeconds = CARGO_SCHEDULE_HOURS
    .slice()
    .sort((a, b) => a - b)
    .map((hour) => ({ hour, secondOfDay: (hour * 3600) + (CARGO_SCHEDULE_MINUTE * 60) }));

  let target = scheduledSeconds.find((entry) => entry.secondOfDay > currentSecondOfDay + 2);
  let secondsUntil;

  if (target) {
    secondsUntil = target.secondOfDay - currentSecondOfDay;
  } else {
    target = scheduledSeconds[0];
    secondsUntil = (24 * 3600) - currentSecondOfDay + target.secondOfDay;
  }

  const targetDate = new Date(date.getTime() + (secondsUntil * 1000) + 1000);
  const targetParts = getEasternScheduleParts(targetDate);
  const slot = buildCargoScheduleSlot(targetParts, target.hour);

  return {
    ...slot,
    delayMs: Math.max(1000, (secondsUntil * 1000) + CARGO_SCHEDULE_WAKE_BUFFER_MS),
  };
}

function formatDelay(ms) {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  if (totalMinutes < 60) return `${totalMinutes} minute(s)`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

async function runScheduledCargoFrenzy(bot, slot) {
  const config = loadCargoScheduleConfig();
  if (!config?.enabled || !config.channelId) return;
  if (config.lastRunKey === slot.key) return;
  if (cargoScheduleRunning) return;

  const channel = await bot.channels.fetch(config.channelId).catch(() => null);
  if (!channel) return;

  cargoScheduleRunning = true;
  try {
    const pseudoMessage = {
      reply: (content) => channel.send(content),
      channel,
      guild: { id: config.guildId || "default" },
      author: { id: "scheduled-cargo-frenzy", tag: "Scheduled Cargo Frenzy" },
    };

    await channel.send(`📦 **Scheduled Cargo Frenzy starting.**\nSlot: ${slot.label}\nTiming: 30 minutes after scheduled restart.`).catch(() => {});
    await runCargoFrenzy(pseudoMessage, { count: CARGO_FRENZY_COUNT, isTest: false, scheduled: true });

    saveCargoScheduleConfig({
      ...config,
      lastRunKey: slot.key,
      lastRunAt: Date.now(),
      lastRunLabel: slot.label,
    });
  } catch (err) {
    await channel.send(`📦 **Scheduled Cargo Frenzy failed.**\nSlot: ${slot.label}\nError: ${err.message}`).catch(() => {});
  } finally {
    cargoScheduleRunning = false;
  }
}

async function checkCargoSchedule(bot) {
  if (!hasPasswordConfigured()) return false;
  const config = loadCargoScheduleConfig();
  if (!config?.enabled || !config.channelId) return false;

  const slot = getCargoScheduleSlot();
  if (!slot) return false;
  if (config.lastRunKey === slot.key) return false;

  await runScheduledCargoFrenzy(bot, slot);
  return true;
}

function clearCargoScheduleTimer() {
  if (cargoScheduleTimer) {
    clearTimeout(cargoScheduleTimer);
    cargoScheduleTimer = null;
    cargoScheduleNextSlot = null;
  }
}

function ensureCargoScheduleLoop(bot) {
  clearCargoScheduleTimer();

  if (!hasPasswordConfigured()) return;
  const config = loadCargoScheduleConfig();
  if (!config?.enabled || !config.channelId) return;

  const currentSlot = getCargoScheduleSlot();
  const nextSlot = currentSlot && config.lastRunKey !== currentSlot.key
    ? { ...currentSlot, delayMs: CARGO_SCHEDULE_WAKE_BUFFER_MS }
    : getNextCargoScheduleSlot();

  cargoScheduleNextSlot = nextSlot;
  cargoScheduleTimer = setTimeout(async () => {
    const scheduledSlot = cargoScheduleNextSlot;
    cargoScheduleTimer = null;
    cargoScheduleNextSlot = null;

    try {
      const ranCatchup = await checkCargoSchedule(bot);
      if (!ranCatchup && scheduledSlot) {
        await runScheduledCargoFrenzy(bot, scheduledSlot);
      }
    } catch (err) {
      console.error("❌ Scheduled cargo run failed:", err.message);
    } finally {
      ensureCargoScheduleLoop(bot);
    }
  }, Math.max(1000, nextSlot.delayMs));
}

async function handleCargoScheduleSetup(message, bot) {
  const config = {
    enabled: true,
    channelId: message.channel.id,
    guildId: message.guild?.id || "default",
    setBy: message.author.id,
    setAt: Date.now(),
    lastRunKey: loadCargoScheduleConfig()?.lastRunKey || null,
    lastRunAt: loadCargoScheduleConfig()?.lastRunAt || null,
    lastRunLabel: loadCargoScheduleConfig()?.lastRunLabel || null,
  };

  saveCargoScheduleConfig(config);
  ensureCargoScheduleLoop(bot);

  await message.reply([
    "📦 **Automatic Cargo Frenzy is now enabled in this channel.**",
    "It will run 30 minutes after each scheduled restart.",
    `Schedule: ${getCargoScheduleLabel()}`,
    `Drops per run: ${CARGO_FRENZY_COUNT}`,
    `Cargo event: ${CARGO_FRENZY_EVENT_NAME}`,
    "It still checks flags/bases first and cancels if it cannot find safe locations.",
  ].join("\n")).catch(() => {});
}

async function handleCargoScheduleOff(message) {
  clearCargoScheduleConfig();
  clearCargoScheduleTimer();
  await message.reply("📦 Automatic Cargo Frenzy is now disabled.").catch(() => {});
}

async function handleCargoScheduleStatus(message) {
  const config = loadCargoScheduleConfig();

  if (!config?.enabled || !config.channelId) {
    await message.reply("📦 Automatic Cargo Frenzy is not set up. Run `!cargoschedulesetup` in the channel where scheduled cargo reports should post.").catch(() => {});
    return;
  }

  const parts = getEasternScheduleParts();
  const slot = getCargoScheduleSlot(parts);
  const nextSlot = cargoScheduleNextSlot || getNextCargoScheduleSlot();
  const lines = [
    "📦 **Cargo Schedule Status**",
    `Enabled: Yes`,
    `Report Channel: <#${config.channelId}>`,
    `Schedule: ${getCargoScheduleLabel()}`,
    `Current ${CARGO_SCHEDULE_TIMEZONE} time: ${parts.keyDate} ${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}:${String(parts.second || 0).padStart(2, "0")}`,
    `Active window right now: ${slot ? "Yes" : "No"}`,
    `Next Run: ${nextSlot.label} (about ${formatDelay(nextSlot.delayMs)} from now)`,
    "Timer Mode: exact sleep-until-next-run, not once-per-minute polling.",
    `Last Run: ${config.lastRunAt ? formatDate(config.lastRunAt) : "Never"}`,
    `Last Slot: ${config.lastRunLabel || "None"}`,
    `Drops per run: ${CARGO_FRENZY_COUNT}`,
    `Cargo event: ${CARGO_FRENZY_EVENT_NAME}`,
  ];

  await message.reply(lines.join("\n")).catch(() => {});
}

function startCargoScheduleOnBoot(bot) {
  if (!hasPasswordConfigured()) return;
  const config = loadCargoScheduleConfig();
  if (!config?.enabled || !config.channelId) return;

  ensureCargoScheduleLoop(bot);
  checkCargoSchedule(bot).catch((err) => {
    console.error("❌ Boot cargo schedule catch-up failed:", err.message);
  });
}


function getKillDecision(event) {
  const type = String(event?.type || "").toLowerCase();
  const killerIsPlayer = eventPersonHasSteamId(event?.killer);
  const victimIsPlayer = eventPersonHasSteamId(event?.victim);

  if (victimIsPlayer) return { post: true, reason: "victim has a Steam ID" };
  if (isLikelyPlayerDeathWithoutSteamId(event)) return { post: true, reason: "looks like a player death even though the event has no victim Steam ID" };
  if (type === "npc" && killerIsPlayer && !victimIsPlayer) {
    if (isNpcCategoryAllowed(event?.cat) || isHostileNpcName(event?.victim?.name) || isHostileNpcName(event?.weaponRaw)) {
      return { post: true, reason: "important hostile NPC event" };
    }
    return { post: false, reason: "player killed normal puppet/animal/NPC farming target" };
  }

  return { post: false, reason: "not recognized as a player death" };
}

function parsePullRangeAndQuery(args) {
  const values = [...(args || [])];
  let range = "24h";
  const allowedRanges = new Set(["session", "24h", "48h", "all"]);
  if (values.length && allowedRanges.has(String(values[values.length - 1]).toLowerCase())) {
    range = String(values.pop()).toLowerCase();
  }
  return { range, query: values.join(" ").trim() };
}

async function fetchKillHistory(range = "24h", playerQuery = "") {
  const params = new URLSearchParams();
  params.set("range", range || "24h");
  params.set("type", "all");
  if (String(playerQuery || "").trim()) params.set("player", String(playerQuery || "").trim());
  return ggconGet(`/kill-feed/history.json?${params.toString()}`);
}

function formatKillDiagnosticEvent(event, index) {
  const decision = getKillDecision(event);
  const location = getKillEventLocation(event);
  const lines = [
    `**${index + 1}. ${decision.post ? "POST" : "IGNORE"}** — ${formatDate(event?.t)}`,
    `Type: ${event?.type || "Unknown"}`,
    `Killer/Cause: ${formatKillPerson(event?.killer)}`,
    `Victim/Death: ${formatKillPerson(event?.victim)}`,
    event?.weapon ? `Weapon/Cause: ${event.weapon}` : null,
    event?.weaponRaw ? `Raw Cause: ${event.weaponRaw}` : null,
    event?.dmgType ? `Damage Type: ${event.dmgType}` : null,
    event?.cat ? `Category: ${event.cat}` : null,
    `Location: ${formatLocation(location)}`,
    `Watcher Decision: ${decision.post ? "Would post" : "Would ignore"} — ${decision.reason}`,
  ].filter(Boolean);

  return lines.join("\n");
}

async function handleKillLogPull(message, args) {
  const { range, query } = parsePullRangeAndQuery(args);
  const data = await fetchKillHistory(range, query);
  const events = Array.isArray(data.events) ? data.events : [];
  const sorted = events.slice().sort((a, b) => Number(b.t || 0) - Number(a.t || 0));
  const state = await loadKillStatePersistent();
  const shown = sorted.slice(0, 6);

  const header = [
    "☠️ **Kill Log Pull**",
    `Range: ${range}`,
    `Player Filter: ${query || "None"}`,
    `Events Returned: ${events.length}`,
    data.capped ? "Result was capped by the server feed." : null,
    `Saved Cursor: ${state?.cursor ?? "None"}`,
    "",
    shown.length ? shown.map(formatKillDiagnosticEvent).join("\n\n") : "No death/kill events were returned for that filter.",
    "",
    "Tip: after a missed death, run `!killlogpull <player name or SteamID> 24h` and paste the result to Josh/dev chat.",
  ].filter(Boolean).join("\n");

  await message.reply(clampDiscord(header)).catch(() => {});
}

function isLikelyVehicleEntityId(value) {
  const text = String(value || "").trim();
  return /^\d{1,12}$/.test(text);
}

function vehicleDiagnosticMatches(vehicle, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  const compactQ = q.replace(/[^a-z0-9]/g, "");
  const fields = [
    vehicle?.id,
    vehicle?.name,
    vehicle?.class,
    vehicle?.owner,
    vehicle?.ownerSteamId,
  ].map((value) => String(value || "").toLowerCase());

  return fields.some((field) => field.includes(q) || field.replace(/[^a-z0-9]/g, "").includes(compactQ));
}

function buildVehicleDiagnosticBlock(id, liveVehicle, savedVehicle, pending, confirmScans) {
  const sourceVehicle = liveVehicle || savedVehicle || pending?.vehicle || { id };
  const missedScans = Number(pending?.missedScans || 0);
  const eligibleForMissingAlert = hasVehicleOwner(savedVehicle) || hasVehicleOwner(pending?.vehicle);
  const status = liveVehicle ? "Currently visible" : pending ? "Missing / pending confirmation" : savedVehicle ? "Missing from live list" : "Not tracked";

  const lines = [
    `**Vehicle ID:** \`${id}\``,
    `Name/Class: ${sourceVehicle?.name || "Vehicle"} / ${sourceVehicle?.class || "Unknown"}`,
    `Status: ${status}`,
    `Current Owner: ${liveVehicle ? formatVehicleOwner(liveVehicle) : "Not visible right now"}`,
    `Last Saved Owner: ${savedVehicle ? formatVehicleOwner(savedVehicle) : "None"}`,
    `Current Location: ${formatLocation(liveVehicle?.location)}`,
    `Last Saved Location: ${formatLocation(savedVehicle?.location || pending?.vehicle?.location)}`,
    `Missing Scans: ${missedScans}/${confirmScans}`,
    `Alert Eligible: ${eligibleForMissingAlert ? "Yes" : "No — no owner was saved for this vehicle"}`,
    pending?.alertedAt ? `Alerted At: ${formatDate(pending.alertedAt)}` : null,
  ].filter(Boolean);

  return lines.join("\n");
}

async function handleVehicleLogPull(message, args) {
  const query = args.join(" ").trim();
  const data = await ggconGet("/vehicles.json");
  const vehicles = Array.isArray(data.vehicles) ? data.vehicles : [];
  const current = buildVehicleSnapshot(vehicles);
  const state = (await loadVehicleStatePersistent()) || {};
  const saved = state.vehicles || {};
  const pending = state.pendingMissing || {};
  const confirmScans = Number(state.missingConfirmationScans || process.env.GGCON_VEHICLE_MISSING_CONFIRMATION_SCANS || "2") || 2;

  if (!query) {
    const pendingRows = Object.entries(pending).slice(0, 8).map(([id, entry]) => {
      const vehicle = entry?.vehicle || saved[id] || { id };
      return `• \`${id}\` ${vehicle.name || vehicle.class || "Vehicle"} — ${Number(entry?.missedScans || 0)}/${confirmScans} scans missing`;
    });

    await message.reply(clampDiscord([
      "🚗 **Vehicle Log Pull**",
      `Live Vehicles Visible: ${vehicles.length}`,
      `Saved Vehicles: ${Object.keys(saved).length}`,
      `Saved Owned Vehicles: ${Object.values(saved).filter(hasVehicleOwner).length}`,
      `Pending Missing: ${Object.keys(pending).length}`,
      `Confirm Missing After: ${confirmScans} scans`,
      "",
      pendingRows.length ? ["**Pending Missing Vehicles:**", pendingRows.join("\n")].join("\n") : "No vehicles are pending missing confirmation right now.",
      "",
      "Use `!vehiclelogpull <vehicleID>` or `!vehiclelogpull <vehicle name/player name>` for details.",
    ].join("\n"))).catch(() => {});
    return;
  }

  const matches = new Map();

  if (isLikelyVehicleEntityId(query)) {
    const id = String(query);
    if (current[id] || saved[id] || pending[id]) matches.set(id, { live: current[id], saved: saved[id], pending: pending[id] });
  }

  for (const [id, vehicle] of Object.entries(current)) {
    if (vehicleDiagnosticMatches(vehicle, query)) matches.set(id, { live: current[id], saved: saved[id], pending: pending[id] });
  }
  for (const [id, vehicle] of Object.entries(saved)) {
    if (vehicleDiagnosticMatches(vehicle, query)) matches.set(id, { live: current[id], saved: saved[id], pending: pending[id] });
  }
  for (const [id, entry] of Object.entries(pending)) {
    if (vehicleDiagnosticMatches(entry?.vehicle, query)) matches.set(id, { live: current[id], saved: saved[id], pending: pending[id] });
  }

  const blocks = Array.from(matches.entries()).slice(0, 6).map(([id, record]) => buildVehicleDiagnosticBlock(id, record.live, record.saved, record.pending, confirmScans));

  await message.reply(clampDiscord([
    "🚗 **Vehicle Log Pull**",
    `Filter: ${query}`,
    `Matches Found: ${matches.size}`,
    "",
    blocks.length ? blocks.join("\n\n") : "No matching vehicle was found in the live list, saved baseline, or pending missing list.",
    matches.size > 6 ? `\nShowing 6 of ${matches.size} matches.` : null,
    "",
    "Tip: if a destroyed vehicle shows `Alert Eligible: No`, it did not have saved owner data when the vehicle log baseline was created.",
  ].filter(Boolean).join("\n"))).catch(() => {});
}

async function handleKillLogSetup(message, bot) {
  await saveKillLogConfigPersistent({
    channelId: message.channel.id,
    setBy: message.author.id,
    setAt: Date.now(),
  });

  try {
    await scanKillsAndAlert(bot, { baselineOnly: true });
  } catch (err) {
    await message.reply(`Kill log setup failed: ${err.message}\nMake sure the Kill Feed plugin is installed and enabled.`).catch(() => {});
    return;
  }

  ensureKillLogLoop(bot);

  await message.reply([
    "Kill log is now active in this channel.",
    "I saved the current death-feed cursor as the baseline, so I will only alert for new deaths after this point.",
    "Mode: all player death types are logged, including suicide puppets, traps, vehicles, animals, and unknown causes.",
    "Normal puppet/animal farming kills are still ignored.",
    "The channel and scan state are saved so redeploys/restarts do not reset the log.",
    `Scan interval: ${getKillLogIntervalSeconds()} seconds`,
  ].join("\n")).catch(() => {});
}

async function handleKillLogOff(message) {
  await clearKillLogConfigPersistent();
  if (killLogTimer) {
    clearInterval(killLogTimer);
    killLogTimer = null;
  }
  await message.reply("Kill log is now disabled.").catch(() => {});
}

async function handleKillLogStatus(message) {
  const channelId = await getKillLogChannelIdAsync();
  const state = await loadKillStatePersistent();

  if (!channelId) {
    await message.reply("Kill log is not set up. Run `!killlogsetup` in the channel where kill alerts should post.").catch(() => {});
    return;
  }

  await message.reply([
    "☠️ **Kill Log Status**",
    `Alert Channel: <#${channelId}>`,
    `Tracking Active: ${killLogTimer ? "Yes" : "Will start on next bot boot/setup"}`,
    `Scan Interval: ${getKillLogIntervalSeconds()} seconds`,
    `Last Scan: ${state?.updatedAt ? formatDate(state.updatedAt) : "Never"}`,
    `Last Event Count: ${state?.lastEventCount ?? "Unknown"}`,
    `Last Posted Count: ${state?.lastPostedCount ?? "Unknown"}`,
    "Mode: all player death types are logged.",
    "Persistence: saved across bot restarts/redeploys when Supabase table is installed.",
    `Cursor: ${state?.cursor ?? "Unknown"}`,
  ].join("\n")).catch(() => {});
}

async function handleKillLogScan(message, bot) {
  const before = await loadKillStatePersistent();
  await scanKillsAndAlert(bot);
  const after = await loadKillStatePersistent();

  await message.reply([
    "☠️ **Kill Log Manual Scan Complete**",
    `Events Found: ${after?.lastEventCount ?? "Unknown"}`,
    `Events Posted: ${after?.lastPostedCount ?? 0}`,
    `Last Scan: ${after?.updatedAt ? formatDate(after.updatedAt) : "Unknown"}`,
    before?.cursor && after?.cursor && before.cursor === after.cursor ? "No new death events were found." : null,
  ].filter(Boolean).join("\n")).catch(() => {});
}

function startKillLogOnBoot(bot) {
  if (!hasPasswordConfigured()) return;

  loadKillLogConfigPersistent().then(async (config) => {
    const channelId = process.env.GGCON_KILL_LOG_CHANNEL_ID || config?.channelId || null;
    if (!channelId) return;

    ensureKillLogLoop(bot);
    const state = await loadKillStatePersistent();
    scanKillsAndAlert(bot, { baselineOnly: !state }).catch((err) => {
      console.error("❌ Boot kill log failed:", err.message);
    });
  }).catch((err) => {
    console.error("❌ Boot kill log failed:", err.message);
  });
}

async function handleGgconInteraction(interaction) {
  if (!interaction.isButton?.()) return false;
  if (!String(interaction.customId || "").startsWith("ggcon:")) return false;

  if (!isStaffInteraction(interaction)) {
    await interaction.reply({ content: "The Watcher sees the request. This button is for staff only.", ephemeral: true }).catch(() => {});
    return true;
  }

  const [, action, value] = interaction.customId.split(":");

  try {
    if (action === "cancel") {
      await interaction.update({ content: "Cancelled.", components: [] }).catch(() => {});
      return true;
    }

    if (action === "confirmDestroyVehicle") {
      return await confirmDestroyVehicle(interaction);
    }

    if (action === "confirmDestroyBase") {
      return await confirmDestroyBase(interaction);
    }

    if (action === "jail") {
      await jailPlayerBySteamId(interaction, value);
      return true;
    }

    if (action === "unjail") {
      await unjailPlayerBySteamId(interaction, value);
      return true;
    }

    if (action === "givevehicleplayer") {
      const parts = interaction.customId.split(":");
      const steamId = parts[2];
      const vehicleQuery = decodeURIComponent(parts.slice(3).join(":") || "");
      await resolveGiveVehicleTarget(interaction, steamId, vehicleQuery);
      return true;
    }

    if (action === "givevehicleclass") {
      const parts = interaction.customId.split(":");
      const steamId = parts[2];
      const vehicleClass = parts.slice(3).join(":");
      await giveVehicleToSteamId(interaction, steamId, vehicleClass);
      return true;
    }

    if (action === "cashop") {
      return await handleCashOrFameButton(interaction, "cash", value ? [value, ...interaction.customId.split(":").slice(3)] : interaction.customId.split(":").slice(2));
    }

    if (action === "fameop") {
      return await handleCashOrFameButton(interaction, "fame", value ? [value, ...interaction.customId.split(":").slice(3)] : interaction.customId.split(":").slice(2));
    }

    if (action === "flagall") {
      const flagData = await ggconGet("/flags.json");
      const page = buildAllFlagsPage(flagData, Number(value || 1));
      await interaction.update({ content: page.content, components: page.components }).catch(async () => {
        await interaction.reply({ content: page.content, components: page.components, ephemeral: true }).catch(() => {});
      });
      return true;
    }

    if (action === "overcap") {
      const flagData = await ggconGet("/flags.json");
      const page = buildOvercapPage(flagData, Number(value || 1));
      await interaction.update({ content: page.content, components: page.components }).catch(async () => {
        await interaction.reply({ content: page.content, components: page.components, ephemeral: true }).catch(() => {});
      });
      return true;
    }

    let content;
    if (action === "vehicle" || action === "vehicles") content = await buildVehiclesBySteamId(value);
    else if (action === "flag" || action === "flags") content = await buildFlagsBySteamId(value);
    else if (action === "squad") content = await buildSquadBySteamId(value);
    else if (action === "nearvehicles") content = await buildNearVehiclesBySteamId(value);
    else content = await buildPlayerDetailsBySteamId(value);

    await interaction.reply({ content, ephemeral: true }).catch(() => {});
  } catch (err) {
    console.error("❌ Server button failed:", err);
    const errorContent = `Server tool error: ${err.message}`;
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: errorContent, ephemeral: true }).catch(() => {});
    } else {
      await interaction.reply({ content: errorContent, ephemeral: true }).catch(() => {});
    }
  }

  return true;
}

async function handleGgconCommand(message, bot) {
  if (!message.guild) return false;
  if (!message.content || !message.content.startsWith("!")) return false;

  const parts = message.content.trim().split(/\s+/);
  const command = parts.shift().toLowerCase();
  const args = parts;

  if (!["!poststatus", "!server", "!player", "!vehicle", "!flag", "!squad", "!overcap", "!vehiclelogsetup", "!vehiclelogoff", "!vehiclelogstatus", "!vehiclelogscan", "!killlogsetup", "!killlogoff", "!killlogstatus", "!killlogscan", "!killlogpull", "!vehiclelogpull", "!destroyvehicle", "!destroybase", "!announce", "!cargofrenzy", "!cargotest", "!cargoschedulesetup", "!cargoscheduleoff", "!cargoschedulestatus", "!cash", "!fame", "!online", "!nearvehicles", "!jail", "!unjail", "!givevehicle"].includes(command)) return false;

  if (!isStaff(message)) {
    await message.reply("The Watcher sees the request. This command is for staff only.").catch(() => {});
    return true;
  }

  try {
    if (command === "!poststatus") {
      await handlePostStatus(message, bot);
      return true;
    }

    if (command === "!server") {
      await handleServerStatus(message);
      return true;
    }

    if (command === "!player") {
      await handlePlayerLookup(message, args);
      return true;
    }

    if (command === "!vehicle") {
      await handleVehiclesLookup(message, args);
      return true;
    }

    if (command === "!flag") {
      await handleFlagsLookup(message, args);
      return true;
    }

    if (command === "!squad") {
      await handleSquadLookup(message, args);
      return true;
    }

    if (command === "!overcap") {
      await handleOvercapLookup(message, args);
      return true;
    }

    if (command === "!destroyvehicle") {
      await handleDestroyVehicleCommand(message, args);
      return true;
    }

    if (command === "!destroybase") {
      await handleDestroyBaseCommand(message, args);
      return true;
    }

    if (command === "!announce") {
      await handleAnnounceCommand(message, args);
      return true;
    }

    if (command === "!cargofrenzy") {
      await handleCargoFrenzyCommand(message);
      return true;
    }

    if (command === "!cargotest") {
      await handleCargoTestCommand(message);
      return true;
    }

    if (command === "!cargoschedulesetup") {
      await handleCargoScheduleSetup(message, bot);
      return true;
    }

    if (command === "!cargoscheduleoff") {
      await handleCargoScheduleOff(message);
      return true;
    }

    if (command === "!cargoschedulestatus") {
      await handleCargoScheduleStatus(message);
      return true;
    }

    if (command === "!cash") {
      await handleCashOrFameCommand(message, args, "cash");
      return true;
    }

    if (command === "!fame") {
      await handleCashOrFameCommand(message, args, "fame");
      return true;
    }

    if (command === "!online") {
      await handleOnlineCommand(message);
      return true;
    }

    if (command === "!nearvehicles") {
      await handleNearVehiclesCommand(message, args);
      return true;
    }

    if (command === "!jail") {
      await handleJailCommand(message, args);
      return true;
    }

    if (command === "!unjail") {
      await handleUnjailCommand(message, args);
      return true;
    }

    if (command === "!givevehicle") {
      await handleGiveVehicleCommand(message, args);
      return true;
    }

    if (command === "!killlogsetup") {
      await handleKillLogSetup(message, bot);
      return true;
    }

    if (command === "!killlogoff") {
      await handleKillLogOff(message);
      return true;
    }

    if (command === "!killlogstatus") {
      await handleKillLogStatus(message);
      return true;
    }

    if (command === "!killlogscan") {
      await handleKillLogScan(message, bot);
      return true;
    }

    if (command === "!killlogpull") {
      await handleKillLogPull(message, args);
      return true;
    }

    if (command === "!vehiclelogpull") {
      await handleVehicleLogPull(message, args);
      return true;
    }

    if (command === "!vehiclelogsetup") {
      await handleVehicleLogSetup(message, bot);
      return true;
    }

    if (command === "!vehiclelogoff") {
      await handleVehicleLogOff(message);
      return true;
    }

    if (command === "!vehiclelogstatus") {
      await handleVehicleLogStatus(message);
      return true;
    }

    if (command === "!vehiclelogscan") {
      await handleVehicleLogScan(message, bot);
      return true;
    }
  } catch (err) {
    console.error("❌ Server command failed:", err);
    await message.reply(`Server tool error: ${err.message}`).catch(() => {});
    return true;
  }

  return false;
}

function startGgconStatusOnBoot(bot) {
  if (!hasPasswordConfigured()) {
    if (loadStatusRef() || getVehicleLogChannelId()) {
      console.warn("⚠️ Server tool startup skipped because the API password is not configured.");
    }
    return;
  }

  startVehicleWatchOnBoot(bot);
  startKillLogOnBoot(bot);
  startCargoScheduleOnBoot(bot);

  const ref = loadStatusRef();
  if (!ref?.channelId || !ref?.messageId) return;

  ensureStatusLoop(bot);
  updateStatusMessage(bot).catch((err) => {
    console.error("❌ Boot status update failed:", err.message);
  });
}

module.exports = {
  handleGgconCommand,
  handleGgconInteraction,
  startGgconStatusOnBoot,
};
