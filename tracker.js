const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { URL } = require('url');
const { createClient } = require('@supabase/supabase-js');
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

// Calibrated from seven user-supplied SCUM map anchors across D4/C2/B2/B0/Z4/Z0/D0.
// These affine coefficients map SCUM world X/Y directly to the supplied 1247x1247 map pixels.
const MAP_CALIBRATION = {
  width: 1286,
  height: 1284,
  uX: -0.000839936949,
  uY: -0.000000114251275,
  u0: 522.554989,
  vX: 0.0000000139951272,
  vY: -0.000839814791,
  v0: 520.569056,
};

const WORLD = {
  minX: Number(process.env.TRACKER_WORLD_MIN_X || '-900000'),
  maxX: Number(process.env.TRACKER_WORLD_MAX_X || '600000'),
  minY: Number(process.env.TRACKER_WORLD_MIN_Y || '-850000'),
  maxY: Number(process.env.TRACKER_WORLD_MAX_Y || '650000'),
  flipX: String(process.env.TRACKER_FLIP_X || 'false').toLowerCase() === 'true',
  flipY: String(process.env.TRACKER_FLIP_Y || 'true').toLowerCase() !== 'false',
};

const mapPath = path.join(__dirname, 'tracker-map.png');
const htmlPath = path.join(__dirname, 'tracker.html');

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

function publicBaseUrl() {
  const explicit = String(process.env.TRACKER_PUBLIC_URL || '').trim().replace(/\/+$/, '');
  if (explicit) return explicit;
  const railwayDomain = String(process.env.RAILWAY_PUBLIC_DOMAIN || '').trim();
  return railwayDomain ? `https://${railwayDomain}` : null;
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function createAccessToken(discordId, guildId) {
  const token = randomToken(32);
  accessTokens.set(token, {
    discordId: String(discordId),
    guildId: String(guildId),
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
  text(res, 403, 'Watcher Tracker access denied or expired. Open it again from the Discord !tracker button.');
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
      expiresAt: Date.now() + SESSION_MINUTES * 60_000,
    });
    res.writeHead(302, {
      Location: '/tracker',
      'Set-Cookie': `watcher_tracker_session=${encodeURIComponent(sid)}; Path=/tracker; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MINUTES * 60}`,
      'Cache-Control': 'no-store',
    });
    return res.end();
  }

  if (url.pathname === '/tracker/health') return json(res, 200, { ok: true });

  const session = getSession(req);
  if (!session) return unauthorized(res);

  if (url.pathname === '/tracker') {
    if (!fs.existsSync(htmlPath)) return text(res, 500, 'tracker.html is missing.');
    return text(res, 200, fs.readFileSync(htmlPath, 'utf8'), 'text/html; charset=utf-8');
  }

  if (url.pathname === '/tracker/map.png') {
    if (!fs.existsSync(mapPath)) return text(res, 404, 'Map image not configured.');
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=3600' });
    return fs.createReadStream(mapPath).pipe(res);
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
  const port = Number(process.env.PORT || process.env.TRACKER_PORT || '3000');
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
  if (!interaction.isButton() || interaction.customId !== 'tracker_open') return false;
  if (!interaction.guild || !hasTrackerRole(interaction.member)) {
    await interaction.reply({ content: 'This tracker is restricted to Outpost X staff.', flags: MessageFlags.Ephemeral });
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

  const token = createAccessToken(interaction.user.id, interaction.guild.id);
  const link = `${base}/tracker/access?token=${encodeURIComponent(token)}`;
  await interaction.reply({
    content: `👁️ **Private Watcher Tracker Access**\nThis link is one-time use and expires in ${ACCESS_TOKEN_SECONDS} seconds. The browser session lasts ${SESSION_MINUTES} minutes.`,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel('Open Watcher Surveillance').setStyle(ButtonStyle.Link).setURL(link).setEmoji('👁️')
      ),
    ],
    flags: MessageFlags.Ephemeral,
  });
  return true;
}

module.exports = {
  startTrackerOnBoot,
  handleTrackerCommand,
  handleTrackerInteraction,
};
