const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

const DEFAULT_SERVER_BASE_URL = "https://ggcon.gghost.games/s/2788404";
const STAFF_ROLE_NAMES = new Set(["Owner", "Owners", "Admin", "Trial Admin"]);

const TRADE_WARDROBE_CENTER = {
  x: 567176.688,
  y: -227246.984,
  z: 365.498,
  pitch: 323.118774,
  yaw: 217.166992,
  roll: 0,
};

const NEAR_RADIUS_UNITS = 500;
const WIDE_RADIUS_UNITS = 5000;

function serverBaseUrl() {
  return String(process.env.GGCON_BASE_URL || DEFAULT_SERVER_BASE_URL).replace(/\/+$/, "");
}

function serverPassword() {
  const password = process.env.GGCON_PASSWORD;
  if (!password) throw new Error("Server tool password is not configured.");
  return password;
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
    text: text.slice(0, 500),
    error: data?.reason || data?.message || data?.error || (!res.ok ? `HTTP ${res.status}` : null),
  };
}

function isStaffMember(member) {
  return !!member?.roles?.cache?.some((role) => STAFF_ROLE_NAMES.has(role.name));
}

function formatLocation(location) {
  if (!location) return "Unknown";
  return `X: ${Math.round(Number(location.x || 0))} | Y: ${Math.round(Number(location.y || 0))} | Z: ${Math.round(Number(location.z || 0))}`;
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
  const x = obj.x ?? obj.X;
  const y = obj.y ?? obj.Y;
  const z = obj.z ?? obj.Z;
  if (x === undefined || y === undefined) return null;
  return { x: Number(x), y: Number(y), z: Number(z || 0) };
}

function summarizeNearby(label, items, center) {
  const rows = [];
  for (const item of items || []) {
    const loc = locFromObject(item);
    const dist = distanceUnits(center, loc);
    if (dist === null || dist > WIDE_RADIUS_UNITS) continue;
    const name = item.name || item.baseName || item.type || item.class || item.i || item.id || "Unknown";
    const id = item.id || item.flagId || item.baseId || item.entityId || "?";
    rows.push({ dist, text: `• ${label}: ${name} #${id} — ${Math.round(dist)}u away — ${formatLocation(loc)}` });
  }
  rows.sort((a, b) => a.dist - b.dist);
  return rows.slice(0, 8).map((r) => r.text);
}

function compact(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function itemMatches(item, terms) {
  const hay = compact([item?.i, item?.dn, item?.c].filter(Boolean).join(" "));
  return terms.every((term) => hay.includes(compact(term)));
}

function findCatalogMatches(items, kind) {
  const list = Array.isArray(items) ? items : [];
  let matches = [];

  if (kind === "wardrobe") {
    matches = list.filter((item) => itemMatches(item, ["wardrobe"]));
  } else if (kind === "screwdriverSmall") {
    matches = list.filter((item) => itemMatches(item, ["screwdriver", "small"]));
  } else if (kind === "screwdriverYellow") {
    matches = list.filter((item) => itemMatches(item, ["screwdriver", "yellow"]));
  }

  return matches.slice(0, 10).map((item) => {
    const dn = item.dn ? ` — ${item.dn}` : "";
    const cat = item.c ? ` (${item.c})` : "";
    return `• \`${item.i}\`${dn}${cat}`;
  });
}

function buildWardrobeProbeText() {
  return [
    "# 🔎 Trade Wardrobe API Probe",
    "Use this hidden test panel to see whether the server API can see the improvised wardrobe near the trader.",
    "",
    `**Probe center:** ${formatLocation(TRADE_WARDROBE_CENTER)}`,
    "**Target:** improvised wardrobe within about 2 meters of that spot",
    "",
    "This is read-only. It does **not** remove items, spawn items, edit files, or touch the database.",
  ].join("\n");
}

function buildWardrobeProbeRows() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("wardrobeprobe:api")
        .setLabel("Scan Trade Wardrobe Area")
        .setEmoji("🔎")
        .setStyle(ButtonStyle.Primary)
    ),
  ];
}

async function setupWardrobeProbePanel(message) {
  if (!isStaffMember(message.member)) return false;
  await message.channel.send({ content: buildWardrobeProbeText(), components: buildWardrobeProbeRows() });
  await message.react("✅").catch(() => {});
  return true;
}

function statusLine(result) {
  if (result.ok) return `✅ \`${result.path}\` — OK`;
  return `❌ \`${result.path}\` — ${result.error || `HTTP ${result.status}`}`;
}

async function runWardrobeApiProbe(interaction) {
  await interaction.deferReply({ ephemeral: true }).catch(() => {});

  const encoded = new URLSearchParams({
    x: String(TRADE_WARDROBE_CENTER.x),
    y: String(TRADE_WARDROBE_CENTER.y),
    z: String(TRADE_WARDROBE_CENTER.z),
    radius: String(WIDE_RADIUS_UNITS),
  }).toString();

  const probes = await Promise.all([
    serverGetRaw("/health"),
    serverGetRaw("/players.json"),
    serverGetRaw("/flags.json"),
    serverGetRaw("/vehicles.json"),
    serverGetRaw("/items.json"),
    serverGetRaw("/gghaul/appliances"),
    serverGetRaw("/stash-n-dash/status.json"),
    serverGetRaw("/stash-n-dash/sites.json"),
    serverGetRaw(`/world/items.json?${encoded}`),
    serverGetRaw(`/world/containers.json?${encoded}`),
    serverGetRaw(`/containers.json?${encoded}`),
    serverGetRaw(`/chests.json?${encoded}`),
    serverGetRaw(`/storages.json?${encoded}`),
    serverGetRaw(`/objects.json?${encoded}`),
  ]);

  const byPath = Object.fromEntries(probes.map((p) => [p.path.split("?")[0], p]));

  const flags = byPath["/flags.json"]?.data?.flags || [];
  const vehicles = byPath["/vehicles.json"]?.data?.vehicles || [];
  const appliances = byPath["/gghaul/appliances"]?.data?.appliances || [];
  const sites = byPath["/stash-n-dash/sites.json"]?.data?.sites || [];
  const catalogItems = byPath["/items.json"]?.data?.items || [];

  const nearbyRows = [
    ...summarizeNearby("Flag", flags, TRADE_WARDROBE_CENTER),
    ...summarizeNearby("Vehicle", vehicles, TRADE_WARDROBE_CENTER),
    ...summarizeNearby("ggHaul", appliances, TRADE_WARDROBE_CENTER),
    ...summarizeNearby("StashSite", sites, TRADE_WARDROBE_CENTER),
  ].slice(0, 12);

  const nearExactAppliances = (appliances || []).filter((item) => {
    const dist = distanceUnits(TRADE_WARDROBE_CENTER, locFromObject(item));
    return dist !== null && dist <= NEAR_RADIUS_UNITS;
  });

  const containerEndpointWorked = probes.some((p) => {
    const base = p.path.split("?")[0];
    return p.ok && ["/world/items.json", "/world/containers.json", "/containers.json", "/chests.json", "/storages.json", "/objects.json"].includes(base);
  });

  let verdict;
  if (containerEndpointWorked) {
    verdict = "✅ **Verdict:** At least one container/world-item endpoint responded. We may be able to build a direct API wardrobe reader from that result.";
  } else if (nearExactAppliances.length) {
    verdict = "⚠️ **Verdict:** The API found a ggHaul appliance very close to the trade spot, but that does not prove it can read an improvised wardrobe's contents.";
  } else {
    verdict = [
      "❌ **Verdict:** The normal server API does not appear to expose loose world containers / improvised wardrobe contents.",
      "Next best test would be a read-only SFTP database probe, not live DB editing.",
    ].join("\n");
  }

  const endpointLines = probes.map(statusLine);
  const wardrobeMatches = findCatalogMatches(catalogItems, "wardrobe");
  const redMatches = findCatalogMatches(catalogItems, "screwdriverSmall");
  const yellowMatches = findCatalogMatches(catalogItems, "screwdriverYellow");

  const result = [
    "🔎 **Trade Wardrobe API Probe**",
    "",
    "This test did **not** remove anything, spawn anything, edit files, or touch the database.",
    "",
    `**Probe Center:** ${formatLocation(TRADE_WARDROBE_CENTER)}`,
    `**Near Radius:** ${NEAR_RADIUS_UNITS} Unreal units`,
    `**Wide Search Radius:** ${WIDE_RADIUS_UNITS} Unreal units`,
    "",
    "**Endpoint Check:**",
    endpointLines.join("\n"),
    "",
    "**Nearby API Objects Found:**",
    nearbyRows.length ? nearbyRows.join("\n") : "None found through flags / vehicles / ggHaul / Stash site APIs.",
    "",
    "**Catalog Matches:**",
    "Improvised Wardrobe candidates:",
    wardrobeMatches.length ? wardrobeMatches.join("\n") : "None found.",
    "",
    "Screwdriver Small candidates:",
    redMatches.length ? redMatches.join("\n") : "None found.",
    "",
    "Yellow Screwdriver candidates:",
    yellowMatches.length ? yellowMatches.join("\n") : "None found.",
    "",
    verdict,
  ].join("\n");

  await interaction.editReply(result.slice(0, 1900)).catch(() => {});
}

async function handleWardrobeProbeCommand(message) {
  const content = String(message.content || "").trim().toLowerCase();
  if (content !== "!wardrobetestsetup" && content !== "!wardrobeprobe") return false;

  if (!isStaffMember(message.member)) {
    await message.reply("Only staff can post the wardrobe probe panel.").catch(() => {});
    return true;
  }

  await setupWardrobeProbePanel(message);
  return true;
}

async function handleWardrobeProbeInteraction(interaction) {
  if (!interaction.isButton?.()) return false;
  if (interaction.customId !== "wardrobeprobe:api") return false;

  try {
    await runWardrobeApiProbe(interaction);
  } catch (err) {
    console.error("❌ Wardrobe probe failed:", err);
    const payload = { content: `Wardrobe probe error: ${err.message}`, ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
  }

  return true;
}

module.exports = {
  handleWardrobeProbeCommand,
  handleWardrobeProbeInteraction,
};
