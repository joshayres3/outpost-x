const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { createClient } = require("@supabase/supabase-js");

const DEFAULT_SERVER_BASE_URL = "https://ggcon.gghost.games/s/2788404";
const RUNTIME_STATE_TABLE = process.env.WATCHER_RUNTIME_STATE_TABLE || "watcher_runtime_state";
const PLAYER_LINKS_TABLE = process.env.WATCHER_PLAYER_LINKS_TABLE || "watcher_player_links";
const REGISTER_CHANNEL_ID = process.env.WATCHER_REGISTER_CHANNEL_ID || "1517255357888466964";
const STAFF_ROLE_NAMES = new Set(["Owner", "Owners", "Admin", "Trial Admin"]);

const MECH_PACKS = {
  rpg7: {
    key: "rpg7",
    emoji: "🚀",
    label: "RPG-7",
    buttonLabel: "Buy RPG-7",
    price: 50000,
    quantity: 1,
    aliases: [
      "Weapon_RPG7",
      "Weapon_RPG_7",
      "RPG7",
      "RPG_7",
      "RPG-7",
      "RPG",
    ],
  },
  rockets10: {
    key: "rockets10",
    emoji: "💥",
    label: "10 RPG Rockets",
    buttonLabel: "Buy 10 Rockets",
    price: 15000,
    quantity: 10,
    aliases: [
      "Ammo_RPG7",
      "Ammo_RPG_7",
      "Ammo_RPG7_Rocket",
      "Ammo_RPG_7_Rocket",
      "RPG7_Rocket",
      "RPG_7_Rocket",
      "Rocket_RPG7",
      "Rocket_RPG_7",
      "RPG-7 Rocket",
      "RPG Rocket",
    ],
  },
};

let supabase;
let cachedItems = null;
let cachedItemsAt = 0;

function getSupabase() {
  if (!supabase) {
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  }
  return supabase;
}

function serverBaseUrl() {
  return String(process.env.GGCON_BASE_URL || DEFAULT_SERVER_BASE_URL).replace(/\/$/, "");
}

function serverPassword() {
  const password = process.env.GGCON_PASSWORD;
  if (!password) throw new Error("Server tool password is not configured.");
  return password;
}

async function serverGet(path) {
  const res = await fetch(`${serverBaseUrl()}${path}`, {
    method: "GET",
    headers: { "X-Password": serverPassword() },
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(data?.message || data?.error || `Server GET failed: ${res.status}`);
  return data;
}

async function serverPost(path, body) {
  const res = await fetch(`${serverBaseUrl()}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Password": serverPassword(),
    },
    body: JSON.stringify(body || {}),
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(data?.message || data?.error || `Server POST failed: ${res.status}`);
  if (data?.ok === false || data?.accepted === false) throw new Error(data?.message || data?.error || "Server rejected the request.");
  return data;
}

function isStaff(message) {
  return Boolean(message?.member?.roles?.cache?.some((role) => STAFF_ROLE_NAMES.has(role.name)));
}

function formatMoney(value) {
  const number = Number(value || 0);
  return `$${Math.round(number).toLocaleString("en-US")}`;
}

function normalizeText(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function compactText(value) {
  return normalizeText(value).replace(/_/g, "");
}

function getPlayerDisplayName(player, fallback = "Unknown") {
  return String(player?.characterName || player?.steamName || player?.realName || player?.fakeName || player?.name || fallback || "Unknown").trim();
}

function getPlayerCash(player) {
  const candidates = [player?.accountBalance, player?.cash, player?.currency, player?.money, player?.balance, player?.account_balance];
  for (const value of candidates) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

async function getPlayerBySteamId(steamId) {
  const data = await serverGet(`/players/${encodeURIComponent(steamId)}.json`);
  const player = data?.player || data;
  return { ...player, userId: steamId };
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

async function saveRuntimeValue(key, value) {
  const db = getSupabase();
  await db.from(RUNTIME_STATE_TABLE).upsert(
    { key, value, updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );
}

async function loadRuntimeValue(key) {
  const db = getSupabase();
  const { data, error } = await db.from(RUNTIME_STATE_TABLE).select("value").eq("key", key).maybeSingle();
  if (error) throw error;
  return data?.value || null;
}

async function getItemCatalog() {
  if (cachedItems && Date.now() - cachedItemsAt < 10 * 60 * 1000) return cachedItems;
  const data = await serverGet("/items.json");
  cachedItems = Array.isArray(data?.items) ? data.items : [];
  cachedItemsAt = Date.now();
  return cachedItems;
}

function itemScore(item, pack) {
  const itemClass = String(item?.i || item?.itemClass || item?.class || "");
  const display = String(item?.dn || item?.name || "");
  const category = String(item?.c || "");
  const combined = `${itemClass} ${display} ${category}`;
  const compactClass = compactText(itemClass);
  const compactDisplay = compactText(display);
  const compactCombined = compactText(combined);

  let best = 0;
  for (const alias of pack.aliases || []) {
    const compactAlias = compactText(alias);
    if (!compactAlias) continue;
    if (compactClass === compactAlias) best = Math.max(best, 2500);
    else if (compactClass.includes(compactAlias) || compactAlias.includes(compactClass)) best = Math.max(best, 1800);
    if (compactDisplay === compactAlias) best = Math.max(best, 1500);
    else if (compactDisplay.includes(compactAlias)) best = Math.max(best, 1000);
    else if (compactCombined.includes(compactAlias)) best = Math.max(best, 700);
  }

  // Guardrails so a generic RPG search does not pick random unrelated items before exact aliases.
  if (pack.key === "rpg7") {
    if (/rocket|ammo|projectile/i.test(display) || /rocket|ammo|projectile/i.test(itemClass)) best -= 500;
    if (!/rpg/i.test(combined)) best = 0;
  }
  if (pack.key === "rockets10") {
    if (!/rpg/i.test(combined) || !/rocket|ammo|projectile/i.test(combined)) best -= 500;
  }

  return best;
}

async function resolvePackItem(pack) {
  const items = await getItemCatalog().catch(() => []);
  const match = items
    .map((item) => ({ item, score: itemScore(item, pack) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || String(a.item.i || "").localeCompare(String(b.item.i || "")))[0]?.item;

  if (match?.i) return { itemClass: match.i, displayName: match.dn || match.i, catalogMatched: true };

  // Conservative fallback if catalog is unavailable. Staff can run !mechpackstatus to see this.
  const fallback = pack.key === "rpg7" ? "Weapon_RPG7" : "Ammo_RPG7";
  return { itemClass: fallback, displayName: fallback, catalogMatched: false };
}

function buildMechPackRows() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("mechpack:buy:rpg7").setLabel("Buy RPG-7 — $50,000").setEmoji("🚀").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("mechpack:buy:rockets10").setLabel("Buy 10 Rockets — $15,000").setEmoji("💥").setStyle(ButtonStyle.Primary)
    ),
  ];
}

function buildMechPackText() {
  return [
    "# 🤖 Mech Hunting Packs",
    "Buy a small starter pack for mech hunting nights.",
    "",
    "🚀 **RPG-7** — `$50,000`",
    "💥 **10 RPG Rockets** — `$15,000`",
    "",
    "⚠️ **Profit note:** To actually profit from mechs, you will need to loot/find rockets — buying rockets is mainly for fun.",
    "",
    `You must register your SCUM character first here: <#${REGISTER_CHANNEL_ID}>`,
  ].join("\n");
}

function buildRegisterRows() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("insurance:register").setLabel("Register Steam").setEmoji("🔗").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("insurance:verify").setLabel("Verify Code").setEmoji("✅").setStyle(ButtonStyle.Success)
    ),
  ];
}

function buildRegisterPanelText() {
  return [
    "# 🔗 Register Your SCUM Character",
    "Register first so Watcher knows which SCUM character belongs to your Discord account.",
    "",
    "You need this for player features like:",
    "🛡️ Vehicle Insurance",
    "🤖 Mech Hunting Packs",
    "",
    "Click **Register Steam**, type the code in SCUM chat, then click **Verify Code**.",
  ].join("\n");
}

async function setupMechPackPanel(message) {
  const sent = await message.channel.send({ content: buildMechPackText(), components: buildMechPackRows() });
  await saveRuntimeValue("mech_pack_config", {
    guildId: message.guild.id,
    channelId: message.channel.id,
    messageId: sent.id,
    setBy: message.author.id,
    setAt: Date.now(),
  });
  await message.react("✅").catch(() => {});
}

async function setupRegisterPanel(message) {
  const sent = await message.channel.send({ content: buildRegisterPanelText(), components: buildRegisterRows() });
  await saveRuntimeValue("register_panel_config", {
    guildId: message.guild.id,
    channelId: message.channel.id,
    messageId: sent.id,
    setBy: message.author.id,
    setAt: Date.now(),
  });
  await message.react("✅").catch(() => {});
}

async function showMechPackStatus(message) {
  const [config, rpg, rockets] = await Promise.all([
    loadRuntimeValue("mech_pack_config").catch(() => null),
    resolvePackItem(MECH_PACKS.rpg7).catch((err) => ({ error: err.message })),
    resolvePackItem(MECH_PACKS.rockets10).catch((err) => ({ error: err.message })),
  ]);

  await message.reply([
    "🤖 **Mech Pack Status**",
    `Panel Channel: ${config?.channelId ? `<#${config.channelId}>` : "Not set"}`,
    `Register Channel: <#${REGISTER_CHANNEL_ID}>`,
    "",
    `RPG-7 item: ${rpg?.itemClass ? `\`${rpg.itemClass}\`${rpg.catalogMatched ? "" : " (fallback)"}` : `Error: ${rpg?.error || "unknown"}`}`,
    `Rocket item: ${rockets?.itemClass ? `\`${rockets.itemClass}\`${rockets.catalogMatched ? "" : " (fallback)"}` : `Error: ${rockets?.error || "unknown"}`}`,
  ].join("\n")).catch(() => {});
}

async function showBuyConfirm(interaction, packKey) {
  const pack = MECH_PACKS[packKey];
  if (!pack) {
    await interaction.reply({ content: "Unknown mech pack.", ephemeral: true }).catch(() => {});
    return;
  }

  const link = await getLink(interaction.guildId, interaction.user.id);
  if (!link?.steam_id) {
    await interaction.reply({
      content: `You need to register your SCUM character first here: <#${REGISTER_CHANNEL_ID}>`,
      ephemeral: true,
    }).catch(() => {});
    return;
  }

  const player = await getPlayerBySteamId(link.steam_id);
  const cash = getPlayerCash(player);
  if (cash === null) {
    await interaction.reply({ content: "I could not read your in-game cash right now. Try again in a few minutes.", ephemeral: true }).catch(() => {});
    return;
  }

  const item = await resolvePackItem(pack);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`mechpack:confirm:${pack.key}`).setLabel(`Buy for ${formatMoney(pack.price)}`).setEmoji(pack.emoji).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("mechpack:cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary)
  );

  await interaction.reply({
    content: [
      `${pack.emoji} **Buy Mech Hunting Pack: ${pack.label}**`,
      `Player: **${link.scum_name || getPlayerDisplayName(player)}**`,
      `Price: **${formatMoney(pack.price)}**`,
      `Your Cash: **${formatMoney(cash)}**`,
      `Item: \`${item.itemClass}\` x${pack.quantity}`,
      "",
      "Click Buy to charge your in-game cash and spawn the item near your character.",
    ].join("\n"),
    components: [row],
    ephemeral: true,
  }).catch(() => {});
}

async function confirmBuy(interaction, packKey) {
  const pack = MECH_PACKS[packKey];
  if (!pack) {
    await interaction.update({ content: "Unknown mech pack.", components: [] }).catch(() => {});
    return;
  }

  const link = await getLink(interaction.guildId, interaction.user.id);
  if (!link?.steam_id) {
    await interaction.update({ content: `Register first here: <#${REGISTER_CHANNEL_ID}>`, components: [] }).catch(() => {});
    return;
  }

  const beforePlayer = await getPlayerBySteamId(link.steam_id);
  const beforeCash = getPlayerCash(beforePlayer);
  if (beforeCash === null || beforeCash < pack.price) {
    await interaction.update({ content: `Not enough in-game cash. Needed ${formatMoney(pack.price)}.`, components: [] }).catch(() => {});
    return;
  }

  const item = await resolvePackItem(pack);

  await serverPost(`/players/${encodeURIComponent(link.steam_id)}/currency`, { action: "change", amount: -pack.price });
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const afterPlayer = await getPlayerBySteamId(link.steam_id);
  const afterCash = getPlayerCash(afterPlayer);

  if (afterCash === null || afterCash > beforeCash - pack.price + 1) {
    await interaction.update({ content: "Payment could not be confirmed. No item was spawned. Ask staff to check your cash before trying again.", components: [] }).catch(() => {});
    return;
  }

  try {
    await serverPost("/spawn", { steamId: String(link.steam_id), item: item.itemClass, qty: pack.quantity });
  } catch (err) {
    // Payment succeeded but item spawn failed. Refund immediately to avoid taking player money.
    await serverPost(`/players/${encodeURIComponent(link.steam_id)}/currency`, { action: "change", amount: pack.price }).catch(() => {});
    await interaction.update({
      content: [
        "The purchase was charged, but the item could not be spawned, so Watcher attempted an automatic refund.",
        `Error: ${err.message}`,
        "Ask staff if your money does not return within a minute.",
      ].join("\n"),
      components: [],
    }).catch(() => {});
    return;
  }

  await interaction.update({
    content: [
      "✅ **Mech Hunting Pack Purchased**",
      `${pack.emoji} **${pack.label}** x${pack.quantity}`,
      `Price Paid: **${formatMoney(pack.price)}**`,
      `New Cash Balance: **${formatMoney(afterCash)}**`,
      "Item spawned near your linked SCUM character.",
      "",
      "Reminder: to profit from mechs, you will need to loot/find rockets too. Buying rockets is mainly for fun.",
    ].join("\n"),
    components: [],
  }).catch(() => {});
}

async function handleMechPackCommand(message) {
  if (!message.guild || !message.content?.startsWith("!")) return false;
  const command = message.content.trim().split(/\s+/)[0].toLowerCase();
  if (!["!mechpacksetup", "!mechpackstatus", "!registersetup"].includes(command)) return false;

  if (!isStaff(message)) {
    await message.reply("The Watcher sees the request. This command is for staff only.").catch(() => {});
    return true;
  }

  if (command === "!mechpacksetup") {
    await setupMechPackPanel(message);
    return true;
  }

  if (command === "!registersetup") {
    await setupRegisterPanel(message);
    return true;
  }

  if (command === "!mechpackstatus") {
    await showMechPackStatus(message);
    return true;
  }

  return false;
}

async function handleMechPackInteraction(interaction) {
  if (!interaction.isButton?.()) return false;
  if (!String(interaction.customId || "").startsWith("mechpack:")) return false;

  const parts = interaction.customId.split(":");
  const action = parts[1];
  const value = parts[2];

  if (action === "cancel") {
    await interaction.update({ content: "Cancelled.", components: [] }).catch(() => {});
    return true;
  }

  if (action === "buy") {
    await showBuyConfirm(interaction, value);
    return true;
  }

  if (action === "confirm") {
    await confirmBuy(interaction, value);
    return true;
  }

  return true;
}

module.exports = {
  handleMechPackCommand,
  handleMechPackInteraction,
};
