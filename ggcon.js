const fs = require("fs");
const path = require("path");

const DEFAULT_GGCON_BASE_URL = "https://ggcon.gghost.games/s/2788404";
const STATUS_FILE = path.join(__dirname, "data", "ggcon-status.json");
const STAFF_ROLE_NAMES = new Set(["Owner", "Owners", "Admin", "Trial Admin"]);

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

function isStaff(message) {
  if (!message.guild || !message.member) return false;

  return message.member.roles.cache.some((role) => STAFF_ROLE_NAMES.has(role.name));
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

async function searchPlayers(query) {
  const cleaned = String(query || "").trim();
  if (!cleaned) return [];

  const data = await ggconGet(`/players/all.json?search=${encodeURIComponent(cleaned)}&page=1`);
  return Array.isArray(data.players) ? data.players : [];
}

function filterMatches(players, query) {
  const q = String(query || "").toLowerCase();

  return players.filter((player) => {
    const characterName = String(player.characterName || "").toLowerCase();
    const steamId = String(player.userId || "");
    return characterName.includes(q) || steamId === query;
  });
}

function buildMultipleMatchesReply(query, matches, commandName) {
  const rows = matches.slice(0, 10).map((player, index) => {
    return [
      `**${index + 1}. ${player.characterName || "Unknown"}**`,
      `Steam ID: \`${player.userId || "Unknown"}\``,
      `Status: ${player.online ? "Online" : "Offline"}`,
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
    `Use: \`${commandName} <Steam ID>\``,
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

  const matches = filterMatches(await searchPlayers(cleaned), cleaned);

  if (matches.length === 0) return { type: "none" };
  if (matches.length > 1) return { type: "multiple", matches };

  const single = matches[0];

  if (single.online && single.userId) {
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
    await message.reply(buildMultipleMatchesReply(query, result.matches, "!player")).catch(() => {});
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
    await message.reply(buildMultipleMatchesReply(query, playerResult.matches, "!vehicles")).catch(() => {});
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
  startGgconStatusOnBoot,
};
