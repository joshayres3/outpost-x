const { recordTransaction } = require('./watcherTransactions');
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
const PRODUCTS_TABLE = process.env.WATCHER_SERVER_SHOP_PRODUCTS_TABLE || "watcher_server_shop_products";
const CATALOG_CACHE_MS = 6 * 60 * 60 * 1000;
const PRODUCT_CACHE_MS = 30 * 1000;
const purchaseLocks = new Set();
let db = null;
let catalogCache = { loadedAt: 0, items: [] };
const productCache = new Map();

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



function defaultProductRows(guildId) {
  return Object.values(PACKAGES).map((pkg, index) => ({
    guild_id: String(guildId),
    slug: pkg.id,
    name: pkg.name,
    emoji: pkg.emoji || '📦',
    description: pkg.description || '',
    category: pkg.id === 'medical' ? 'Medical' : pkg.id === 'gas' ? 'Supplies' : 'Weapons',
    price: Number(pkg.price || 0),
    enabled: true,
    sort_order: index,
    items: pkg.items.map((item) => ({
      label: item.label, qty: Number(item.qty || 1), itemClass: item.itemClass || null, aliases: item.aliases || [item.label],
    })),
  }));
}

async function ensurePortalProducts(guildId) {
  const db = getDb();
  const { data, error } = await db.from(PRODUCTS_TABLE).select('*').eq('guild_id', String(guildId)).order('sort_order', { ascending: true });
  if (error) throw error;
  if (data?.length) return data;
  const { data: seeded, error: seedError } = await db.from(PRODUCTS_TABLE).insert(defaultProductRows(guildId)).select('*');
  if (seedError) throw seedError;
  return seeded || [];
}

function normalizeProductRow(row) {
  const items = Array.isArray(row?.items) ? row.items : [];
  return {
    id: row.id, slug: row.slug, name: row.name, emoji: row.emoji || '📦', description: row.description || '',
    category: row.category || 'General', price: Number(row.price || 0), enabled: row.enabled !== false,
    sortOrder: Number(row.sort_order || 0), purchaseLimit: row.purchase_limit == null ? null : Number(row.purchase_limit),
    cooldownMinutes: Number(row.cooldown_minutes || 0),
    items: items.map((item) => ({ label: String(item.label || item.displayName || item.itemClass || 'Item'), qty: Math.max(1, Number(item.qty || 1)), itemClass: item.itemClass || item.class || null, aliases: item.aliases || [item.label, item.itemClass].filter(Boolean) })),
  };
}

async function listManagedProducts(guildId, includeDisabled = true) {
  const key = String(guildId);
  const cached = productCache.get(key);
  if (cached && Date.now() - cached.loadedAt < PRODUCT_CACHE_MS) {
    return cached.products.filter((x) => includeDisabled || x.enabled !== false);
  }
  let q = getDb().from(PRODUCTS_TABLE).select('*').eq('guild_id', key).order('sort_order', { ascending: true }).order('name', { ascending: true });
  const { data, error } = await q;
  if (error) throw error;
  const rows = data?.length ? data : await ensurePortalProducts(guildId);
  const products = rows.map(normalizeProductRow);
  productCache.set(key, { loadedAt: Date.now(), products });
  return products.filter((x) => includeDisabled || x.enabled !== false);
}

async function getManagedProduct(guildId, productId) {
  let q = getDb().from(PRODUCTS_TABLE).select('*').eq('guild_id', String(guildId));
  if (/^[0-9a-f-]{30,}$/i.test(String(productId || ''))) q = q.eq('id', String(productId));
  else q = q.eq('slug', String(productId || ''));
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  return data ? normalizeProductRow(data) : null;
}

function safeSlug(value) {
  return String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || `product-${Date.now()}`;
}

async function saveManagedProduct(guildId, actorId, body = {}) {
  const items = (Array.isArray(body.items) ? body.items : []).map((item) => {
    const label = String(item.label || item.displayName || item.itemClass || '').trim();
    const itemClass = String(item.itemClass || item.class || '').trim();
    const aliases = [...new Set([
      ...(Array.isArray(item.aliases) ? item.aliases : []),
      label,
      itemClass,
    ].filter(Boolean).map(String))];
    return {
      label,
      qty: Math.max(1, Math.min(1000, Math.floor(Number(item.qty || 1)))),
      itemClass: itemClass || null,
      aliases,
    };
  }).filter((item) => item.label && (item.itemClass || item.aliases.length));
  if (!String(body.name || '').trim()) throw new Error('Product name is required.');
  if (!items.length) throw new Error('This product has no usable package items. Add an item from the catalogue or restore its existing package contents.');
  const price = Math.max(0, Math.floor(Number(body.price || 0)));
  const row = {
    guild_id: String(guildId), slug: safeSlug(body.slug || body.name), name: String(body.name).trim().slice(0, 100),
    emoji: String(body.emoji || '📦').trim().slice(0, 16), description: String(body.description || '').trim().slice(0, 500),
    category: String(body.category || 'General').trim().slice(0, 60), price, enabled: body.enabled !== false,
    sort_order: Math.floor(Number(body.sortOrder || 0)), purchase_limit: body.purchaseLimit ? Math.max(1, Math.floor(Number(body.purchaseLimit))) : null,
    cooldown_minutes: Math.max(0, Math.floor(Number(body.cooldownMinutes || 0))), items, updated_by: String(actorId || ''), updated_at: new Date().toISOString(),
  };
  let result;
  if (body.id) result = await getDb().from(PRODUCTS_TABLE).update(row).eq('guild_id', String(guildId)).eq('id', String(body.id)).select('*').single();
  else result = await getDb().from(PRODUCTS_TABLE).insert({ ...row, created_by: String(actorId || '') }).select('*').single();
  if (result.error) throw result.error;
  productCache.delete(String(guildId));
  return normalizeProductRow(result.data);
}

async function deleteManagedProduct(guildId, id) {
  const { error } = await getDb().from(PRODUCTS_TABLE).delete().eq('guild_id', String(guildId)).eq('id', String(id));
  if (error) throw error;
  productCache.delete(String(guildId));
  return { ok: true };
}

async function searchItemCatalog(query = '', limit = 60) {
  const catalog = await loadCatalog();
  const wanted = normalize(query);
  return catalog.map((item) => {
    const names = catalogNames(item);
    const itemClass = catalogClass(item);
    const label = String(item?.dn || item?.displayName || item?.display_name || item?.name || item?.label || itemClass || 'Unknown Item');
    const haystack = normalize(`${label} ${itemClass} ${names.join(' ')}`);
    return { label, itemClass, category: String(item?.category || item?.cat || item?.type || 'SCUM Item'), score: !wanted ? 1 : haystack.includes(wanted) ? (normalize(label).startsWith(wanted) ? 3 : 2) : 0 };
  }).filter((item) => item.itemClass && item.score > 0).sort((a, b) => b.score - a.score || a.label.localeCompare(b.label)).slice(0, Math.max(1, Math.min(100, Number(limit || 60))));
}

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
    await recordTransaction({ guildId: interaction.guildId, discordId: interaction.user.id, steamId: link.steam_id, playerName: link.scum_name || getPlayerDisplayName(player), type: 'server_shop', title: `Server Shop: ${pkg.name}`, amount: -pkg.price, balanceBefore: cash, balanceAfter: cash - pkg.price, details: { packageId: pkg.id, packageName: pkg.name, items: pkg.items } });
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


async function getPortalCatalog(guildId) {
  try {
    const products = await listManagedProducts(guildId, false);
    return products.map((pkg) => ({ id: pkg.id, slug: pkg.slug, name: pkg.name, emoji: pkg.emoji, description: pkg.description, category: pkg.category, price: pkg.price, enabled: pkg.enabled, contents: pkg.items.map((item) => ({ label: item.label, qty: item.qty })) }));
  } catch (error) {
    console.warn('⚠️ Dynamic server shop unavailable; using built-in catalogue:', error.message);
    return Object.values(PACKAGES).map((pkg) => ({ id: pkg.id, slug: pkg.id, name: pkg.name, emoji: pkg.emoji, description: pkg.description, category: 'General', price: pkg.price, enabled: true, contents: pkg.items.map((item) => ({ label: item.label, qty: item.qty })) }));
  }
}

async function buyPackageForPortal({ guildId, discordId, steamId, playerName, packageId }) {
  let pkg = null;
  try { pkg = await getManagedProduct(guildId, packageId); } catch {}
  if (!pkg) {
    const fallback = PACKAGES[String(packageId || '')];
    if (fallback) pkg = { ...fallback, slug: fallback.id, enabled: true };
  }
  if (!pkg || pkg.enabled === false) throw new Error('That shop package no longer exists or is disabled.');
  const lockKey = `${guildId}:${discordId}`;
  if (purchaseLocks.has(lockKey)) throw new Error('A shop purchase is already being processed for you.');
  purchaseLocks.add(lockKey);
  try {
    const link = steamId ? { steam_id: String(steamId), scum_name: playerName || null } : await getLink(guildId, discordId);
    if (!link?.steam_id) throw new Error('You must register your SCUM character before using the shop.');
    const playerResult = await getPlayerForLookup(link.steam_id);
    const player = playerResult?.type === 'single' ? playerResult.player : null;
    if (!player || !isOnline(player)) throw new Error('You must be online in SCUM to receive a shop purchase.');
    const cash = getCash(player);
    if (cash === null) throw new Error('Watcher could not verify your current in-game cash.');
    if (cash < pkg.price) throw new Error(`You need $${formatMoney(pkg.price)}. Your current balance is $${formatMoney(cash)}.`);
    const resolved = [];
    for (const item of pkg.items) resolved.push({ ...item, itemClass: item.itemClass || await resolveItemClass(item) });
    await ggconPost(`/players/${encodeURIComponent(link.steam_id)}/currency`, { action: 'change', amount: -pkg.price });
    try {
      for (const item of resolved) await ggconPost('/spawn', { steamId: String(link.steam_id), item: item.itemClass, qty: item.qty });
    } catch (error) {
      await ggconPost(`/players/${encodeURIComponent(link.steam_id)}/currency`, { action: 'change', amount: pkg.price }).catch(() => {});
      await recordPurchase({ guild_id:String(guildId), discord_id:String(discordId), steam_id:String(link.steam_id), player_name:link.scum_name||getPlayerDisplayName(player), package_id:pkg.slug||pkg.id, package_name:pkg.name, price:pkg.price, status:'refunded', error_message:error.message, created_at:new Date().toISOString() });
      throw new Error(`Delivery failed, so your $${formatMoney(pkg.price)} was refunded. ${error.message}`);
    }
    await recordPurchase({ guild_id:String(guildId), discord_id:String(discordId), steam_id:String(link.steam_id), player_name:link.scum_name||getPlayerDisplayName(player), package_id:pkg.slug||pkg.id, package_name:pkg.name, price:pkg.price, status:'delivered', error_message:null, created_at:new Date().toISOString() });
    await recordTransaction({ guildId, discordId, steamId:link.steam_id, playerName:link.scum_name||getPlayerDisplayName(player), type:'server_shop', title:`Server Shop: ${pkg.name}`, amount:-pkg.price, balanceBefore:cash, balanceAfter:cash-pkg.price, details:{ packageId:pkg.id, packageName:pkg.name, items:pkg.items } });
    return { ok:true, package:pkg, playerName:link.scum_name||getPlayerDisplayName(player), balanceBefore:cash, balanceAfter:cash-pkg.price };
  } finally { purchaseLocks.delete(lockKey); }
}
module.exports = { handleShopCommand, handleShopInteraction, getPortalCatalog, buyPackageForPortal, listManagedProducts, saveManagedProduct, deleteManagedProduct, searchItemCatalog };
