'use strict';

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const TABLE = process.env.WATCHER_RUNTIME_STATE_TABLE || 'watcher_runtime_state';
const LEASE_KEY = process.env.WATCHER_DEPLOYMENT_LEASE_KEY || 'watcher_deployment_leader_v1';
const HANDOFF_KEY = process.env.WATCHER_DEPLOYMENT_HANDOFF_KEY || 'watcher_deployment_handoff_v1';
const LEASE_MS = Math.max(15000, Number(process.env.WATCHER_DEPLOYMENT_LEASE_MS || 45000));
const RENEW_MS = Math.max(5000, Math.floor(LEASE_MS / 3));
const INSTANCE_ID = String(process.env.RAILWAY_DEPLOYMENT_ID || process.env.RAILWAY_REPLICA_ID || crypto.randomUUID());

let db;
let leader = false;
let botReady = false;
let webReady = false;
let draining = false;
let renewTimer = null;
let handoffTimer = null;
let onRelinquish = null;

function getDb(){
  if (!db) db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, { auth:{persistSession:false} });
  return db;
}
function state(){ return { instanceId:INSTANCE_ID, leader, botReady, webReady, draining, ready:webReady && leader && botReady && !draining }; }
function setWebReady(value=true){ webReady=!!value; }
function setBotReady(value=true){ botReady=!!value; }
function isLeader(){ return leader && !draining; }

async function readValue(key){
  const {data,error}=await getDb().from(TABLE).select('value,updated_at').eq('key',key).maybeSingle();
  if(error) throw error;
  return data || null;
}
async function writeValue(key,value){
  const {error}=await getDb().from(TABLE).upsert({key,value,updated_at:new Date().toISOString()},{onConflict:'key'});
  if(error) throw error;
}
async function tryAcquire(){
  const now=Date.now();
  const row=await readValue(LEASE_KEY).catch(()=>null);
  const current=row?.value || {};
  const expires=Date.parse(current.expiresAt||'');
  if(current.instanceId && current.instanceId!==INSTANCE_ID && Number.isFinite(expires) && expires>now) return false;
  await writeValue(LEASE_KEY,{instanceId:INSTANCE_ID,acquiredAt:current.instanceId===INSTANCE_ID?current.acquiredAt||new Date().toISOString():new Date().toISOString(),expiresAt:new Date(now+LEASE_MS).toISOString()});
  const verify=await readValue(LEASE_KEY);
  leader=verify?.value?.instanceId===INSTANCE_ID;
  return leader;
}
async function renew(){
  if(!leader||draining) return false;
  const row=await readValue(LEASE_KEY).catch(()=>null);
  if(row?.value?.instanceId!==INSTANCE_ID){leader=false;botReady=false;return false;}
  await writeValue(LEASE_KEY,{...row.value,instanceId:INSTANCE_ID,expiresAt:new Date(Date.now()+LEASE_MS).toISOString()});
  return true;
}
async function requestHandoff(){ await writeValue(HANDOFF_KEY,{candidate:INSTANCE_ID,requestedAt:new Date().toISOString()}).catch(()=>{}); }
async function release(reason='shutdown'){
  draining=true; botReady=false;
  if(leader){
    const row=await readValue(LEASE_KEY).catch(()=>null);
    if(row?.value?.instanceId===INSTANCE_ID) await writeValue(LEASE_KEY,{instanceId:null,releasedBy:INSTANCE_ID,reason,expiresAt:new Date(0).toISOString()}).catch(()=>{});
  }
  leader=false;
}
async function monitorHandoff(){
  if(!leader||draining) return;
  const row=await readValue(HANDOFF_KEY).catch(()=>null);
  const candidate=row?.value?.candidate;
  const requested=Date.parse(row?.value?.requestedAt||'');
  if(candidate && candidate!==INSTANCE_ID && Number.isFinite(requested) && Date.now()-requested<120000){
    console.log(`🔄 Deployment handoff requested by ${candidate}. Relinquishing bot leadership while keeping HTTP alive.`);
    await release('handoff');
    if(typeof onRelinquish==='function') await onRelinquish();
  }
}
async function waitForLeadership(options={}){
  onRelinquish=options.onRelinquish || onRelinquish;
  const timeoutMs=Math.max(30000,Number(options.timeoutMs||180000));
  const started=Date.now();
  while(Date.now()-started<timeoutMs){
    if(await tryAcquire().catch(()=>false)){
      renewTimer=setInterval(()=>renew().catch(err=>console.error('❌ Deployment lease renewal failed:',err.message)),RENEW_MS);renewTimer.unref?.();
      handoffTimer=setInterval(()=>monitorHandoff().catch(()=>{}),5000);handoffTimer.unref?.();
      console.log(`✅ Watcher deployment leadership acquired: ${INSTANCE_ID}`);
      return true;
    }
    await requestHandoff();
    await new Promise(r=>setTimeout(r,3000));
  }
  throw new Error('Timed out waiting for Watcher deployment leadership.');
}
async function shutdown(reason='shutdown'){
  clearInterval(renewTimer);clearInterval(handoffTimer);
  await release(reason);
}

module.exports={INSTANCE_ID,state,setWebReady,setBotReady,isLeader,waitForLeadership,shutdown};
