const { createClient } = require('@supabase/supabase-js');
const {
  ggconGet,
  ggconPost,
  getOnlinePlayers,
  getPlayerDisplayName,
  triggerCargoFrenzyFromPortal,
} = require('./ggcon');

const RUNTIME_TABLE = process.env.WATCHER_RUNTIME_STATE_TABLE || 'watcher_runtime_state';
const STATE_KEY = 'watcher_special_events';
const CHAT_POLL_MS = Math.max(3000, Number(process.env.WATCHER_EVENT_CHAT_POLL_MS || 5000));
const HUNT_CHECK_MS = Math.max(3000, Number(process.env.WATCHER_HUNT_CHECK_MS || 5000));
const DEFAULT_SCAN_COOLDOWN = 30;
const DEFAULT_HUNT_MINUTES = 20;
const DEFAULT_JOIN_SECONDS = 120;
const WIN_DISTANCE_UNITS = 5000; // 50 metres; SCUM coordinates are roughly 100 units per metre.

let dbClient = null;
let pollTimer = null;
let lastLogCursor = Date.now() - 5000;
let processing = false;
let botRef = null;

function db() {
  if (!dbClient) dbClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, { auth: { persistSession: false } });
  return dbClient;
}

function emptyState() {
  return { active: null, updatedAt: new Date().toISOString(), recentBounties: [] };
}

async function loadState() {
  const { data, error } = await db().from(RUNTIME_TABLE).select('value').eq('key', STATE_KEY).maybeSingle();
  if (error) throw error;
  return data?.value && typeof data.value === 'object' ? { ...emptyState(), ...data.value } : emptyState();
}

async function saveState(state) {
  state.updatedAt = new Date().toISOString();
  const { error } = await db().from(RUNTIME_TABLE).upsert({ key: STATE_KEY, value: state, updated_at: state.updatedAt }, { onConflict: 'key' });
  if (error) throw error;
  return state;
}

function steamIdOf(p) { return String(p?.userId || p?.steamId || p?.steamID || p?.steam_id || '').trim(); }
function nameOf(p) { return String(getPlayerDisplayName?.(p) || p?.characterName || p?.name || p?.steamName || steamIdOf(p) || 'Unknown'); }
function posOf(p) {
  const l = p?.location || p;
  const x = Number(l?.x), y = Number(l?.y), z = Number(l?.z || 0);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y, z } : null;
}
function distanceUnits(a, b) { return Math.hypot(Number(a.x) - Number(b.x), Number(a.y) - Number(b.y)); }
function metres(units) { return Math.max(0, Math.round(units / 100)); }
function compass(dx, dy) {
  const angle = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
  const dirs = ['north','northeast','east','southeast','south','southwest','west','northwest'];
  return dirs[Math.round(angle / 45) % 8];
}
function roundedDistance(m) {
  if (m < 100) return 'less than 100 metres';
  if (m < 500) return `about ${Math.round(m / 50) * 50} metres`;
  if (m < 1000) return `about ${Math.round(m / 100) * 100} metres`;
  return `about ${(Math.round(m / 100) / 10).toFixed(1)} kilometres`;
}
function strength(m) {
  if (m <= 100) return 'CRITICAL';
  if (m <= 300) return 'Very Strong';
  if (m <= 800) return 'Strong';
  if (m <= 2000) return 'Moderate';
  return 'Weak';
}

async function publicMessage(text) {
  return ggconPost('/message', { text, type: 'ServerMessage' });
}
async function privateMessage(steamId, text, color = '#3d97ff', duration = 8) {
  return ggconPost('/message', { method: 'warning', steamId: String(steamId), text, color, duration });
}

function parseChatLine(entry) {
  const line = String(entry?.line || '').trim();
  if (!line || !/!(hunt|scan|risk|safe|riskit)\b/i.test(line)) return null;
  const cmd = (line.match(/!(hunt|scan|risk|safe|riskit)\b/i) || [])[1]?.toLowerCase();
  const steam = (line.match(/\b(7656119\d{10})\b/) || line.match(/steam(?:id)?\s*[:=]\s*(\d{15,20})/i) || [])[1];
  if (!cmd || !steam) return null;
  const nameMatch = line.match(/(?:CharacterName|PlayerName|Name)\s*[:=]\s*["']?([^,"'|\]]+)/i)
    || line.match(/^\s*\[[^\]]+\]\s*([^:]+):\s*!/)
    || line.match(/\b\d{15,20}\b\s*[-|:]\s*([^:|]+)\s*[:|]\s*!/);
  return { command: `!${cmd}`, steamId: steam, name: nameMatch?.[1]?.trim() || steam, key: `${entry?.t || 0}|${entry?.src || ''}|${line}` };
}

async function fetchNewChatCommands() {
  const params = new URLSearchParams({ since: String(lastLogCursor) });
  const data = await ggconGet(`/logs?${params.toString()}`);
  const lines = Array.isArray(data?.lines) ? data.lines : [];
  const next = Number(data?.next || 0);
  if (next) lastLogCursor = Math.max(lastLogCursor, next);
  else if (lines.length) lastLogCursor = Math.max(lastLogCursor, ...lines.map(x => Number(x?.t || 0) + 1));
  else lastLogCursor = Date.now() - 1000;
  const seen = new Set();
  return lines.map(parseChatLine).filter(x => x && !seen.has(x.key) && seen.add(x.key));
}

async function onlineMap() {
  const players = await getOnlinePlayers();
  return new Map((players || []).map(p => [steamIdOf(p), p]).filter(([id]) => id));
}

function chooseBounty(players, opts, state) {
  const all = [...players.values()];
  if (opts.bountySteamId) return players.get(String(opts.bountySteamId)) || null;
  const recent = new Set((state.recentBounties || []).slice(-8));
  let eligible = all.filter(p => !recent.has(steamIdOf(p)));
  if (!eligible.length) eligible = all;
  return eligible[Math.floor(Math.random() * eligible.length)] || null;
}

async function startHunt(options = {}) {
  const state = await loadState();
  if (state.active) throw new Error('Another Watcher special event is already active.');
  const players = await onlineMap();
  if (players.size < 2) throw new Error('At least two online players are required.');
  const bounty = chooseBounty(players, options, state);
  if (!bounty) throw new Error('No eligible bounty player could be selected.');
  const now = Date.now();
  state.active = {
    type: 'hunt', phase: 'joining', startedAt: now,
    joinEndsAt: now + Math.max(30, Number(options.joinSeconds || DEFAULT_JOIN_SECONDS)) * 1000,
    endsAt: now + Math.max(5, Number(options.durationMinutes || DEFAULT_HUNT_MINUTES)) * 60_000,
    scanCooldownSeconds: Math.max(10, Number(options.scanCooldownSeconds || DEFAULT_SCAN_COOLDOWN)),
    winDistanceUnits: WIN_DISTANCE_UNITS,
    bounty: { steamId: steamIdOf(bounty), name: nameOf(bounty) },
    participants: {}, proximity: {}, allowStaffBounty: options.allowStaffBounty === true,
    rewardCash: Math.max(0, Number(options.rewardCash || 2500)),
    createdBy: options.createdBy || null,
  };
  await saveState(state);
  await publicMessage('WATCHER HUNT IS OPEN. A hidden target has been selected. Type !hunt in SCUM chat within 2 minutes to join. Nobody will be told who the bounty is.');
  ensureLoop();
  return eventStatus(state.active, true);
}

async function joinHunt(event, steamId, name, players) {
  if (event.phase !== 'joining' || Date.now() > event.joinEndsAt) return privateMessage(steamId, 'WATCHER HUNT: Joining is closed.', '#e9c46a', 5);
  if (!players.has(steamId)) return;
  if (!event.participants[steamId]) event.participants[steamId] = { steamId, name: name || nameOf(players.get(steamId)), joinedAt: Date.now(), lastScanAt: 0, previousDistance: null, rechargeNoticeAt: 0 };
  await privateMessage(steamId, 'WATCHER HUNT: You are registered. When the hunt begins, type !scan for a private directional signal.', '#47d67d', 7);
}

function decoyTarget(event, hunterId, players) {
  if (hunterId !== event.bounty.steamId) return players.get(event.bounty.steamId);
  const choices = [...players.values()].filter(p => steamIdOf(p) !== hunterId);
  if (!choices.length) return null;
  const idx = Math.abs([...hunterId].reduce((a,c)=>a+c.charCodeAt(0),0) + Math.floor(Date.now()/60000)) % choices.length;
  return choices[idx];
}

async function scanHunt(event, steamId, players) {
  const participant = event.participants[steamId];
  if (!participant) return privateMessage(steamId, 'WATCHER HUNT: You are not registered. Type !hunt during the join window.', '#e9c46a', 6);
  if (event.phase !== 'active') return privateMessage(steamId, 'WATCHER HUNT: The hunt has not started yet.', '#e9c46a', 5);
  const now = Date.now(), cd = event.scanCooldownSeconds * 1000;
  const remaining = Math.ceil((participant.lastScanAt + cd - now) / 1000);
  if (remaining > 0) return privateMessage(steamId, `WATCHER: Scanner recharging. Next scan available in ${remaining} seconds.`, '#e9c46a', 5);
  const hunter = players.get(steamId), target = decoyTarget(event, steamId, players);
  const hp = posOf(hunter), tp = posOf(target);
  if (!hp || !tp) return privateMessage(steamId, 'WATCHER: Signal unavailable. Remain online and try again.', '#ff6b6b', 5);
  const units = distanceUnits(hp, tp), m = metres(units), dir = compass(tp.x - hp.x, tp.y - hp.y);
  const trend = participant.previousDistance == null ? '' : units < participant.previousDistance - 2500 ? ' You are getting closer.' : units > participant.previousDistance + 2500 ? ' The signal is getting farther away.' : ' Signal distance is steady.';
  participant.previousDistance = units; participant.lastScanAt = now; participant.rechargeNoticeAt = now + cd;
  await privateMessage(steamId, `WATCHER SCAN: The hidden signal is ${roundedDistance(m)} ${dir} of you. Signal strength: ${strength(m)}.${trend} Next scan available in ${event.scanCooldownSeconds} seconds.`, m <= 100 ? '#ff4d4d' : '#3d97ff', 10);
}

async function startRisk(options = {}) {
  const state = await loadState();
  if (state.active) throw new Error('Another Watcher special event is already active.');
  const now = Date.now();
  state.active = { type:'risk', phase:'open', startedAt:now, endsAt:now + Math.max(30, Number(options.acceptSeconds || 90))*1000, contestant:null, safeReward:Math.max(0,Number(options.safeReward||500)), maxReward:Math.max(500,Number(options.maxReward||3000)), allowStorm:options.allowStorm!==false, createdBy:options.createdBy||null };
  await saveState(state);
  await publicMessage('WATCHER OFFER: One prisoner may accept my proposal. Type !risk in SCUM chat. First eligible player gets the choice: !safe or !riskit.');
  ensureLoop();
  return eventStatus(state.active, true);
}

async function handleRiskCommand(event, cmd, steamId, name, players) {
  if (!players.has(steamId)) return;
  if (cmd === '!risk') {
    if (event.contestant) return privateMessage(steamId, 'WATCHER OFFER: Another prisoner accepted first.', '#e9c46a', 5);
    event.contestant = { steamId, name: name || nameOf(players.get(steamId)), acceptedAt: Date.now() };
    event.phase = 'choice'; event.endsAt = Date.now() + 60_000;
    await privateMessage(steamId, `WATCHER OFFER: Take the guaranteed $${event.safeReward.toLocaleString()} with !safe, or risk it with !riskit for up to $${event.maxReward.toLocaleString()}.`, '#3d97ff', 12);
    await publicMessage('WATCHER OFFER ACCEPTED. One prisoner is now deciding whether courage and judgment are the same thing.');
    return;
  }
  if (!event.contestant || event.contestant.steamId !== steamId) return privateMessage(steamId, 'WATCHER OFFER: This choice is not yours.', '#ff6b6b', 5);
  if (!['!safe','!riskit'].includes(cmd)) return;
  let reward = event.safeReward, result = `accepted the guaranteed $${reward.toLocaleString()}`;
  if (cmd === '!riskit') {
    const roll = Math.random();
    if (roll < .20) { reward = 0; result = 'risked it and received nothing but Watcher\'s attention'; }
    else if (roll < .45) { reward = Math.round(event.maxReward * .4 / 50) * 50; result = `risked it and won $${reward.toLocaleString()}`; }
    else if (roll < .75) { reward = Math.round(event.maxReward * .7 / 50) * 50; result = `risked it and won $${reward.toLocaleString()}`; }
    else { reward = event.maxReward; result = `risked it and won the maximum $${reward.toLocaleString()}`; }
  }
  if (reward > 0) await ggconPost(`/players/${encodeURIComponent(steamId)}/currency`, { action:'change', amount:reward });
  await privateMessage(steamId, `WATCHER RESULT: You ${result}.`, reward ? '#47d67d' : '#ff6b6b', 10);
  await publicMessage(`WATCHER RESULT: ${event.contestant.name} ${result}.`);
  return 'complete';
}

function eventStatus(event, includeSecret = false) {
  if (!event) return { active:false };
  const base = { active:true, type:event.type, phase:event.phase, startedAt:event.startedAt, endsAt:event.endsAt, participantCount:Object.keys(event.participants||{}).length };
  if (event.type === 'hunt') Object.assign(base, { joinEndsAt:event.joinEndsAt, scanCooldownSeconds:event.scanCooldownSeconds, winDistanceMetres:50, rewardCash:event.rewardCash, bounty:includeSecret?event.bounty:undefined });
  if (event.type === 'risk') Object.assign(base, { safeReward:event.safeReward, maxReward:event.maxReward, contestant:event.contestant });
  return base;
}

async function endActiveEvent(reason = 'Ended by staff') {
  const state = await loadState();
  if (!state.active) return { active:false };
  const type = state.active.type;
  state.active = null; await saveState(state);
  await publicMessage(`${type === 'hunt' ? 'WATCHER HUNT' : 'WATCHER OFFER'} ENDED: ${reason}.`).catch(()=>{});
  return { active:false };
}

async function tick() {
  if (processing) return; processing = true;
  try {
    const state = await loadState();
    const event = state.active;
    if (!event) return;
    const players = await onlineMap();
    const commands = await fetchNewChatCommands().catch(err => { console.warn('Watcher event chat poll failed:', err.message); return []; });
    let changed = false;
    for (const c of commands) {
      if (event.type === 'hunt') {
        if (c.command === '!hunt') { await joinHunt(event,c.steamId,c.name,players); changed = true; }
        if (c.command === '!scan') { await scanHunt(event,c.steamId,players); changed = true; }
      } else if (event.type === 'risk' && ['!risk','!safe','!riskit'].includes(c.command)) {
        const done = await handleRiskCommand(event,c.command,c.steamId,c.name,players); changed = true;
        if (done === 'complete') state.active = null;
      }
    }
    if (!state.active) { await saveState(state); return; }
    if (event.type === 'hunt') {
      const now=Date.now();
      if (event.phase==='joining' && now>=event.joinEndsAt) {
        if (Object.keys(event.participants).length < 1) { await publicMessage('WATCHER HUNT CANCELLED: No hunters joined.'); state.active=null; }
        else { event.phase='active'; await publicMessage('WATCHER HUNT ACTIVE. Registered hunters: type !scan for your private signal. The target remains unaware.'); changed=true; }
      }
      for (const p of Object.values(event.participants||{})) {
        if (p.rechargeNoticeAt && now>=p.rechargeNoticeAt) { p.rechargeNoticeAt=0; await privateMessage(p.steamId,'WATCHER: Your scanner has recharged. Type !scan for an updated signal.','#47d67d',6).catch(()=>{}); changed=true; }
      }
      if (event.phase==='active') {
        const bountyP=players.get(event.bounty.steamId), bp=posOf(bountyP);
        if (!bountyP || !bp) { await publicMessage('WATCHER HUNT CANCELLED: The hidden signal disappeared.'); state.active=null; }
        else {
          for (const [id,p] of Object.entries(event.participants)) {
            if (id===event.bounty.steamId) continue;
            const hp=posOf(players.get(id)); if(!hp) continue;
            if(distanceUnits(hp,bp)<=event.winDistanceUnits) event.proximity[id]=(event.proximity[id]||0)+1; else event.proximity[id]=0;
            if(event.proximity[id]>=2){
              if(event.rewardCash>0) await ggconPost(`/players/${encodeURIComponent(id)}/currency`,{action:'change',amount:event.rewardCash}).catch(()=>{});
              await privateMessage(id,`WATCHER: Target confirmed within 50 metres. Hunt complete. $${event.rewardCash.toLocaleString()} issued.`,'#47d67d',10).catch(()=>{});
              await publicMessage(`WATCHER HUNT COMPLETE. Hunter: ${p.name}. The hidden bounty was ${event.bounty.name}. Target confirmed within 50 metres.`);
              state.recentBounties=[...(state.recentBounties||[]),event.bounty.steamId].slice(-12); state.active=null; break;
            }
          }
        }
      }
      if(state.active && now>=event.endsAt){await publicMessage(`WATCHER HUNT ENDED. The hidden bounty escaped. The bounty was ${event.bounty.name}.`);state.active=null;}
    } else if(event.type==='risk' && Date.now()>=event.endsAt){await publicMessage(event.contestant?'WATCHER OFFER EXPIRED: The contestant failed to choose.':'WATCHER OFFER EXPIRED: Nobody accepted.');state.active=null;}
    if(changed || !state.active) await saveState(state);
  } finally { processing=false; }
}

function ensureLoop() { if (!pollTimer) pollTimer=setInterval(()=>tick().catch(err=>console.error('Watcher special event tick failed:',err)),Math.min(CHAT_POLL_MS,HUNT_CHECK_MS)); }
async function startSpecialEventsOnBoot(bot){botRef=bot;const s=await loadState().catch(()=>emptyState());if(s.active)ensureLoop();}
async function getSpecialEventAdminStatus(){const state=await loadState();const players=await getOnlinePlayers().catch(()=>[]);return {event:eventStatus(state.active,true),onlinePlayers:(players||[]).map(p=>({steamId:steamIdOf(p),name:nameOf(p)}))};}
async function triggerSpecialEvent(action, options={}) {
  if(action==='cargo') return triggerCargoFrenzyFromPortal({count:Number(options.count||10)});
  if(action==='hunt') return startHunt(options);
  if(action==='risk') return startRisk(options);
  if(action==='end') return endActiveEvent(options.reason||'Ended by staff');
  throw new Error('Unknown event trigger.');
}

module.exports={startSpecialEventsOnBoot,getSpecialEventAdminStatus,triggerSpecialEvent};
