const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { URL } = require('url');
const { createClient } = require('@supabase/supabase-js');
const { MAP_CALIBRATION } = require('./mapCalibration');
const { getPortalCatalog, buyPackageForPortal } = require('./shop');
const { portalCreateRental } = require('./rentals');
const { portalInsuranceOptions, portalBuyInsurance, portalRedeemInsurance } = require('./insurance');
const { portalCreateShop, portalUpdateShop, portalToggleShop, portalDeleteShop, portalSetShopImages, portalAdminShop } = require('./playerShops');
const { portalCreateSquad, portalUpdateSquad, portalToggleSquad, portalDeleteSquad, portalAdminSquad } = require('./squadFinder');
const { portalCreateLore, portalUpdateLore, portalToggleLore, portalDeleteLore, portalSetLoreImages, portalAdminLore } = require('./playerLore');
const { portalListEvents, portalRsvpEvent, portalCreateEvent, portalUpdateEvent, portalSetEventStatus, portalDeleteEvent } = require('./events');
const {
  buildPlayerDetailsBySteamId,
  buildVehiclesBySteamId,
  getVehiclesForSteamIdStructured,
  buildSquadBySteamId,
  buildNearVehiclesBySteamId,
  getPlayerForLookup,
  getPlayerDisplayName,
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
const RETENTION_HOURS = Math.max(1, Number(process.env.TRACKER_RETENTION_HOURS || '48'));
const MOVE_THRESHOLD_UNITS = Math.max(0, Number(process.env.TRACKER_MOVE_THRESHOLD_UNITS || '1000'));
const HEARTBEAT_SECONDS = Math.max(30, Number(process.env.TRACKER_HEARTBEAT_SECONDS || '300'));
const ACCESS_TOKEN_SECONDS = Math.max(30, Number(process.env.TRACKER_ACCESS_TOKEN_SECONDS || '120'));
const SESSION_MINUTES = Math.max(5, Number(process.env.TRACKER_SESSION_MINUTES || '60'));
const CLEANUP_MINUTES = Math.max(10, Number(process.env.TRACKER_CLEANUP_MINUTES || '60'));
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
const htmlPath = path.join(__dirname, 'surveillance.html');
const portalHtmlPath = path.join(__dirname, 'portal.html');
const portalCssPath = path.join(__dirname, 'portal.css');
const portalJsPath = path.join(__dirname, 'portal.js');
const portalOutpostPath = path.join(__dirname, 'portal-outpost.jpg');
const portalWatcherPath = path.join(__dirname, 'portal-watcher.jpg');
const TRANSACTIONS_TABLE = process.env.WATCHER_TRANSACTIONS_TABLE || 'watcher_transactions';

let dbClient = null;
let botRef = null;
let serverRef = null;
let sampleTimer = null;
let cleanupTimer = null;
let sampleRunning = false;
let latestOnline = new Map();
const lastSaved = new Map();
const accessTokens = new Map();
const sessions = new Map();
const portalAirliftPending = new Map();
const portalAirliftLaunches = new Set();
const PORTAL_AIRLIFT_PENDING_MS = 10 * 60 * 1000;
const PORTAL_AIRLIFT_PRICE = Math.max(0, Number(process.env.AIRLIFT_PRICE || '1000'));
const PORTAL_AIRLIFT_ALTITUDE_Z = Number(process.env.AIRLIFT_ALTITUDE_Z || '150000');
const PORTAL_AIRLIFT_LAUNCH_DELAY_MS = Math.max(0, Number(process.env.AIRLIFT_LAUNCH_DELAY_MS || '10000'));
const PORTAL_AIRLIFT_PARACHUTE_ITEM = process.env.AIRLIFT_PARACHUTE_ITEM || 'BeginPlay_Parachute';

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
  const sid = parseCookies(req).watcher_tracker_session;
  if (!sid) return null;
  const session = sessions.get(sid);
  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(sid);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_MINUTES * 60_000;
  return { sid, ...session };
}

function pruneAuthState() {
  const now = Date.now();
  for (const [token, grant] of accessTokens) if (grant.expiresAt <= now) accessTokens.delete(token);
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
  const [insurance,rentals,rides,shops,myShop,squads,mySquad,lore,myLore,transactions,adminTransactions,events] = await Promise.all([
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
    session.isAdmin?safeRows(TRANSACTIONS_TABLE,q=>q.select('*').eq('guild_id',String(session.guildId)).gte('created_at',cutoff15).order('created_at',{ascending:false}).limit(1000)):[],
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
  return {
    me:{discordId:session.discordId,displayName:session.displayName||link?.discord_tag||'Outpost Player',avatar:session.avatar||null,isAdmin:!!session.isAdmin,sessionExpiresAt:new Date(session.expiresAt).toISOString()},
    player:{steamId:steamId||null,name:link?.scum_name||playerDetail?.characterName||playerDetail?.name||onlineSample?.name||null,online:!!onlineSample,cash:playerCash(playerDetail),fame:playerFame(playerDetail)},
    vehicles,insurance,rental:rentals.find(r=>['active','removal_pending'].includes(r.status))||rentals[0]||null,
    airlift:{ready:!nextRide||nextRide<=new Date(),nextRide:nextRide?.toISOString()||null},shops,myShop:myShop[0]||null,squads,mySquad:mySquad[0]||null,lore,myLore:myLore[0]||null,events,transactions,adminTransactions,
    shopCatalog:getPortalCatalog(),
    mapCalibration: MAP_CALIBRATION
  };
}
const PORTAL_SECTORS = {D4:[493707,525891],D3:[193707,525891],D2:[-106293,525891],D1:[-406293,525891],D0:[-693133,480558],C4:[493707,225891],C3:[193707,225891],C2:[-152325,290058],C1:[-406293,225891],C0:[-706293,225891],B4:[493707,-74109],B3:[193707,-74109],B2:[-123750,-166083],B1:[-406293,-74109],B0:[-825081,-141941],A4:[493707,-374109],A3:[193707,-374109],A2:[-106293,-374109],A1:[-406293,-374109],A0:[-706293,-374109],Z4:[410705,-755571],Z3:[193707,-674109],Z2:[-106293,-674109],Z1:[-406293,-674109],Z0:[-712773,-706255]};
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
async function adminPlayerInfo(session, steamId, view) {
  steamId=String(steamId||'').trim(); if(!steamId) throw new Error('Steam ID is required.');
  let content;
  if(view==='details') content=await buildPlayerDetailsBySteamId(steamId, session.guildId);
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

function portalCtx(session){return {guildId:String(session.guildId),discordId:String(session.discordId),displayName:session.displayName||'Player',isAdmin:!!session.isAdmin,db:getDb(),bot:botRef};}
async function portalInsuranceData(session){const link=await portalLink(session);if(!link?.steam_id)return{policies:[],claims:[],vehicles:[]};return portalInsuranceOptions({...portalCtx(session),steamId:String(link.steam_id)});}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function text(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  res.end(body);
}

function unauthorized(res) {
  text(res, 403, 'Outpost Command Center access denied or expired. Open it again from the Discord Command Center button.');
}

async function handleHttp(req, res) {
  pruneAuthState();
  const host = req.headers.host || 'localhost';
  const url = new URL(req.url, `http://${host}`);

  if (url.pathname === '/tracker/access') {
    const token = String(url.searchParams.get('token') || '');
    const grant = accessTokens.get(token);
    if (!grant || grant.expiresAt <= Date.now()) return unauthorized(res);
    accessTokens.delete(token);
    const sid = randomToken(32);
    sessions.set(sid, {
      discordId: grant.discordId,
      guildId: grant.guildId,
      displayName: grant.displayName,
      avatar: grant.avatar,
      isAdmin: !!grant.isAdmin,
      expiresAt: Date.now() + SESSION_MINUTES * 60_000,
    });
    res.writeHead(302, {
      Location: '/portal',
      'Set-Cookie': `watcher_tracker_session=${encodeURIComponent(sid)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MINUTES * 60}`,
      'Cache-Control': 'no-store',
    });
    return res.end();
  }

  if (url.pathname === '/tracker/health') return json(res, 200, { ok: true });

  const session = getSession(req);
  if (!session) return unauthorized(res);

  if (url.pathname === '/tracker') {
    res.writeHead(302, { Location: '/portal?section=surveillance', 'Cache-Control': 'no-store' });
    return res.end();
  }
  if (url.pathname === '/tracker/view') {
    if (!session.isAdmin) return unauthorized(res);
    if (!fs.existsSync(htmlPath)) return text(res, 500, 'surveillance.html is missing.');
    return text(res, 200, fs.readFileSync(htmlPath, 'utf8'), 'text/html; charset=utf-8');
  }

  if (url.pathname === '/portal') {
    if (!fs.existsSync(portalHtmlPath)) return text(res, 500, 'portal.html is missing.');
    return text(res, 200, fs.readFileSync(portalHtmlPath, 'utf8'), 'text/html; charset=utf-8');
  }
  if (url.pathname === '/portal/assets/portal.css') return text(res, 200, fs.readFileSync(portalCssPath, 'utf8'), 'text/css; charset=utf-8');
  if (url.pathname === '/portal/assets/portal.js') return text(res, 200, fs.readFileSync(portalJsPath, 'utf8'), 'application/javascript; charset=utf-8');
  if (url.pathname === '/portal/assets/outpost.jpg') { res.writeHead(200, {'Content-Type':'image/jpeg','Cache-Control':'private, max-age=86400'}); return fs.createReadStream(portalOutpostPath).pipe(res); }
  if (url.pathname === '/portal/assets/watcher.jpg') { res.writeHead(200, {'Content-Type':'image/jpeg','Cache-Control':'private, max-age=86400'}); return fs.createReadStream(portalWatcherPath).pipe(res); }

  if (url.pathname === '/portal/api/overview') {
    try { return json(res, 200, await buildPortalOverview(session)); }
    catch (err) { return json(res, 500, { error: err.message }); }
  }
  if (url.pathname === '/portal/api/action/taxi/prepare' && req.method === 'POST') {
    try { return json(res, 200, await portalTaxiPrepare(session, await readJsonBody(req))); }
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
    try { return json(res, 200, await portalRental(session)); }
    catch (err) { return json(res, 400, { error: err.message }); }
  }
  if (url.pathname === '/portal/api/action/shop' && req.method === 'POST') {
    try { const link=await portalLink(session); return json(res,200,await buyPackageForPortal({guildId:session.guildId,discordId:session.discordId,steamId:link?.steam_id,playerName:link?.scum_name,packageId:(await readJsonBody(req)).id})); }
    catch (err) { return json(res,400,{error:err.message}); }
  }
  if (url.pathname === '/portal/api/events/rsvp' && req.method === 'POST') { try{const b=await readJsonBody(req);return json(res,200,await portalRsvpEvent(portalCtx(session),b.id,b.attending!==false));}catch(err){return json(res,400,{error:err.message});} }
  if (url.pathname === '/portal/api/events/create' && req.method === 'POST') { if(!session.isAdmin)return unauthorized(res);try{return json(res,200,await portalCreateEvent(portalCtx(session),await readJsonBody(req,60*1024*1024)));}catch(err){return json(res,400,{error:err.message});} }
  if (url.pathname === '/portal/api/events/update' && req.method === 'POST') { if(!session.isAdmin)return unauthorized(res);try{return json(res,200,await portalUpdateEvent(portalCtx(session),await readJsonBody(req,60*1024*1024)));}catch(err){return json(res,400,{error:err.message});} }
  if (url.pathname === '/portal/api/events/status' && req.method === 'POST') { if(!session.isAdmin)return unauthorized(res);try{return json(res,200,await portalSetEventStatus(portalCtx(session),await readJsonBody(req)));}catch(err){return json(res,400,{error:err.message});} }
  if (url.pathname === '/portal/api/events/delete' && req.method === 'POST') { if(!session.isAdmin)return unauthorized(res);try{return json(res,200,await portalDeleteEvent(portalCtx(session),(await readJsonBody(req)).id));}catch(err){return json(res,400,{error:err.message});} }
  if (url.pathname === '/portal/api/insurance/options') { try{return json(res,200,await portalInsuranceData(session));}catch(err){return json(res,400,{error:err.message});} }
  if (url.pathname === '/portal/api/insurance/buy' && req.method === 'POST') { try{const link=await portalLink(session);const b=await readJsonBody(req);return json(res,200,await portalBuyInsurance({...portalCtx(session),steamId:link?.steam_id},b.vehicleId));}catch(err){return json(res,400,{error:err.message});} }
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
  if (url.pathname === '/portal/api/admin/content' && req.method === 'POST') { if(!session.isAdmin)return unauthorized(res);try{const b=await readJsonBody(req);const ctx=portalCtx(session);if(b.kind==='shop')return json(res,200,await portalAdminShop(ctx,b));if(b.kind==='squad')return json(res,200,await portalAdminSquad(ctx,b));if(b.kind==='lore')return json(res,200,await portalAdminLore(ctx,b));throw new Error('Unknown content type.');}catch(err){return json(res,400,{error:err.message});} }
  if (url.pathname === '/portal/api/admin/search' && req.method === 'POST') { if(!session.isAdmin)return unauthorized(res); try{return json(res,200,await adminSearchPlayers(session,await readJsonBody(req)));}catch(err){return json(res,400,{error:err.message});} }
  if (url.pathname === '/portal/api/admin/player' && req.method === 'POST') { if(!session.isAdmin)return unauthorized(res); try{const b=await readJsonBody(req);return json(res,200,await adminPlayerInfo(session,b.steamId,b.view));}catch(err){return json(res,400,{error:err.message});} }
  if (url.pathname === '/portal/api/admin/adjust' && req.method === 'POST') { if(!session.isAdmin)return unauthorized(res); try{return json(res,200,await adminAdjust(session,await readJsonBody(req)));}catch(err){return json(res,400,{error:err.message});} }
  if (url.pathname === '/portal/api/admin/jail' && req.method === 'POST') { if(!session.isAdmin)return unauthorized(res); try{return json(res,200,await adminJailAction(session,await readJsonBody(req)));}catch(err){return json(res,400,{error:err.message});} }
  if (url.pathname === '/portal/api/admin/moderate' && req.method === 'POST') { if(!session.isAdmin)return unauthorized(res); try{return json(res,200,await adminModeration(session,await readJsonBody(req)));}catch(err){return json(res,400,{error:err.message});} }
  if (url.pathname === '/portal/api/admin/refund' && req.method === 'POST') {
    if (!session.isAdmin) return unauthorized(res);
    try { return json(res, 200, await portalRefund(session, await readJsonBody(req))); }
    catch (err) { return json(res, 400, { error: err.message }); }
  }


  if (url.pathname.startsWith('/tracker/tiles/hi/')) {
    const match = url.pathname.match(/^\/tracker\/tiles\/hi\/(\d+)_(\d+)\.jpg$/);
    if (!match) return text(res, 404, 'Map tile not found.');
    const x = Number(match[1]);
    const y = Number(match[2]);
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x > 7 || y < 0 || y > 7) return text(res, 404, 'Map tile not found.');
    const tilePath = path.join(portalMapTilesPath, 'hi', `${x}_${y}.jpg`);
    if (!fs.existsSync(tilePath)) return text(res, 404, 'Map tile not found.');
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=604800, immutable' });
    return fs.createReadStream(tilePath).pipe(res);
  }

  if (url.pathname === '/tracker/map.png') {
    if (!fs.existsSync(mapPath)) return text(res, 404, 'Map image not configured.');
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=3600' });
    return fs.createReadStream(mapPath).pipe(res);
  }

  if (url.pathname === '/tracker/map-hi.webp') {
    if (!fs.existsSync(highResMapPath)) return text(res, 404, 'High-resolution map image not configured.');
    res.writeHead(200, { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=86400' });
    return fs.createReadStream(highResMapPath).pipe(res);
  }

  if (url.pathname === '/tracker/api/config') {
    return json(res, 200, {
      retentionHours: RETENTION_HOURS,
      sampleSeconds: SAMPLE_SECONDS,
      mapAvailable: fs.existsSync(mapPath),
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
  if (sampleTimer) clearInterval(sampleTimer);
  sampleTimer = setInterval(() => recordMovementSample(), SAMPLE_SECONDS * 1000);
  if (cleanupTimer) clearInterval(cleanupTimer);
  cleanupTimer = setInterval(() => cleanupOldTrackerData(), CLEANUP_MINUTES * 60_000);
  await cleanupOldTrackerData();
  console.log(`👁️ Movement tracker active: ${SAMPLE_SECONDS}s samples, ${RETENTION_HOURS}h retention.`);
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

  const token = createAccessToken(interaction.user.id, interaction.guild.id, { displayName: interaction.member?.displayName || interaction.user.globalName || interaction.user.username, avatar: interaction.user.displayAvatarURL({ extension: 'png', size: 128 }), isAdmin: hasTrackerRole(interaction.member) });
  const link = `${base}/tracker/access?token=${encodeURIComponent(token)}`;
  await interaction.reply({
    content: `👁️ **Private Outpost Command Center Access**\nThis link is one-time use and expires in ${ACCESS_TOKEN_SECONDS} seconds. The browser session lasts ${SESSION_MINUTES} minutes.`,
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
    if (msg.author?.id === message.client.user.id && (msg.components||[]).some(r => r.components?.some(c => ['player_dashboard_open','command_center_open'].includes(c.customId)))) await msg.delete().catch(()=>{});
  }
  await message.channel.send({
    content: '👁️ **THE OUTPOST COMMAND CENTER**\nYour secure gateway to Outpost X services, vehicles, records, shops, lore, squads, and Watcher tools.',
    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('command_center_open').setLabel('Enter Command Center').setEmoji('👁️').setStyle(ButtonStyle.Primary))]
  });
  return true;
}

module.exports = {
  startTrackerOnBoot,
  handleTrackerCommand,
  handleTrackerInteraction,
  handleCommandCenterCommand,
};
