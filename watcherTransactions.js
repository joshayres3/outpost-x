const { createClient } = require('@supabase/supabase-js');
const TABLE = process.env.WATCHER_TRANSACTIONS_TABLE || 'watcher_transactions';
let db;
function getDb(){ if(!db) db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_KEY,{auth:{persistSession:false}}); return db; }
async function recordTransaction(v){
  try{
    const row={
      guild_id:String(v.guildId),discord_id:v.discordId?String(v.discordId):null,steam_id:v.steamId?String(v.steamId):null,
      player_name:v.playerName||null,type:String(v.type||'watcher_action'),title:v.title||v.type||'Watcher Action',
      amount:Number(v.amount||0),currency:v.currency||'cash',status:v.status||'completed',details:v.details||{},
      balance_before:Number.isFinite(Number(v.balanceBefore))?Number(v.balanceBefore):null,
      balance_after:Number.isFinite(Number(v.balanceAfter))?Number(v.balanceAfter):null,
      refundable:v.refundable!==false && Number(v.amount||0)<0,
      created_at:new Date().toISOString(),updated_at:new Date().toISOString()
    };
    const {data,error}=await getDb().from(TABLE).insert(row).select('*').single(); if(error) throw error; return data;
  }catch(err){console.error('❌ Watcher transaction record failed:',err.message);return null;}
}
module.exports={recordTransaction,TABLE};
