const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const net = require('net');
const zlib = require('zlib');
const { URL } = require('url');
const { createClient } = require('@supabase/supabase-js');
const { MAP_CALIBRATION } = require('./mapCalibration');
const watcherScheduler = require('./watcherScheduler');
const { getPortalCatalog, buyPackageForPortal, listManagedProducts, saveManagedProduct, deleteManagedProduct, searchItemCatalog } = require('./shop');
const { getAdminPermissions, saveAdminPermissions, canUse, permissionCatalog } = require('./ownerControls');
const { getSpecialEventAdminStatus, triggerSpecialEvent } = require('./watcherSpecialEvents');
const { portalCreateRental } = require('./rentals');
const { portalInsuranceOptions, portalBuyInsurance, portalRedeemInsurance } = require('./insurance');
const { portalCreateShop, portalUpdateShop, portalToggleShop, portalDeleteShop, portalSetShopImages, portalAdminShop } = require('./playerShops');
const { portalCreateSquad, portalUpdateSquad, portalToggleSquad, portalDeleteSquad, portalAdminSquad } = require('./squadFinder');
const { portalCreateLore, portalUpdateLore, portalToggleLore, portalDeleteLore, portalSetLoreImages, portalAdminLore } = require('./playerLore');
const { portalListEvents, portalRsvpEvent, portalCreateEvent, portalUpdateEvent, portalSetEventStatus, portalDeleteEvent, portalRetryEventPost } = require('./events');
const {
  buildPlayerDetailsBySteamId,
  buildVehiclesBySteamId,
  getVehiclesForSteamIdStructured,
  buildSquadBySteamId,
  buildNearVehiclesBySteamId,
  getPlayerForLookup,
  getPlayerDisplayName,
  getPlayerIpInfo,
  jailPlayerBySteamId,
  unjailPlayerBySteamId,
} = require('./ggcon');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');

const DEFAULT_GGCON_BASE_URL = 'https://ggcon.gghost.games/s/2788404';
const MOVEMENT_TABLE = process.env.TRACKER_MOVEMENT_TABLE || 'watcher_player_movement';
const PLAYERS_TABLE = process.env.TRACKER_PLAYERS_TABLE || 'watcher_tracker_players';
const PLAYER_LINKS_TABLE = process.env.WATCHER_PLAYER_LINKS_TABLE || 'watcher_player_links';
const SAMPLE_SECONDS = Math.max(5, Number(process.env.TRACKER_SAMPLE_SECONDS || '15'));
const IDLE_SAMPLE_SECONDS = Math.max(SAMPLE_SECONDS, Number(process.env.TRACKER_IDLE_SAMPLE_SECONDS || '90'));
const RETENTION_HOURS = Math.max(1, Number(process.env.TRACKER_RETENTION_HOURS || '48'));
const MOVE_THRESHOLD_UNITS = Math.max(0, Number(process.env.TRACKER_MOVE_THRESHOLD_UNITS || '1000'));
const HEARTBEAT_SECONDS = Math.max(30, Number(process.env.TRACKER_HEARTBEAT_SECONDS || '600'));
const ACCESS_TOKEN_SECONDS = Math.max(30, Number(process.env.TRACKER_ACCESS_TOKEN_SECONDS || '120'));
const PORTAL_SESSION_DAYS = Math.max(1, Number(process.env.PORTAL_SESSION_DAYS || '30'));
const PORTAL_SESSION_MS = PORTAL_SESSION_DAYS * 24 * 60 * 60 * 1000;
const PORTAL_ROLE_RECHECK_MS = Math.max(60_000, Number(process.env.PORTAL_ROLE_RECHECK_MINUTES || '15') * 60_000);
const CLEANUP_MINUTES = Math.max(10, Number(process.env.TRACKER_CLEANUP_MINUTES || '60'));
const IP_GEOLOOKUP_ENABLED = String(process.env.PORTAL_IP_GEOLOOKUP_ENABLED || 'true').toLowerCase() !== 'false';
const IP_GEOLOOKUP_BASE_URL = String(process.env.PORTAL_IP_GEOLOOKUP_BASE_URL || 'https://ipwho.is').trim().replace(/\/+$/, '');
const IP_GEOLOOKUP_CACHE_MS = Math.max(60_000, Number(process.env.PORTAL_IP_GEOLOOKUP_CACHE_HOURS || '24') * 60 * 60 * 1000);
const ipGeoCache = new Map();

const STAFF_ROLE_NAMES = new Set(
  String(process.env.TRACKER_STAFF_ROLES || 'Owner,Owners,Admin,Trial Admin,Baby Admin')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean)
);

// Shared calibration is maintained in mapCalibration.js and used across Watcher.


const WORLD = {
  minX: Number(process.env.TRACKER_WORLD_MIN_X || '-900000'),
  maxX: Number(process.env.TRACKER_WORLD_MAX_X || '600000'),
  minY: Number(process.env.TRACKER_WORLD_MIN_Y || '-850000'),
  maxY: Number(process.env.TRACKER_WORLD_MAX_Y || '650000'),
  flipX: String(process.env.TRACKER_FLIP_X || 'false').toLowerCase() === 'true',
  flipY: String(process.env.TRACKER_FLIP_Y || 'true').toLowerCase() !== 'false',
};

const mapPath = path.join(__dirname, 'tracker-map.png');
const highResMapPath = path.join(__dirname, 'tracker-map-hi.webp');
const portalMapTilesPath = path.join(__dirname, 'portal-map-tiles');
const MAP_STORAGE_BUCKET = String(process.env.PORTAL_MAP_STORAGE_BUCKET || 'outpost-x-static').trim();
const MAP_STORAGE_PREFIX = String(process.env.PORTAL_MAP_STORAGE_PREFIX || 'maps').trim().replace(/^\/+|\/+$/g, '');

function externalMapAssetBaseUrl() {
  const explicit = String(process.env.PORTAL_MAP_ASSET_BASE_URL || '').trim().replace(/\/+$/, '');
  if (explicit) return explicit;
  const supabaseUrl = String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  if (!supabaseUrl || !MAP_STORAGE_BUCKET) return '';
  const bucket = encodeURIComponent(MAP_STORAGE_BUCKET);
  const prefix = MAP_STORAGE_PREFIX.split('/').filter(Boolean).map(encodeURIComponent).join('/');
  return `${supabaseUrl}/storage/v1/object/public/${bucket}${prefix ? `/${prefix}` : ''}`;
}

function externalMapAssetUrl(relativePath) {
  const base = externalMapAssetBaseUrl();
  if (!base) return '';
  const encodedPath = String(relativePath || '').split('/').filter(Boolean).map(encodeURIComponent).join('/');
  return encodedPath ? `${base}/${encodedPath}` : base;
}

function redirectToMapAsset(res, relativePath) {
  const target = externalMapAssetUrl(relativePath);
  if (!target) return false;
  res.writeHead(302, {
    Location: target,
    'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
  });
  res.end();
  return true;
}
const htmlPath = path.join(__dirname, 'surveillance.html');
const portalHtmlPath = path.join(__dirname, 'portal.html');
const portalCssPath = path.join(__dirname, 'portal.css');
const portalJsPath = path.join(__dirname, 'portal.js');
function portalAssetVersion() {
  try {
    const mtimes = [portalHtmlPath, portalCssPath, portalJsPath].map((file) => fs.statSync(file).mtimeMs);
    return String(Math.max(...mtimes).toFixed(0));
  } catch {
    return String(Date.now());
  }
}

const portalOutpostPath = path.join(__dirname, 'portal-outpost.jpg');
const portalWatcherPath = path.join(__dirname, 'portal-watcher.jpg');
const portalFaviconPath = path.join(__dirname, 'portal-favicon.png');
const portalStaffAssets = new Map(['josh','nivy','cat','deathbloom','crazylady','oneeyeddude','watcher-staff'].map((name) => [name, path.join(__dirname, `staff-${name}.webp`)]));
const TRANSACTIONS_TABLE = process.env.WATCHER_TRANSACTIONS_TABLE || 'watcher_transactions';
const WATCHER_VERSION = String(process.env.WATCHER_VERSION || process.env.RAILWAY_GIT_COMMIT_SHA || require('./package.json').version || 'development').slice(0,12);
const WATCHER_DEPLOYED_AT = String(process.env.WATCHER_DEPLOYED_AT || process.env.RAILWAY_DEPLOYMENT_ID || 'Current deployment');

let dbClient = null;
let botRef = null;
let serverRef = null;
let sampleTimer = null;
const portalRevisions = new Map();
let cleanupTimer = null;
const responseCache = new Map();
const inFlight = new Map();
const revisionStreams = new Map();
const retryQueue = [];
let retryWorkerRunning = false;
const RUNTIME_TABLE = process.env.WATCHER_RUNTIME_STATE_TABLE || 'watcher_runtime_state';
const PORTAL_SETTINGS_KEY_PREFIX = 'portal_settings:';
let sampleRunning = false;
let latestOnline = new Map();
const onlineFirstSeen = new Map();
const lastSaved = new Map();
const accessTokens = new Map();
const oauthStates = new Map();
const sessions = new Map();
const portalAirliftPending = new Map();
const portalAirliftLaunches = new Set();
const PORTAL_AIRLIFT_PENDING_MS = 10 * 60 * 1000;
const PORTAL_AIRLIFT_PRICE = Math.max(0, Number(process.env.AIRLIFT_PRICE || '1000'));
const PORTAL_AIRLIFT_ALTITUDE_Z = Number(process.env.AIRLIFT_ALTITUDE_Z || '150000');
const PORTAL_AIRLIFT_LAUNCH_DELAY_MS = Math.max(0, Number(process.env.AIRLIFT_LAUNCH_DELAY_MS || '10000'));
const PORTAL_AIRLIFT_PARACHUTE_ITEM = process.env.AIRLIFT_PARACHUTE_ITEM || 'BeginPlay_Parachute';


function portalRevisionKey(guildId) {
  return String(guildId || 'global');
}

function getPortalRevision(guildId) {
  return portalRevisions.get(portalRevisionKey(guildId)) || { value: 1, updatedAt: Date.now() };
}

function bumpPortalRevision(guildId) {
  const key = portalRevisionKey(guildId);
  const current = getPortalRevision(key);
  const next = { value: current.value + 1, updatedAt: Date.now() };
  portalRevisions.set(key, next);
  responseCache.clear();
  const listeners = revisionStreams.get(key);
  if (listeners) {
    const payload = `event: revision\ndata: ${JSON.stringify(next)}\n\n`;
    for (const res of [...listeners]) { try { res.write(payload); } catch { listeners.delete(res); } }
  }
  return next;
}

function scheduleMovementSample(delaySeconds) {
  if (sampleTimer) clearTimeout(sampleTimer);
  sampleTimer = setTimeout(async () => {
    await recordMovementSample();
    const nextDelay = latestOnline.size > 0 ? SAMPLE_SECONDS : IDLE_SAMPLE_SECONDS;
    scheduleMovementSample(nextDelay);
  }, Math.max(5, Number(delaySeconds || SAMPLE_SECONDS)) * 1000);
}

function getDb() {
  if (dbClient) return dbClient;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) throw new Error('Supabase is not configured.');
  dbClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, { auth: { persistSession: false } });
  return dbClient;
}

function ggconBaseUrl() {
  return String(process.env.GGCON_BASE_URL || DEFAULT_GGCON_BASE_URL).replace(/\/+$/, '');
}

function ggconPassword() {
  if (!process.env.GGCON_PASSWORD) throw new Error('GGCON_PASSWORD is not configured.');
  return process.env.GGCON_PASSWORD;
}

async function ggconGet(endpoint) {
  const response = await fetch(`${ggconBaseUrl()}${endpoint}`, {
    headers: { Accept: 'application/json', 'X-Password': ggconPassword() },
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.message || data?.reason || data?.error || `GGCON HTTP ${response.status}`);
  }
  return data;
}

async function ggconPost(endpoint, body = {}) {
  const response = await fetch(`${ggconBaseUrl()}${endpoint}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Password': ggconPassword(),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok || data?.ok === false || data?.accepted === false) {
    throw new Error(data?.message || data?.reason || data?.error || `GGCON HTTP ${response.status}`);
  }
  return data;
}

function hasOwnerRole(member) {
  return !!member?.roles?.cache?.some((role) => ['owner','owners'].includes(String(role.name || '').toLowerCase()));
}
function hasTrackerRole(member) {
  return !!member?.roles?.cache?.some((role) => STAFF_ROLE_NAMES.has(String(role.name || '').toLowerCase()));
}

function hasPortalAccess(member) {
  return hasTrackerRole(member) || !!member?.roles?.cache?.some((role) => ['the exiles','exiles'].includes(String(role.name || '').toLowerCase()));
}

function publicBaseUrl() {
  const explicit = String(process.env.TRACKER_PUBLIC_URL || '').trim().replace(/\/+$/, '');
  if (explicit) return explicit;
  const railwayDomain = String(process.env.RAILWAY_PUBLIC_DOMAIN || '').trim();
  return railwayDomain ? `https://${railwayDomain}` : null;
}

function discordOAuthConfig() {
  const base = publicBaseUrl();
  const clientId = String(process.env.DISCORD_CLIENT_ID || botRef?.user?.id || '').trim();
  const clientSecret = String(process.env.DISCORD_CLIENT_SECRET || '').trim();
  const guildId = String(process.env.DISCORD_GUILD_ID || process.env.GUILD_ID || '1516269432538661025').trim();
  const redirectUri = String(process.env.DISCORD_OAUTH_REDIRECT_URI || (base ? `${base}/portal/oauth/callback` : '')).trim();
  return { base, clientId, clientSecret, guildId, redirectUri };
}

function createOAuthState() {
  const state = randomToken(24);
  oauthStates.set(state, { expiresAt: Date.now() + 10 * 60_000 });
  return state;
}

function portalSessionSecret() {
  const secret = String(process.env.PORTAL_SESSION_SECRET || process.env.DISCORD_CLIENT_SECRET || process.env.DISCORD_TOKEN || '').trim();
  if (!secret) throw new Error('Portal session signing is not configured.');
  return secret;
}

function createPortalSession(user, member, guildId) {
  const now = Date.now();
  return {
    discordId: String(user.id),
    guildId: String(guildId),
    displayName: member?.displayName || user.global_name || user.username || 'Outpost Player',
    avatar: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128` : null,
    isAdmin: hasTrackerRole(member),
    isOwner: hasOwnerRole(member),
    roleCheckedAt: now,
    expiresAt: now + PORTAL_SESSION_MS,
  };
}

function signPortalSession(session) {
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
  const signature = crypto.createHmac('sha256', portalSessionSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifyPortalSession(token) {
  const [payload, signature, extra] = String(token || '').split('.');
  if (!payload || !signature || extra) return null;
  const expected = crypto.createHmac('sha256', portalSessionSecret()).update(payload).digest();
  let supplied;
  try { supplied = Buffer.from(signature, 'base64url'); } catch { return null; }
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!session?.discordId || !session?.guildId || Number(session.expiresAt || 0) <= Date.now()) return null;
    return session;
  } catch { return null; }
}

function attachPortalSessionCookie(res, session) {
  session.expiresAt = Date.now() + PORTAL_SESSION_MS;
  const token = signPortalSession(session);
  res.setHeader('Set-Cookie', `watcher_tracker_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(PORTAL_SESSION_MS / 1000)}`);
  res.setHeader('X-Watcher-Session-Expires', new Date(session.expiresAt).toISOString());
}

function setPortalSessionCookie(res, session, location = '/portal') {
  attachPortalSessionCookie(res, session);
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

function oauthErrorPage(res, message) {
  const safe = String(message || 'Discord authorization failed.').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  return text(res, 400, `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Command Center Access</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#060a0f;color:#eaf4ff;font-family:system-ui}.box{max-width:560px;margin:24px;padding:28px;border:1px solid #284963;border-radius:14px;background:#0a1119;text-align:center}.box h1{margin-top:0}.box p{color:#9bb1c3;line-height:1.5}.box a{display:inline-block;margin-top:10px;padding:10px 16px;border-radius:9px;background:#12365a;color:#fff;text-decoration:none}</style></head><body><div class="box"><h1>Watcher Access Denied</h1><p>${safe}</p><a href="/portal/login">Try Again</a></div></body></html>`, 'text/html; charset=utf-8');
}

async function exchangeDiscordOAuthCode(code, config) {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'authorization_code',
    code: String(code),
    redirect_uri: config.redirectUri,
  });
  const response = await fetch('https://discord.com/api/v10/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error(data.error_description || data.message || 'Discord token exchange failed.');
  return data.access_token;
}

async function fetchDiscordOAuthUser(accessToken) {
  const response = await fetch('https://discord.com/api/v10/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.id) throw new Error(data.message || 'Discord account lookup failed.');
  return data;
}


function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function createAccessToken(discordId, guildId, profile = {}) {
  const token = randomToken(32);
  accessTokens.set(token, {
    discordId: String(discordId),
    guildId: String(guildId),
    displayName: profile.displayName || 'Outpost Player',
    avatar: profile.avatar || null,
    isAdmin: !!profile.isAdmin,
    isOwner: !!profile.isOwner,
    expiresAt: Date.now() + ACCESS_TOKEN_SECONDS * 1000,
  });
  return token;
}

function parseCookies(req) {
  const raw = String(req.headers.cookie || '');
  const out = {};
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

function getSession(req) {
  const token = parseCookies(req).watcher_tracker_session;
  if (!token) return null;
  const signed = verifyPortalSession(token);
  if (signed) return signed;

  // Temporary compatibility for sessions created before this update.
  const legacy = sessions.get(token);
  if (!legacy || legacy.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return { ...legacy };
}

async function refreshPortalSessionAccess(session, force = false) {
  const checkedAt = Number(session.roleCheckedAt || 0);
  if (!force && Date.now() - checkedAt < PORTAL_ROLE_RECHECK_MS) return session;
  const guild = botRef?.guilds?.cache?.get(String(session.guildId)) || await botRef?.guilds?.fetch(String(session.guildId)).catch(() => null);
  if (!guild) return null;
  const member = await guild.members.fetch({ user: String(session.discordId), force: true }).catch(() => null);
  if (!member || !hasPortalAccess(member)) return null;
  session.displayName = member.displayName || session.displayName || 'Outpost Player';
  session.isAdmin = hasTrackerRole(member);
  session.isOwner = hasOwnerRole(member);
  session.roleCheckedAt = Date.now();
  return session;
}

function pruneAuthState() {
  const now = Date.now();
  for (const [token, grant] of accessTokens) if (grant.expiresAt <= now) accessTokens.delete(token);
  for (const [state, grant] of oauthStates) if (grant.expiresAt <= now) oauthStates.delete(state);
  for (const [sid, session] of sessions) if (session.expiresAt <= now) sessions.delete(sid);
}

function numericLocation(player) {
  const loc = player?.location;
  if (!loc) return null;
  const x = Number(loc.x);
  const y = Number(loc.y);
  const z = Number(loc.z);
  if (![x, y, z].every(Number.isFinite)) return null;
  return { x, y, z };
}

function playerSteamId(player) {
  return String(player?.userId || player?.steamId || player?.steam_id || player?.id || '').trim();
}

function playerName(player) {
  return String(player?.characterName || player?.name || player?.steamName || playerSteamId(player) || 'Unknown').trim();
}

function distance2D(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot(Number(a.x) - Number(b.x), Number(a.y) - Number(b.y));
}

async function recordMovementSample() {
  if (sampleRunning) return;
  sampleRunning = true;
  try {
    const data = await ggconGet('/players.json');
    const players = Array.isArray(data?.players) ? data.players : [];
    const nowIso = new Date().toISOString();
    const nowMs = Date.now();
    const movementRows = [];
    const summaryRows = [];
    const online = new Map();

    for (const player of players) {
      const steamId = playerSteamId(player);
      const location = numericLocation(player);
      if (!steamId || !location) continue;
      const name = playerName(player);
      const previous = lastSaved.get(steamId);
      const moved = !previous || distance2D(location, previous) >= MOVE_THRESHOLD_UNITS;
      const heartbeatDue = !previous || nowMs - Number(previous.savedAt || 0) >= HEARTBEAT_SECONDS * 1000;

      online.set(steamId, { steamId, name, ...location, seenAt: nowIso });
      summaryRows.push({
        steam_id: steamId,
        player_name: name,
        last_seen: nowIso,
        last_x: location.x,
        last_y: location.y,
        last_z: location.z,
      });

      if (moved || heartbeatDue) {
        movementRows.push({
          steam_id: steamId,
          player_name: name,
          x: location.x,
          y: location.y,
          z: location.z,
          recorded_at: nowIso,
        });
        lastSaved.set(steamId, { ...location, savedAt: nowMs });
      }
    }

    const nowOnlineIds = new Set(online.keys());
    for (const steamId of nowOnlineIds) if (!onlineFirstSeen.has(steamId)) onlineFirstSeen.set(steamId, nowMs);
    for (const steamId of [...onlineFirstSeen.keys()]) if (!nowOnlineIds.has(steamId)) onlineFirstSeen.delete(steamId);
    latestOnline = online;
    const db = getDb();
    if (summaryRows.length) {
      const { error } = await db.from(PLAYERS_TABLE).upsert(summaryRows, { onConflict: 'steam_id' });
      if (error) throw error;
    }
    if (movementRows.length) {
      const { error } = await db.from(MOVEMENT_TABLE).insert(movementRows);
      if (error) throw error;
    }
  } catch (err) {
    console.error(`❌ Tracker sample failed: ${err.message}`);
  } finally {
    sampleRunning = false;
  }
}

async function cleanupOldTrackerData() {
  try {
    const cutoff = new Date(Date.now() - RETENTION_HOURS * 3600_000).toISOString();
    const db = getDb();
    const movement = await db.from(MOVEMENT_TABLE).delete().lt('recorded_at', cutoff);
    if (movement.error) throw movement.error;
    const players = await db.from(PLAYERS_TABLE).delete().lt('last_seen', cutoff);
    if (players.error) throw players.error;
    const transactionCutoff = new Date(Date.now() - 15 * 86400000).toISOString();
    const transactions = await db.from(TRANSACTIONS_TABLE).delete().lt('created_at', transactionCutoff);
    if (transactions.error && !String(transactions.error.message || '').includes('does not exist')) throw transactions.error;
  } catch (err) {
    console.error(`❌ Tracker cleanup failed: ${err.message}`);
  }
}

async function fetchTrackerPlayers() {
  const cutoff = new Date(Date.now() - RETENTION_HOURS * 3600_000).toISOString();
  const { data, error } = await getDb()
    .from(PLAYERS_TABLE)
    .select('steam_id,player_name,last_seen,last_x,last_y,last_z')
    .gte('last_seen', cutoff)
    .order('last_seen', { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data || []).map((row) => ({
    steamId: row.steam_id,
    name: row.player_name || row.steam_id,
    lastSeen: row.last_seen,
    x: Number(row.last_x),
    y: Number(row.last_y),
    z: Number(row.last_z),
    online: latestOnline.has(String(row.steam_id)),
  }));
}

async function fetchPlayerHistory(steamId, fromIso, toIso) {
  const earliest = Date.now() - RETENTION_HOURS * 3600_000;
  let fromMs = Date.parse(fromIso || '');
  let toMs = Date.parse(toIso || '');
  if (!Number.isFinite(fromMs)) fromMs = earliest;
  if (!Number.isFinite(toMs)) toMs = Date.now();
  fromMs = Math.max(fromMs, earliest);
  toMs = Math.min(Math.max(toMs, fromMs), Date.now());

  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; offset < 50000; offset += pageSize) {
    const { data, error } = await getDb()
      .from(MOVEMENT_TABLE)
      .select('steam_id,player_name,x,y,z,recorded_at')
      .eq('steam_id', String(steamId))
      .gte('recorded_at', new Date(fromMs).toISOString())
      .lte('recorded_at', new Date(toMs).toISOString())
      .order('recorded_at', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }

  return rows.map((row) => ({
    steamId: row.steam_id,
    name: row.player_name || row.steam_id,
    x: Number(row.x),
    y: Number(row.y),
    z: Number(row.z),
    t: row.recorded_at,
  }));
}

async function readJsonBody(req, maxBytes = 65536) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
      if (Buffer.byteLength(raw) > maxBytes) {
        reject(new Error('Request body is too large.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('Invalid JSON body.')); }
    });
    req.on('error', reject);
  });
}

async function resolveSessionSteamId(session) {
  const { data, error } = await getDb()
    .from(PLAYER_LINKS_TABLE)
    .select('steam_id,scum_name')
    .eq('guild_id', String(session.guildId))
    .eq('discord_id', String(session.discordId))
    .not('steam_id', 'is', null)
    .maybeSingle();
  if (error) throw error;
  const steamId = String(data?.steam_id || '').trim();
  if (!/^\d{15,20}$/.test(steamId)) throw new Error('Your Discord account is not linked to a SCUM player.');
  return { steamId, name: data?.scum_name || steamId };
}

async function getRecordedPoint(steamId, recordedAt) {
  const { data, error } = await getDb()
    .from(MOVEMENT_TABLE)
    .select('steam_id,player_name,x,y,z,recorded_at')
    .eq('steam_id', String(steamId))
    .eq('recorded_at', String(recordedAt))
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('That recorded point is no longer available. Refresh the tracker and try again.');
  return {
    steamId: String(data.steam_id),
    name: data.player_name || data.steam_id,
    x: Number(data.x),
    y: Number(data.y),
    z: Number(data.z),
    recordedAt: data.recorded_at,
  };
}


function cacheGet(key) {
  const item = responseCache.get(key);
  if (!item || item.expiresAt <= Date.now()) { responseCache.delete(key); return null; }
  return item.value;
}
function cacheSet(key, value, ttlMs) { responseCache.set(key, { value, expiresAt: Date.now() + Math.max(250, ttlMs) }); return value; }
async function singleFlight(key, fn) {
  if (inFlight.has(key)) return inFlight.get(key);
  const promise = Promise.resolve().then(fn).finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}
async function cachedFlight(key, ttlMs, fn) {
  const hit = cacheGet(key); if (hit !== null) return hit;
  return singleFlight(key, async () => cacheSet(key, await fn(), ttlMs));
}
function defaultPortalSettings() {
  return {
    maintenanceTitle: String(process.env.PORTAL_MAINTENANCE_TITLE || 'WATCHER NOTICE').trim(),
    maintenanceMessage: String(process.env.PORTAL_MAINTENANCE_MESSAGE || '').trim(),
    maintenanceLevel: String(process.env.PORTAL_MAINTENANCE_LEVEL || 'notice').trim().toLowerCase(),
    announcement: '',
    features: { purchases:true, rentals:true, airlift:true, insurance:true, eventCreation:true, surveillanceTeleport:true },
  };
}
async function loadPortalSettings(guildId) {
  const key = `${PORTAL_SETTINGS_KEY_PREFIX}${guildId}`;
  return cachedFlight(`settings:${key}`, 30_000, async () => {
    const base = defaultPortalSettings();
    try {
      const { data, error } = await getDb().from(RUNTIME_TABLE).select('value').eq('key', key).maybeSingle();
      if (error) throw error;
      const value = data?.value || {};
      return { ...base, ...value, features: { ...base.features, ...(value.features || {}) } };
    } catch (error) {
      console.warn(`⚠️ Portal settings fallback: ${error.message}`);
      return base;
    }
  });
}
async function savePortalSettings(guildId, input) {
  const current = await loadPortalSettings(guildId);
  const next = {
    ...current,
    maintenanceTitle: String(input.maintenanceTitle ?? current.maintenanceTitle).slice(0,80),
    maintenanceMessage: String(input.maintenanceMessage ?? current.maintenanceMessage).slice(0,1000),
    maintenanceLevel: ['info','notice','critical'].includes(String(input.maintenanceLevel)) ? String(input.maintenanceLevel) : current.maintenanceLevel,
    announcement: String(input.announcement ?? current.announcement).slice(0,1000),
    features: { ...current.features, ...(input.features || {}) },
  };
  const key = `${PORTAL_SETTINGS_KEY_PREFIX}${guildId}`;
  const { error } = await getDb().from(RUNTIME_TABLE).upsert({ key, value: next, updated_at: new Date().toISOString() }, { onConflict:'key' });
  if (error) throw error;
  responseCache.delete(`settings:${key}`);
  bumpPortalRevision(guildId);
  return next;
}
async function featureEnabled(guildId, feature) { return (await loadPortalSettings(guildId)).features?.[feature] !== false; }
async function requireFeature(guildId, feature, label) { if (!(await featureEnabled(guildId, feature))) throw new Error(`${label || feature} is temporarily disabled by the Owner.`); }
function queueRetry(name, handler, options={}) {
  retryQueue.push({ id: crypto.randomUUID(), name, handler, attempts:0, maxAttempts:Math.max(1,Number(options.maxAttempts||3)), nextAt:Date.now()+Math.max(1000,Number(options.delayMs||3000)), lastError:null });
  runRetryWorker().catch(()=>{});
}
async function runRetryWorker() {
  if (retryWorkerRunning) return;
  retryWorkerRunning = true;
  try {
    while (retryQueue.length) {
      retryQueue.sort((a,b)=>a.nextAt-b.nextAt);
      const item=retryQueue[0], wait=item.nextAt-Date.now();
      if(wait>0){await new Promise(r=>setTimeout(r,Math.min(wait,30000)));continue;}
      retryQueue.shift(); item.attempts++;
      try { await item.handler(); }
      catch(error){ item.lastError=String(error?.message||error); if(item.attempts<item.maxAttempts){item.nextAt=Date.now()+Math.min(60000,3000*(2**item.attempts));retryQueue.push(item);} }
    }
  } finally { retryWorkerRunning=false; }
}


async function safeRows(table, build) {
  try { const q = build(getDb().from(table)); const { data, error } = await q; if (error) throw error; return data || []; }
  catch (err) { console.warn(`⚠️ Portal could not read ${table}: ${err.message}`); return []; }
}
async function portalLink(session) {
  const { data, error } = await getDb().from(PLAYER_LINKS_TABLE).select('*').eq('guild_id', String(session.guildId)).eq('discord_id', String(session.discordId)).maybeSingle();
  if (error) throw error; return data || null;
}
function currentPlayerBySteam(steamId) {
  const p = latestOnline.get(String(steamId));
  return p || null;
}
function playerCash(p){ const n=Number(p?.accountBalance ?? p?.account_balance ?? p?.cash ?? p?.currency ?? p?.money ?? p?.balance ?? p?.wallet?.balance ?? p?.account?.balance); return Number.isFinite(n)?n:null; }
function playerFame(p){ const n=Number(p?.famePoints ?? p?.fame ?? p?.fame_points); return Number.isFinite(n)?n:null; }
async function portalHealthSnapshot(session){
  return cachedFlight(`health:${session.guildId}`,15000,async()=>{
  const now=new Date().toISOString();
  const checks={watcher:{ok:!!botRef?.isReady?.(),detail:botRef?.isReady?.()?'Discord bot connected':'Discord bot is not ready'},supabase:{ok:false,detail:'Not checked'},ggcon:{ok:false,detail:'Not checked'},eventPosting:{ok:false,detail:'Not checked'},surveillance:{ok:!!externalMapAssetBaseUrl(),detail:externalMapAssetBaseUrl()?'Supabase map storage configured':'Map asset URL is not configured'}};
  try{const {error}=await getDb().from(PLAYER_LINKS_TABLE).select('discord_id').limit(1);if(error)throw error;checks.supabase={ok:true,detail:'Database reachable'};}catch(e){checks.supabase={ok:false,detail:e.message};}
  try{const data=await ggconGet('/players.json');checks.ggcon={ok:true,detail:`GGCON reachable • ${Array.isArray(data?.players)?data.players.length:0} online`};}catch(e){checks.ggcon={ok:false,detail:e.message};}
  try{const guild=botRef?.guilds?.cache?.get(String(session.guildId));const channelId=String(process.env.EVENTS_CHANNEL_ID||'');const ch=guild?.channels?.cache?.get(channelId)||await botRef?.channels?.fetch(channelId).catch(()=>null);checks.eventPosting={ok:!!ch?.isTextBased?.(),detail:ch?.isTextBased?.()?`Ready in #${ch.name}`:'Configured event channel is unavailable'};}catch(e){checks.eventPosting={ok:false,detail:e.message};}
  const settings=await loadPortalSettings(session.guildId);
  const config={eventsChannel:!!String(process.env.EVENTS_CHANNEL_ID||''),supabase:!!(process.env.SUPABASE_URL&&process.env.SUPABASE_KEY),ggcon:!!process.env.GGCON_PASSWORD,discordOAuth:!!(process.env.DISCORD_CLIENT_ID&&process.env.DISCORD_CLIENT_SECRET),mapStorage:!!externalMapAssetBaseUrl()};
  return {ok:true,checkedAt:now,version:WATCHER_VERSION,deployment:WATCHER_DEPLOYED_AT,checks,config,settings,scheduler:watcherScheduler.snapshot(),retryQueue:retryQueue.map(x=>({id:x.id,name:x.name,attempts:x.attempts,maxAttempts:x.maxAttempts,nextAt:new Date(x.nextAt).toISOString(),lastError:x.lastError}))};
  });
}
async function portalAttentionCounts(session){
  if(!session.isAdmin)return {};
  const events=await safeRows('events',q=>q.select('id,channel_id,message_id,status').eq('status','open').limit(250));
  const failedEvents=events.filter(e=>!e.channel_id||!e.message_id||String(e.message_id)==='portal').length;
  const failedTransactions=await safeRows(TRANSACTIONS_TABLE,q=>q.select('id').eq('guild_id',String(session.guildId)).eq('status','failed').gte('created_at',new Date(Date.now()-15*86400000).toISOString()).limit(250));
  const pendingInsurance=await safeRows('watcher_vehicle_insurance',q=>q.select('id').eq('guild_id',String(session.guildId)).in('status',['claim_available','pending']).limit(250));
  return {total:failedEvents+failedTransactions.length+pendingInsurance.length,failedEvents,failedTransactions:failedTransactions.length,pendingInsurance:pendingInsurance.length};
}

function isPublicLookupIp(ip) {
  const value = String(ip || '').trim();
  const kind = net.isIP(value);
  if (!kind) return false;
  if (kind === 4) {
    const parts = value.split('.').map(Number);
    const [a,b] = parts;
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a >= 224) return false;
    return true;
  }
  const lower = value.toLowerCase();
  if (lower === '::1' || lower === '::' || lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) return false;
  return true;
}

function formatApproximateIpLocation(data) {
  const place = [data.city, data.region, data.country].filter(Boolean).join(', ') || 'Location unavailable';
  const provider = data.connection?.isp || data.connection?.org || 'Unknown';
  const asn = data.connection?.asn ? `AS${data.connection.asn}` : 'Unknown';
  const timezone = data.timezone?.id || data.timezone?.utc || 'Unknown';
  return [
    '🌐 Approximate IP Location',
    '',
    `IP: ${data.ip || 'Unknown'}`,
    `Approximate Location: ${place}`,
    `Provider: ${provider}`,
    `ASN: ${asn}`,
    `Time Zone: ${timezone}`,
    '',
    'This is an IP-network estimate, not a home address. Mobile networks, VPNs, proxies, and ISP routing can show a different city or region.',
  ].join('\n');
}

async function lookupApproximateIp(ip) {
  if (!IP_GEOLOOKUP_ENABLED) throw new Error('IP location lookup is disabled.');
  const value = String(ip || '').trim();
  if (!isPublicLookupIp(value)) throw new Error('No public IP address is available for this player.');
  const cached = ipGeoCache.get(value);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  timeout.unref?.();
  try {
    const endpoint = `${IP_GEOLOOKUP_BASE_URL}/${encodeURIComponent(value)}?fields=ip,success,message,country,region,city,connection,time_zone,timezone`;
    const response = await fetch(endpoint, { signal: controller.signal, headers: { Accept: 'application/json', 'User-Agent': 'Outpost-X-Watcher/1.0' } });
    if (!response.ok) throw new Error(response.status === 429 ? 'IP lookup limit reached. Try again later.' : `IP lookup service returned ${response.status}.`);
    const data = await response.json();
    if (data?.success === false) throw new Error(data.message || 'IP location lookup failed.');
    const normalized = {
      ip: data.ip || value,
      city: data.city || null,
      region: data.region || null,
      country: data.country || null,
      connection: data.connection || {},
      timezone: data.timezone || data.time_zone || {},
      lookedUpAt: new Date().toISOString(),
    };
    ipGeoCache.set(value, { data: normalized, expiresAt: Date.now() + IP_GEOLOOKUP_CACHE_MS });
    return normalized;
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error('IP location lookup timed out.');
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function portalAdminIpLocation(session, steamId) {
  if (!session.isAdmin) throw new Error('Admin access required.');
  const id = String(steamId || '').trim();
  if (!/^\d{15,20}$/.test(id)) throw new Error('A valid Steam64 ID is required.');
  const result = await getPlayerForLookup(id);
  if (result.type !== 'single') throw new Error('Player could not be found in current or recent server data.');
  const ipInfo = await getPlayerIpInfo(result.player).catch(() => null);
  if (!ipInfo?.ip) throw new Error('No recent public IP was found for this player.');
  const location = await lookupApproximateIp(ipInfo.ip);
  return {
    steamId: id,
    playerName: getPlayerDisplayName(result.player),
    source: ipInfo.source || 'server data',
    seenAt: ipInfo.seenAt || null,
    location,
    content: formatApproximateIpLocation(location),
  };
}

async function portalActiveUnregisteredPlayers(session) {
  if (!session.isAdmin) throw new Error('Admin access required.');
  const players = [...latestOnline.values()];
  if (!players.length) return { players: [], count: 0, sampledAt: new Date().toISOString() };
  const steamIds = players.map((p) => String(p.steamId || '')).filter(Boolean);
  const links = await safeRows(PLAYER_LINKS_TABLE, (q) => q.select('steam_id,discord_id,scum_name').eq('guild_id', String(session.guildId)).in('steam_id', steamIds));
  const linked = new Set(links.map((row) => String(row.steam_id || '')));
  const now = Date.now();
  const unknown = players.filter((p) => !linked.has(String(p.steamId))).map((p) => {
    const firstSeenMs = onlineFirstSeen.get(String(p.steamId)) || now;
    return {
      steamId: String(p.steamId),
      name: p.name || 'Unknown',
      firstSeenAt: new Date(firstSeenMs).toISOString(),
      sessionMinutes: Math.max(0, Math.floor((now - firstSeenMs) / 60000)),
      lastSeenAt: p.seenAt || new Date().toISOString(),
      status: 'No known Discord registration',
    };
  }).sort((a,b) => b.sessionMinutes-a.sessionMinutes || a.name.localeCompare(b.name));
  return { players: unknown, count: unknown.length, sampledAt: new Date().toISOString(), note: 'Watcher can confirm there is no linked Discord registration. A player may still use a different Discord name.' };
}

async function portalAdminRecentActivity(session){
  if(!session.isAdmin)return [];
  return safeRows(TRANSACTIONS_TABLE,q=>q.select('*').eq('guild_id',String(session.guildId)).gte('created_at',new Date(Date.now()-15*86400000).toISOString()).order('created_at',{ascending:false}).limit(12));
}
async function portalBackupExport(session){
  if(!session.isOwner)throw new Error('Owner access required.');
  const tables=['events','watcher_server_shop_products','watcher_vehicle_insurance','watcher_dirtbike_rentals','watcher_player_shops','watcher_squad_listings','watcher_player_lore',TRANSACTIONS_TABLE];
  const data={exportedAt:new Date().toISOString(),watcherVersion:WATCHER_VERSION,guildId:String(session.guildId),tables:{}};
  for(const table of tables)data.tables[table]=await safeRows(table,q=>{let x=q.select('*');if(table!== 'events')x=x.eq('guild_id',String(session.guildId));return x.limit(5000)});
  return data;
}

async function buildPortalOverview(session) {
  const link = await portalLink(session);
  const steamId = String(link?.steam_id || '');
  const onlineSample = steamId ? currentPlayerBySteam(steamId) : null;
  let playerDetail = onlineSample;
  if (steamId) {
    try {
      const d = await ggconGet(`/players/${encodeURIComponent(steamId)}.json`);
      playerDetail = d?.player || d?.data?.player || d?.data || d || onlineSample;
    } catch {}
  }
  const cutoff15 = new Date(Date.now()-15*86400000).toISOString();
  const permissions = session.isAdmin ? await getAdminPermissions(getDb(), session.guildId) : {};
  const [insurance,rentals,rides,shops,myShop,squads,mySquad,lore,myLore,transactions,events] = await Promise.all([
    steamId?safeRows('watcher_vehicle_insurance',q=>q.select('*').eq('guild_id',String(session.guildId)).eq('steam_id',steamId).order('purchased_at',{ascending:false}).limit(100)):[],
    steamId?safeRows('watcher_dirtbike_rentals',q=>q.select('*').eq('guild_id',String(session.guildId)).eq('steam_id',steamId).order('created_at',{ascending:false}).limit(5)):[],
    steamId?safeRows('watcher_airlift_rides',q=>q.select('*').eq('guild_id',String(session.guildId)).eq('steam_id',steamId).order('completed_at',{ascending:false}).limit(5)):[],
    safeRows('watcher_player_shops',q=>q.select('*').eq('guild_id',String(session.guildId)).order('updated_at',{ascending:false}).limit(250)),
    safeRows('watcher_player_shops',q=>q.select('*').eq('guild_id',String(session.guildId)).eq('owner_id',String(session.discordId)).limit(1)),
    safeRows('watcher_squad_listings',q=>q.select('*').eq('guild_id',String(session.guildId)).order('updated_at',{ascending:false}).limit(250)),
    safeRows('watcher_squad_listings',q=>q.select('*').eq('guild_id',String(session.guildId)).eq('owner_id',String(session.discordId)).limit(1)),
    safeRows('watcher_player_lore',q=>{let z=q.select('*').eq('guild_id',String(session.guildId));if(!session.isAdmin)z=z.eq('is_published',true);return z.order('updated_at',{ascending:false}).limit(250)}),
    safeRows('watcher_player_lore',q=>q.select('*').eq('guild_id',String(session.guildId)).eq('owner_id',String(session.discordId)).limit(1)),
    steamId?safeRows(TRANSACTIONS_TABLE,q=>q.select('*').eq('guild_id',String(session.guildId)).eq('steam_id',steamId).gte('created_at',cutoff15).order('created_at',{ascending:false}).limit(500)):[],
    portalListEvents({db:getDb(),bot:botRef,guildId:String(session.guildId),discordId:String(session.discordId),isAdmin:!!session.isAdmin}),
  ]);
  const lastRide=rides[0]?.completed_at?new Date(rides[0].completed_at):null; const nextRide=lastRide?new Date(lastRide.getTime()+3600000):null;
  const vehicles=[];
  try {
    if (steamId) {
      const arr = await getVehiclesForSteamIdStructured(steamId);
      for (const x of arr) {
        const vehicleId = x.id ?? x.vehicleId;
        vehicles.push({
          ...x,
          id: vehicleId,
          vehicleId,
          name: x.name || x.vehicleName || x.class || 'Vehicle',
          insured: insurance.some((i) => String(i.vehicle_id) === String(vehicleId) && ['active','claim_available'].includes(String(i.status))),
        });
      }
    }
  } catch (err) {
    console.warn(`⚠️ Portal vehicle lookup failed for ${steamId}: ${err.message}`);
  }
  const shopCatalog = await getPortalCatalog(session.guildId);
  const portalSettings = await loadPortalSettings(session.guildId);
  return {
    me:{discordId:session.discordId,displayName:session.displayName||link?.discord_tag||'Outpost Player',avatar:session.avatar||null,isAdmin:!!session.isAdmin,isOwner:!!session.isOwner,permissions,permissionCatalog:session.isOwner?permissionCatalog():[],sessionExpiresAt:new Date(session.expiresAt).toISOString()},
    player:{steamId:steamId||null,name:link?.scum_name||playerDetail?.characterName||playerDetail?.name||onlineSample?.name||null,online:!!onlineSample,cash:playerCash(playerDetail),fame:playerFame(playerDetail)},
    vehicles,insurance,rental:rentals.find(r=>['active','removal_pending'].includes(r.status))||rentals[0]||null,
    airlift:{ready:!nextRide||nextRide<=new Date(),nextRide:nextRide?.toISOString()||null},shops,myShop:myShop[0]||null,squads,mySquad:mySquad[0]||null,lore,myLore:myLore[0]||null,events,transactions,
    shopCatalog,
    mapCalibration: MAP_CALIBRATION,
    attention: await portalAttentionCounts(session),
    adminRecentActivity: await portalAdminRecentActivity(session),
    settings: portalSettings,
    system:{
      verifiedAt:new Date().toISOString(),
      onlinePlayers:latestOnline.size,
      maintenance:portalSettings.maintenanceMessage?{id:crypto.createHash('sha1').update(portalSettings.maintenanceMessage).digest('hex').slice(0,12),title:portalSettings.maintenanceTitle,message:portalSettings.maintenanceMessage,level:portalSettings.maintenanceLevel}:null
    },
    build:{version:WATCHER_VERSION,deployment:WATCHER_DEPLOYED_AT}
  };
}
const PORTAL_SECTORS = {D4:[493707,525891],D3:[193707,525891],D2:[-106293,525891],D1:[-406293,525891],D0:[-693133,480558],C4:[493707,225891],C3:[193707,225891],C2:[-152325,290058],C1:[-406293,225891],C0:[-706293,225891],B4:[493707,-74109],B3:[193707,-74109],B2:[-123750,-166083],B1:[-406293,-74109],B0:[-825081,-141941],A4:[493707,-374109],A3:[193707,-374109],A2:[-106293,-374109],A1:[-406293,-374109],A0:[-706293,-374109],Z4:[410705,-755571],Z3:[193707,-674109],Z2:[-106293,-674109],Z1:[-406293,-674109],Z0:[-712773,-706255]};

function cleanLedgerSearch(value) {
  return String(value || '').trim().replace(/[,%()]/g, ' ').replace(/\s+/g, ' ').slice(0, 100);
}
async function fetchAdminTransactionPage(session, url) {
  await requirePermission(session, 'view_transactions');
  const pageSize = Math.max(10, Math.min(100, Number(url.searchParams.get('pageSize') || 25)));
  const page = Math.max(1, Number(url.searchParams.get('page') || 1));
  const category = String(url.searchParams.get('category') || 'all').toLowerCase();
  const status = String(url.searchParams.get('status') || 'all').toLowerCase();
  const search = cleanLedgerSearch(url.searchParams.get('search'));
  const cutoff = new Date(Date.now() - 15 * 86400000).toISOString();

  let query = getDb()
    .from(TRANSACTIONS_TABLE)
    .select('*', { count: 'exact' })
    .eq('guild_id', String(session.guildId))
    .gte('created_at', cutoff);

  if (category === 'server_shop') query = query.eq('type', 'server_shop');
  else if (category === 'insurance') query = query.eq('type', 'vehicle_insurance');
  else if (category === 'taxi') query = query.eq('type', 'airlift_taxi');
  else if (category === 'rental') query = query.eq('type', 'dirtbike_rental');
  else if (category === 'refund') query = query.eq('type', 'refund');
  else if (category === 'admin') query = query.like('type', 'admin_%');

  if (status !== 'all') {
    if (status === 'refunded') query = query.in('refund_status', ['partially_refunded', 'fully_refunded']);
    else query = query.eq('status', status);
  }
  if (search) {
    const pattern = `%${search}%`;
    query = query.or(`player_name.ilike.${pattern},steam_id.ilike.${pattern},title.ilike.${pattern},type.ilike.${pattern}`);
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const { data, error, count } = await query.order('created_at', { ascending: false }).range(from, to);
  if (error) throw error;
  const total = Number(count || 0);
  return {
    transactions: data || [],
    total,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

async function portalTransaction(v){
  const row={guild_id:String(v.guildId),discord_id:String(v.discordId),steam_id:String(v.steamId),player_name:v.playerName||null,type:v.type,title:v.title,amount:Number(v.amount||0),currency:'cash',status:'completed',details:v.details||{},balance_before:v.before??null,balance_after:v.after??null,refundable:Number(v.amount)<0,created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
  const {data,error}=await getDb().from(TRANSACTIONS_TABLE).insert(row).select('*').single(); if(error) console.warn('⚠️ Transaction insert failed:',error.message); return data;
}
function portalAirliftKey(session) {
  return `${session.guildId}:${session.discordId}`;
}
function getPortalAirliftPending(session) {
  const key = portalAirliftKey(session);
  const value = portalAirliftPending.get(key);
  if (!value) return null;
  if (Number(value.expiresAt || 0) <= Date.now()) {
    portalAirliftPending.delete(key);
    return null;
  }
  return value;
}
async function loadPortalAirliftPlayer(session) {
  const link = await portalLink(session);
  if (!link?.steam_id) throw new Error('Your Discord account is not linked to a SCUM player.');
  const payload = await ggconGet(`/players/${encodeURIComponent(link.steam_id)}.json`);
  const player = payload?.player || payload;
  const online = player?.online === true || player?.ping !== undefined || player?.health !== undefined || latestOnline.has(String(link.steam_id));
  if (!online) throw new Error('You must be online in SCUM to use the Airlift Taxi.');
  return { link, player };
}
async function verifyPortalAirliftReady(session, link, player) {
  const last = await safeRows('watcher_airlift_rides', q => q.select('*').eq('guild_id', String(session.guildId)).eq('steam_id', String(link.steam_id)).eq('status', 'completed').order('completed_at', { ascending: false }).limit(1));
  if (last[0]?.completed_at && Date.now() - Date.parse(last[0].completed_at) < 3600000) throw new Error('Your Airlift Taxi is still on cooldown.');
  const cash = playerCash(player);
  if (cash === null || cash < PORTAL_AIRLIFT_PRICE) throw new Error(`You need $${PORTAL_AIRLIFT_PRICE.toLocaleString('en-CA')} in SCUM cash for an airlift.`);
  return cash;
}
async function portalTaxiPrepare(session, body) {
  const sector = String(body.sector || '').toUpperCase();
  if (!PORTAL_SECTORS[sector] || sector === 'C0') throw new Error('Choose a valid SCUM sector.');
  const { link, player } = await loadPortalAirliftPlayer(session);
  await verifyPortalAirliftReady(session, link, player);
  await ggconPost('/command', { command: `#SpawnItem ${PORTAL_AIRLIFT_PARACHUTE_ITEM} 1 Location ${link.steam_id}` });
  const pending = { steamId: String(link.steam_id), playerName: link.scum_name || getPlayerDisplayName(player), sector, expiresAt: Date.now() + PORTAL_AIRLIFT_PENDING_MS };
  portalAirliftPending.set(portalAirliftKey(session), pending);
  return { ok: true, stage: 'prepared', sector, expiresAt: new Date(pending.expiresAt).toISOString() };
}
async function portalTaxiCancel(session) {
  portalAirliftPending.delete(portalAirliftKey(session));
  return { ok: true, stage: 'cancelled' };
}
async function portalTaxiSend(session, body) {
  const key = portalAirliftKey(session);
  if (portalAirliftLaunches.has(key)) throw new Error('Your airlift is already being processed.');
  const pending = getPortalAirliftPending(session);
  const sector = String(body.sector || pending?.sector || '').toUpperCase();
  if (!pending || pending.sector !== sector) throw new Error('This prepared Airlift Taxi expired. Prepare a new ride first.');
  portalAirliftLaunches.add(key);
  try {
    let { link, player } = await loadPortalAirliftPlayer(session);
    if (String(link.steam_id) !== String(pending.steamId)) throw new Error('The linked SCUM account changed. Prepare the airlift again.');
    await verifyPortalAirliftReady(session, link, player);

    // Give the player time to return from the browser to the SCUM game window.
    if (PORTAL_AIRLIFT_LAUNCH_DELAY_MS > 0) {
      await new Promise((resolve) => setTimeout(resolve, PORTAL_AIRLIFT_LAUNCH_DELAY_MS));
    }

    // Re-check online status, linked account, cooldown, and cash immediately before charging.
    ({ link, player } = await loadPortalAirliftPlayer(session));
    if (String(link.steam_id) !== String(pending.steamId)) throw new Error('The linked SCUM account changed. Prepare the airlift again.');
    const before = await verifyPortalAirliftReady(session, link, player);
    const [x, y] = PORTAL_SECTORS[sector];
    const z = PORTAL_AIRLIFT_ALTITUDE_Z;
    await ggconPost(`/players/${encodeURIComponent(link.steam_id)}/currency`, { action: 'change', amount: -PORTAL_AIRLIFT_PRICE });
    try {
      await ggconPost(`/players/${encodeURIComponent(link.steam_id)}/teleport`, { x, y, z });
    } catch (err) {
      await ggconPost(`/players/${encodeURIComponent(link.steam_id)}/currency`, { action: 'change', amount: PORTAL_AIRLIFT_PRICE }).catch(() => {});
      throw new Error(`Airlift failed and your $${PORTAL_AIRLIFT_PRICE.toLocaleString('en-CA')} was returned. ${err.message}`);
    }
    const now = new Date().toISOString();
    const { error: rideError } = await getDb().from('watcher_airlift_rides').insert({ guild_id: String(session.guildId), discord_id: String(session.discordId), steam_id: String(link.steam_id), player_name: pending.playerName || link.scum_name || null, sector, destination_x: x, destination_y: y, destination_z: z, price: PORTAL_AIRLIFT_PRICE, status: 'completed', completed_at: now });
    if (rideError) console.warn('⚠️ Airlift ride record failed:', rideError.message);
    await portalTransaction({ guildId: session.guildId, discordId: session.discordId, steamId: link.steam_id, playerName: pending.playerName || link.scum_name, type: 'airlift_taxi', title: `Airlift Taxi to ${sector}`, amount: -PORTAL_AIRLIFT_PRICE, before, after: before - PORTAL_AIRLIFT_PRICE, details: { sector, x, y, z } });
    portalAirliftPending.delete(key);
    return { ok: true, stage: 'launched', sector, nextRide: new Date(Date.now() + 3600000).toISOString() };
  } finally {
    portalAirliftLaunches.delete(key);
  }
}

async function portalRental(session){const link=await portalLink(session);if(!link?.steam_id)throw new Error('Your Discord account is not linked to a SCUM player.');return portalCreateRental({guildId:session.guildId,discordId:session.discordId,steamId:link.steam_id,playerName:link.scum_name});}
async function portalRefund(session,body){
  const id=String(body.transactionId||''); const amount=Number(body.amount); const reason=String(body.reason||'').trim(); if(!id||!Number.isFinite(amount)||amount<=0) throw new Error('Enter a valid refund amount.'); if(!reason) throw new Error('A refund reason is required.');
  const {data:tx,error}=await getDb().from(TRANSACTIONS_TABLE).select('*').eq('id',id).eq('guild_id',String(session.guildId)).maybeSingle(); if(error) throw error; if(!tx) throw new Error('Transaction not found.'); if(!tx.refundable) throw new Error('This transaction is not refundable.');
  const max=Math.abs(Number(tx.amount||0))-Number(tx.refunded_amount||0); if(amount>max+0.001) throw new Error(`Maximum remaining refund is $${max.toFixed(2)}.`); if(!tx.steam_id) throw new Error('No linked Steam ID is attached to this transaction.');
  await ggconPost(`/players/${encodeURIComponent(tx.steam_id)}/currency`,{action:'change',amount}); const total=Number(tx.refunded_amount||0)+amount; const full=total>=Math.abs(Number(tx.amount||0))-0.001; const now=new Date().toISOString();
  const {error:updateError}=await getDb().from(TRANSACTIONS_TABLE).update({refunded_amount:total,refund_status:full?'fully_refunded':'partially_refunded',refunded_by_discord_id:String(session.discordId),refunded_by_name:session.displayName||'Admin',refund_reason:reason,refunded_at:now,updated_at:now}).eq('id',id); if(updateError) throw updateError;
  await getDb().from(TRANSACTIONS_TABLE).insert({guild_id:String(session.guildId),discord_id:tx.discord_id,steam_id:tx.steam_id,player_name:tx.player_name,type:'refund',title:`Refund: ${tx.title}`,amount, currency:'cash',status:'completed',details:{reason,admin:session.displayName||'Admin'},refundable:false,original_transaction_id:tx.id,created_at:now,updated_at:now}); return {ok:true,amount};
}


function cleanAdminText(value) {
  return String(value || '').replace(/<@!?(\d+)>/g, '@DiscordUser').replace(/`/g, '');
}
async function adminSearchPlayers(session, body) {
  const query=String(body.query||'').trim(); if(!query) throw new Error('Enter a player name or Steam ID.');
  const result=await getPlayerForLookup(query);
  const matches=result?.type==='single'?[result.player]:(result?.matches||[]);
  return {players:matches.slice(0,25).map(p=>({steamId:String(p.userId||p.steamId||''),name:getPlayerDisplayName(p),online:!!(p.online===true||p.ping!==undefined),cash:playerCash(p),fame:playerFame(p)}))};
}

async function portalAbandonedVehicleReview(session, days = 14) {
  if (!session?.isAdmin) throw new Error('Admin access required.');
  const thresholdDays = [7, 14, 30].includes(Number(days)) ? Number(days) : 14;
  const data = await ggconGet('/vehicles.json');
  const vehicles = Array.isArray(data?.vehicles) ? data.vehicles : [];
  const now = Date.now();
  const rows = vehicles.map((vehicle) => {
    const raw = vehicle?.lastActive;
    const ms = raw ? new Date(raw).getTime() : NaN;
    const hasActivity = Number.isFinite(ms);
    const inactiveDays = hasActivity ? Math.max(0, Math.floor((now - ms) / 86400000)) : null;
    return {
      id: String(vehicle?.id ?? ''),
      name: String(vehicle?.name || vehicle?.class || 'Vehicle'),
      className: String(vehicle?.class || ''),
      owner: vehicle?.owner ? String(vehicle.owner) : null,
      ownerSteamId: vehicle?.ownerSteamId ? String(vehicle.ownerSteamId) : null,
      rendered: vehicle?.rendered === true,
      lastActive: hasActivity ? new Date(ms).toISOString() : null,
      inactiveDays,
      reviewCandidate: hasActivity && inactiveDays >= thresholdDays,
      location: vehicle?.location || null,
    };
  });
  const candidates = rows.filter((row) => row.reviewCandidate).sort((a, b) => (b.inactiveDays || 0) - (a.inactiveDays || 0));
  return {
    thresholdDays,
    totalVehicles: rows.length,
    withActivity: rows.filter((row) => row.lastActive).length,
    withoutActivity: rows.filter((row) => !row.lastActive).length,
    candidates,
    note: 'Read-only review. Vehicles with lastActive=null are not considered abandoned.',
  };
}

async function adminPlayerInfo(session, steamId, view) {
  steamId=String(steamId||'').trim(); if(!steamId) throw new Error('Steam ID is required.');
  let content;
  if(view==='details') {
    content=await buildPlayerDetailsBySteamId(steamId, session.guildId);
    try {
      const geo = await portalAdminIpLocation(session, steamId);
      if (geo?.content) content = `${content}\n\n${geo.content}`;
    } catch (err) {
      const message = String(err?.message || 'Location unavailable.');
      content = `${content}\n\n🌐 Approximate IP Location\n\nUnavailable: ${message}`;
    }
  }
  else if(view==='vehicles') content=await buildVehiclesBySteamId(steamId);
  else if(view==='squad') content=await buildSquadBySteamId(steamId);
  else if(view==='nearby') content=await buildNearVehiclesBySteamId(steamId);
  else throw new Error('Unknown player view.');
  return {content:cleanAdminText(content)};
}
function portalAdminContext(session, sink){
  return {guildId:String(session.guildId),user:{id:String(session.discordId),username:session.displayName||'Admin',tag:session.displayName||'Admin'},reply:async payload=>sink(payload),update:async payload=>sink(payload)};
}
async function adminAdjust(session, body){
  const steamId=String(body.steamId||'').trim(),kind=String(body.kind||''),amount=Math.floor(Number(body.amount)),reason=String(body.reason||'').trim();
  if(!steamId||!['cash','fame'].includes(kind)||!Number.isFinite(amount)||amount===0) throw new Error('Choose cash or fame and enter a non-zero whole amount.');
  if(!reason) throw new Error('A reason is required.');
  await ggconPost(`/players/${encodeURIComponent(steamId)}/${kind==='cash'?'currency':'fame'}`,{action:'change',amount});
  const target=await getPlayerForLookup(steamId).catch(()=>null); const p=target?.type==='single'?target.player:null;
  await portalTransaction({guildId:session.guildId,discordId:session.discordId,steamId,playerName:p?getPlayerDisplayName(p):steamId,type:`admin_${kind}_adjustment`,title:`Admin ${kind} adjustment`,amount:kind==='cash'?amount:0,details:{kind,amount,reason,admin:session.displayName||'Admin'}});
  return {ok:true};
}
async function adminJailAction(session,body){
  const steamId=String(body.steamId||'').trim(),action=String(body.action||''); if(!steamId||!['jail','unjail'].includes(action)) throw new Error('Invalid jail action.');
  let message=''; const ctx=portalAdminContext(session,p=>{message=typeof p==='string'?p:(p?.content||'');});
  if(action==='jail') await jailPlayerBySteamId(ctx,steamId); else await unjailPlayerBySteamId(ctx,steamId);
  return {ok:true,message:cleanAdminText(message)};
}
async function adminLinkForSteam(guildId,steamId){return (await safeRows(PLAYER_LINKS_TABLE,q=>q.select('*').eq('guild_id',String(guildId)).eq('steam_id',String(steamId)).limit(1)))[0]||null;}
async function adminModeration(session,body){
  const steamId=String(body.steamId||'').trim(),action=String(body.action||''),reason=String(body.reason||'').trim(),confirm=String(body.confirm||'').toUpperCase();
  if(!steamId||!['ban','unban','unlink'].includes(action)) throw new Error('Invalid moderation action.');
  if(action==='unlink'){
    if(confirm!=='UNLINK') throw new Error('Type UNLINK to confirm.');
    const {error}=await getDb().from(PLAYER_LINKS_TABLE).delete().eq('guild_id',String(session.guildId)).eq('steam_id',steamId); if(error) throw error;
    return {ok:true,message:'Discord link removed.'};
  }
  if(!reason) throw new Error('A reason is required.');
  if(confirm!==action.toUpperCase()) throw new Error(`Type ${action.toUpperCase()} to confirm.`);
  const link=await adminLinkForSteam(session.guildId,steamId);
  const guild=botRef?.guilds?.cache?.get(String(session.guildId));
  if(action==='ban'){
    if(link?.discord_id){const member=await guild?.members?.fetch(String(link.discord_id)).catch(()=>null);if(String(link.discord_id)===String(guild?.ownerId)||member?.roles?.cache?.some(r=>STAFF_ROLE_NAMES.has(String(r.name||'').toLowerCase()))) throw new Error('Ban blocked because the linked Discord account is staff or owns the server.');}
    await ggconPost(`/players/${encodeURIComponent(steamId)}/ban`,{});
    if(link?.discord_id&&guild) await guild.members.ban(String(link.discord_id),{reason:`Outpost X portal ban by ${session.displayName||'Admin'}: ${reason}`}).catch(()=>{});
    return {ok:true,message:'Player banned from SCUM. Linked Discord account was also banned when available.'};
  }
  await ggconPost(`/players/${encodeURIComponent(steamId)}/unban`,{});
  if(link?.discord_id&&guild) await guild.bans.remove(String(link.discord_id),`Outpost X portal unban by ${session.displayName||'Admin'}: ${reason}`).catch(()=>{});
  return {ok:true,message:'Player unbanned from SCUM. Linked Discord ban was removed when available.'};
}

function portalCtx(session){return {guildId:String(session.guildId),discordId:String(session.discordId),displayName:session.displayName||'Player',isAdmin:!!session.isAdmin,isOwner:!!session.isOwner,db:getDb(),bot:botRef};}
async function portalInsuranceData(session){const link=await portalLink(session);if(!link?.steam_id)return{policies:[],claims:[],vehicles:[]};return portalInsuranceOptions({...portalCtx(session),steamId:String(link.steam_id)});}

function acceptsCompression(req) {
  const value = String(req?.headers?.['accept-encoding'] || '');
  if (/\bbr\b/.test(value)) return 'br';
  if (/\bgzip\b/.test(value)) return 'gzip';
  return '';
}
function sendPayload(res, status, body, contentType, cacheControl='no-store') {
  const raw = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  const encoding = raw.length >= 1024 ? acceptsCompression(res._watcherReq) : '';
  let payload = raw;
  if (encoding === 'br') payload = zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } });
  else if (encoding === 'gzip') payload = zlib.gzipSync(raw, { level: 6 });
  const headers = {
    'Content-Type': contentType,
    'Cache-Control': cacheControl,
    'Content-Length': payload.length,
    'Vary': 'Accept-Encoding',
  };
  if (encoding) headers['Content-Encoding'] = encoding;
  res.writeHead(status, headers);
  res.end(payload);
}
function json(res, status, body, cacheControl='no-store') {
  sendPayload(res, status, JSON.stringify(body), 'application/json; charset=utf-8', cacheControl);
}
function text(res, status, body, contentType = 'text/plain; charset=utf-8', cacheControl='no-store') {
  sendPayload(res, status, body, contentType, cacheControl);
}

function unauthorized(res, status = 403) {
  text(res, status, 'Outpost Command Center access denied or expired. Open it again from the Discord Command Center button.');
}

async function requirePermission(session, key) {
  if (!(await canUse(getDb(), session, key))) throw new Error('Your role does not have permission to use this tool.');
}

async function handleHttp(req, res) {
  res._watcherReq = req;
  pruneAuthState();
  const host = req.headers.host || 'localhost';
  const url = new URL(req.url, `http://${host}`);

  if (url.pathname === '/portal/login') {
    let existing = getSession(req);
    if (existing) existing = await refreshPortalSessionAccess(existing, true);
    if (existing) return setPortalSessionCookie(res, existing, '/portal');
    const config = discordOAuthConfig();
    if (!config.base || !config.clientId || !config.clientSecret || !config.redirectUri) {
      return oauthErrorPage(res, 'Single-click Discord login is not configured yet. Add DISCORD_CLIENT_SECRET in Railway and register the portal callback URL in the Discord Developer Portal.');
    }
    const state = createOAuthState();
    const authorize = new URL('https://discord.com/oauth2/authorize');
    authorize.searchParams.set('client_id', config.clientId);
    authorize.searchParams.set('response_type', 'code');
    authorize.searchParams.set('redirect_uri', config.redirectUri);
    authorize.searchParams.set('scope', 'identify');
    authorize.searchParams.set('state', state);
    res.writeHead(302, { Location: authorize.toString(), 'Cache-Control': 'no-store' });
    return res.end();
  }

  if (url.pathname === '/portal/oauth/callback') {
    const config = discordOAuthConfig();
    const state = String(url.searchParams.get('state') || '');
    const code = String(url.searchParams.get('code') || '');
    const oauthState = oauthStates.get(state);
    oauthStates.delete(state);
    if (url.searchParams.get('error')) return oauthErrorPage(res, 'Discord authorization was cancelled or denied.');
    if (!oauthState || oauthState.expiresAt <= Date.now() || !code) return oauthErrorPage(res, 'That secure Discord login request expired. Please try again.');
    try {
      const accessToken = await exchangeDiscordOAuthCode(code, config);
      const user = await fetchDiscordOAuthUser(accessToken);
      const guild = botRef?.guilds?.cache?.get(config.guildId) || await botRef?.guilds?.fetch(config.guildId).catch(() => null);
      if (!guild) throw new Error('Outpost X Discord server could not be verified.');
      const member = await guild.members.fetch(user.id).catch(() => null);
      if (!member) throw new Error('You must be a member of the Outpost X Discord server.');
      if (!hasPortalAccess(member)) throw new Error('You need the Outpost X player role before entering the Command Center.');
      const session = createPortalSession(user, member, config.guildId);
      return setPortalSessionCookie(res, session, '/portal');
    } catch (err) {
      return oauthErrorPage(res, err.message);
    }
  }

  if (url.pathname === '/tracker/access') {
    const token = String(url.searchParams.get('token') || '');
    const grant = accessTokens.get(token);
    if (!grant || grant.expiresAt <= Date.now()) return unauthorized(res);
    accessTokens.delete(token);
    const now = Date.now();
    const session = {
      discordId: grant.discordId,
      guildId: grant.guildId,
      displayName: grant.displayName,
      avatar: grant.avatar,
      isAdmin: !!grant.isAdmin,
      isOwner: !!grant.isOwner,
      roleCheckedAt: now,
      expiresAt: now + PORTAL_SESSION_MS,
    };
    return setPortalSessionCookie(res, session, '/portal');
  }

  if (url.pathname === '/tracker/health') return json(res, 200, { ok: true });
  // Public favicon so browsers can load the Watcher emblem before or after login.
  if (url.pathname === '/portal/assets/favicon.png' || url.pathname === '/favicon.ico') {
    if (!fs.existsSync(portalFaviconPath)) return text(res, 404, 'Portal favicon is missing.');
    res.writeHead(200, {'Content-Type':'image/png','Cache-Control':'public, max-age=604800, stale-while-revalidate=86400'});
    return fs.createReadStream(portalFaviconPath).pipe(res);
  }

  let session = getSession(req);
  if (session) session = await refreshPortalSessionAccess(session, url.pathname === '/portal');
  if (!session) {
    if (url.pathname === '/portal' || url.pathname === '/tracker') {
      res.writeHead(302, { Location: '/portal/login', 'Cache-Control': 'no-store' });
      return res.end();
    }
    return unauthorized(res, 401);
  }
  // Rolling login: every authenticated visit renews the signed cookie for another 30 days.
  attachPortalSessionCookie(res, session);

  if (url.pathname === '/tracker') {
    res.writeHead(302, { Location: '/portal?section=surveillance', 'Cache-Control': 'no-store' });
    return res.end();
  }
  if (url.pathname === '/tracker/view') {
    try { await requirePermission(session, 'use_surveillance'); } catch { return unauthorized(res); }
    if (!fs.existsSync(htmlPath)) return text(res, 500, 'surveillance.html is missing.');
    return text(res, 200, fs.readFileSync(htmlPath, 'utf8'), 'text/html; charset=utf-8');
  }

  if (url.pathname === '/portal') {
    if (!fs.existsSync(portalHtmlPath)) return text(res, 500, 'portal.html is missing.');
    const html = fs.readFileSync(portalHtmlPath, 'utf8').replaceAll('__PORTAL_ASSET_VERSION__', portalAssetVersion());
    return text(res, 200, html, 'text/html; charset=utf-8');
  }
  if (url.pathname === '/portal/assets/portal.css') return text(res,200,fs.readFileSync(portalCssPath,'utf8'),'text/css; charset=utf-8','public, max-age=31536000, immutable');
  if (url.pathname === '/portal/assets/portal.js') return text(res,200,fs.readFileSync(portalJsPath,'utf8'),'application/javascript; charset=utf-8','public, max-age=31536000, immutable');
  if (url.pathname === '/portal/assets/outpost.jpg') { res.writeHead(200, {'Content-Type':'image/jpeg','Cache-Control':'public, max-age=604800, stale-while-revalidate=86400'}); return fs.createReadStream(portalOutpostPath).pipe(res); }
  if (url.pathname === '/portal/assets/watcher.jpg') { res.writeHead(200, {'Content-Type':'image/jpeg','Cache-Control':'public, max-age=604800, stale-while-revalidate=86400'}); return fs.createReadStream(portalWatcherPath).pipe(res); }
  const staffAssetMatch = url.pathname.match(/^\/portal\/assets\/staff\/([a-z-]+)\.webp$/);
  if (staffAssetMatch && portalStaffAssets.has(staffAssetMatch[1])) { const assetPath = portalStaffAssets.get(staffAssetMatch[1]); if (!fs.existsSync(assetPath)) return text(res, 404, 'Staff image not found.'); res.writeHead(200, {'Content-Type':'image/webp','Cache-Control':'public, max-age=604800, stale-while-revalidate=86400'}); return fs.createReadStream(assetPath).pipe(res); }

  if (url.pathname === '/portal/api/stream') {
    const key = portalRevisionKey(session.guildId);
    res.writeHead(200, {
      'Content-Type':'text/event-stream; charset=utf-8',
      'Cache-Control':'no-cache, no-transform',
      'Connection':'keep-alive',
      'X-Accel-Buffering':'no',
    });
    res.write(`event: ready\ndata: ${JSON.stringify(getPortalRevision(session.guildId))}\n\n`);
    const listeners = revisionStreams.get(key) || new Set();
    listeners.add(res); revisionStreams.set(key,listeners);
    const heartbeat=setInterval(()=>{try{res.write(': heartbeat\n\n')}catch{}},25000); heartbeat.unref?.();
    req.on('close',()=>{clearInterval(heartbeat);listeners.delete(res);if(!listeners.size)revisionStreams.delete(key)});
    return;
  }

  if (url.pathname === '/portal/api/revision') {
    const revision = getPortalRevision(session.guildId);
    return json(res, 200, { revision: revision.value, updatedAt: new Date(revision.updatedAt).toISOString() });
  }

  if (url.pathname.startsWith('/portal/api/') && ['POST','PUT','PATCH','DELETE'].includes(req.method || 'GET')) {
    bumpPortalRevision(session.guildId);
  }

  if (url.pathname === '/portal/api/overview') {
    try { const key=`overview:${session.guildId}:${session.discordId}`; return json(res,200,await cachedFlight(key,8000,()=>buildPortalOverview(session))); }
    catch (err) { return json(res, 500, { error: err.message }); }
  }
  if (url.pathname === '/portal/api/action/taxi/prepare' && req.method === 'POST') {
    try { await requireFeature(session.guildId,'airlift','Airlift Taxi'); return json(res, 200, await portalTaxiPrepare(session, await readJsonBody(req))); }
    catch (err) { return json(res, 400, { error: err.message }); }
  }
  if (url.pathname === '/portal/api/action/taxi/send' && req.method === 'POST') {
    try { return json(res, 200, await portalTaxiSend(session, await readJsonBody(req))); }
    catch (err) { return json(res, 400, { error: err.message }); }
  }
  if (url.pathname === '/portal/api/action/taxi/cancel' && req.method === 'POST') {
    try { return json(res, 200, await portalTaxiCancel(session)); }
    catch (err) { return json(res, 400, { error: err.message }); }
  }
  if (url.pathname === '/portal/api/action/rental' && req.method === 'POST') {
    try { await requireFeature(session.guildId,'rentals','Dirtbike rentals'); return json(res, 200, await portalRental(session)); }
    catch (err) { return json(res, 400, { error: err.message }); }
  }
  if (url.pathname === '/portal/api/action/shop' && req.method === 'POST') {
    try { await requireFeature(session.guildId,'purchases','Server purchases'); const link=await portalLink(session); return json(res,200,await buyPackageForPortal({guildId:session.guildId,discordId:session.discordId,steamId:link?.steam_id,playerName:link?.scum_name,packageId:(await readJsonBody(req)).id})); }
    catch (err) { return json(res,400,{error:err.message}); }
  }
  if (url.pathname === '/portal/api/events/rsvp' && req.method === 'POST') { try{const b=await readJsonBody(req);return json(res,200,await portalRsvpEvent(portalCtx(session),b.id,b.attending!==false));}catch(err){return json(res,400,{error:err.message});} }
  if (url.pathname === '/portal/api/events/create' && req.method === 'POST') { try{await requirePermission(session,'manage_events');await requireFeature(session.guildId,'eventCreation','Event creation');return json(res,200,await portalCreateEvent(portalCtx(session),await readJsonBody(req,60*1024*1024)));}catch(err){return json(res,400,{error:err.message});} }
  if (url.pathname === '/portal/api/events/update' && req.method === 'POST') { try{await requirePermission(session,'manage_events');return json(res,200,await portalUpdateEvent(portalCtx(session),await readJsonBody(req,60*1024*1024)));}catch(err){return json(res,400,{error:err.message});} }
  if (url.pathname === '/portal/api/events/status' && req.method === 'POST') { try{await requirePermission(session,'manage_events');return json(res,200,await portalSetEventStatus(portalCtx(session),await readJsonBody(req)));}catch(err){return json(res,400,{error:err.message});} }
  if (url.pathname === '/portal/api/events/delete' && req.method === 'POST') { try{await requirePermission(session,'manage_events');return json(res,200,await portalDeleteEvent(portalCtx(session),(await readJsonBody(req)).id));}catch(err){return json(res,400,{error:err.message});} }
  if (url.pathname === '/portal/api/events/retry-post' && req.method === 'POST') { try{await requirePermission(session,'manage_events');return json(res,200,await portalRetryEventPost(portalCtx(session),(await readJsonBody(req)).id));}catch(err){return json(res,400,{error:err.message});} }
  if (url.pathname === '/portal/api/admin/health' && req.method === 'GET') { try{if(!session.isAdmin)throw new Error('Admin access required.');return json(res,200,await portalHealthSnapshot(session));}catch(err){return json(res,400,{error:err.message});} }
  if (url.pathname === '/portal/api/owner/export' && req.method === 'GET') { try{return json(res,200,await portalBackupExport(session));}catch(err){return json(res,400,{error:err.message});} }
  if (url.pathname === '/portal/api/owner/settings' && req.method === 'GET') { try{if(!session.isOwner)throw new Error('Owner access required.');return json(res,200,{settings:await loadPortalSettings(session.guildId)});}catch(err){return json(res,400,{error:err.message});} }
  if (url.pathname === '/portal/api/owner/settings' && req.method === 'POST') { try{if(!session.isOwner)throw new Error('Owner access required.');return json(res,200,{settings:await savePortalSettings(session.guildId,await readJsonBody(req))});}catch(err){return json(res,400,{error:err.message});} }
  if (url.pathname === '/portal/api/admin/unregistered-active' && req.method === 'GET') { try{return json(res,200,await cachedFlight(`unregistered:${session.guildId}`,10000,()=>portalActiveUnregisteredPlayers(session)));}catch(err){return json(res,400,{error:err.message});} }
  if (url.pathname === '/portal/api/admin/inbox' && req.method === 'GET') { try{if(!session.isAdmin)throw new Error('Admin access required.');const attention=await portalAttentionCounts(session);return json(res,200,{attention,retryQueue:retryQueue.map(x=>({name:x.name,attempts:x.attempts,maxAttempts:x.maxAttempts,nextAt:new Date(x.nextAt).toISOString(),lastError:x.lastError}))});}catch(err){return json(res,400,{error:err.message});} }
  if (url.pathname === '/portal/api/insurance/options') { try{return json(res,200,await portalInsuranceData(session));}catch(err){return json(res,400,{error:err.message});} }
  if (url.pathname === '/portal/api/insurance/buy' && req.method === 'POST') { try{await requireFeature(session.guildId,'insurance','Vehicle insurance');const link=await portalLink(session);const b=await readJsonBody(req);return json(res,200,await portalBuyInsurance({...portalCtx(session),steamId:link?.steam_id},b.vehicleId));}catch(err){return json(res,400,{error:err.message});} }
  if (url.pathname === '/portal/api/insurance/redeem' && req.method === 'POST') { try{const link=await portalLink(session);const b=await readJsonBody(req);return json(res,200,await portalRedeemInsurance({...portalCtx(session),steamId:link?.steam_id},b.claimId));}catch(err){return json(res,400,{error:err.message});} }
  if (url.pathname === '/portal/api/player-shop/create' && req.method === 'POST') { try{return json(res,200,await portalCreateShop(portalCtx(session),await readJsonBody(req)));}catch(err){return json(res,400,{error:err.message});} }
  if (url.pathname === '/portal/api/player-shop/update' && req.method === 'POST') { try{return json(res,200,await portalUpdateShop(portalCtx(session),await readJsonBody(req)));}catch(err){return json(res,400,{error:err.message});} }
  if (url.pathname === '/portal/api/player-shop/toggle' && req.method === 'POST') { try{return json(res,200,await portalToggleShop(portalCtx(session)));}catch(err){return json(res,400,{error:err.message});} }
  if (url.pathname === '/portal/api/player-shop/delete' && req.method === 'POST') { try{return json(res,200,await portalDeleteShop(portalCtx(session)));}catch(err){return json(res,400,{error:err.message});} }
  if (url.pathname === '/portal/api/player-shop/images' && req.method === 'POST') { try{return json(res,200,await portalSetShopImages(portalCtx(session),await readJsonBody(req,60*1024*1024)));}catch(err){return json(res,400,{error:err.message});} }
  if (url.pathname === '/portal/api/squad/create' && req.method === 'POST') { try{return json(res,200,await portalCreateSquad(portalCtx(session),await readJsonBody(req)));}catch(err){return json(res,400,{error:err.message});} }
  if (url.pathname === '/portal/api/squad/update' && req.method === 'POST') { try{return json(res,200,await portalUpdateSquad(portalCtx(session),await readJsonBody(req)));}catch(err){return json(res,400,{error:err.message});} }
  if (url.pathname === '/portal/api/squad/toggle' && req.method === 'POST') { try{return json(res,200,await portalToggleSquad(portalCtx(session)));}catch(err){return json(res,400,{error:err.message});} }
  if (url.pathname === '/portal/api/squad/delete' && req.method === 'POST') { try{return json(res,200,await portalDeleteSquad(portalCtx(session)));}catch(err){return json(res,400,{error:err.message});} }
  if (url.pathname === '/portal/api/lore/create' && req.method === 'POST') { try{return json(res,200,await portalCreateLore(portalCtx(session),await readJsonBody(req)));}catch(err){return json(res,400,{error:err.message});} }
  if (url.pathname === '/portal/api/lore/update' && req.method === 'POST') { try{return json(res,200,await portalUpdateLore(portalCtx(session),await readJsonBody(req)));}catch(err){return json(res,400,{error:err.message});} }
  if (url.pathname === '/portal/api/lore/toggle' && req.method === 'POST') { try{return json(res,200,await portalToggleLore(portalCtx(session)));}catch(err){return json(res,400,{error:err.message});} }
  if (url.pathname === '/portal/api/lore/delete' && req.method === 'POST') { try{return json(res,200,await portalDeleteLore(portalCtx(session)));}catch(err){return json(res,400,{error:err.message});} }
  if (url.pathname === '/portal/api/lore/images' && req.method === 'POST') { try{return json(res,200,await portalSetLoreImages(portalCtx(session),await readJsonBody(req,60*1024*1024)));}catch(err){return json(res,400,{error:err.message});} }

  if (url.pathname === '/portal/api/owner/permissions' && req.method === 'GET') {
    if (!session.isOwner) return unauthorized(res);
    try { return json(res, 200, { permissions: await getAdminPermissions(getDb(), session.guildId), catalog: permissionCatalog() }); }
    catch (err) { return json(res, 400, { error: err.message }); }
  }
  if (url.pathname === '/portal/api/owner/permissions' && req.method === 'POST') {
    if (!session.isOwner) return unauthorized(res);
    try { const body = await readJsonBody(req); return json(res, 200, { ok:true, row: await saveAdminPermissions(getDb(), session.guildId, body.permissions || {}, session.discordId) }); }
    catch (err) { return json(res, 400, { error: err.message }); }
  }

  if (url.pathname === '/portal/api/admin/event-triggers' && req.method === 'GET') {
    try { await requirePermission(session, 'manage_events'); return json(res, 200, await getSpecialEventAdminStatus()); }
    catch (err) { return json(res, 403, { error: err.message }); }
  }
  if (url.pathname === '/portal/api/admin/event-triggers' && req.method === 'POST') {
    try { await requirePermission(session, 'manage_events'); const body = await readJsonBody(req); return json(res, 200, await triggerSpecialEvent(body.action, { ...(body.options || {}), createdBy: session.discordId })); }
    catch (err) { return json(res, 400, { error: err.message }); }
  }

  if (url.pathname === '/portal/api/admin/shop/products' && req.method === 'GET') {
    try { await requirePermission(session, 'manage_server_shop'); return json(res, 200, { products: await listManagedProducts(session.guildId, true) }); }
    catch (err) { return json(res, 403, { error: err.message }); }
  }
  if (url.pathname === '/portal/api/admin/shop/items' && req.method === 'GET') {
    try { await requirePermission(session, 'manage_server_shop'); return json(res, 200, { items: await searchItemCatalog(url.searchParams.get('q') || '', 80) }); }
    catch (err) { return json(res, 403, { error: err.message }); }
  }
  if (url.pathname === '/portal/api/admin/shop/product' && req.method === 'POST') {
    try { await requirePermission(session, 'edit_shop_products'); const body=await readJsonBody(req); if(body.id){const old=(await listManagedProducts(session.guildId,true)).find(x=>String(x.id)===String(body.id)); if(old&&Number(old.price)!==Number(body.price))await requirePermission(session,'edit_shop_prices');} return json(res, 200, { product: await saveManagedProduct(session.guildId, session.discordId, body) }); }
    catch (err) { return json(res, 403, { error: err.message }); }
  }
  if (url.pathname === '/portal/api/admin/shop/delete' && req.method === 'POST') {
    try { await requirePermission(session, 'delete_shop_products'); const body=await readJsonBody(req); return json(res, 200, await deleteManagedProduct(session.guildId, body.id)); }
    catch (err) { return json(res, 403, { error: err.message }); }
  }

  if (url.pathname === '/portal/api/admin/content' && req.method === 'POST') { try{const b=await readJsonBody(req);const ctx=portalCtx(session);if(b.kind==='shop'){await requirePermission(session,'moderate_player_shops');return json(res,200,await portalAdminShop(ctx,b));}if(b.kind==='squad'){await requirePermission(session,'moderate_squads');return json(res,200,await portalAdminSquad(ctx,b));}if(b.kind==='lore'){await requirePermission(session,'moderate_player_lore');return json(res,200,await portalAdminLore(ctx,b));}throw new Error('Unknown content type.');}catch(err){return json(res,400,{error:err.message});} }
  if (url.pathname === '/portal/api/admin/abandoned-vehicles' && req.method === 'GET') {
    try { await requirePermission(session,'search_players'); return json(res,200,await cachedFlight(`abandoned:${session.guildId}:${url.searchParams.get('days')||14}`,15000,()=>portalAbandonedVehicleReview(session,url.searchParams.get('days')))); }
    catch(err){ return json(res,400,{error:err.message}); }
  }
  if (url.pathname === '/portal/api/admin/search' && req.method === 'POST') { try{await requirePermission(session,'search_players');return json(res,200,await adminSearchPlayers(session,await readJsonBody(req)));}catch(err){return json(res,400,{error:err.message});} }
  if (url.pathname === '/portal/api/admin/ip-location' && req.method === 'POST') { try{await requirePermission(session,'search_players');const b=await readJsonBody(req);return json(res,200,await portalAdminIpLocation(session,b.steamId));}catch(err){return json(res,400,{error:err.message});} }
  if (url.pathname === '/portal/api/admin/player' && req.method === 'POST') { try{await requirePermission(session,'search_players');const b=await readJsonBody(req);return json(res,200,await adminPlayerInfo(session,b.steamId,b.view));}catch(err){return json(res,400,{error:err.message});} }
  if (url.pathname === '/portal/api/admin/adjust' && req.method === 'POST') { try{await requirePermission(session,'adjust_balances');return json(res,200,await adminAdjust(session,await readJsonBody(req)));}catch(err){return json(res,400,{error:err.message});} }
  if (url.pathname === '/portal/api/admin/jail' && req.method === 'POST') { try{await requirePermission(session,'jail_release');return json(res,200,await adminJailAction(session,await readJsonBody(req)));}catch(err){return json(res,400,{error:err.message});} }
  if (url.pathname === '/portal/api/admin/moderate' && req.method === 'POST') { try{const body=await readJsonBody(req);await requirePermission(session,body.action==='ban'||body.action==='unban'?'ban_unban':'search_players');return json(res,200,await adminModeration(session,body));}catch(err){return json(res,400,{error:err.message});} }
  if (url.pathname === '/portal/api/admin/transactions' && req.method === 'GET') {
    try { return json(res, 200, await fetchAdminTransactionPage(session, url)); }
    catch (err) { return json(res, err.message?.toLowerCase().includes('permission') ? 403 : 400, { error: err.message }); }
  }
  if (url.pathname === '/portal/api/admin/refund' && req.method === 'POST') {
    try { await requirePermission(session,'issue_refunds'); return json(res, 200, await portalRefund(session, await readJsonBody(req))); }
    catch (err) { return json(res, 400, { error: err.message }); }
  }


  if (url.pathname.startsWith('/tracker/tiles/hi/')) {
    const match = url.pathname.match(/^\/tracker\/tiles\/hi\/(\d+)_(\d+)\.jpg$/);
    if (!match) return text(res, 404, 'Map tile not found.');
    const x = Number(match[1]);
    const y = Number(match[2]);
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x > 7 || y < 0 || y > 7) return text(res, 404, 'Map tile not found.');
    const tileName = `${x}_${y}.jpg`;
    const tilePath = path.join(portalMapTilesPath, 'hi', tileName);
    if (fs.existsSync(tilePath)) {
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=2592000, immutable' });
      return fs.createReadStream(tilePath).pipe(res);
    }
    if (redirectToMapAsset(res, `tiles/hi/${tileName}`)) return;
    return text(res, 404, 'Map tile not configured.');
  }

  if (url.pathname === '/tracker/map.png') {
    if (fs.existsSync(mapPath)) {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=604800, stale-while-revalidate=86400' });
      return fs.createReadStream(mapPath).pipe(res);
    }
    if (redirectToMapAsset(res, 'tracker-map.png')) return;
    return text(res, 404, 'Map image not configured.');
  }

  if (url.pathname === '/tracker/map-hi.webp') {
    if (fs.existsSync(highResMapPath)) {
      res.writeHead(200, { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=604800, stale-while-revalidate=86400' });
      return fs.createReadStream(highResMapPath).pipe(res);
    }
    if (redirectToMapAsset(res, 'tracker-map-hi.webp')) return;
    return text(res, 404, 'High-resolution map image not configured.');
  }

  if (url.pathname === '/tracker/api/config') {
    return json(res, 200, {
      retentionHours: RETENTION_HOURS,
      sampleSeconds: SAMPLE_SECONDS,
      mapAvailable: fs.existsSync(mapPath) || !!externalMapAssetBaseUrl(),
      mapAssetsExternal: !fs.existsSync(mapPath) && !!externalMapAssetBaseUrl(),
      map: MAP_CALIBRATION,
      world: WORLD,
      sessionExpiresAt: new Date(session.expiresAt).toISOString(),
    });
  }

  if (url.pathname === '/tracker/api/players') {
    try { return json(res, 200, { players: await fetchTrackerPlayers() }); }
    catch (err) { return json(res, 500, { error: err.message }); }
  }

  if (url.pathname === '/tracker/api/live') {
    return json(res, 200, {
      players: [...latestOnline.values()],
      sampledAt: new Date().toISOString(),
    });
  }

  if (url.pathname === '/tracker/api/history') {
    const steamId = String(url.searchParams.get('steamId') || '').trim();
    if (!/^\d{15,20}$/.test(steamId)) return json(res, 400, { error: 'A valid Steam64 ID is required.' });
    try {
      const points = await fetchPlayerHistory(steamId, url.searchParams.get('from'), url.searchParams.get('to'));
      return json(res, 200, { steamId, points });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  if (url.pathname === '/tracker/api/teleport-me' && req.method === 'POST') {
    try {
      await requireFeature(session.guildId,'surveillanceTeleport','Surveillance teleporting');
      const body = await readJsonBody(req);
      const targetSteamId = String(body.targetSteamId || '').trim();
      const recordedAt = String(body.recordedAt || '').trim();
      if (!/^\d{15,20}$/.test(targetSteamId) || !recordedAt) {
        return json(res, 400, { error: 'A recorded player point is required.' });
      }

      // Never accept X/Y/Z from the browser. Re-read the exact recorded point from Supabase.
      const point = await getRecordedPoint(targetSteamId, recordedAt);
      const actor = await resolveSessionSteamId(session);
      await ggconPost(`/players/${encodeURIComponent(actor.steamId)}/teleport`, {
        x: point.x,
        y: point.y,
        z: point.z,
      });
      return json(res, 200, {
        ok: true,
        teleportedSteamId: actor.steamId,
        teleportedName: actor.name,
        sourcePlayer: point.name,
        point,
      });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  return text(res, 404, 'Not found.');
}

function startWebServer() {
  if (serverRef) return serverRef;
  const port = Number(process.env.PORT || process.env.TRACKER_PORT || '8080');
  serverRef = http.createServer((req, res) => {
    handleHttp(req, res).catch((err) => {
      console.error('❌ Tracker HTTP error:', err);
      if (!res.headersSent) json(res, 500, { error: 'Internal tracker error.' });
      else res.end();
    });
  });
  serverRef.listen(port, '0.0.0.0', () => {
    console.log(`👁️ Watcher Tracker web server listening on port ${port}`);
  });
  return serverRef;
}

async function startTrackerOnBoot(bot) {
  botRef = bot;
  startWebServer();
  await recordMovementSample();
  scheduleMovementSample(latestOnline.size > 0 ? SAMPLE_SECONDS : IDLE_SAMPLE_SECONDS);
  watcherScheduler.registerTask('movement-retention-cleanup', CLEANUP_MINUTES*60_000, cleanupOldTrackerData, {initialDelayMs:5000,jitterMs:30000,essential:true});
  await cleanupOldTrackerData();
  console.log(`👁️ Movement tracker active: ${SAMPLE_SECONDS}s online / ${IDLE_SAMPLE_SECONDS}s idle samples, ${RETENTION_HOURS}h retention.`);
}

async function handleTrackerCommand(message) {
  const content = String(message.content || '').trim().toLowerCase();
  if (content !== '!tracker') return false;
  if (!message.guild || !hasTrackerRole(message.member)) {
    await message.reply('This tracker is restricted to Outpost X staff.').catch(() => {});
    return true;
  }

  await message.delete().catch(() => {});
  await message.channel.send({
    content: '👁️ **Watcher Surveillance**\nStaff access only. Use the button below whenever you need a private tracker session.',
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('tracker_open')
          .setLabel('Open Player Tracker')
          .setEmoji('👁️')
          .setStyle(ButtonStyle.Secondary)
      ),
    ],
  }).catch(() => null);
  return true;
}

async function handleTrackerInteraction(interaction) {
  if (!interaction.isButton() || !['tracker_open','command_center_open'].includes(interaction.customId)) return false;
  const isPortal = interaction.customId === 'command_center_open';
  const allowed = isPortal ? hasPortalAccess(interaction.member) : hasTrackerRole(interaction.member);
  if (!interaction.guild || !allowed) {
    await interaction.reply({ content: isPortal ? 'You need the Outpost X player role before entering the Command Center.' : 'This tracker is restricted to Outpost X staff.', flags: MessageFlags.Ephemeral });
    return true;
  }

  const base = publicBaseUrl();
  if (!base) {
    await interaction.reply({
      content: 'Tracker web access is not configured yet. Set `TRACKER_PUBLIC_URL` to this Railway service public URL.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const token = createAccessToken(interaction.user.id, interaction.guild.id, { displayName: interaction.member?.displayName || interaction.user.globalName || interaction.user.username, avatar: interaction.user.displayAvatarURL({ extension: 'png', size: 128 }), isAdmin: hasTrackerRole(interaction.member), isOwner: hasOwnerRole(interaction.member) });
  const link = `${base}/tracker/access?token=${encodeURIComponent(token)}`;
  await interaction.reply({
    content: `👁️ **Private Outpost Command Center Access**\nThis link is one-time use and expires in ${ACCESS_TOKEN_SECONDS} seconds. The browser stays signed in for ${PORTAL_SESSION_DAYS} rolling days, with access rechecked against Discord.`,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel('Enter Command Center').setStyle(ButtonStyle.Link).setURL(link).setEmoji('👁️')
      ),
    ],
    flags: MessageFlags.Ephemeral,
  });
  return true;
}


async function handleCommandCenterCommand(message) {
  if (String(message.content || '').trim().toLowerCase() !== '!commandcentersetup') return false;
  if (!message.guild || !hasTrackerRole(message.member)) { await message.reply('Only Outpost X staff can install the Command Center panel.').catch(()=>{}); return true; }
  await message.delete().catch(()=>{});
  const recent = await message.channel.messages.fetch({ limit: 50 }).catch(()=>null);
  for (const msg of recent?.values?.() || []) {
    if (msg.author?.id === message.client.user.id && (msg.components||[]).some(r => r.components?.some(c => ['player_dashboard_open','command_center_open'].includes(c.customId) || String(c.url || '').includes('/portal/login')))) await msg.delete().catch(()=>{});
  }
  const base = publicBaseUrl();
  if (!base) { await message.channel.send('Command Center web access is not configured. Set `TRACKER_PUBLIC_URL` first.'); return true; }
  await message.channel.send({
    content: '👁️ **THE OUTPOST COMMAND CENTER**\nYour secure gateway to Outpost X services, vehicles, records, shops, lore, squads, and Watcher tools.',
    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setURL(`${base}/portal/login`).setLabel('Enter Command Center').setEmoji('👁️').setStyle(ButtonStyle.Link))]
  });
  return true;
}

module.exports = {
  startTrackerOnBoot,
  handleTrackerCommand,
  handleTrackerInteraction,
  handleCommandCenterCommand,
};
