const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { createClient } = require("@supabase/supabase-js");

const DEFAULT_SERVER_BASE_URL = "https://ggcon.gghost.games/s/2788404";
const PLAYER_LINKS_TABLE = process.env.WATCHER_PLAYER_LINKS_TABLE || "watcher_player_links";
const REGISTER_CHANNEL_ID = process.env.WATCHER_REGISTER_CHANNEL_ID || "1517255357888466964";
const STAFF_ROLE_NAMES = new Set(["Owner", "Owners", "Admin", "Trial Admin"]);

let supabase;

function getSupabase() {
  if (!supabase) supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  return supabase;
}

function serverBaseUrl() {
  return String(process.env.GGCON_BASE_URL || DEFAULT_SERVER_BASE_URL).replace(/\/+$/, "");
}

function serverPassword() {
  const password = process.env.GGCON_PASSWORD;
  if (!password) throw new Error("Server tool password is not configured.");
  return password;
}

async function serverGet(path) {
  const res = await fetch(`${serverBaseUrl()}${path}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-Password": serverPassword(),
    },
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.reason || data?.message || data?.error || `HTTP ${res.status}`);
  }
  return data;
}

function isStaffMember(member) {
  return !!member?.roles?.cache?.some((role) => STAFF_ROLE_NAMES.has(role.name));
}

async function getLink(guildId, discordId) {
  const db = getSupabase();
  const { data, error } = await db
    .from(PLAYER_LINKS_TABLE)
    .select("*")
    .eq("guild_id", String(guildId))
    .eq("discord_id", String(discordId))
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

function normalizeText(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function looksLikeScrewdriverSmall(text) {
  const compact = normalizeText(text);
  if (!compact) return false;
  return compact.includes("screwdriversmall") || (compact.includes("screwdriver") && compact.includes("small"));
}

function quantityFromObject(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return 1;
  const keys = ["quantity", "qty", "count", "amount", "stackCount", "stack_count", "stack"];
  for (const key of keys) {
    const value = Number(obj[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 1;
}

function pathLooksInventoryLike(path) {
  return /(inventory|inventories|backpack|container|containers|equipment|clothing|storage|items|itemlist|contents|gear)/i.test(path.join("."));
}

function describeSample(value) {
  if (Array.isArray(value)) return `array(${value.length})`;
  if (!value || typeof value !== "object") return typeof value;
  const keys = Object.keys(value).slice(0, 8);
  return `object{${keys.join(", ")}${Object.keys(value).length > 8 ? ", …" : ""}}`;
}

function collectInventoryFields(value, path = [], out = [], depth = 0) {
  if (!value || typeof value !== "object" || depth > 7) return out;

  if (path.length && pathLooksInventoryLike(path)) {
    out.push({ path: path.join("."), sample: describeSample(value) });
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < Math.min(value.length, 25); i += 1) {
      collectInventoryFields(value[i], [...path, String(i)], out, depth + 1);
    }
    return out;
  }

  for (const [key, child] of Object.entries(value)) {
    if (child && typeof child === "object") collectInventoryFields(child, [...path, key], out, depth + 1);
  }

  return out;
}

function itemTextFromObject(obj) {
  if (!obj || typeof obj !== "object") return String(obj || "");
  const likelyKeys = [
    "i", "item", "itemClass", "class", "className", "name", "displayName", "dn", "type", "id", "itemName",
  ];
  const parts = [];
  for (const key of likelyKeys) {
    if (obj[key] !== undefined && obj[key] !== null) parts.push(String(obj[key]));
  }
  return parts.join(" ");
}

function countScrewdriversInInventoryLikeData(value, path = [], depth = 0) {
  if (value === null || value === undefined || depth > 8) return 0;

  if (Array.isArray(value)) {
    return value.reduce((sum, child, index) => sum + countScrewdriversInInventoryLikeData(child, [...path, String(index)], depth + 1), 0);
  }

  if (typeof value === "object") {
    let total = 0;
    if (pathLooksInventoryLike(path) && looksLikeScrewdriverSmall(itemTextFromObject(value))) {
      total += quantityFromObject(value);
    }

    for (const [key, child] of Object.entries(value)) {
      total += countScrewdriversInInventoryLikeData(child, [...path, key], depth + 1);
    }
    return total;
  }

  // Only count plain strings when they are inside an inventory-looking path.
  if (pathLooksInventoryLike(path) && looksLikeScrewdriverSmall(value)) return 1;
  return 0;
}

function formatLocation(location) {
  if (!location) return "Unknown";
  return `X: ${Math.round(Number(location.x || 0))} | Y: ${Math.round(Number(location.y || 0))} | Z: ${Math.round(Number(location.z || 0))}`;
}

function buildTradeTestText() {
  return [
    "# 🔧 Trade System Inventory Test",
    "Use this hidden test panel to check if Watcher can see exact items in a player inventory.",
    "",
    "**Test item:** `Screwdriver Small` / red screwdriver",
    "**Trade idea:** 35x Screwdriver Small → 1x Yellow Screwdriver",
    "",
    "Before clicking:",
    "1. Register your SCUM character first if you have not already.",
    "2. Go online in SCUM.",
    "3. Put more than 35 red screwdrivers in your backpack/inventory.",
    "4. Click the button below.",
    "",
    "⚠️ This is a read-only test. It does **not** remove items and does **not** spawn the yellow screwdriver yet.",
  ].join("\n");
}

function buildTradeTestRows() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("tradetest:inventory")
        .setLabel("Run Inventory Read Test")
        .setEmoji("🔎")
        .setStyle(ButtonStyle.Primary)
    ),
  ];
}

async function setupTradeTestPanel(message) {
  if (!isStaffMember(message.member)) return false;
  await message.channel.send({ content: buildTradeTestText(), components: buildTradeTestRows() });
  await message.react("✅").catch(() => {});
  return true;
}

async function runInventoryReadTest(interaction) {
  const link = await getLink(interaction.guildId, interaction.user.id);
  if (!link?.steam_id) {
    await interaction.reply({
      content: `You need to register your SCUM character first: <#${REGISTER_CHANNEL_ID}>`,
      ephemeral: true,
    }).catch(() => {});
    return;
  }

  await interaction.deferReply({ ephemeral: true }).catch(() => {});

  let data;
  try {
    data = await serverGet(`/players/${encodeURIComponent(link.steam_id)}.json`);
  } catch (err) {
    await interaction.editReply([
      "❌ **Inventory Read Test Failed**",
      "Watcher could not read your live player record.",
      "",
      "Make sure you are online in SCUM and try again.",
      `Error: ${err.message}`,
    ].join("\n")).catch(() => {});
    return;
  }

  const player = data?.player || data;
  const topKeys = Object.keys(player || {}).sort();
  const inventoryFields = collectInventoryFields(player).filter((entry, index, arr) => {
    return arr.findIndex((other) => other.path === entry.path) === index;
  });
  const screwdriverCount = countScrewdriversInInventoryLikeData(player);
  const itemInHands = player?.itemInHands || "Empty / not reported";

  let verdict;
  if (inventoryFields.length === 0) {
    verdict = [
      "❌ **Verdict:** Watcher does not appear to receive full inventory/backpack contents from the current server API.",
      "It can see basic live player data like location, gear weight, and item in hands, but not exact backpack item counts.",
    ].join("\n");
  } else if (screwdriverCount >= 35) {
    verdict = `✅ **Verdict:** Watcher detected at least **${screwdriverCount}x Screwdriver Small** in inventory-like data. This is enough for the trade test.`;
  } else if (screwdriverCount > 0) {
    verdict = `⚠️ **Verdict:** Watcher detected **${screwdriverCount}x Screwdriver Small**, but not the required 35.`;
  } else {
    verdict = "⚠️ **Verdict:** Watcher found inventory-like fields, but did not detect Screwdriver Small in them.";
  }

  const visibleInventoryFields = inventoryFields.slice(0, 10).map((entry) => `• ${entry.path} — ${entry.sample}`);
  const extraFields = inventoryFields.length > 10 ? `\n…and ${inventoryFields.length - 10} more` : "";

  const result = [
    "🔎 **Trade Inventory Read Test**",
    "",
    "This test did **not** remove anything and did **not** spawn anything.",
    "",
    `**Online Location:** ${formatLocation(player?.location)}`,
    `**Gear Weight:** ${player?.gearWeightKg ?? "Not reported"} kg`,
    `**Item In Hands:** \`${String(itemInHands).slice(0, 120)}\``,
    "",
    `**Inventory-like fields found:** ${inventoryFields.length}`,
    visibleInventoryFields.length ? visibleInventoryFields.join("\n") + extraFields : "None found.",
    "",
    `**Screwdriver Small detected:** ${screwdriverCount > 0 ? `${screwdriverCount}x` : "Not detected"}`,
    "",
    verdict,
    "",
    "**Raw player fields visible to Watcher:**",
    `\`${topKeys.slice(0, 35).join(", ")}${topKeys.length > 35 ? ", …" : ""}\``,
  ].join("\n");

  await interaction.editReply(result.slice(0, 1900)).catch(() => {});
}

async function handleTradeTestCommand(message) {
  const content = String(message.content || "").trim().toLowerCase();
  if (content !== "!tradetestsetup" && content !== "!tradetest") return false;

  if (!isStaffMember(message.member)) {
    await message.reply("Only staff can post the trade test panel.").catch(() => {});
    return true;
  }

  await setupTradeTestPanel(message);
  return true;
}

async function handleTradeTestInteraction(interaction) {
  if (!interaction.isButton?.()) return false;
  if (interaction.customId !== "tradetest:inventory") return false;

  try {
    await runInventoryReadTest(interaction);
  } catch (err) {
    console.error("❌ Trade test failed:", err);
    const payload = { content: `Trade test error: ${err.message}`, ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
  }

  return true;
}

module.exports = {
  handleTradeTestCommand,
  handleTradeTestInteraction,
};
