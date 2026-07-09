const fs = require("fs");
const path = require("path");
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

const DEFAULT_GGCON_BASE_URL = "https://ggcon.gghost.games/s/2788404";
const STATUS_FILE = path.join(__dirname, "data", "ggcon-status.json");
const VEHICLE_WATCH_FILE = path.join(__dirname, "data", "ggcon-vehicle-watch.json");
const VEHICLE_STATE_FILE = path.join(__dirname, "data", "ggcon-vehicle-state.json");
const KILL_LOG_FILE = path.join(__dirname, "data", "ggcon-kill-log.json");
const KILL_STATE_FILE = path.join(__dirname, "data", "ggcon-kill-state.json");
const JAIL_LOCATION = { x: 231926.016, y: -289455.094, z: 16877.357, pitch: 308.556671, yaw: 1.584615, roll: 0 };
const STAFF_ROLE_NAMES = new Set(["Owner", "Owners", "Admin", "Trial Admin"]);
const MAX_PLAYER_SCAN_PAGES = Number(process.env.GGCON_PLAYER_SCAN_PAGES || "10");
const DEFAULT_FLAG_PAGE_SIZE = 5;

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

function getBaseUrl() {
  return (process.env.GGCON_BASE_URL || DEFAULT_GGCON_BASE_URL).replace(/\/+$/, "");
}

function getPassword() {
  const password = process.env.GGCON_PASSWORD;
  if (!password) {
    throw new Error("Missing GGCON_PASSWORD Railway variable.");
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
    throw new Error(`GGCON request failed: ${reason}`);
  }

  if (data && data.ok === false) {
    const reason = data.reason || data.message || data.error || "Unknown GGCON error";
    throw new Error(`GGCON request failed: ${reason}`);
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
    throw new Error(`GGCON request failed: ${reason}`);
  }

  if (data && data.ok === false) {
    const reason = data.reason || data.message || data.error || "Unknown GGCON error";
    throw new Error(`GGCON request failed: ${reason}`);
  }

  return data || { ok: true };
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

function getKillLogChannelId() {
  return process.env.GGCON_KILL_LOG_CHANNEL_ID || loadKillLogConfig()?.channelId || null;
}

function getVehicleLogChannelId() {
  return process.env.GGCON_VEHICLE_LOG_CHANNEL_ID || loadVehicleWatchConfig()?.channelId || null;
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
      console.error("❌ GGCON status update failed:", err.message);
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

  // Fallback: if GGCON's search did not find an offline player, scan the first player pages locally.
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
  const action = commandName === "!vehicle" || commandName === "!vehicles" ? "vehicle" : commandName === "!flag" || commandName === "!flags" ? "flag" : commandName === "!squad" ? "squad" : commandName === "!nearvehicles" ? "nearvehicles" : commandName === "!jail" ? "jail" : "player";
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
    ? "\n\n⚠️ Vehicle ownership is not fully resolved right now. GGCON says ownership requires at least one player online."
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

function buildMissingVehicleAlert(vehicle) {
  return clampDiscord([
    "🚗 **Vehicle No Longer Listed**",
    "",
    `**Vehicle:** ${vehicle.name || vehicle.class || "Vehicle"}`,
    `**ID:** \`${vehicle.id}\``,
    `**Class:** ${vehicle.class || "Unknown"}`,
    `**Last Known Owner:** ${vehicle.owner || "Unknown"}`,
    `**Owner Steam ID:** ${vehicle.ownerSteamId ? `\`${vehicle.ownerSteamId}\`` : "Unknown"}`,
    `**Last Known Location:** ${formatLocation(vehicle.location)}`,
    `**Spawned:** ${formatDate(vehicle.spawnDate)}`,
    "",
    "**Reason:** Unknown. GGCON does not expose a structured vehicle-destroy reason for removals outside Watcher.",
    "This means the vehicle disappeared from `/vehicles.json` since the last scan. It may have been destroyed, deleted, cleaned up, or otherwise removed.",
  ].join("\n"));
}

async function scanVehiclesAndAlert(bot, { baselineOnly = false } = {}) {
  const channelId = getVehicleLogChannelId();
  if (!channelId) return;

  const data = await ggconGet("/vehicles.json");
  const vehicles = Array.isArray(data.vehicles) ? data.vehicles : [];
  const current = buildVehicleSnapshot(vehicles);
  const previousState = loadVehicleState();
  const previous = previousState?.vehicles || null;

  saveVehicleState({
    updatedAt: Date.now(),
    count: vehicles.length,
    ownershipResolved: data.ownershipResolved,
    vehicles: current,
  });

  if (baselineOnly || !previous) return;

  const removed = Object.values(previous).filter((vehicle) => {
    if (current[String(vehicle.id)]) return false;
    // Only alert for vehicles that had player ownership or a last known owner name.
    return !!(vehicle.ownerSteamId || vehicle.owner);
  });

  if (removed.length === 0) return;

  const channel = await bot.channels.fetch(channelId).catch(() => null);
  if (!channel?.send) return;

  for (const vehicle of removed.slice(0, 10)) {
    await channel.send(buildMissingVehicleAlert(vehicle)).catch((err) => {
      console.error("❌ Vehicle watch alert failed:", err.message);
    });
  }

  if (removed.length > 10) {
    await channel.send(`⚠️ ${removed.length - 10} more player-owned vehicles disappeared in the same scan. Output was trimmed to avoid spam.`).catch(() => {});
  }
}

function ensureVehicleWatchLoop(bot) {
  const channelId = getVehicleLogChannelId();
  if (!channelId) return;
  if (vehicleWatchTimer) return;

  const seconds = Number(process.env.GGCON_VEHICLE_WATCH_INTERVAL_SECONDS || "180");
  const intervalMs = Math.max(60, Number.isFinite(seconds) ? seconds : 180) * 1000;

  vehicleWatchTimer = setInterval(() => {
    scanVehiclesAndAlert(bot).catch((err) => {
      console.error("❌ GGCON vehicle watch failed:", err.message);
    });
  }, intervalMs);
}

async function handleVehicleLogSetup(message, bot) {
  saveVehicleWatchConfig({
    channelId: message.channel.id,
    setBy: message.author.id,
    setAt: Date.now(),
  });

  await scanVehiclesAndAlert(bot, { baselineOnly: true });
  ensureVehicleWatchLoop(bot);

  await message.reply([
    "Vehicle watch is now active in this channel.",
    "I saved the current vehicle list as the baseline, so I will only alert for vehicles that disappear after this point.",
    "Reason will show as unknown unless a future Watcher destroy command is added, because GGCON does not expose a structured destroy reason for normal removals.",
  ].join("\n")).catch(() => {});
}

async function handleVehicleLogOff(message) {
  clearVehicleWatchConfig();
  if (vehicleWatchTimer) {
    clearInterval(vehicleWatchTimer);
    vehicleWatchTimer = null;
  }
  await message.reply("Vehicle watch is now disabled.").catch(() => {});
}

async function handleVehicleLogStatus(message) {
  const channelId = getVehicleLogChannelId();
  const state = loadVehicleState();

  if (!channelId) {
    await message.reply("Vehicle watch is not set up. Run `!vehiclelogsetup` in the channel where alerts should post.").catch(() => {});
    return;
  }

  const vehicles = state?.vehicles ? Object.values(state.vehicles) : [];
  const ownedTracked = vehicles.filter((vehicle) => vehicle.ownerSteamId || vehicle.owner).length;
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
    `Last Scan: ${state?.updatedAt ? formatDate(state.updatedAt) : "Never"}`,
    `Ownership Resolved Last Scan: ${state?.ownershipResolved === undefined ? "Unknown" : state.ownershipResolved ? "Yes" : "No"}`,
  ].join("\n")).catch(() => {});
}

function startVehicleWatchOnBoot(bot) {
  if (!hasPasswordConfigured()) return;
  const channelId = getVehicleLogChannelId();
  if (!channelId) return;

  ensureVehicleWatchLoop(bot);
  scanVehiclesAndAlert(bot, { baselineOnly: !loadVehicleState() }).catch((err) => {
    console.error("❌ GGCON boot vehicle watch failed:", err.message);
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
    return `No usable location found for **${getPlayerDisplayName(player)}**. They may need to be online or have a last-known location in GGCON.`;
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

  await ggconPost(`/players/${encodeURIComponent(realSteamId)}/teleport`, {
    x: JAIL_LOCATION.x,
    y: JAIL_LOCATION.y,
    z: JAIL_LOCATION.z,
  });

  const displayName = getPlayerDisplayName(player);
  const content = [
    `🚔 **${displayName}** was sent to jail.`,
    `Steam ID: \`${realSteamId}\``,
    `Jail Location: ${getJailLocationText()}`,
    "Note: GGCON teleport uses X/Y/Z only. Pitch/yaw/roll from the saved point are ignored.",
  ].join("\n");

  const log = buildAdminActionLog("🚔 **Player Jailed**", [
    `Player: **${displayName}**`,
    `Steam ID: \`${realSteamId}\``,
    `Location: ${getJailLocationText()}`,
    `Jailed by: ${messageOrInteraction.member?.displayName || messageOrInteraction.user?.tag || messageOrInteraction.author?.tag || "Unknown"}`,
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

function buildKillAlert(event) {
  const type = String(event.type || "unknown").toLowerCase();
  const emoji = type === "pvp" ? "☠️" : type === "npc" ? "🐾" : type === "suicide" ? "💀" : type === "trap" ? "🪤" : "⚰️";
  const title = type === "pvp" ? "PvP Kill" : type === "npc" ? "NPC / Animal Kill" : type === "suicide" ? "Suicide" : type === "trap" ? "Trap Death" : "Kill Event";
  const location = getKillEventLocation(event);

  return clampDiscord([
    `${emoji} **${title}**`,
    "",
    `Type: ${event.type || "Unknown"}`,
    event.killer ? `Killer: ${formatKillPerson(event.killer)}` : null,
    event.victim ? `Victim / Death: ${formatKillPerson(event.victim)}` : null,
    event.weapon ? `Weapon: ${event.weapon}` : null,
    event.cat ? `Category: ${event.cat}` : null,
    event.dist !== undefined && event.dist !== null ? `Distance: ${Number(event.dist).toFixed(1)} m` : null,
    event.tod ? `In-Game Time: ${event.tod}` : null,
    `Death Location: ${formatLocation(location)}`,
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
  const channelId = getKillLogChannelId();
  if (!channelId) return;

  const previous = loadKillState() || {};
  const cursor = previous.cursor || 0;
  const data = await fetchKillEventsSince(cursor);
  const events = Array.isArray(data.events) ? data.events : [];
  const nextCursor = data.next || events.reduce((max, event) => Math.max(max, Number(event.t || 0)), Number(cursor || 0));

  saveKillState({
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
    unique.push(event);
  }

  saveKillState({
    updatedAt: Date.now(),
    cursor: nextCursor,
    total: data.total,
    lastEventCount: events.length,
    seen: Array.from(seen).slice(-250),
  });

  for (const event of unique.slice(0, 10)) {
    await channel.send(buildKillAlert(event)).catch((err) => {
      console.error("❌ Kill log alert failed:", err.message);
    });
  }

  if (unique.length > 10) {
    await channel.send(`⚠️ ${unique.length - 10} more kill event(s) occurred in the same scan. Output was trimmed to avoid spam.`).catch(() => {});
  }
}

function ensureKillLogLoop(bot) {
  const channelId = getKillLogChannelId();
  if (!channelId) return;
  if (killLogTimer) return;

  const intervalMs = getKillLogIntervalSeconds() * 1000;
  killLogTimer = setInterval(() => {
    scanKillsAndAlert(bot).catch((err) => {
      console.error("❌ GGCON kill log watch failed:", err.message);
    });
  }, intervalMs);
}

async function handleKillLogSetup(message, bot) {
  saveKillLogConfig({
    channelId: message.channel.id,
    setBy: message.author.id,
    setAt: Date.now(),
  });

  try {
    await scanKillsAndAlert(bot, { baselineOnly: true });
  } catch (err) {
    await message.reply(`Kill log setup failed: ${err.message}\nMake sure the GGCON Kill Feed plugin is installed and enabled.`).catch(() => {});
    return;
  }

  ensureKillLogLoop(bot);

  await message.reply([
    "Kill log is now active in this channel.",
    "I saved the current kill-feed cursor as the baseline, so I will only alert for new kill events after this point.",
    `Scan interval: ${getKillLogIntervalSeconds()} seconds`,
  ].join("\n")).catch(() => {});
}

async function handleKillLogOff(message) {
  clearKillLogConfig();
  if (killLogTimer) {
    clearInterval(killLogTimer);
    killLogTimer = null;
  }
  await message.reply("Kill log is now disabled.").catch(() => {});
}

async function handleKillLogStatus(message) {
  const channelId = getKillLogChannelId();
  const state = loadKillState();

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
    `Cursor: ${state?.cursor ?? "Unknown"}`,
  ].join("\n")).catch(() => {});
}

function startKillLogOnBoot(bot) {
  if (!hasPasswordConfigured()) return;
  const channelId = getKillLogChannelId();
  if (!channelId) return;

  ensureKillLogLoop(bot);
  scanKillsAndAlert(bot, { baselineOnly: !loadKillState() }).catch((err) => {
    console.error("❌ GGCON boot kill log failed:", err.message);
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
    console.error("❌ GGCON button failed:", err);
    const errorContent = `GGCON error: ${err.message}`;
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

  if (!["!poststatus", "!server", "!player", "!vehicle", "!flag", "!squad", "!overcap", "!vehiclelogsetup", "!vehiclelogoff", "!vehiclelogstatus", "!killlogsetup", "!killlogoff", "!killlogstatus", "!destroyvehicle", "!destroybase", "!announce", "!cash", "!fame", "!online", "!nearvehicles", "!jail", "!givevehicle"].includes(command)) return false;

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
  } catch (err) {
    console.error("❌ GGCON command failed:", err);
    await message.reply(`GGCON error: ${err.message}`).catch(() => {});
    return true;
  }

  return false;
}

function startGgconStatusOnBoot(bot) {
  if (!hasPasswordConfigured()) {
    if (loadStatusRef() || getVehicleLogChannelId()) {
      console.warn("⚠️ GGCON startup skipped because GGCON_PASSWORD is not configured.");
    }
    return;
  }

  startVehicleWatchOnBoot(bot);
  startKillLogOnBoot(bot);

  const ref = loadStatusRef();
  if (!ref?.channelId || !ref?.messageId) return;

  ensureStatusLoop(bot);
  updateStatusMessage(bot).catch((err) => {
    console.error("❌ GGCON boot status update failed:", err.message);
  });
}

module.exports = {
  handleGgconCommand,
  handleGgconInteraction,
  startGgconStatusOnBoot,
};
