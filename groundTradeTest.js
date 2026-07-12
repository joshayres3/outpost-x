const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

const DEFAULT_SERVER_BASE_URL = "https://ggcon.gghost.games/s/2788404";
const STAFF_ROLE_NAMES = new Set(["Owner", "Owners", "Admin", "Trial Admin"]);

const TRADE_PAD_CENTER = {
  x: 567176.688,
  y: -227246.984,
  z: 365.498,
  pitch: 323.118774,
  yaw: 217.166992,
  roll: 0,
};

const TRADE_ITEM_CLASS = "Screwdriver_Small";
const REQUIRED_COUNT = 35;
const TRADE_RADIUS_METERS = 1;
const API_RADIUS_UNITS = 500;

function serverBaseUrl() {
  return String(process.env.GGCON_BASE_URL || DEFAULT_SERVER_BASE_URL).replace(/\/+$/, "");
}

function serverPassword() {
  const password = process.env.GGCON_PASSWORD;
  if (!password) throw new Error("Server tool password is not configured.");
  return password;
}

function isStaffMember(member) {
  return !!member?.roles?.cache?.some((role) => STAFF_ROLE_NAMES.has(role.name));
}

function formatLocation(location) {
  if (!location) return "Unknown";
  return `X: ${Math.round(Number(location.x || 0))} | Y: ${Math.round(Number(location.y || 0))} | Z: ${Math.round(Number(location.z || 0))}`;
}

function clampDiscord(text, limit = 1900) {
  const value = String(text || "");
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 40)}\n\n...trimmed for Discord...`;
}

async function serverGetRaw(path) {
  const res = await fetch(`${serverBaseUrl()}${path}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-Password": serverPassword(),
    },
  });

  const text = await res.text().catch(() => "");
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  return {
    path,
    ok: res.ok && data?.ok !== false,
    status: res.status,
    data,
    text: text.slice(0, 800),
    error: data?.reason || data?.message || data?.error || (!res.ok ? `HTTP ${res.status}` : null),
  };
}

async function serverPostRaw(path, body = {}) {
  try {
    const res = await fetch(`${serverBaseUrl()}${path}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Password": serverPassword(),
      },
      body: JSON.stringify(body || {}),
    });

    const text = await res.text().catch(() => "");
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    return {
      path,
      httpOk: res.ok,
      ok: res.ok && data?.ok !== false,
      status: res.status,
      data,
      text: text.slice(0, 1200),
      error: data?.reason || data?.message || data?.error || (!res.ok ? `HTTP ${res.status}` : null),
    };
  } catch (err) {
    return {
      path,
      httpOk: false,
      ok: false,
      status: 0,
      data: null,
      text: "",
      error: err?.message || String(err),
    };
  }
}

function distanceUnits(a, b) {
  if (!a || !b) return null;
  const ax = Number(a.x);
  const ay = Number(a.y);
  const az = Number(a.z || 0);
  const bx = Number(b.x);
  const by = Number(b.y);
  const bz = Number(b.z || 0);
  if (![ax, ay, az, bx, by, bz].every(Number.isFinite)) return null;
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2 + (az - bz) ** 2);
}

function locFromObject(obj) {
  if (!obj || typeof obj !== "object") return null;
  if (obj.location && typeof obj.location === "object") return obj.location;
  if (obj.Location && typeof obj.Location === "object") return obj.Location;
  const x = obj.x ?? obj.X ?? obj.posX ?? obj.locationX;
  const y = obj.y ?? obj.Y ?? obj.posY ?? obj.locationY;
  const z = obj.z ?? obj.Z ?? obj.posZ ?? obj.locationZ;
  if (x === undefined || y === undefined) return null;
  return { x: Number(x), y: Number(y), z: Number(z || 0) };
}

function flattenValues(obj, depth = 0, out = []) {
  if (obj === null || obj === undefined || depth > 6) return out;
  if (typeof obj !== "object") {
    out.push(String(obj));
    return out;
  }
  if (Array.isArray(obj)) {
    for (const item of obj) flattenValues(item, depth + 1, out);
    return out;
  }
  for (const value of Object.values(obj)) flattenValues(value, depth + 1, out);
  return out;
}

function compact(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function itemNameText(item) {
  return flattenValues(item).join(" ");
}

function isScrewdriverSmall(item) {
  const hay = compact(itemNameText(item));
  return hay.includes("screwdriversmall") || (hay.includes("screwdriver") && hay.includes("small"));
}

function extractItemsFromPayload(payload) {
  const roots = [];
  if (!payload || typeof payload !== "object") return roots;

  const candidates = [
    payload.items,
    payload.worldItems,
    payload.groundItems,
    payload.objects,
    payload.entities,
    payload.data,
    payload.results,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) roots.push(...candidate);
    else if (candidate && typeof candidate === "object") {
      for (const value of Object.values(candidate)) {
        if (Array.isArray(value)) roots.push(...value);
      }
    }
  }

  if (!roots.length) {
    for (const value of Object.values(payload)) {
      if (Array.isArray(value)) roots.push(...value);
    }
  }

  return roots;
}

function summarizeItem(item, index) {
  const loc = locFromObject(item);
  const dist = distanceUnits(TRADE_PAD_CENTER, loc);
  const name = item.i || item.item || item.class || item.type || item.name || item.baseName || item.dn || "Unknown item";
  const id = item.id || item.entityId || item.itemId || item.guid || "?";
  const qty = item.count || item.quantity || item.stack || item.amount || "?";
  const parts = [`${index + 1}. ${name}`];
  if (id !== "?") parts.push(`#${id}`);
  if (qty !== "?") parts.push(`qty:${qty}`);
  if (dist !== null) parts.push(`${Math.round(dist)}u away`);
  if (loc) parts.push(formatLocation(loc));
  return parts.join(" — ");
}

function countScrewdriverSmall(items) {
  let count = 0;
  const matches = [];

  for (const item of items || []) {
    if (!isScrewdriverSmall(item)) continue;
    matches.push(item);
    const rawCount = Number(item.count ?? item.quantity ?? item.stack ?? item.amount ?? 1);
    count += Number.isFinite(rawCount) && rawCount > 0 ? rawCount : 1;
  }

  return { count, matches };
}

function buildGroundTradeText() {
  return [
    "# 🔧 Ground Trade Pad Test",
    "Use this hidden test panel to see whether Watcher can read Screwdriver Small items dropped on the ground at the trade pad.",
    "",
    `**Trade Pad:** ${formatLocation(TRADE_PAD_CENTER)}`,
    `**Required:** ${REQUIRED_COUNT}x \`${TRADE_ITEM_CLASS}\``,
    `**Delete Radius:** ${TRADE_RADIUS_METERS} meter`,
    "",
    "The scan button is read-only.",
    "The auto-delete test only sends the delete command if Watcher can first read **exactly 35** Screwdriver Small on the ground.",
  ].join("\n");
}

function buildGroundTradeRows() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("groundtrade:scan")
        .setLabel("Scan Ground Trade Pad")
        .setEmoji("🔎")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("groundtrade:auto_delete")
        .setLabel("Scan + Delete If Exact")
        .setEmoji("🧹")
        .setStyle(ButtonStyle.Danger)
    ),
  ];
}

async function setupGroundTradePanel(message) {
  if (!isStaffMember(message.member)) return false;
  await message.channel.send({ content: buildGroundTradeText(), components: buildGroundTradeRows() });
  await message.react("✅").catch(() => {});
  return true;
}

function endpointStatus(result) {
  if (result.ok) return `✅ \`${result.path}\` — OK`;
  return `❌ \`${result.path}\` — ${result.error || `HTTP ${result.status}`}`;
}

function buildEncodedParams(radius = API_RADIUS_UNITS) {
  return new URLSearchParams({
    x: String(TRADE_PAD_CENTER.x),
    y: String(TRADE_PAD_CENTER.y),
    z: String(TRADE_PAD_CENTER.z),
    radius: String(radius),
  }).toString();
}

async function scanGroundItems() {
  const encoded = buildEncodedParams(API_RADIUS_UNITS);
  const probes = await Promise.all([
    serverGetRaw(`/world/items.json?${encoded}`),
    serverGetRaw(`/ground/items.json?${encoded}`),
    serverGetRaw(`/items/nearby.json?${encoded}`),
    serverGetRaw(`/items/world.json?${encoded}`),
    serverGetRaw(`/objects.json?${encoded}`),
    serverGetRaw(`/entities.json?${encoded}`),
  ]);

  const usable = [];
  for (const probe of probes) {
    if (!probe.ok) continue;
    const items = extractItemsFromPayload(probe.data);
    if (items.length) usable.push({ probe, items });
  }

  let selected = null;
  let nearbyItems = [];
  for (const entry of usable) {
    const withDistance = entry.items
      .map((item) => ({ item, loc: locFromObject(item) }))
      .map((entry2) => ({ ...entry2, dist: distanceUnits(TRADE_PAD_CENTER, entry2.loc) }))
      .filter((entry2) => entry2.dist === null || entry2.dist <= API_RADIUS_UNITS);

    if (withDistance.length) {
      selected = entry;
      nearbyItems = withDistance.map((entry2) => entry2.item);
      break;
    }
  }

  if (!selected && usable.length) {
    selected = usable[0];
    nearbyItems = selected.items;
  }

  const counts = countScrewdriverSmall(nearbyItems);
  return { probes, usable, selected, nearbyItems, ...counts };
}

function verdictForCount(count, canRead) {
  if (!canRead) {
    return [
      "❌ **Verdict:** Watcher still cannot read loose ground item counts from the normal server API.",
      "No delete command was sent.",
    ].join("\n");
  }
  if (count < REQUIRED_COUNT) return `⚠️ **Verdict:** Not enough. Detected **${count}/${REQUIRED_COUNT}** Screwdriver Small.`;
  if (count > REQUIRED_COUNT) return `⚠️ **Verdict:** Too many. Detected **${count}/${REQUIRED_COUNT}** Screwdriver Small. Remove extras before approving/deleting.`;
  return `✅ **Verdict:** Exact amount detected: **${count}/${REQUIRED_COUNT}** Screwdriver Small.`;
}

function buildDestroyCommand() {
  const t = `{X=${TRADE_PAD_CENTER.x} Y=${TRADE_PAD_CENTER.y} Z=${TRADE_PAD_CENTER.z}|P=${TRADE_PAD_CENTER.pitch} Y=${TRADE_PAD_CENTER.yaw} R=${TRADE_PAD_CENTER.roll}}`;
  return `#DestroyAllItemsWithinRadius ${TRADE_ITEM_CLASS} ${TRADE_RADIUS_METERS} ${t}`;
}

function summarizeCommandResult(result) {
  if (!result) return "No command result.";
  const parts = [];
  parts.push(result.ok ? "✅ Command accepted by server API." : `❌ Command failed: ${result.error || `HTTP ${result.status}`}`);
  const dataText = result.data ? JSON.stringify(result.data).slice(0, 600) : "";
  if (dataText) parts.push(`Raw response: \`${dataText.replace(/`/g, "'")}\``);
  else if (result.text) parts.push(`Raw response: \`${String(result.text).replace(/`/g, "'")}\``);
  return parts.join("\n");
}

async function runGroundTradeScan(interaction, shouldDeleteIfExact = false) {
  await interaction.deferReply({ ephemeral: true }).catch(() => {});

  const scan = await scanGroundItems();
  const canRead = !!scan.selected;
  const endpointLines = scan.probes.map(endpointStatus);
  const itemLines = (scan.nearbyItems || []).slice(0, 12).map(summarizeItem);
  const matchLines = (scan.matches || []).slice(0, 12).map(summarizeItem);

  let commandResult = null;
  let command = null;

  if (shouldDeleteIfExact && canRead && scan.count === REQUIRED_COUNT) {
    command = buildDestroyCommand();
    commandResult = await serverPostRaw("/command", { command });
  }

  const lines = [
    shouldDeleteIfExact ? "🧹 **Ground Trade Scan + Delete If Exact**" : "🔎 **Ground Trade Pad Scan**",
    "",
    `**Trade Pad:** ${formatLocation(TRADE_PAD_CENTER)}`,
    `**Required:** ${REQUIRED_COUNT}x \`${TRADE_ITEM_CLASS}\``,
    `**Detected:** ${canRead ? `${scan.count}x Screwdriver Small` : "Unknown / unreadable"}`,
    "",
    "**Endpoint Check:**",
    endpointLines.join("\n"),
    "",
    "**Ground Items Endpoint Used:**",
    canRead ? `\`${scan.selected.probe.path}\`` : "None worked with readable item data.",
    "",
    "**Nearby Items Found:**",
    itemLines.length ? itemLines.join("\n") : "None readable.",
    "",
    "**Screwdriver Small Matches:**",
    matchLines.length ? matchLines.join("\n") : "None detected.",
    "",
    verdictForCount(scan.count, canRead),
  ];

  if (shouldDeleteIfExact) {
    lines.push("");
    if (!canRead) {
      lines.push("🛑 **Delete skipped:** Watcher could not read ground item count.");
    } else if (scan.count !== REQUIRED_COUNT) {
      lines.push(`🛑 **Delete skipped:** count must be exactly ${REQUIRED_COUNT}.`);
    } else {
      lines.push("**Delete Command Sent:**");
      lines.push(`\`${command}\``);
      lines.push(summarizeCommandResult(commandResult));
    }
  }

  await interaction.editReply(clampDiscord(lines.join("\n"))).catch(() => {});
}

async function handleGroundTradeTestCommand(message) {
  const content = String(message.content || "").trim().toLowerCase();
  if (content !== "!groundtradetestsetup" && content !== "!groundtradeprobe") return false;

  if (!isStaffMember(message.member)) {
    await message.reply("Only staff can post the ground trade test panel.").catch(() => {});
    return true;
  }

  await setupGroundTradePanel(message);
  return true;
}

async function handleGroundTradeTestInteraction(interaction) {
  if (!interaction.isButton?.()) return false;
  if (!String(interaction.customId || "").startsWith("groundtrade:")) return false;

  if (!isStaffMember(interaction.member)) {
    await interaction.reply({ content: "Only staff can run this hidden trade test.", ephemeral: true }).catch(() => {});
    return true;
  }

  try {
    if (interaction.customId === "groundtrade:scan") {
      await runGroundTradeScan(interaction, false);
      return true;
    }

    if (interaction.customId === "groundtrade:auto_delete") {
      await runGroundTradeScan(interaction, true);
      return true;
    }
  } catch (err) {
    console.error("❌ Ground trade test failed:", err);
    const payload = { content: `Ground trade test error: ${err.message}`, ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
    return true;
  }

  return false;
}

module.exports = {
  handleGroundTradeTestCommand,
  handleGroundTradeTestInteraction,
};
