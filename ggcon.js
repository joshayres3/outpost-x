const fs = require("fs");
const path = require("path");
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

const DEFAULT_GGCON_BASE_URL = "https://ggcon.gghost.games/s/2788404";
const STATUS_FILE = path.join(__dirname, "data", "ggcon-status.json");
const VEHICLE_WATCH_FILE = path.join(__dirname, "data", "ggcon-vehicle-watch.json");
const VEHICLE_STATE_FILE = path.join(__dirname, "data", "ggcon-vehicle-state.json");
const STAFF_ROLE_NAMES = new Set(["Owner", "Owners", "Admin", "Trial Admin"]);
const MAX_PLAYER_SCAN_PAGES = Number(process.env.GGCON_PLAYER_SCAN_PAGES || "10");
const DEFAULT_FLAG_PAGE_SIZE = 5;

let statusTimer = null;
let vehicleWatchTimer = null;

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
  const action = commandName === "!vehicle" || commandName === "!vehicles" ? "vehicle" : commandName === "!flag" || commandName === "!flags" ? "flag" : commandName === "!squad" ? "squad" : "player";
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

async function handleGgconInteraction(interaction) {
  if (!interaction.isButton?.()) return false;
  if (!String(interaction.customId || "").startsWith("ggcon:")) return false;

  if (!isStaffInteraction(interaction)) {
    await interaction.reply({ content: "The Watcher sees the request. This button is for staff only.", ephemeral: true }).catch(() => {});
    return true;
  }

  const [, action, value] = interaction.customId.split(":");

  try {
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

  if (!["!poststatus", "!server", "!player", "!vehicle", "!flag", "!squad", "!overcap", "!vehiclelogsetup", "!vehiclelogoff", "!vehiclelogstatus"].includes(command)) return false;

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
