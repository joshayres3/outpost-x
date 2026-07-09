const fs = require("fs");
const path = require("path");
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

const DEFAULT_GGCON_BASE_URL = "https://ggcon.gghost.games/s/2788404";
const STATUS_FILE = path.join(__dirname, "data", "ggcon-status.json");
const STAFF_ROLE_NAMES = new Set(["Owner", "Owners", "Admin", "Trial Admin"]);
const MAX_PLAYER_SCAN_PAGES = Number(process.env.GGCON_PLAYER_SCAN_PAGES || "10");

let statusTimer = null;

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
  const action = commandName === "!vehicles" ? "vehicles" : "player";
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

async function handleVehiclesLookup(message, args) {
  const query = args.join(" ").trim();

  if (!query) {
    await message.reply("Use: `!vehicles <player name or Steam ID>`").catch(() => {});
    return;
  }

  const playerResult = await getPlayerForLookup(query);

  if (playerResult.type === "none") {
    await message.reply(`No player found for **${query}**.`).catch(() => {});
    return;
  }

  if (playerResult.type === "multiple") {
    await message.reply({
      content: buildMultipleMatchesReply(query, playerResult.matches, "!vehicles"),
      components: buildMatchButtons(playerResult.matches, "!vehicles"),
    }).catch(() => {});
    return;
  }

  const player = playerResult.player;
  const steamId = String(player.userId || "");
  const vehicleData = await ggconGet("/vehicles.json");
  const vehicles = Array.isArray(vehicleData.vehicles) ? vehicleData.vehicles : [];
  const owned = vehicles.filter((vehicle) => String(vehicle.ownerSteamId || "") === steamId);

  if (owned.length === 0) {
    const ownershipNote = vehicleData.ownershipResolved === false
      ? "\n\n⚠️ Vehicle ownership is not fully resolved right now. GGCON says ownership requires at least one player online."
      : "";

    await message.reply(`No vehicles found for **${player.characterName || query}** / \`${steamId || "unknown Steam ID"}\`.${ownershipNote}`).catch(() => {});
    return;
  }

  const rows = owned.slice(0, 12).map(buildVehicleLine);
  const extra = owned.length > 12 ? `\n\nShowing 12 of ${owned.length} vehicles.` : "";
  const ownershipNote = vehicleData.ownershipResolved === false
    ? "\n\n⚠️ Vehicle ownership is not fully resolved right now."
    : "";

  const reply = [
    `🚗 **Vehicles for ${player.characterName || query}**`,
    `Steam ID: \`${steamId || "Unknown"}\``,
    `Total: ${owned.length}`,
    "",
    rows.join("\n\n"),
    extra,
    ownershipNote,
  ].join("\n");

  await message.reply(clampDiscord(reply)).catch(() => {});
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

  const player = playerResult.player;
  const playerSteamId = String(player.userId || steamId || "");
  const vehicleData = await ggconGet("/vehicles.json");
  const vehicles = Array.isArray(vehicleData.vehicles) ? vehicleData.vehicles : [];
  const owned = vehicles.filter((vehicle) => String(vehicle.ownerSteamId || "") === playerSteamId);

  if (owned.length === 0) {
    const ownershipNote = vehicleData.ownershipResolved === false
      ? "\n\n⚠️ Vehicle ownership is not fully resolved right now. GGCON says ownership requires at least one player online."
      : "";

    return `No vehicles found for **${player.characterName || player.steamName || "Unknown"}** / \`${playerSteamId || "unknown Steam ID"}\`.${ownershipNote}`;
  }

  const rows = owned.slice(0, 12).map(buildVehicleLine);
  const extra = owned.length > 12 ? `\n\nShowing 12 of ${owned.length} vehicles.` : "";
  const ownershipNote = vehicleData.ownershipResolved === false
    ? "\n\n⚠️ Vehicle ownership is not fully resolved right now."
    : "";

  return clampDiscord([
    `🚗 **Vehicles for ${player.characterName || player.steamName || "Unknown"}**`,
    `Steam ID: \`${playerSteamId || "Unknown"}\``,
    `Total: ${owned.length}`,
    "",
    rows.join("\n\n"),
    extra,
    ownershipNote,
  ].join("\n"));
}

async function handleGgconInteraction(interaction) {
  if (!interaction.isButton?.()) return false;
  if (!String(interaction.customId || "").startsWith("ggcon:")) return false;

  if (!isStaffInteraction(interaction)) {
    await interaction.reply({ content: "The Watcher sees the request. This button is for staff only.", ephemeral: true }).catch(() => {});
    return true;
  }

  const [, action, steamId] = interaction.customId.split(":");

  try {
    const content = action === "vehicles"
      ? await buildVehiclesBySteamId(steamId)
      : await buildPlayerDetailsBySteamId(steamId);

    await interaction.reply({ content, ephemeral: true }).catch(() => {});
  } catch (err) {
    console.error("❌ GGCON button failed:", err);
    await interaction.reply({ content: `GGCON error: ${err.message}`, ephemeral: true }).catch(() => {});
  }

  return true;
}

async function handleGgconCommand(message, bot) {
  if (!message.guild) return false;
  if (!message.content || !message.content.startsWith("!")) return false;

  const parts = message.content.trim().split(/\s+/);
  const command = parts.shift().toLowerCase();
  const args = parts;

  if (!["!poststatus", "!player", "!vehicles"].includes(command)) return false;

  if (!isStaff(message)) {
    await message.reply("The Watcher sees the request. This command is for staff only.").catch(() => {});
    return true;
  }

  try {
    if (command === "!poststatus") {
      await handlePostStatus(message, bot);
      return true;
    }

    if (command === "!player") {
      await handlePlayerLookup(message, args);
      return true;
    }

    if (command === "!vehicles") {
      await handleVehiclesLookup(message, args);
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
  const ref = loadStatusRef();
  if (!ref?.channelId || !ref?.messageId) return;

  if (!hasPasswordConfigured()) {
    console.warn("⚠️ Saved GGCON status post found, but GGCON_PASSWORD is not configured.");
    return;
  }

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
