const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");
const { createClient } = require("@supabase/supabase-js");
const { getPlayerForLookup, getPlayerDisplayName, ggconPost } = require("./ggcon");

const PLAYER_LINKS_TABLE = process.env.WATCHER_PLAYER_LINKS_TABLE || "watcher_player_links";
const PURCHASES_TABLE = process.env.WATCHER_SHOP_PURCHASES_TABLE || "watcher_shop_purchases";
const CATALOG_CACHE_MS = 10 * 60 * 1000;
const purchaseLocks = new Set();
let db = null;
let catalogCache = { loadedAt: 0, items: [] };

const PACKAGES = {
  medical: {
    id: "medical",
    name: "Medical Kit",
    emoji: "🩹",
    description: "Emergency medical supplies.",
    price: 2000,
    items: [
      { label: "Emergency Bandage", qty: 10, aliases: ["Emergency Bandage", "Emergency_Bandage"] },
      { label: "Garlic", qty: 2, aliases: ["Garlic"] },
      { label: "Antibiotic Pill Single", qty: 2, aliases: ["Antibiotic Pill Single", "Antibiotic_Pill_Single", "Antibiotic Pill"] },
    ],
  },
  gas: {
    id: "gas",
    name: "Emergency Gas",
    emoji: "⛽",
    description: "One large gasoline canister.",
    price: 750,
    items: [
      { label: "Large Gas Canister", qty: 1, itemClass: "Gasoline_Canister", aliases: ["Gasoline Canister", "Gasoline_Canister"] },
    ],
  },
  rpg7: {
    id: "rpg7",
    name: "RPG-7",
    emoji: "🚀",
    description: "One RPG-7 for mech hunting nights.",
    price: 50000,
    items: [
      {
        label: "RPG-7",
        qty: 1,
        aliases: ["Weapon_RPG7", "Weapon_RPG_7", "RPG7", "RPG_7", "RPG-7", "RPG"],
      },
    ],
  },
  rockets10: {
    id: "rockets10",
    name: "PG-7M Rockets x10",
    emoji: "💥",
    description: "Ten PG-7M rockets for mech hunting nights.",
    price: 15000,
    items: [
      {
        label: "PG-7M Rocket",
        qty: 10,
        aliases: [
          "PG-7M", "PG7M", "PG_7M", "Ammo_PG7M", "Ammo_PG_7M",
          "Ammo_RPG7_PG7M", "Ammo_RPG_7_PG_7M", "RPG7_PG7M", "RPG_7_PG_7M",
          "Ammo_RPG7", "Ammo_RPG_7", "Ammo_RPG7_Rocket", "Ammo_RPG_7_Rocket",
          "RPG7_Rocket", "RPG_7_Rocket", "Rocket_RPG7", "Rocket_RPG_7",
          "RPG-7 Rocket", "RPG Rocket"
        ],
      },
    ],
  },
};

function getDb() {
  if (db) return db;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) throw new Error("Supabase is not configured.");
  db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, { auth: { persistSession: false } });
  return db;
}

function ephemeralFlags() {
  return MessageFlags?.Ephemeral ? MessageFlags.Ephemeral : undefined;
}

function isStaff(member) {
  return !!member?.roles?.cache?.some((role) => ["Owner", "Owners", "Admin", "Trial Admin"].includes(role.name));
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString("en-CA");
}

function isOnline(player) {
  return !!player && (player.online === true || player.ping !== undefined || player.health !== undefined);
}

function getCash(player) {
  for (const value of [player?.accountBalance, player?.cash, player?.currency, player?.money, player?.balance, player?.account_balance]) {
    const amount = Number(value);
    if (Number.isFinite(amount)) return amount;
  }
  return null;
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function getLink(guildId, discordId) {
  const { data, error } = await getDb()
    .from(PLAYER_LINKS_TABLE)
    .select("steam_id, scum_name")
    .eq("guild_id", String(guildId))
    .eq("discord_id", String(discordId))
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function loadCatalog() {
  if (catalogCache.items.length && Date.now() - catalogCache.loadedAt < CATALOG_CACHE_MS) return catalogCache.items;
  const base = (process.env.GGCON_BASE_URL || "https://ggcon.gghost.games/s/2788404").replace(/\/+$/, "");
  const response = await fetch(`${base}/items.json`, {
    headers: { Accept: "application/json", "X-Password": process.env.GGCON_PASSWORD || "" },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok === false) throw new Error(payload?.reason || payload?.message || `Item catalog failed (${response.status}).`);
  const items = Array.isArray(payload?.items) ? payload.items : Array.isArray(payload) ? payload : [];
  if (!items.length) throw new Error("GGCON returned an empty item catalog.");
  catalogCache = { loadedAt: Date.now(), items };
  return items;
}

function catalogNames(item) {
  return [
    item?.i,
    item?.dn,
    item?.c,
    item?.name,
    item?.label,
    item?.displayName,
    item?.display_name,
    item?.item,
    item?.class,
    item?.itemClass,
    item?.id,
  ].filter(Boolean).map(String);
}

function catalogClass(item) {
  return String(item?.i || item?.itemClass || item?.class || item?.item || item?.id || item?.name || "").trim();
}

function itemMatchScore(item, config) {
  const itemClass = normalize(item?.i || item?.itemClass || item?.class || item?.item || item?.id);
  const display = normalize(item?.dn || item?.displayName || item?.display_name || item?.name || item?.label);
  const combined = catalogNames(item).map(normalize).join(" ");
  let best = 0;

  for (const alias of config.aliases || [config.label]) {
    const wanted = normalize(alias);
    if (!wanted) continue;
    if (itemClass === wanted) best = Math.max(best, 3000);
    else if (itemClass.includes(wanted) || wanted.includes(itemClass)) best = Math.max(best, 2100);
    if (display === wanted) best = Math.max(best, 1800);
    else if (display.includes(wanted) || wanted.includes(display)) best = Math.max(best, 1300);
    else if (combined.includes(wanted)) best = Math.max(best, 700);
  }
  return best;
}

async function resolveItemClass(config) {
  if (config.itemClass) return config.itemClass;
  const catalog = await loadCatalog();
  const match = catalog
    .map((item) => ({ item, score: itemMatchScore(item, config) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || catalogClass(a.item).localeCompare(catalogClass(b.item)))[0]?.item;

  const itemClass = catalogClass(match);
  if (!itemClass) {
    const examples = catalog.slice(0, 3).map((item) => `${item?.dn || item?.name || "Unknown"} [${item?.i || item?.itemClass || item?.class || "no class"}]`).join(", ");
    throw new Error(`Could not find ${config.label} in the GGCON item catalog.${examples ? ` Catalog sample: ${examples}` : ""}`);
  }
  return itemClass;
}

function launcherEmbed() {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("🛒 Outpost X Server Shop")
    .setDescription([
      "Buy useful supplies without leaving Discord.",
      "",
      "You must be registered and online in SCUM for delivery.",
    ].join("\n"));
}

function launcherRows() {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("shop:browse").setLabel("Browse Shop").setEmoji("🛒").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("shop:history").setLabel("My Purchases").setEmoji("📦").setStyle(ButtonStyle.Secondary),
  )];
}

function shopEmbed() {
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle("🛒 Outpost X Server Shop").setDescription("Choose a package below.");
  for (const pkg of Object.values(PACKAGES)) {
    embed.addFields({
      name: `${pkg.emoji} ${pkg.name} — $${formatMoney(pkg.price)}`,
      value: pkg.description,
      inline: false,
    });
  }
  return embed;
}

function shopRows() {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("shop:view:medical").setLabel("Medical Kit").setEmoji("🩹").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("shop:view:gas").setLabel("Emergency Gas").setEmoji("⛽").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("shop:view:rpg7").setLabel("RPG-7").setEmoji("🚀").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("shop:view:rockets10").setLabel("PG-7M x10").setEmoji("💥").setStyle(ButtonStyle.Secondary),
  )];
}

function packageEmbed(pkg) {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${pkg.emoji} ${pkg.name}`)
    .setDescription(pkg.description)
    .addFields(
      { name: "Price", value: `$${formatMoney(pkg.price)}`, inline: true },
      { name: "Contents", value: pkg.items.map((item) => `• ${item.qty} × ${item.label}`).join("\n"), inline: false },
      { name: "Delivery", value: "Spawns near your linked SCUM character. You must be online.", inline: false },
    );
}

function packageRows(pkg) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`shop:buy:${pkg.id}`).setLabel(`Buy for $${formatMoney(pkg.price)}`).setEmoji("✅").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("shop:back").setLabel("Back").setStyle(ButtonStyle.Secondary),
  )];
}

async function recordPurchase(values) {
  const { error } = await getDb().from(PURCHASES_TABLE).insert(values);
  if (error) console.error("❌ Shop purchase record failed:", error.message);
}

async function buyPackage(interaction, pkg) {
  const lockKey = `${interaction.guildId}:${interaction.user.id}`;
  if (purchaseLocks.has(lockKey)) throw new Error("A shop purchase is already being processed for you.");
  purchaseLocks.add(lockKey);
  try {
    const link = await getLink(interaction.guildId, interaction.user.id);
    if (!link?.steam_id) throw new Error("You must register your SCUM character before using the shop.");
    const playerResult = await getPlayerForLookup(link.steam_id);
    const player = playerResult?.type === "single" ? playerResult.player : null;
    if (!player || !isOnline(player)) throw new Error("You must be online in SCUM to receive a shop purchase.");
    const cash = getCash(player);
    if (cash === null) throw new Error("Watcher could not verify your current in-game cash.");
    if (cash < pkg.price) throw new Error(`You need $${formatMoney(pkg.price)}. Your current balance is $${formatMoney(cash)}.`);

    const resolved = [];
    for (const item of pkg.items) resolved.push({ ...item, itemClass: await resolveItemClass(item) });

    await ggconPost(`/players/${encodeURIComponent(link.steam_id)}/currency`, { action: "change", amount: -pkg.price });
    try {
      for (const item of resolved) {
        await ggconPost("/spawn", { steamId: String(link.steam_id), item: item.itemClass, qty: item.qty });
      }
    } catch (error) {
      await ggconPost(`/players/${encodeURIComponent(link.steam_id)}/currency`, { action: "change", amount: pkg.price }).catch(() => {});
      await recordPurchase({
        guild_id: String(interaction.guildId), discord_id: String(interaction.user.id), steam_id: String(link.steam_id),
        player_name: link.scum_name || getPlayerDisplayName(player), package_id: pkg.id, package_name: pkg.name,
        price: pkg.price, status: "refunded", error_message: error.message, created_at: new Date().toISOString(),
      });
      throw new Error(`Delivery failed, so your $${formatMoney(pkg.price)} was refunded. ${error.message}`);
    }

    await recordPurchase({
      guild_id: String(interaction.guildId), discord_id: String(interaction.user.id), steam_id: String(link.steam_id),
      player_name: link.scum_name || getPlayerDisplayName(player), package_id: pkg.id, package_name: pkg.name,
      price: pkg.price, status: "delivered", error_message: null, created_at: new Date().toISOString(),
    });
    return { playerName: link.scum_name || getPlayerDisplayName(player) };
  } finally {
    purchaseLocks.delete(lockKey);
  }
}

async function purchaseHistory(interaction) {
  const { data, error } = await getDb()
    .from(PURCHASES_TABLE)
    .select("package_name, price, status, created_at")
    .eq("guild_id", String(interaction.guildId))
    .eq("discord_id", String(interaction.user.id))
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw error;
  const lines = (data || []).map((row) => {
    const ts = Math.floor(new Date(row.created_at).getTime() / 1000);
    return `• **${row.package_name}** — $${formatMoney(row.price)} — ${row.status} — <t:${ts}:R>`;
  });
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("📦 My Shop Purchases")
    .setDescription(lines.length ? lines.join("\n") : "You have no recorded Watcher shop purchases yet.");
}

async function handleShopCommand(message) {
  if (!message.guild || !message.content?.startsWith("!")) return false;
  const command = message.content.trim().split(/\s+/)[0].toLowerCase();
  if (command !== "!shopsetup") return false;
  if (!isStaff(message.member)) {
    await message.reply("Only Watcher staff can set up the server shop.").catch(() => {});
    return true;
  }
  await message.delete().catch(() => {});
  await message.channel.send({ embeds: [launcherEmbed()], components: launcherRows() });
  return true;
}

async function handleShopInteraction(interaction) {
  if (!interaction.isButton?.()) return false;
  const customId = String(interaction.customId || "");
  if (!customId.startsWith("shop:")) return false;

  const [, action, packageId] = customId.split(":");
  if (action === "browse" || action === "back") {
    const payload = { embeds: [shopEmbed()], components: shopRows(), flags: ephemeralFlags() };
    if (interaction.deferred || interaction.replied || action === "back") await interaction.update({ embeds: payload.embeds, components: payload.components });
    else await interaction.reply(payload);
    return true;
  }

  if (action === "view") {
    const pkg = PACKAGES[packageId];
    if (!pkg) throw new Error("That shop package no longer exists.");
    await interaction.update({ embeds: [packageEmbed(pkg)], components: packageRows(pkg) });
    return true;
  }

  if (action === "history") {
    await interaction.deferReply({ flags: ephemeralFlags() });
    await interaction.editReply({ embeds: [await purchaseHistory(interaction)], components: [] });
    return true;
  }

  if (action === "buy") {
    const pkg = PACKAGES[packageId];
    if (!pkg) throw new Error("That shop package no longer exists.");
    await interaction.deferReply({ flags: ephemeralFlags() });
    const result = await buyPackage(interaction, pkg);
    await interaction.editReply({
      content: `✅ **${pkg.name} delivered** near **${result.playerName}** in SCUM. $${formatMoney(pkg.price)} was deducted.`,
      embeds: [], components: [],
    });
    return true;
  }

  return true;
}

module.exports = { handleShopCommand, handleShopInteraction };
