const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const { DateTime } = require("luxon");

const DEFAULT_SERVER_BASE_URL = "https://ggcon.gghost.games/s/2788404";
const TIMEZONE = process.env.WATCHER_LOTTERY_TIMEZONE || "America/Toronto";
const RUNTIME_STATE_TABLE = process.env.WATCHER_RUNTIME_STATE_TABLE || "watcher_runtime_state";
const PLAYER_LINKS_TABLE = process.env.WATCHER_PLAYER_LINKS_TABLE || "watcher_player_links";
const SNAPSHOTS_TABLE = process.env.WATCHER_PLAYER_SNAPSHOTS_TABLE || "watcher_player_snapshots";
const DRAWS_TABLE = process.env.WATCHER_LOTTERY_DRAWS_TABLE || "watcher_lottery_draws";
const CODES_TABLE = process.env.WATCHER_LOTTERY_CODES_TABLE || "watcher_lottery_codes";
const STATE_KEY = "lottery_config";

const REGISTER_CHANNEL_ID = process.env.WATCHER_REGISTER_CHANNEL_ID || "1517255357888466964";
const DEFAULT_ADMIN_CHANNEL_IDS = ["1516273523046355094", "1516272506804371646"];

const TICK_SECONDS = Math.max(10, Number(process.env.WATCHER_LOTTERY_TICK_SECONDS || "30"));
const CODE_SCAN_SECONDS = Math.max(10, Number(process.env.WATCHER_LOTTERY_CODE_SCAN_SECONDS || "20"));
const CLAIM_EXPIRY_HOURS = Math.max(1, Number(process.env.WATCHER_LOTTERY_CODE_EXPIRY_HOURS || "24"));
const DRAW_GRACE_MINUTES = Math.max(1, Number(process.env.WATCHER_LOTTERY_DRAW_GRACE_MINUTES || "5"));
const WARNING_GRACE_MINUTES = Math.max(1, Number(process.env.WATCHER_LOTTERY_WARNING_GRACE_MINUTES || "5"));
const ONLINE_LINK_LIMIT = Math.max(100, Number(process.env.WATCHER_LOTTERY_LINK_LIMIT || "2000"));
const RECENT_WINNER_HOURS = Math.max(0, Number(process.env.WATCHER_LOTTERY_RECENT_WINNER_HOURS || "6"));
const RECENT_WINNER_MIN_ELIGIBLE = Math.max(0, Number(process.env.WATCHER_LOTTERY_RECENT_WINNER_MIN_ELIGIBLE || "4"));
const LOTTERY_NORMAL_WEIGHT = Math.max(1, Number(process.env.WATCHER_LOTTERY_NORMAL_WEIGHT || "4"));
const LOTTERY_RECENT_WINNER_WEIGHT = Math.max(0, Number(process.env.WATCHER_LOTTERY_RECENT_WINNER_WEIGHT || "1"));

const STAFF_ROLE_NAME_FALLBACK = new Set(["Owner", "Owners", "Admin", "Trial Admin"]);
const OWNER_ROLE_NAME_FALLBACK = new Set(["Owner", "Owners"]);

let supabase = null;
let lotteryTimer = null;
let codeTimer = null;
let lotteryTickRunning = false;
let codeScanRunning = false;
let cachedItems = null;
let cachedItemsAt = 0;

const LOTTERY_PACKS = [
  {
    id: "jackpot",
    name: "The Jackpot",
    items: [
      { label: "Weapon_MAC10", qty: 1, fallback: "Weapon_MAC10", aliases: ["Weapon_MAC10"] },
      { label: "Magazine_MAC10", qty: 2, fallback: "Magazine_MAC10", aliases: ["Magazine_MAC10"] },
      { label: "Cal_9mm_Ammobox", qty: 3, fallback: "Cal_9mm_Ammobox", aliases: ["Cal_9mm_Ammobox"] },
      { label: "Weapon_Cleaning_Kit", qty: 1, fallback: "Weapon_Cleaning_Kit", aliases: ["Weapon_Cleaning_Kit"] },
    ],
  },
  {
    id: "fisherman",
    name: "The Fisherman Pack",
    items: [
      { label: "FishingRod_A", qty: 1, fallback: "FishingRod_A", aliases: ["FishingRod_A"] },
      { label: "Fishing_hook", qty: 1, fallback: "Fishing_hook", aliases: ["Fishing_hook"] },
      { label: "FishingLine_1", qty: 1, fallback: "FishingLine_1", aliases: ["FishingLine_1"] },
      { label: "Boonie_Hat_01", qty: 1, fallback: "Boonie_Hat_01", aliases: ["Boonie_Hat_01"] },
      { label: "Canned_Tuna", qty: 2, fallback: "Canned_Tuna", aliases: ["Canned_Tuna"] },
    ],
  },
  {
    id: "tactical_homeless",
    name: "The Tactical Homeless Pack",
    items: [
      { label: "Military_Helmet_01_01", qty: 1, fallback: "Military_Helmet_01_01", aliases: ["Military_Helmet_01_01"] },
      { label: "Tactical_Handgun_Holster_01", qty: 1, fallback: "Tactical_Handgun_Holster_01", aliases: ["Tactical_Handgun_Holster_01"] },
      { label: "Military_Shirt_01", qty: 1, fallback: "Military_Shirt_01", aliases: ["Military_Shirt_01"] },
      { label: "CombatBoots", qty: 1, fallback: "CombatBoots", aliases: ["CombatBoots"] },
      { label: "CannedCatFood", qty: 1, fallback: "CannedCatFood", aliases: ["CannedCatFood"] },
    ],
  },
  {
    id: "puppet_souvenir",
    name: "The Puppet Souvenir Pack",
    items: [
      { label: "Puppet_Eye", qty: 2, fallback: "Puppet_Eye", aliases: ["Puppet_Eye"] },
      { label: "Bone", qty: 1, fallback: "Bone", aliases: ["Bone"] },
      { label: "05_Teeth_Necklace", qty: 1, fallback: "05_Teeth_Necklace", aliases: ["05_Teeth_Necklace"] },
      { label: "2_pieces_Ear_Necklace", qty: 1, fallback: "2_pieces_Ear_Necklace", aliases: ["2_pieces_Ear_Necklace"] },
      { label: "Rags", qty: 1, fallback: "Rags", aliases: ["Rags"] },
      { label: "Safety_pin", qty: 1, fallback: "Safety_pin", aliases: ["Safety_pin"] },
    ],
  },
  {
    id: "master_builder",
    name: "The Master Builder Pack",
    items: [
      { label: "Metal_Scrap_01", qty: 5, fallback: "Metal_Scrap_01", aliases: ["Metal_Scrap_01"] },
      { label: "Nails", qty: 5, fallback: "Nails", aliases: ["Nails"] },
      { label: "Bolts", qty: 2, fallback: "Bolts", aliases: ["Bolts"] },
      { label: "Rubber_band", qty: 1, fallback: "Rubber_band", aliases: ["Rubber_band"] },
      { label: "Rubber_sheet", qty: 1, fallback: "Rubber_sheet", aliases: ["Rubber_sheet"] },
      { label: "Wooden_Stick", qty: 1, fallback: "Wooden_Stick", aliases: ["Wooden_Stick"] },
    ],
  },
  {
    id: "romantic_dinner",
    name: "The Romantic Dinner Pack",
    items: [
      { label: "CannedSpaghetti", qty: 2, fallback: "CannedSpaghetti", aliases: ["CannedSpaghetti"] },
      { label: "CannedPeach", qty: 1, fallback: "CannedPeach", aliases: ["CannedPeach"] },
      { label: "Beer", qty: 2, fallback: "Beer", aliases: ["Beer"] },
      { label: "Candle_01", qty: 1, fallback: "Candle_01", aliases: ["Candle_01"] },
      { label: "Matches", qty: 1, fallback: "Matches", aliases: ["Matches"] },
      { label: "Underpants_01", qty: 1, fallback: "Underpants_01", aliases: ["Underpants_01"] },
    ],
  },
  {
    id: "almost_armed",
    name: "The Almost Armed Pack",
    items: [
      { label: "Magazine_M9", qty: 1, fallback: "Magazine_M9", aliases: ["Magazine_M9"] },
      { label: "WeaponScope_ACOG_01", qty: 1, fallback: "WeaponScope_ACOG_01", aliases: ["WeaponScope_ACOG_01"] },
      { label: "Tactical_Handgun_Holster_01", qty: 1, fallback: "Tactical_Handgun_Holster_01", aliases: ["Tactical_Handgun_Holster_01"] },
      { label: "Cal_22_Ammobox", qty: 1, fallback: "Cal_22_Ammobox", aliases: ["Cal_22_Ammobox"] },
      { label: "12_Gauge_Buckshot_Ammobox", qty: 1, fallback: "12_Gauge_Buckshot_Ammobox", aliases: ["12_Gauge_Buckshot_Ammobox"] },
    ],
  },
  {
    id: "professional_medic",
    name: "The Professional Medic Pack",
    items: [
      { label: "Rags", qty: 2, fallback: "Rags", aliases: ["Rags"] },
      { label: "Rag_Stripes", qty: 1, fallback: "Rag_Stripes", aliases: ["Rag_Stripes"] },
      { label: "Painkillers_01", qty: 1, fallback: "Painkillers_01", aliases: ["Painkillers_01"] },
      { label: "Vitamins_01", qty: 1, fallback: "Vitamins_01", aliases: ["Vitamins_01"] },
      { label: "Medical_Glove_01", qty: 1, fallback: "Medical_Glove_01", aliases: ["Medical_Glove_01"] },
      { label: "Disposable_Mask", qty: 1, fallback: "Disposable_Mask", aliases: ["Disposable_Mask"] },
      { label: "CannedDogFood", qty: 1, fallback: "CannedDogFood", aliases: ["CannedDogFood"] },
    ],
  },
  {
    id: "bear_necessities",
    name: "The Bear Necessities Pack",
    items: [
      { label: "Bear_Head", qty: 1, fallback: "Bear_Head", aliases: ["Bear_Head"] },
      { label: "Bear_Front_Paws", qty: 1, fallback: "Bear_Front_Paws", aliases: ["Bear_Front_Paws"] },
      { label: "Bear_Back_Paws", qty: 1, fallback: "Bear_Back_Paws", aliases: ["Bear_Back_Paws"] },
      { label: "Animal_skin", qty: 1, fallback: "Animal_skin", aliases: ["Animal_skin"] },
      { label: "Bone", qty: 1, fallback: "Bone", aliases: ["Bone"] },
      { label: "Bear_Steak", qty: 1, fallback: "Bear_Steak", aliases: ["Bear_Steak"] },
      { label: "Improvised_Bag_Small_01", qty: 1, fallback: "Improvised_Bag_Small_01", aliases: ["Improvised_Bag_Small_01"] },
    ],
  },
  {
    id: "christmas_in_july",
    name: "The Christmas in July Pack",
    items: [
      { label: "Christmas_Present_01", qty: 1, fallback: "Christmas_Present_01", aliases: ["Christmas_Present_01"] },
      { label: "Santa_Hat_01", qty: 1, fallback: "Santa_Hat_01", aliases: ["Santa_Hat_01"] },
      { label: "Medical_Glove_01", qty: 1, fallback: "Medical_Glove_01", aliases: ["Medical_Glove_01"] },
      { label: "Snowballs_01", qty: 1, fallback: "Snowballs_01", aliases: ["Snowballs_01"] },
      { label: "BakedBeans", qty: 1, fallback: "BakedBeans", aliases: ["BakedBeans"] },
      { label: "Socks_02", qty: 1, fallback: "Socks_02", aliases: ["Socks_02"] },
    ],
  },
  {
    id: "influencer",
    name: "The Influencer Pack",
    items: [
      { label: "Mobile_Phone", qty: 1, fallback: "Mobile_Phone", aliases: ["Mobile_Phone"] },
      { label: "Smartphone_Battery", qty: 1, fallback: "Smartphone_Battery", aliases: ["Smartphone_Battery"] },
      { label: "Round_Sunglasses", qty: 1, fallback: "Round_Sunglasses", aliases: ["Round_Sunglasses"] },
      { label: "Ghillie_Suit_Jacket_04", qty: 1, fallback: "Ghillie_Suit_Jacket_04", aliases: ["Ghillie_Suit_Jacket_04"] },
      { label: "Energy_Drink_Red_Ghoul", qty: 2, fallback: "Energy_Drink_Red_Ghoul", aliases: ["Energy_Drink_Red_Ghoul"] },
    ],
  },
  {
    id: "grand_prize_sort_of",
    name: "The Grand Prize… Sort Of",
    items: [
      { label: "Hiking_Backpack_01_05", qty: 1, fallback: "Hiking_Backpack_01_05", aliases: ["Hiking_Backpack_01_05"] },
      { label: "CannedCatFood", qty: 10, fallback: "CannedCatFood", aliases: ["CannedCatFood"] },
      { label: "CannedDogFood", qty: 10, fallback: "CannedDogFood", aliases: ["CannedDogFood"] },
      { label: "Spoon", qty: 1, fallback: "Spoon", aliases: ["Spoon"] },
      { label: "Water_05l", qty: 1, fallback: "Water_05l", aliases: ["Water_05l"] },
    ],
  },
];

function getSupabase() {
  if (supabase) return supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!url || !key) throw new Error("Supabase is not configured.");
  supabase = createClient(url, key, { auth: { persistSession: false } });
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
    headers: { Accept: "application/json", "X-Password": serverPassword() },
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(data?.message || data?.error || `Server GET failed: ${res.status}`);
  if (data?.ok === false) throw new Error(data?.message || data?.error || "Server rejected the request.");
  return data;
}

async function serverPost(path, body = {}) {
  const res = await fetch(`${serverBaseUrl()}${path}`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "X-Password": serverPassword() },
    body: JSON.stringify(body || {}),
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(data?.message || data?.error || `Server POST failed: ${res.status}`);
  if (data?.ok === false || data?.accepted === false) throw new Error(data?.message || data?.error || "Server rejected the request.");
  return data || { ok: true };
}

async function sendGameMessage(text, steamId = null) {
  const body = { text, type: "ServerMessage" };
  if (steamId) body.steamId = String(steamId);
  return await serverPost("/message", body);
}

function splitEnvList(name) {
  return String(process.env[name] || "")
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function adminChannelIds() {
  const configured = splitEnvList("WATCHER_LOTTERY_ADMIN_CHANNEL_IDS");
  return configured.length ? new Set(configured) : new Set(DEFAULT_ADMIN_CHANNEL_IDS);
}

function configuredStaffRoleIds() {
  return splitEnvList("WATCHER_LOTTERY_STAFF_ROLE_IDS");
}

function configuredOwnerRoleIds() {
  return splitEnvList("WATCHER_LOTTERY_OWNER_ROLE_IDS");
}

function configuredLotteryManagerRoleIds() {
  return splitEnvList("WATCHER_LOTTERY_MANAGER_ROLE_IDS");
}

const LOTTERY_MANAGER_ROLE_NAME_FALLBACK = new Set(["Owner", "Owners", "Admin"]);

function hasAnyRoleId(member, ids) {
  const set = new Set(ids || []);
  if (!set.size) return false;
  return !!member?.roles?.cache?.some((role) => set.has(String(role.id)));
}

function hasAnyRoleName(member, names) {
  return !!member?.roles?.cache?.some((role) => names.has(role.name));
}

function isOwnerMember(member) {
  const ids = configuredOwnerRoleIds();
  if (ids.length && hasAnyRoleId(member, ids)) return true;
  return hasAnyRoleName(member, OWNER_ROLE_NAME_FALLBACK);
}

function isLotteryManagerMember(member) {
  if (isOwnerMember(member)) return true;
  const ids = configuredLotteryManagerRoleIds();
  if (ids.length && hasAnyRoleId(member, ids)) return true;
  return hasAnyRoleName(member, LOTTERY_MANAGER_ROLE_NAME_FALLBACK);
}

function isStaffExcluded(member) {
  const ids = configuredStaffRoleIds();
  if (ids.length) return hasAnyRoleId(member, ids);
  return hasAnyRoleName(member, STAFF_ROLE_NAME_FALLBACK);
}

function isLotteryCommandChannel(message, config = null) {
  const allowed = adminChannelIds();
  if (allowed.has(String(message.channelId))) return true;
  if (config?.channelId && String(config.channelId) === String(message.channelId)) return true;
  if (config?.logChannelId && String(config.logChannelId) === String(message.channelId)) return true;
  return false;
}

function playerSteamId(player) {
  return String(player?.userId || player?.steamId || player?.steam_id || "").trim();
}

function playerName(player, fallback = "Unknown") {
  return String(player?.characterName || player?.steamName || player?.realName || player?.fakeName || player?.name || fallback || "Unknown").trim();
}

function formatDate(msOrIso) {
  const dt = typeof msOrIso === "number" ? DateTime.fromMillis(msOrIso).setZone(TIMEZONE) : DateTime.fromISO(String(msOrIso || "")).setZone(TIMEZONE);
  return dt.isValid ? dt.toFormat("yyyy-MM-dd h:mm a") : "Unknown";
}

function safeJson(value) {
  try { return JSON.parse(JSON.stringify(value ?? null)); } catch { return null; }
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
}

function codeHash(guildId, code) {
  return crypto.createHash("sha256").update(`${guildId}:${normalizeCode(code)}`).digest("hex");
}

function codeHint(code) {
  const clean = normalizeCode(code);
  if (clean.length <= 6) return "OX-****";
  return `${clean.slice(0, 3)}****${clean.slice(-2)}`;
}

function generateClaimCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let token = "";
  const bytes = crypto.randomBytes(6);
  for (const byte of bytes) token += alphabet[byte % alphabet.length];
  return `OX-${token.slice(0, 6)}`;
}

function randomChoice(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function currentToronto() {
  return DateTime.now().setZone(TIMEZONE);
}

function slotKey(dt) {
  return `lottery:${dt.toFormat("yyyy-MM-dd-HH")}:45`;
}

function warningKey(dt) {
  return `lottery-warning:${dt.toFormat("yyyy-MM-dd-HH")}:40`;
}

function drawSlotForNow(now = currentToronto()) {
  const target = now.set({ minute: 45, second: 0, millisecond: 0 });
  const end = target.plus({ minutes: DRAW_GRACE_MINUTES });
  if (now >= target && now <= end) {
    return { key: slotKey(target), scheduledFor: target.toISO(), label: target.toFormat("yyyy-MM-dd h:mm a") };
  }
  return null;
}

function warningSlotForNow(now = currentToronto()) {
  const target = now.set({ minute: 40, second: 0, millisecond: 0 });
  const end = target.plus({ minutes: WARNING_GRACE_MINUTES });
  if (now >= target && now <= end) {
    return { key: warningKey(target), drawKey: slotKey(now.set({ minute: 45, second: 0, millisecond: 0 })), label: target.toFormat("yyyy-MM-dd h:mm a") };
  }
  return null;
}

function nextLotteryTimes(now = currentToronto()) {
  let warning = now.set({ minute: 40, second: 0, millisecond: 0 });
  let draw = now.set({ minute: 45, second: 0, millisecond: 0 });
  if (now > draw.plus({ seconds: 1 })) {
    warning = warning.plus({ hours: 1 });
    draw = draw.plus({ hours: 1 });
  } else if (now > warning.plus({ seconds: 1 }) && now <= draw.plus({ seconds: 1 })) {
    // Warning window passed, draw is still coming.
  }
  return { warning, draw };
}

async function loadRuntimeValue(key) {
  const db = getSupabase();
  const { data, error } = await db.from(RUNTIME_STATE_TABLE).select("value").eq("key", key).maybeSingle();
  if (error) throw error;
  return data?.value || null;
}

async function saveRuntimeValue(key, value) {
  const db = getSupabase();
  const { error } = await db.from(RUNTIME_STATE_TABLE).upsert(
    { key, value: value || {}, updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );
  if (error) throw error;
}

async function loadConfig() {
  return await loadRuntimeValue(STATE_KEY).catch(() => null);
}

async function saveConfig(config) {
  await saveRuntimeValue(STATE_KEY, config);
}

async function getOnlinePlayers() {
  const data = await serverGet("/players.json");
  return Array.isArray(data?.players) ? data.players : [];
}

async function fetchLinksForGuild(guildId) {
  const db = getSupabase();
  const { data, error } = await db
    .from(PLAYER_LINKS_TABLE)
    .select("*")
    .eq("guild_id", String(guildId))
    .not("steam_id", "is", null)
    .limit(ONLINE_LINK_LIMIT);
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function fetchSnapshot(steamId) {
  const db = getSupabase();
  const { data, error } = await db.from(SNAPSHOTS_TABLE).select("*").eq("steam_id", String(steamId)).maybeSingle();
  if (error) return null;
  return data || null;
}

function linkFreshness(link) {
  const ts = Date.parse(link?.linked_at || link?.updated_at || link?.created_at || "");
  return Number.isFinite(ts) ? ts : 0;
}

function buildSteamLinkMap(links) {
  const map = new Map();
  for (const link of links || []) {
    const steamId = String(link?.steam_id || "").trim();
    if (!steamId) continue;
    const previous = map.get(steamId);
    if (!previous || linkFreshness(link) > linkFreshness(previous)) map.set(steamId, link);
  }
  return map;
}

async function buildEligiblePlayers(bot, guildId) {
  const guild = await bot.guilds.fetch(guildId).catch(() => null);
  if (!guild) throw new Error("Discord guild was not available.");

  const [onlinePlayers, links] = await Promise.all([getOnlinePlayers(), fetchLinksForGuild(guildId)]);
  const linksBySteam = buildSteamLinkMap(links);
  const eligible = [];
  const rejected = [];

  for (const player of onlinePlayers) {
    const steamId = playerSteamId(player);
    if (!steamId) {
      rejected.push({ reason: "no Steam ID", player });
      continue;
    }

    const link = linksBySteam.get(steamId);
    if (!link?.discord_id) {
      rejected.push({ reason: "not registered", player, steamId });
      continue;
    }

    const member = await guild.members.fetch(String(link.discord_id)).catch(() => null);
    if (!member) {
      rejected.push({ reason: "Discord member not found", player, link, steamId });
      continue;
    }

    if (isStaffExcluded(member)) {
      rejected.push({ reason: "staff role excluded", player, link, steamId });
      continue;
    }

    eligible.push({ player, link, member, steamId, scumName: playerName(player, link.scum_name || steamId) });
  }

  return { eligible, rejected, onlinePlayers, links };
}

async function getItemCatalog() {
  if (cachedItems && Date.now() - cachedItemsAt < 10 * 60 * 1000) return cachedItems;
  const data = await serverGet("/items.json").catch(() => ({ items: [] }));
  cachedItems = Array.isArray(data?.items) ? data.items : [];
  cachedItemsAt = Date.now();
  return cachedItems;
}

function compact(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function itemScore(item, packItem) {
  const itemClass = String(item?.i || item?.itemClass || item?.class || "");
  const display = String(item?.dn || item?.name || "");
  const category = String(item?.c || "");
  const combined = `${itemClass} ${display} ${category}`;
  const compactClass = compact(itemClass);
  const compactDisplay = compact(display);
  const compactCombined = compact(combined);
  let best = 0;

  for (const alias of packItem.aliases || []) {
    const a = compact(alias);
    if (!a) continue;
    if (compactClass === a) best = Math.max(best, 2500);
    else if (compactClass.includes(a) || a.includes(compactClass)) best = Math.max(best, 1600);
    if (compactDisplay === a) best = Math.max(best, 1400);
    else if (compactDisplay.includes(a)) best = Math.max(best, 1000);
    else if (compactCombined.includes(a)) best = Math.max(best, 600);
  }

  return best;
}

async function resolvePackItem(packItem) {
  const items = await getItemCatalog();
  const match = items
    .map((item) => ({ item, score: itemScore(item, packItem) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || String(a.item.i || "").localeCompare(String(b.item.i || "")))[0]?.item;

  if (match?.i) return { itemClass: match.i, displayName: match.dn || match.i, catalogMatched: true };
  return { itemClass: packItem.fallback || packItem.aliases?.[0] || packItem.label, displayName: packItem.label, catalogMatched: false };
}

async function deliverPack(steamId, packPayload) {
  const pack = packPayload || null;
  const items = Array.isArray(pack?.items) ? pack.items : [];
  const results = [];
  for (const packItem of items) {
    const resolved = await resolvePackItem(packItem);
    const qty = Math.max(1, Math.floor(Number(packItem.qty || 1)));
    const result = await serverPost("/spawn", { steamId: String(steamId), item: resolved.itemClass, qty });
    results.push({ label: packItem.label, qty, itemClass: resolved.itemClass, catalogMatched: resolved.catalogMatched, result: safeJson(result) });
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  return results;
}

async function createDrawRecord({ guildId, drawKey, scheduledFor, channelId }) {
  const db = getSupabase();
  const { data, error } = await db.from(DRAWS_TABLE).insert({
    guild_id: String(guildId),
    draw_key: drawKey,
    scheduled_for: scheduledFor,
    actual_run_at: new Date().toISOString(),
    channel_id: String(channelId || ""),
    status: "running",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).select("*").single();

  if (error) {
    if (String(error.code || "") === "23505" || /duplicate/i.test(error.message || "")) return null;
    throw error;
  }
  return data;
}

async function updateDraw(id, updates) {
  const db = getSupabase();
  const { data, error } = await db.from(DRAWS_TABLE).update({ ...updates, updated_at: new Date().toISOString() }).eq("id", id).select("*").maybeSingle();
  if (error) throw error;
  return data;
}

async function createCodeRecord({ guildId, drawId, code, winner, pack, expiresAt }) {
  const db = getSupabase();
  const { data, error } = await db.from(CODES_TABLE).insert({
    guild_id: String(guildId),
    draw_id: drawId,
    code_hash: codeHash(guildId, code),
    code_hint: codeHint(code),
    discord_id: String(winner.link.discord_id),
    discord_tag: winner.link.discord_tag || winner.member?.user?.tag || null,
    steam_id: String(winner.steamId),
    scum_name: winner.scumName,
    pack_id: pack.id,
    pack_name: pack.name,
    pack_payload: safeJson(pack),
    status: "active",
    expires_at: expiresAt,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).select("*").single();
  if (error) throw error;
  return data;
}

async function updateCode(id, updates) {
  const db = getSupabase();
  const { data, error } = await db.from(CODES_TABLE).update({ ...updates, updated_at: new Date().toISOString() }).eq("id", id).select("*").maybeSingle();
  if (error) throw error;
  return data;
}

async function fetchRecentWinnerRows(guildId) {
  if (RECENT_WINNER_HOURS <= 0) return [];
  const since = DateTime.now().minus({ hours: RECENT_WINNER_HOURS }).toISO();
  const db = getSupabase();
  const { data, error } = await db
    .from(DRAWS_TABLE)
    .select("selected_steam_id, selected_scum_name, actual_run_at")
    .eq("guild_id", String(guildId))
    .eq("status", "completed")
    .gte("actual_run_at", since)
    .not("selected_steam_id", "is", null)
    .order("actual_run_at", { ascending: false })
    .limit(500);

  if (error) {
    console.warn("[lottery] Recent winner lookup failed:", error.message || error);
    return [];
  }

  return Array.isArray(data) ? data : [];
}

async function buildRecentWinnerProtection(guildId, eligiblePlayers) {
  const eligibleCount = Array.isArray(eligiblePlayers) ? eligiblePlayers.length : 0;
  const base = {
    applied: false,
    reason: "not_applied",
    recentWinnerIds: new Set(),
    reducedCount: 0,
    normalWeight: LOTTERY_NORMAL_WEIGHT,
    recentWeight: LOTTERY_RECENT_WINNER_WEIGHT,
    hours: RECENT_WINNER_HOURS,
    minEligible: RECENT_WINNER_MIN_ELIGIBLE,
  };

  if (RECENT_WINNER_HOURS <= 0) return { ...base, reason: "disabled" };
  if (eligibleCount < RECENT_WINNER_MIN_ELIGIBLE) return { ...base, reason: "not_enough_eligible" };
  if (LOTTERY_RECENT_WINNER_WEIGHT >= LOTTERY_NORMAL_WEIGHT) return { ...base, reason: "weights_equal_or_higher" };

  const rows = await fetchRecentWinnerRows(guildId);
  const recentWinnerIds = new Set(
    rows
      .map((row) => String(row?.selected_steam_id || "").trim())
      .filter(Boolean)
  );

  const reducedCount = (eligiblePlayers || []).filter((entry) => recentWinnerIds.has(String(entry.steamId))).length;
  return {
    ...base,
    applied: recentWinnerIds.size > 0,
    reason: recentWinnerIds.size ? "recent_winners_found" : "no_recent_winners",
    recentWinnerIds,
    reducedCount,
  };
}

function lotteryTicketWeight(entry, protection) {
  if (!entry) return 0;
  const steamId = String(entry.steamId || "");
  const isRecentWinner = Boolean(protection?.recentWinnerIds?.has(steamId));
  return isRecentWinner ? Math.max(0, protection.recentWeight || 0) : Math.max(1, protection.normalWeight || 1);
}

function selectWeightedWinner(eligiblePlayers, protection) {
  const tickets = [];
  for (const entry of eligiblePlayers || []) {
    const weight = lotteryTicketWeight(entry, protection);
    for (let i = 0; i < weight; i += 1) tickets.push(entry);
  }

  if (!tickets.length) return randomChoice(eligiblePlayers);
  return randomChoice(tickets);
}

async function dmWinner(winner, code, pack) {
  const user = winner.member?.user;
  if (!user?.send) throw new Error("Discord user could not be messaged.");
  await user.send([
    "🎉 **YOU WON THE OUTPOST X LOTTERY!**",
    "",
    `You won: **${pack.name}**`,
    "",
    "Your one-time claim code is:",
    "",
    `**${code}**`,
    "",
    "Enter this code in SCUM chat to claim your pack.",
    "",
    "This code belongs only to your linked SCUM account and cannot be transferred or reused.",
    "",
    "The contents of your pack will remain a mystery until it is claimed.",
    "",
    "— The Watcher",
  ].join("\n"));
}

async function fetchFirstAvailableChannel(bot, channelIds) {
  for (const channelId of channelIds || []) {
    const channel = await bot.channels.fetch(String(channelId)).catch(() => null);
    if (channel?.send) return channel;
  }
  return null;
}

async function postLotterySetupChannel(bot, config, text) {
  const channel = config?.channelId ? await bot.channels.fetch(config.channelId).catch(() => null) : null;
  if (channel?.send) return await channel.send(text).catch(() => null);
  return null;
}

async function postLotteryLogChannel(bot, config, text) {
  let channel = config?.logChannelId ? await bot.channels.fetch(config.logChannelId).catch(() => null) : null;
  if (!channel?.send) channel = await fetchFirstAvailableChannel(bot, Array.from(adminChannelIds()));
  if (channel?.send) return await channel.send(text).catch(() => null);
  return null;
}

async function runLotteryDraw(bot, config, options = {}) {
  if (!config?.enabled && !options.manual) return { ran: false, reason: "Lottery is disabled." };
  const guildId = String(config?.guildId || options.guildId || "");
  if (!guildId) throw new Error("Lottery guild is not configured.");
  const now = currentToronto();
  const drawKey = options.manual ? `manual:${now.toFormat("yyyy-MM-dd-HH-mm-ss")}:${crypto.randomBytes(3).toString("hex")}` : options.drawKey;
  const scheduledFor = options.scheduledFor || now.set({ minute: 45, second: 0, millisecond: 0 }).toISO();

  const draw = await createDrawRecord({ guildId, drawKey, scheduledFor, channelId: config.logChannelId || "" });
  if (!draw) return { ran: false, reason: "Draw already processed." };

  try {
    const pool = await buildEligiblePlayers(bot, guildId);
    const eligibleSteamIds = pool.eligible.map((entry) => entry.steamId);
    await updateDraw(draw.id, { eligible_count: pool.eligible.length, eligible_steam_ids: eligibleSteamIds });

    if (pool.eligible.length === 0) {
      await updateDraw(draw.id, { status: "no_eligible", claim_status: "none" });
      const message = "🎟️ The Outpost X Lottery ended with no eligible players online. Better luck next hour!";
      await sendGameMessage(message).catch(() => {});
      await postLotteryLogChannel(bot, config, [
        "🎟️ **Outpost X Lottery**",
        "No eligible registered players were online for this draw.",
        "Better luck next hour.",
      ].join("\n"));
      return { ran: true, status: "no_eligible", eligibleCount: 0 };
    }

    const protection = await buildRecentWinnerProtection(guildId, pool.eligible);
    const remaining = pool.eligible.slice();
    while (remaining.length) {
      const winner = selectWeightedWinner(remaining, protection);
      const winnerIndex = remaining.findIndex((entry) => String(entry.steamId) === String(winner?.steamId));
      if (winnerIndex >= 0) remaining.splice(winnerIndex, 1);
      const pack = randomChoice(LOTTERY_PACKS);
      const code = generateClaimCode();
      const expiresAt = DateTime.now().plus({ hours: CLAIM_EXPIRY_HOURS }).toISO();
      const codeRow = await createCodeRecord({ guildId, drawId: draw.id, code, winner, pack, expiresAt });

      try {
        await dmWinner(winner, code, pack);
        await updateCode(codeRow.id, { dm_sent_at: new Date().toISOString(), dm_status: "sent" });
        await updateDraw(draw.id, {
          status: "completed",
          selected_discord_id: String(winner.link.discord_id),
          selected_steam_id: String(winner.steamId),
          selected_scum_name: winner.scumName,
          selected_pack_id: pack.id,
          selected_pack_name: pack.name,
          code_id: codeRow.id,
          dm_status: "sent",
          claim_status: "active",
        });

        const gameAnnouncement = `🎉 LOTTERY WINNER: ${winner.scumName}! You won ${pack.name}! A one-time claim code has been sent through Discord. Enter it in SCUM chat to discover your questionable reward.`;
        await sendGameMessage(gameAnnouncement).catch(() => {});
        await postLotteryLogChannel(bot, config, [
          "🎉 **OUTPOST X LOTTERY WINNER**",
          "",
          `Winner: **${winner.scumName}**`,
          `Discord: <@${winner.link.discord_id}>`,
          `Pack Won: **${pack.name}**`,
          `Eligible Players: **${pool.eligible.length}**`,
          protection.applied
            ? `Recent Winner Protection: **${protection.reducedCount}** player(s) reduced (${protection.hours}h window, ${protection.normalWeight}:1 tickets)`
            : `Recent Winner Protection: not applied (${protection.reason})`,
          "",
          "A one-time claim code has been sent through Discord.",
          "The winner must enter the code in SCUM chat to claim the mystery pack.",
        ].join("\n"));
        return { ran: true, status: "completed", winner: winner.scumName, pack: pack.name };
      } catch (dmErr) {
        await updateCode(codeRow.id, {
          status: "dm_failed",
          dm_status: "failed",
          dm_error: String(dmErr?.message || dmErr),
          cancelled_at: new Date().toISOString(),
        });
        await postLotteryLogChannel(bot, config, [
          "⚠️ **Lottery DM failed**",
          `Player: **${winner.scumName}**`,
          `Discord: <@${winner.link.discord_id}>`,
          "Watcher could not DM this player, so they were skipped for this draw.",
          remaining.length ? "Trying another eligible player." : "No other eligible players remain.",
        ].join("\n"));
      }
    }

    await updateDraw(draw.id, { status: "dm_failed", dm_status: "failed", claim_status: "none" });
    await postLotteryLogChannel(bot, config, "⚠️ **Lottery ended:** eligible players were found, but Watcher could not DM any selected winner.");
    return { ran: true, status: "dm_failed" };
  } catch (err) {
    await updateDraw(draw.id, { status: "failed", error_info: { message: err.message, stack: err.stack?.slice(0, 1000) } }).catch(() => {});
    throw err;
  }
}

async function processLotteryWarning(bot, config) {
  if (!config?.enabled) return false;
  const slot = warningSlotForNow();
  if (!slot) return false;
  if (config.lastWarningKey === slot.key) return false;
  await sendGameMessage("🎟️ OUTPOST X LOTTERY IN 5 MINUTES! Registered players who are online at draw time are eligible. Good luck—you will probably need it.").catch(() => {});
  await saveConfig({ ...config, lastWarningKey: slot.key, lastWarningAt: new Date().toISOString() });
  return true;
}

async function processLotteryDraw(bot, config) {
  if (!config?.enabled) return false;
  const slot = drawSlotForNow();
  if (!slot) return false;
  await runLotteryDraw(bot, config, { drawKey: slot.key, scheduledFor: slot.scheduledFor });
  return true;
}

async function lotteryTick(bot) {
  if (lotteryTickRunning) return;
  lotteryTickRunning = true;
  try {
    const config = await loadConfig();
    if (!config?.enabled) return;
    await processLotteryWarning(bot, config);
    const fresh = await loadConfig();
    await processLotteryDraw(bot, fresh || config);
  } catch (err) {
    console.error("❌ Lottery schedule tick failed:", err.message);
  } finally {
    lotteryTickRunning = false;
  }
}

function startLotteryTimers(bot) {
  if (lotteryTimer) clearInterval(lotteryTimer);
  lotteryTimer = setInterval(() => lotteryTick(bot), TICK_SECONDS * 1000);
  lotteryTick(bot).catch(() => {});

  if (codeTimer) clearInterval(codeTimer);
  codeTimer = setInterval(() => scanLotteryClaimCodes(bot), CODE_SCAN_SECONDS * 1000);
  scanLotteryClaimCodes(bot).catch(() => {});
}

function stopLotteryTimers() {
  if (lotteryTimer) clearInterval(lotteryTimer);
  if (codeTimer) clearInterval(codeTimer);
  lotteryTimer = null;
  codeTimer = null;
}

function extractChatIdentity(line) {
  const text = String(line || "");
  const match = text.match(/'?(\d{15,20}):([^('\n]+)\((\d+)\)'?/);
  if (!match) return null;
  return { steamId: match[1], name: match[2].trim(), profileId: match[3] };
}

function extractCodesFromLine(line) {
  const text = String(line || "").toUpperCase();
  const matches = text.match(/\bOX-[A-Z0-9]{6}\b/g);
  return Array.from(new Set(matches || []));
}

async function fetchChatLogsSince(since) {
  const params = new URLSearchParams();
  params.set("since", String(Math.max(0, Number(since || 0))));
  params.set("sources", "chat");
  return await serverGet(`/logs?${params.toString()}`);
}

async function findCodeByInput(guildId, code) {
  const db = getSupabase();
  const { data, error } = await db
    .from(CODES_TABLE)
    .select("*")
    .eq("guild_id", String(guildId))
    .eq("code_hash", codeHash(guildId, code))
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function handleClaimAttempt(bot, config, identity, code, rawLine) {
  const guildId = String(config.guildId || "");
  const codeRow = await findCodeByInput(guildId, code);
  if (!codeRow) {
    await sendGameMessage("❌ That lottery code is invalid, expired, already used, or does not belong to you.", identity.steamId).catch(() => {});
    return false;
  }

  const nowIso = new Date().toISOString();
  const expired = codeRow.expires_at && Date.parse(codeRow.expires_at) < Date.now();
  if (expired && codeRow.status === "active") {
    await updateCode(codeRow.id, { status: "expired" }).catch(() => {});
  }

  if (expired || codeRow.status !== "active" || String(codeRow.steam_id) !== String(identity.steamId)) {
    await sendGameMessage("❌ That lottery code is invalid, expired, already used, or does not belong to you.", identity.steamId).catch(() => {});
    return false;
  }

  await updateCode(codeRow.id, {
    status: "used_processing",
    used_at: nowIso,
    claimed_by_steam_id: identity.steamId,
    claimed_by_name: identity.name,
    claim_line: String(rawLine || "").slice(0, 1200),
  });

  try {
    const delivery = await deliverPack(identity.steamId, codeRow.pack_payload || LOTTERY_PACKS.find((pack) => pack.id === codeRow.pack_id));
    await updateCode(codeRow.id, {
      status: "used",
      delivery_status: "delivered",
      delivery_result: safeJson(delivery),
    });

    if (codeRow.draw_id) {
      await updateDraw(codeRow.draw_id, {
        claim_status: "claimed",
        claim_time: nowIso,
      }).catch(() => {});
    }

    await sendGameMessage("🎟️ Lottery code accepted! Your mystery pack has been delivered. The Watcher accepts no responsibility for disappointment.", identity.steamId).catch(() => {});
    await postLotteryLogChannel(bot, config, [
      "🎟️ **Lottery Pack Claimed**",
      `Player: **${identity.name || codeRow.scum_name || "Unknown"}**`,
      `Pack: **${codeRow.pack_name}**`,
      "Status: Delivered",
    ].join("\n"));
    return true;
  } catch (err) {
    await updateCode(codeRow.id, {
      status: "delivery_failed",
      delivery_status: "failed",
      delivery_error: String(err?.message || err),
    }).catch(() => {});
    await sendGameMessage("❌ Your lottery code was accepted, but delivery failed. Staff has been notified.", identity.steamId).catch(() => {});
    await postLotteryLogChannel(bot, config, [
      "⚠️ **Lottery Delivery Failed**",
      `Player: **${identity.name || codeRow.scum_name || "Unknown"}**`,
      `Pack: **${codeRow.pack_name}**`,
      `Error: ${err.message}`,
    ].join("\n"));
    return false;
  }
}

async function scanLotteryClaimCodes(bot) {
  if (codeScanRunning) return;
  codeScanRunning = true;
  try {
    const config = await loadConfig();
    if (!config?.enabled || !config.guildId) return;
    const since = Number(config.chatCursor || 0) || Math.max(0, Date.now() - (5 * 60 * 1000));
    const data = await fetchChatLogsSince(since).catch(() => null);
    const lines = Array.isArray(data?.lines) ? data.lines : [];
    let nextCursor = data?.next || lines.reduce((max, entry) => Math.max(max, Number(entry?.t || 0)), since) || Date.now();

    for (const entry of lines.slice().sort((a, b) => Number(a?.t || 0) - Number(b?.t || 0))) {
      const rawLine = String(entry?.line || "");
      const codes = extractCodesFromLine(rawLine);
      if (!codes.length) continue;
      const identity = extractChatIdentity(rawLine);
      if (!identity?.steamId) continue;
      for (const code of codes) {
        await handleClaimAttempt(bot, config, identity, code, rawLine).catch((err) => {
          console.error("❌ Lottery claim handling failed:", err.message);
        });
      }
    }

    await saveConfig({ ...config, chatCursor: nextCursor, chatCursorUpdatedAt: new Date().toISOString() });
  } catch (err) {
    console.error("❌ Lottery code scan failed:", err.message);
  } finally {
    codeScanRunning = false;
  }
}

function buildRegistrationAnnouncement() {
  return [
    "# 🎟️ OUTPOST X HOURLY LOTTERY",
    "",
    "The Outpost X Lottery is now active!",
    "",
    "A lottery draw takes place once every hour, 45 minutes after server restarts. One eligible player currently online will be randomly selected to receive one of 12 mystery lottery packs.",
    "",
    "Every pack has the exact same chance of being selected. One might contain a MAC-10 and ammunition. The others may contain something slightly less impressive—or deeply disappointing.",
    "",
    "## How to Enter",
    "",
    "Register through this channel to become eligible for future lottery draws.",
    "",
    "You must be:",
    "",
    "✅ Registered through the Welcome Pack system",
    "✅ Online in SCUM when the lottery takes place",
    "✅ Connected to your correct Steam64 ID",
    "✅ Able to receive DMs from The Watcher",
    "✅ A regular player without an Owner, Admin, or Trial Admin role",
    "",
    "The winner will receive a one-time-use claim code through Discord. Enter that code in SCUM chat to claim your mystery pack.",
    "",
    "Codes cannot be transferred or reused.",
    "",
    `Need to register? Use <#${REGISTER_CHANNEL_ID}>.`,
  ].join("\n");
}

function buildLotteryHelp() {
  return [
    "🎟️ **Lottery Commands**",
    "",
    "`!lotterysetup` — owner-only. Enable hourly lottery and post the player lottery info in this channel.",
    "`!lotterystatus` or `!lottery` — show status, player channel, admin log channel, next warning, and next draw.",
    "`!lotteryoff` — owner-only. Pause lottery without deleting history or unused codes.",
    "`!lotterydraw` — admin/owner. Run an extra one-off lottery right now using normal rules.",
    `Recent Winner Protection: last ${RECENT_WINNER_HOURS}h winners get ${LOTTERY_RECENT_WINNER_WEIGHT} ticket instead of ${LOTTERY_NORMAL_WEIGHT} when ${RECENT_WINNER_MIN_ELIGIBLE}+ players qualify.`,
  ].join("\n");
}

async function handleLotteryStatus(message, config) {
  const next = nextLotteryTimes();
  const roleIdCount = configuredStaffRoleIds().length;
  await message.reply([
    "🎟️ **Outpost X Lottery Status**",
    `Status: **${config?.enabled ? "Enabled" : "Disabled"}**`,
    `Player Info Channel: ${config?.channelId ? `<#${config.channelId}>` : "Not set"}`,
    `Admin Log Channel: ${config?.logChannelId ? `<#${config.logChannelId}>` : "Not set — run !lotterylogsetup in the hidden admin log channel"}`,
    `Next Warning: ${next.warning.toFormat("yyyy-MM-dd h:mm a")} Toronto`,
    `Next Draw: ${next.draw.toFormat("yyyy-MM-dd h:mm a")} Toronto`,
    `Code Expiration: ${CLAIM_EXPIRY_HOURS} hour(s)`,
    `Recent Winner Protection: ${RECENT_WINNER_HOURS ? `${RECENT_WINNER_HOURS}h window, normal ${LOTTERY_NORMAL_WEIGHT} ticket(s), recent ${LOTTERY_RECENT_WINNER_WEIGHT} ticket(s), min ${RECENT_WINNER_MIN_ELIGIBLE} eligible` : "Disabled"}`,
    `Staff Exclusion: ${roleIdCount ? `${roleIdCount} configured role ID(s)` : "role-name fallback active"}`,
    `Timers: ${lotteryTimer ? "running" : "not running"}`,
  ].join("\n")).catch(() => {});
}

async function handleLotteryOn(message, bot, existing) {
  const config = {
    ...(existing || {}),
    enabled: true,
    guildId: message.guild.id,
    channelId: message.channel.id,
    setBy: message.author.id,
    setAt: new Date().toISOString(),
    chatCursor: existing?.chatCursor || Math.max(0, Date.now() - (2 * 60 * 1000)),
  };
  await saveConfig(config);
  startLotteryTimers(bot);
  await message.reply([
    "🎟️ **Outpost X Hourly Lottery enabled.**",
    `Player lottery info channel saved as: <#${message.channel.id}>`,
    config.logChannelId ? `Winner/admin log channel: <#${config.logChannelId}>` : "Run `!lotterylogsetup` in the hidden admin log channel before winners start posting.",
    "Draws run every hour at :45. In-game warning posts at :40.",
  ].join("\n")).catch(() => {});
}

async function handleLotteryLogSetup(message, bot, existing) {
  const config = {
    ...(existing || {}),
    guildId: existing?.guildId || message.guild.id,
    logChannelId: message.channel.id,
    logSetBy: message.author.id,
    logSetAt: new Date().toISOString(),
  };
  await saveConfig(config);
  await message.reply([
    "🎟️ **Lottery admin log channel saved.**",
    `Winner, claim, DM failure, and draw summary posts will go to: <#${message.channel.id}>`,
    config.channelId ? `Player lottery info channel remains: <#${config.channelId}>` : "Player lottery info channel is not set yet. Run `!lotterysetup` in the public lottery/register channel.",
  ].join("\n")).catch(() => {});
}

async function handleLotteryOff(message, existing) {
  const config = { ...(existing || {}), enabled: false, disabledBy: message.author.id, disabledAt: new Date().toISOString() };
  await saveConfig(config);
  stopLotteryTimers();
  await message.reply("🎟️ Hourly lottery is now paused. Registrations, history, and unused codes were not deleted.").catch(() => {});
}

async function handleLotteryEligible(message, bot, config) {
  const guildId = config?.guildId || message.guild.id;
  const pool = await buildEligiblePlayers(bot, guildId);
  const lines = [
    "🎟️ **Current Lottery Eligibility**",
    `Eligible: ${pool.eligible.length}`,
    `Online players checked: ${pool.onlinePlayers.length}`,
    "",
    pool.eligible.length
      ? pool.eligible.map((entry, index) => `${index + 1}. ${entry.scumName} — <@${entry.link.discord_id}>`).join("\n")
      : "No eligible registered players are online right now.",
    "",
    `Rejected/skipped: ${pool.rejected.length}`,
  ];
  await message.author.send(lines.join("\n")).then(async () => {
    await message.react("✅").catch(() => {});
  }).catch(async () => {
    await message.reply(lines.join("\n")).catch(() => {});
  });
}

async function handleLotteryHistory(message) {
  const db = getSupabase();
  const { data, error } = await db
    .from(DRAWS_TABLE)
    .select("draw_key, actual_run_at, status, selected_scum_name, selected_pack_name, dm_status, claim_status, claim_time")
    .eq("guild_id", String(message.guild.id))
    .order("actual_run_at", { ascending: false })
    .limit(10);
  if (error) throw error;

  const rows = (data || []).map((row, index) => {
    const winner = row.selected_scum_name || "No winner";
    const pack = row.selected_pack_name || "None";
    return `${index + 1}. **${winner}** — ${pack}\nStatus: ${row.status || "unknown"} | DM: ${row.dm_status || "n/a"} | Claim: ${row.claim_status || "n/a"}\nTime: ${row.actual_run_at ? formatDate(row.actual_run_at) : "Unknown"}`;
  });

  await message.reply([
    "🎟️ **Recent Lottery History**",
    "",
    rows.length ? rows.join("\n\n") : "No lottery draws saved yet.",
  ].join("\n")).catch(() => {});
}

async function findPlayerLinkForQuery(guildId, query) {
  const raw = String(query || "").trim();
  const mention = raw.match(/^<@!?(\d+)>$/)?.[1];
  const clean = raw.toLowerCase();
  const db = getSupabase();
  const { data, error } = await db.from(PLAYER_LINKS_TABLE).select("*").eq("guild_id", String(guildId)).limit(ONLINE_LINK_LIMIT);
  if (error) throw error;
  const links = Array.isArray(data) ? data : [];
  return links.find((link) => {
    if (mention && String(link.discord_id) === mention) return true;
    if (raw && String(link.steam_id || "") === raw) return true;
    const fields = [link.scum_name, link.discord_tag, link.discord_id, link.steam_id].filter(Boolean).map((v) => String(v).toLowerCase());
    return fields.some((field) => field.includes(clean));
  }) || null;
}

async function handleLotteryPlayer(message, query) {
  if (!query) {
    await message.reply("Use: `!lottery player <name/@user/SteamID>`").catch(() => {});
    return;
  }

  const link = await findPlayerLinkForQuery(message.guild.id, query);
  if (!link) {
    await message.reply(`No registered lottery/player link found for **${query}**.`).catch(() => {});
    return;
  }

  const db = getSupabase();
  const { data: codes, error } = await db
    .from(CODES_TABLE)
    .select("code_hint, pack_name, status, expires_at, used_at, created_at, dm_status")
    .eq("guild_id", String(message.guild.id))
    .eq("steam_id", String(link.steam_id || ""))
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) throw error;

  const snapshot = link.steam_id ? await fetchSnapshot(link.steam_id).catch(() => null) : null;
  const codeRows = (codes || []).map((code, index) => `${index + 1}. ${code.code_hint || "Hidden"} — ${code.pack_name || "Unknown Pack"} — ${code.status || "unknown"} — DM: ${code.dm_status || "n/a"}`).join("\n");

  await message.reply([
    "🎟️ **Lottery Player Status**",
    `Player: **${link.scum_name || snapshot?.character_name || "Unknown"}**`,
    `Discord: <@${link.discord_id}>`,
    `Registration: ${link.steam_id ? "Linked" : "Not linked"}`,
    snapshot?.last_seen_online_at ? `Last Seen: ${formatDate(snapshot.last_seen_online_at)}` : null,
    "",
    "**Recent Codes**",
    codeRows || "No lottery codes found for this player.",
    "",
    "Actual code text is never shown here.",
  ].filter(Boolean).join("\n")).catch(() => {});
}

async function handleLotteryCancel(message, code) {
  const clean = normalizeCode(code);
  if (!/^OX-[A-Z0-9]{6}$/.test(clean)) {
    await message.reply("Use: `!lottery cancel OX-ABC123`").catch(() => {});
    return;
  }
  const row = await findCodeByInput(message.guild.id, clean);
  if (!row) {
    await message.reply("No matching lottery code was found.").catch(() => {});
    return;
  }
  if (row.status !== "active") {
    await message.reply(`That code is already **${row.status}**.`).catch(() => {});
    return;
  }
  await updateCode(row.id, {
    status: "cancelled",
    cancelled_at: new Date().toISOString(),
    cancelled_by_discord_id: String(message.author.id),
  });
  await message.reply(`Lottery code ${row.code_hint || "hidden"} was cancelled.`).catch(() => {});
}

async function handleLotteryCommand(message, bot) {
  if (!message.guild || !message.content) return false;

  const parts = message.content.trim().split(/\s+/);
  const command = String(parts.shift() || "").toLowerCase();

  let action = null;
  if (command === "!lottery" || command === "!lotterystatus") action = "status";
  else if (command === "!lotterysetup") action = "setup";
  else if (command === "!lotterylogsetup") action = "logsetup";
  else if (command === "!lotteryoff") action = "off";
  else if (command === "!lotterydraw") action = "draw";
  else return false;

  const config = await loadConfig().catch(() => null);

  const ownerOnly = new Set(["setup", "logsetup", "off"]);
  if (ownerOnly.has(action) && !isOwnerMember(message.member)) {
    await message.reply("The Watcher sees the request. Lottery setup controls are owner-only.").catch(() => {});
    return true;
  }

  if (action === "draw" && !isLotteryManagerMember(message.member)) {
    await message.reply("The Watcher sees the request. Extra lottery draws are for Owner/Admin only.").catch(() => {});
    return true;
  }

  if (action === "status" && !isOwnerMember(message.member) && !hasAnyRoleName(message.member, STAFF_ROLE_NAME_FALLBACK) && !hasAnyRoleId(message.member, configuredStaffRoleIds())) {
    await message.reply("The Watcher sees the request. Lottery status is for staff only.").catch(() => {});
    return true;
  }

  // Lottery commands are protected by Discord role checks above.
  // Do not block valid Owner/Admin commands just because the admin channel ID was not configured.

  try {
    if (action === "status") {
      await handleLotteryStatus(message, config);
    } else if (action === "setup") {
      await handleLotteryOn(message, bot, config);
      await message.channel.send(buildRegistrationAnnouncement()).catch(() => {});
    } else if (action === "logsetup") {
      await handleLotteryLogSetup(message, bot, config);
    } else if (action === "off") {
      await handleLotteryOff(message, config);
    } else if (action === "draw") {
      const active = { ...(config || {}), enabled: true, guildId: config?.guildId || message.guild.id, channelId: config?.channelId || message.channel.id, logChannelId: config?.logChannelId || message.channel.id };
      const result = await runLotteryDraw(bot, active, { manual: true, guildId: message.guild.id });
      await message.reply(`Extra lottery draw complete: ${result.status || result.reason || "done"}.`).catch(() => {});
    }
  } catch (err) {
    console.error("❌ Lottery command failed:", err);
    await message.reply(`Lottery error: ${err.message}`).catch(() => {});
  }

  return true;
}

async function startLotteryOnBoot(bot) {
  const config = await loadConfig().catch((err) => {
    console.error("❌ Lottery startup read failed:", err.message);
    return null;
  });
  if (!config?.enabled) return;
  startLotteryTimers(bot);
  await postLotteryLogChannel(bot, config, "🎟️ Lottery scheduler is online. Hourly draws remain active.").catch(() => {});
}

module.exports = {
  handleLotteryCommand,
  startLotteryOnBoot,
};
