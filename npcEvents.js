const { createClient } = require("@supabase/supabase-js");

const DEFAULT_SERVER_BASE_URL = "https://ggcon.gghost.games/s/2788404";
const RUNTIME_STATE_TABLE = process.env.WATCHER_RUNTIME_STATE_TABLE || "watcher_runtime_state";
const STAFF_ROLE_NAMES = new Set(["Owner", "Owners", "Admin", "Trial Admin"]);

const ANCHOR_STEAM_ID = process.env.WATCHER_NPC_ANCHOR_STEAM_ID || "76561198108396598";
const DEFAULT_RADIUS = Number(process.env.WATCHER_NPC_EVENT_RADIUS || "30000");
const TEST_CLEANUP_MINUTES = Number(process.env.WATCHER_NPC_TEST_CLEANUP_MINUTES || "10");
const EVENT_DURATION_MINUTES = Number(process.env.WATCHER_NPC_EVENT_DURATION_MINUTES || "60");
const REFRESH_MINUTES = Number(process.env.WATCHER_NPC_EVENT_REFRESH_MINUTES || "15");
const RESTART_SAFETY_MINUTES = Number(process.env.WATCHER_NPC_RESTART_SAFETY_MINUTES || "75");
const NPC_COUNT = Number(process.env.WATCHER_NPC_EVENT_NPC_COUNT || "12");
const PRESENTS_PER_SESSION = Number(process.env.WATCHER_NPC_PRESENTS_PER_SESSION || "2");
const TIMEZONE = process.env.WATCHER_NPC_TIMEZONE || "America/Toronto";
const RESTART_HOURS = String(process.env.WATCHER_NPC_RESTART_HOURS || "0,4,8,12,16,20")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value) && value >= 0 && value <= 23);

const AREA_STATE_KEY = "npc_event_areas";
const ACTIVE_STATE_KEY = "npc_event_active";

const NPC_ALIASES = {
  lvl2: [
    "BP_Drifter_Lvl_2",
    "BP_Drifter_Level_2",
    "BP_ArmedNPC_Lvl_2",
    "BP_ArmedNPC_Level_2",
    "BP_ArmedNPC_Soldier_Lvl_2",
    "BP_ArmedNPC_Soldier_02",
    "Lvl_2",
    "Level_2",
  ],
  lvl3: [
    "BP_Drifter_Lvl_3",
    "BP_Drifter_Level_3",
    "BP_ArmedNPC_Lvl_3",
    "BP_ArmedNPC_Level_3",
    "BP_ArmedNPC_Soldier_Lvl_3",
    "BP_ArmedNPC_Soldier_03",
    "Lvl_3",
    "Level_3",
  ],
};

const PRESENT_ALIASES = [
  "Christmas_Present",
  "ChristmasPresent",
  "Christmas_Gift",
  "Holiday_Present",
  "Present",
  "Gift",
  "Item_Present",
  "BP_Present",
  "Loot_Present",
  "Random_Present",
];

const BANNED_LOOT_TERMS = ["m82", "m249", "50bmg", "50_bmg", "cal50", "gold_katana", "golden_katana"];

let supabase;
let activeTimer = null;
let activeRunLock = false;
let cachedNpcCatalog = null;
let cachedNpcAt = 0;
let cachedItems = null;
let cachedItemsAt = 0;

function getSupabase() {
  if (!supabase) {
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, {
      auth: { persistSession: false },
    });
  }
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
  if (!res.ok || data?.ok === false) throw new Error(data?.message || data?.reason || data?.error || `Server GET failed: ${res.status}`);
  return data;
}

async function serverPost(path, body) {
  const res = await fetch(`${serverBaseUrl()}${path}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Password": serverPassword(),
    },
    body: JSON.stringify(body || {}),
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok || data?.ok === false || data?.accepted === false) throw new Error(data?.message || data?.reason || data?.error || `Server POST failed: ${res.status}`);
  return data || { ok: true };
}

async function serverPostRaw(path, body) {
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
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    return { ok: res.ok && data?.ok !== false && data?.accepted !== false, status: res.status, data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
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

async function clearRuntimeValue(key) {
  const db = getSupabase();
  const { error } = await db.from(RUNTIME_STATE_TABLE).delete().eq("key", key);
  if (error) throw error;
}

function isStaff(message) {
  return Boolean(message?.member?.roles?.cache?.some((role) => STAFF_ROLE_NAMES.has(role.name)));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "")
    .slice(0, 40);
}

function formatLocation(location) {
  if (!location) return "Unknown";
  const x = Number(location.x);
  const y = Number(location.y);
  const z = Number(location.z);
  return `X=${Math.round(x)} Y=${Math.round(y)} Z=${Math.round(z)}`;
}

function locationFromPlayer(player) {
  const loc = player?.location || player?.position || null;
  if (!loc) return null;
  const x = Number(loc.x ?? loc.X);
  const y = Number(loc.y ?? loc.Y);
  const z = Number(loc.z ?? loc.Z);
  if (![x, y, z].every(Number.isFinite)) return null;
  return { x, y, z };
}

function displayPlayer(player) {
  return String(player?.characterName || player?.steamName || player?.realName || player?.fakeName || player?.name || player?.userId || "Unknown").trim();
}

async function getOnlinePlayers() {
  const data = await serverGet("/players.json").catch(() => ({ players: [] }));
  return Array.isArray(data.players) ? data.players : [];
}

async function requireAnyPlayersOnline() {
  const players = await getOnlinePlayers();
  if (!players.length) throw new Error("No players are online. NPC events do not start or refresh on an empty server.");
  return players;
}

async function getAnchorPlayer() {
  const online = await getOnlinePlayers();
  const match = online.find((player) => String(player.userId || player.steamId || "") === String(ANCHOR_STEAM_ID));
  if (match) return { ...match, userId: ANCHOR_STEAM_ID };

  const data = await serverGet(`/players/${encodeURIComponent(ANCHOR_STEAM_ID)}.json`).catch(() => null);
  const player = data?.player || data;
  const location = locationFromPlayer(player);
  if (!player || !location) throw new Error(`Event anchor ${ANCHOR_STEAM_ID} is not online or has no readable location.`);
  return { ...player, userId: ANCHOR_STEAM_ID };
}

async function loadAreas() {
  const areas = await loadRuntimeValue(AREA_STATE_KEY);
  return areas && typeof areas === "object" ? areas : {};
}

async function saveAreas(areas) {
  await saveRuntimeValue(AREA_STATE_KEY, areas || {});
}

function normalizeForSearch(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

async function getNpcCatalog() {
  if (cachedNpcCatalog && Date.now() - cachedNpcAt < 10 * 60 * 1000) return cachedNpcCatalog;
  const data = await serverGet("/armed-npcs.json");
  cachedNpcCatalog = Array.isArray(data?.items) ? data.items : [];
  cachedNpcAt = Date.now();
  return cachedNpcCatalog;
}

async function getItemCatalog() {
  if (cachedItems && Date.now() - cachedItemsAt < 10 * 60 * 1000) return cachedItems;
  const data = await serverGet("/items.json");
  cachedItems = Array.isArray(data?.items) ? data.items : [];
  cachedItemsAt = Date.now();
  return cachedItems;
}

function itemClass(item) {
  return String(item?.i || item?.itemClass || item?.class || "");
}

function itemName(item) {
  return String(item?.dn || item?.name || item?.displayName || itemClass(item));
}

function isBannedLootText(value) {
  const clean = normalizeForSearch(value);
  return BANNED_LOOT_TERMS.some((term) => clean.includes(normalizeForSearch(term)));
}

function scoreAliasCandidate(candidateText, aliases) {
  const text = normalizeForSearch(candidateText);
  let score = 0;
  for (const alias of aliases) {
    const a = normalizeForSearch(alias);
    if (!a) continue;
    if (text === a) score = Math.max(score, 3000);
    else if (text.includes(a)) score = Math.max(score, 1800);
    else if (a.includes(text) && text.length >= 4) score = Math.max(score, 800);
  }
  return score;
}

async function resolveNpcClass(levelKey) {
  const aliases = NPC_ALIASES[levelKey] || [];
  const catalog = await getNpcCatalog().catch(() => []);
  const best = catalog
    .map((npc) => {
      const cls = itemClass(npc);
      return { cls, score: scoreAliasCandidate(cls, aliases) };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.cls.localeCompare(b.cls))[0];

  if (best?.cls) return { entity: best.cls, matched: true };
  return { entity: levelKey === "lvl3" ? "BP_Drifter_Lvl_3" : "BP_Drifter_Lvl_2", matched: false };
}

async function resolvePresentItem() {
  const catalog = await getItemCatalog().catch(() => []);
  const best = catalog
    .map((item) => {
      const cls = itemClass(item);
      const name = itemName(item);
      const combined = `${cls} ${name}`;
      if (isBannedLootText(combined)) return { item, score: 0 };
      return { item, score: Math.max(scoreAliasCandidate(cls, PRESENT_ALIASES), scoreAliasCandidate(name, PRESENT_ALIASES)) };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || itemClass(a.item).localeCompare(itemClass(b.item)))[0]?.item;

  if (!best) return null;
  return { item: itemClass(best), displayName: itemName(best), matched: true };
}

async function teleportAnchor(location) {
  await serverPost(`/players/${encodeURIComponent(ANCHOR_STEAM_ID)}/teleport`, {
    x: Number(location.x),
    y: Number(location.y),
    z: Number(location.z),
  });
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function distance2d(a, b) {
  const dx = Number(a.x) - Number(b.x);
  const dy = Number(a.y) - Number(b.y);
  return Math.sqrt(dx * dx + dy * dy);
}

function makeRandomPoint(area, radius) {
  const angle = randomBetween(0, Math.PI * 2);
  const distance = Math.sqrt(Math.random()) * radius;
  return {
    x: Number(area.center.x) + Math.cos(angle) * distance,
    y: Number(area.center.y) + Math.sin(angle) * distance,
    z: Number(area.center.z),
  };
}

function generateSpreadPoints(area, count, radius) {
  const points = [];
  const minSpacing = Math.max(4500, Math.min(12000, radius / 4));
  let attempts = 0;

  while (points.length < count && attempts < 250) {
    attempts += 1;
    const point = makeRandomPoint(area, radius);
    if (points.every((existing) => distance2d(existing, point) >= minSpacing)) points.push(point);
  }

  while (points.length < count) {
    points.push(makeRandomPoint(area, radius));
  }

  return points;
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function getEasternParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

function minutesUntilNextRestart() {
  const now = new Date();
  const p = getEasternParts(now);
  const nowMinutes = p.hour * 60 + p.minute + p.second / 60;
  const restartMinutes = RESTART_HOURS.map((h) => h * 60).sort((a, b) => a - b);
  for (const minute of restartMinutes) {
    if (minute > nowMinutes) return Math.round(minute - nowMinutes);
  }
  return Math.round(24 * 60 - nowMinutes + restartMinutes[0]);
}

function formatTimeLeft(ms) {
  const total = Math.max(0, Math.ceil(ms / 60000));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

async function cleanupArmedNpcsNearArea(area, radius) {
  const before = await getAnchorPlayer();
  const original = locationFromPlayer(before);
  const commands = [];
  let cleanupOk = false;

  try {
    await teleportAnchor(area.center);
    await sleep(1500);

    const cleanupRadius = Math.max(5000, Math.round(radius || DEFAULT_RADIUS));
    const candidates = [
      `#ExecAs ${ANCHOR_STEAM_ID} #DestroyArmedNPCsWithinRadius ${cleanupRadius}`,
      `#ExecAs ${ANCHOR_STEAM_ID} #DestroyNPCsWithinRadius ${cleanupRadius}`,
    ];

    for (const command of candidates) {
      const raw = await serverPostRaw("/command", { command });
      commands.push({ command, ok: raw.ok, message: raw.data?.message || raw.data?.raw || raw.error || "sent" });
      if (raw.ok) {
        cleanupOk = true;
        break;
      }
    }
  } finally {
    if (original) {
      await teleportAnchor(original).catch(() => {});
    }
  }

  return { cleanupOk, commands };
}

async function spawnSession(area, options = {}) {
  const testMode = Boolean(options.testMode);
  const npcCount = testMode ? 2 : Math.max(1, Math.min(30, NPC_COUNT));
  const presentCount = Math.max(0, Math.min(2, PRESENTS_PER_SESSION));
  const radius = testMode ? Math.min(Number(area.radius || DEFAULT_RADIUS), 1) : Math.max(1, Number(area.radius || DEFAULT_RADIUS));

  await requireAnyPlayersOnline();
  const anchor = await getAnchorPlayer();
  const original = locationFromPlayer(anchor);
  if (!original) throw new Error("Event anchor location could not be read.");

  const [lvl2, lvl3, present] = await Promise.all([
    resolveNpcClass("lvl2"),
    resolveNpcClass("lvl3"),
    resolvePresentItem(),
  ]);

  const lvl3Count = testMode ? 1 : Math.max(1, Math.round(npcCount / 3));
  const npcClasses = shuffle([
    ...Array(Math.max(0, npcCount - lvl3Count)).fill(lvl2.entity),
    ...Array(lvl3Count).fill(lvl3.entity),
  ]).slice(0, npcCount);

  const spawnPoints = testMode
    ? Array(npcClasses.length).fill(area.center)
    : generateSpreadPoints(area, npcClasses.length, Number(area.radius || DEFAULT_RADIUS));

  const presentPoints = testMode
    ? Array(presentCount).fill(area.center)
    : shuffle(generateSpreadPoints(area, presentCount, Number(area.radius || DEFAULT_RADIUS))).slice(0, presentCount);

  const results = [];

  try {
    for (let i = 0; i < npcClasses.length; i += 1) {
      const point = spawnPoints[i] || area.center;
      await teleportAnchor(point);
      await sleep(1200);
      const raw = await serverPost("/spawn-entity", {
        steamId: String(ANCHOR_STEAM_ID),
        verb: "SpawnArmedNPC",
        entity: npcClasses[i],
      });
      results.push({ type: "npc", ok: true, entity: npcClasses[i], point, raw });
      await sleep(900);
    }

    if (present?.item) {
      for (const point of presentPoints) {
        await teleportAnchor(point);
        await sleep(1200);
        const raw = await serverPost("/spawn", {
          steamId: String(ANCHOR_STEAM_ID),
          item: present.item,
          qty: 1,
        });
        results.push({ type: "present", ok: true, item: present.item, point, raw });
        await sleep(900);
      }
    }
  } finally {
    await teleportAnchor(original).catch(() => {});
  }

  return {
    anchorName: displayPlayer(anchor),
    original,
    lvl2,
    lvl3,
    present,
    npcSpawned: results.filter((r) => r.type === "npc").length,
    presentsSpawned: results.filter((r) => r.type === "present").length,
    results,
  };
}

async function handleNpcArea(message, args) {
  const key = cleanKey(args.shift());
  const displayName = args.join(" ").trim();

  if (!key || !displayName) {
    await message.reply("Use: `!npcarea <shortname> <Display Name>`\nExample: `!npcarea southquarry South Quarry A3`").catch(() => {});
    return;
  }

  await requireAnyPlayersOnline();
  const anchor = await getAnchorPlayer();
  const center = locationFromPlayer(anchor);
  if (!center) throw new Error("I could not read your current SCUM location.");

  const areas = await loadAreas();
  areas[key] = {
    key,
    displayName,
    center,
    radius: Math.max(1000, Number.isFinite(DEFAULT_RADIUS) ? DEFAULT_RADIUS : 30000),
    anchorSteamId: ANCHOR_STEAM_ID,
    createdBy: message.author.id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await saveAreas(areas);

  await message.reply([
    "✅ **NPC Event Area Saved**",
    `Key: \`${key}\``,
    `Name: **${displayName}**`,
    `Center: ${formatLocation(center)}`,
    `Anchor: **${displayPlayer(anchor)}**`,
    "",
    "Next test command:",
    `\`!npctest ${key}\``,
  ].join("\n")).catch(() => {});
}

async function handleNpcAreas(message) {
  const areas = await loadAreas();
  const rows = Object.values(areas);
  if (!rows.length) {
    await message.reply("No NPC event areas saved yet. Use `!npcarea southquarry South Quarry A3` while standing in the area.").catch(() => {});
    return;
  }

  await message.reply([
    "🎁 **Saved NPC Event Areas**",
    "",
    ...rows.map((area, index) => `${index + 1}. \`${area.key}\` — **${area.displayName}** — ${formatLocation(area.center)}`),
  ].join("\n")).catch(() => {});
}

async function handleNpcTest(message, args, bot) {
  const key = cleanKey(args[0]);
  if (!key) {
    await message.reply("Use: `!npctest <shortname>`\nExample: `!npctest southquarry`").catch(() => {});
    return;
  }

  const areas = await loadAreas();
  const area = areas[key];
  if (!area) {
    await message.reply(`No NPC event area found for \`${key}\`. Save it first with \`!npcarea ${key} Display Name\`.`).catch(() => {});
    return;
  }

  const progress = await message.reply([
    `🧪 **NPC Loot Event Test Starting: ${area.displayName}**`,
    "Spawning 2 NPCs and max 2 presents.",
    "Your anchor character may teleport for a few seconds and then return.",
  ].join("\n")).catch(() => null);

  const result = await spawnSession(area, { testMode: true });

  await progress?.edit?.([
    `✅ **NPC Loot Event Test Spawned: ${area.displayName}**`,
    `NPCs: **${result.npcSpawned}**`,
    `Presents: **${result.presentsSpawned}**`,
    `Level 2 NPC: \`${result.lvl2.entity}\`${result.lvl2.matched ? "" : " (fallback)"}`,
    `Level 3 NPC: \`${result.lvl3.entity}\`${result.lvl3.matched ? "" : " (fallback)"}`,
    `Present item: ${result.present?.item ? `\`${result.present.item}\`` : "Not found — no presents spawned"}`,
    "",
    `Auto-cleanup attempt in **${TEST_CLEANUP_MINUTES} minutes** for NPCs near this area.`,
    "Presents are limited to max 2 per session. Watcher cannot safely delete individual collected/uncollected world items yet.",
  ].join("\n")).catch(() => {});

  setTimeout(async () => {
    try {
      const cleanup = await cleanupArmedNpcsNearArea(area, Number(area.radius || DEFAULT_RADIUS));
      const ch = await bot.channels.fetch(message.channel.id).catch(() => null);
      await ch?.send(cleanup.cleanupOk
        ? `🧹 NPC test cleanup attempted for **${area.displayName}**.`
        : `⚠️ NPC test cleanup command was not confirmed for **${area.displayName}**. Use \`!npcstop\` or clean manually if needed.`
      ).catch(() => {});
    } catch (err) {
      const ch = await bot.channels.fetch(message.channel.id).catch(() => null);
      await ch?.send(`⚠️ NPC test cleanup failed for **${area.displayName}**: ${err.message}`).catch(() => {});
    }
  }, Math.max(1, TEST_CLEANUP_MINUTES) * 60 * 1000);
}

function buildEventAnnouncement(area, testMode = false) {
  return [
    testMode ? "🧪 **NPC Loot Event Test**" : "🎁 **NPC Loot Event Active**",
    "",
    `Armed NPCs have been spotted at **${area.displayName}**.`,
    "Loot presents are scattered through the area.",
    testMode ? "This is a short staff test." : `The event will stay active for about **${EVENT_DURATION_MINUTES} minutes**.`,
    "",
    "No promises. No mercy. Bring ammo.",
  ].join("\n");
}

async function refreshActiveEvent(bot, active, reason = "refresh") {
  if (activeRunLock) return;
  activeRunLock = true;

  try {
    const now = Date.now();
    if (now >= active.endsAt) {
      await stopActiveEvent(bot, "ended");
      return;
    }

    const areas = await loadAreas();
    const area = areas[active.key];
    if (!area) throw new Error(`Area ${active.key} no longer exists.`);

    const online = await getOnlinePlayers();
    if (!online.length) {
      active.nextRefreshAt = Date.now() + REFRESH_MINUTES * 60 * 1000;
      active.lastNote = "Paused because no players were online.";
      await saveRuntimeValue(ACTIVE_STATE_KEY, active);
      scheduleActiveEvent(bot, active);
      return;
    }

    await cleanupArmedNpcsNearArea(area, Number(area.radius || DEFAULT_RADIUS)).catch(() => null);
    const result = await spawnSession(area, { testMode: false });

    active.lastRefreshAt = Date.now();
    active.nextRefreshAt = Math.min(active.endsAt, Date.now() + REFRESH_MINUTES * 60 * 1000);
    active.lastNote = `${reason}: spawned ${result.npcSpawned} NPCs and ${result.presentsSpawned} presents.`;
    await saveRuntimeValue(ACTIVE_STATE_KEY, active);

    const channel = await bot.channels.fetch(active.channelId).catch(() => null);
    if (channel && reason === "start") {
      await channel.send(buildEventAnnouncement(area, false)).catch(() => {});
    }

    await serverPost("/message", {
      text: `NPC Loot Event active at ${area.displayName}. Armed NPCs and loot presents are in the area.`,
      type: "ServerMessage",
    }).catch(() => {});

    scheduleActiveEvent(bot, active);
  } finally {
    activeRunLock = false;
  }
}

function scheduleActiveEvent(bot, active) {
  if (activeTimer) clearTimeout(activeTimer);
  if (!active || Date.now() >= Number(active.endsAt || 0)) return;
  const wait = Math.max(10 * 1000, Math.min(REFRESH_MINUTES * 60 * 1000, Number(active.nextRefreshAt || 0) - Date.now()));
  activeTimer = setTimeout(() => {
    refreshActiveEvent(bot, active, "refresh").catch((err) => console.error("❌ NPC event refresh failed:", err.message));
  }, wait);
}

async function handleNpcStart(message, args, bot) {
  const key = cleanKey(args[0]);
  if (!key) {
    await message.reply("Use: `!npcstart <shortname>`\nExample: `!npcstart southquarry`").catch(() => {});
    return;
  }

  const minutesToRestart = minutesUntilNextRestart();
  if (minutesToRestart < RESTART_SAFETY_MINUTES) {
    await message.reply(`NPC event not started. Next restart is in about **${minutesToRestart} minutes**. Safety buffer is **${RESTART_SAFETY_MINUTES} minutes**.`).catch(() => {});
    return;
  }

  await requireAnyPlayersOnline();
  const areas = await loadAreas();
  const area = areas[key];
  if (!area) {
    await message.reply(`No NPC event area found for \`${key}\`. Save it first with \`!npcarea ${key} Display Name\`.`).catch(() => {});
    return;
  }

  const existing = await loadRuntimeValue(ACTIVE_STATE_KEY);
  if (existing?.key && Date.now() < Number(existing.endsAt || 0)) {
    await message.reply(`An NPC event is already active: **${existing.displayName || existing.key}**. Stop it first with \`!npcstop\`.`).catch(() => {});
    return;
  }

  const active = {
    key,
    displayName: area.displayName,
    guildId: message.guild.id,
    channelId: message.channel.id,
    startedBy: message.author.id,
    startedAt: Date.now(),
    endsAt: Date.now() + EVENT_DURATION_MINUTES * 60 * 1000,
    nextRefreshAt: Date.now(),
    refreshMinutes: REFRESH_MINUTES,
    durationMinutes: EVENT_DURATION_MINUTES,
  };

  await saveRuntimeValue(ACTIVE_STATE_KEY, active);
  await message.reply([
    `🎁 **NPC Loot Event Starting: ${area.displayName}**`,
    `Duration: **${EVENT_DURATION_MINUTES} minutes**`,
    `Refresh: every **${REFRESH_MINUTES} minutes**`,
    `NPCs per refresh: **${NPC_COUNT}**`,
    `Presents per refresh: **max ${PRESENTS_PER_SESSION}**`,
    "",
    "Watcher will pause refreshes if the server is empty.",
  ].join("\n")).catch(() => {});

  await refreshActiveEvent(bot, active, "start");
}

async function stopActiveEvent(bot, mode = "manual", message = null) {
  const active = await loadRuntimeValue(ACTIVE_STATE_KEY);
  if (activeTimer) {
    clearTimeout(activeTimer);
    activeTimer = null;
  }

  if (!active?.key) {
    if (message) await message.reply("No NPC event is active.").catch(() => {});
    return;
  }

  const areas = await loadAreas();
  const area = areas[active.key];
  if (area) await cleanupArmedNpcsNearArea(area, Number(area.radius || DEFAULT_RADIUS)).catch(() => null);
  await clearRuntimeValue(ACTIVE_STATE_KEY);

  const channel = message?.channel || (active.channelId ? await bot.channels.fetch(active.channelId).catch(() => null) : null);
  await channel?.send(mode === "ended"
    ? `✅ **NPC Loot Event Ended:** ${active.displayName || active.key}`
    : `🛑 **NPC Loot Event Stopped:** ${active.displayName || active.key}`
  ).catch(() => {});
}

async function handleNpcStatus(message) {
  const [active, areas, lvl2, lvl3, present] = await Promise.all([
    loadRuntimeValue(ACTIVE_STATE_KEY).catch(() => null),
    loadAreas().catch(() => ({})),
    resolveNpcClass("lvl2").catch((err) => ({ error: err.message })),
    resolveNpcClass("lvl3").catch((err) => ({ error: err.message })),
    resolvePresentItem().catch((err) => ({ error: err.message })),
  ]);

  const rows = [
    "🎁 **NPC Loot Event Status**",
    `Anchor Steam ID: \`${ANCHOR_STEAM_ID}\``,
    `Saved areas: **${Object.keys(areas || {}).length}**`,
    `Next restart: about **${minutesUntilNextRestart()} minutes**`,
    "",
    active?.key && Date.now() < Number(active.endsAt || 0)
      ? `Active: **${active.displayName || active.key}** | time left: **${formatTimeLeft(Number(active.endsAt) - Date.now())}** | next refresh: **${formatTimeLeft(Number(active.nextRefreshAt || Date.now()) - Date.now())}**`
      : "Active: **No**",
    active?.lastNote ? `Last note: ${active.lastNote}` : null,
    "",
    `Level 2 NPC: ${lvl2?.entity ? `\`${lvl2.entity}\`${lvl2.matched ? "" : " (fallback)"}` : `Error: ${lvl2?.error || "unknown"}`}`,
    `Level 3 NPC: ${lvl3?.entity ? `\`${lvl3.entity}\`${lvl3.matched ? "" : " (fallback)"}` : `Error: ${lvl3?.error || "unknown"}`}`,
    `Present item: ${present?.item ? `\`${present.item}\`` : present?.error ? `Error: ${present.error}` : "Not found"}`,
    "",
    "Presents are max 2 per spawn session. Watcher does not yet have a safe item-handle cleanup for individual world presents.",
  ].filter(Boolean);

  await message.reply(rows.join("\n")).catch(() => {});
}

async function handleNpcStop(message, bot) {
  await stopActiveEvent(bot, "manual", message);
}

async function handleNpcEventCommand(message, bot) {
  if (!message.guild || !message.content?.startsWith("!")) return false;

  const parts = message.content.trim().split(/\s+/);
  const command = parts.shift().toLowerCase();
  const args = parts;
  const commands = ["!npcarea", "!npcareas", "!npctest", "!npcstart", "!npcstop", "!npcstatus"];
  if (!commands.includes(command)) return false;

  if (!isStaff(message)) {
    await message.reply("The Watcher sees the request. This command is for staff only.").catch(() => {});
    return true;
  }

  try {
    if (command === "!npcarea") await handleNpcArea(message, args);
    else if (command === "!npcareas") await handleNpcAreas(message);
    else if (command === "!npctest") await handleNpcTest(message, args, bot);
    else if (command === "!npcstart") await handleNpcStart(message, args, bot);
    else if (command === "!npcstop") await handleNpcStop(message, bot);
    else if (command === "!npcstatus") await handleNpcStatus(message);
  } catch (err) {
    console.error("❌ NPC event command failed:", err);
    await message.reply(`NPC event error: ${err.message}`).catch(() => {});
  }

  return true;
}

async function startNpcEventsOnBoot(bot) {
  const active = await loadRuntimeValue(ACTIVE_STATE_KEY).catch(() => null);
  if (!active?.key) return;
  if (Date.now() >= Number(active.endsAt || 0)) {
    await clearRuntimeValue(ACTIVE_STATE_KEY).catch(() => {});
    return;
  }
  scheduleActiveEvent(bot, active);
  console.log(`✅ NPC event scheduler resumed for ${active.displayName || active.key}`);
}

module.exports = {
  handleNpcEventCommand,
  startNpcEventsOnBoot,
};
