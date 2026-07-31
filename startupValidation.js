'use strict';

const { createClient } = require('@supabase/supabase-js');
const gg = require('./ggcon');
const log = require('./lib/logger');

const REQUIRED_ENV = ['DISCORD_TOKEN', 'SUPABASE_URL', 'SUPABASE_KEY', 'GGCON_PASSWORD'];
const OPTIONAL_CHANNELS = ['ADMIN_CHANNEL_ID','EVENTS_CHANNEL_ID','TICKET_CHANNEL_ID','MAIN_CHAT_CHANNEL_ID'];
let lastReport = { status: 'starting', checkedAt: null, checks: [] };

function check(ok, name, detail, essential = true) { return { ok: !!ok, name, detail, essential }; }

async function validateStartup(bot) {
  const checks = [];
  for (const key of REQUIRED_ENV) checks.push(check(!!process.env[key], `env.${key}`, process.env[key] ? 'Configured' : 'Missing', true));
  checks.push(check(!!process.env.GEMINI_API_KEY, 'env.GEMINI_API_KEY', process.env.GEMINI_API_KEY ? 'Configured' : 'Missing; assistant replies unavailable', false));

  let db = null;
  try {
    db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, { auth: { persistSession: false } });
    const table = process.env.WATCHER_RUNTIME_STATE_TABLE || 'watcher_runtime_state';
    const { error } = await db.from(table).select('key').limit(1);
    checks.push(check(!error, 'supabase.runtime_state', error?.message || 'Connected', true));
  } catch (error) { checks.push(check(false, 'supabase.runtime_state', error.message, true)); }

  try {
    const health = await gg.ggconGet('/health');
    checks.push(check(health?.ok === true && health?.running !== false, 'ggcon.health', `Version ${health?.version || 'unknown'}; running=${health?.running !== false}`, true));
  } catch (error) { checks.push(check(false, 'ggcon.health', error.message, true)); }

  checks.push(check(!!bot?.isReady?.(), 'discord.client', bot?.isReady?.() ? `Connected as ${bot.user?.tag || 'Watcher'}` : 'Discord client is not ready', true));
  for (const key of OPTIONAL_CHANNELS) {
    const id = process.env[key];
    if (!id) { checks.push(check(true, `discord.${key}`, 'Not configured (optional)', false)); continue; }
    const found = bot?.channels?.cache?.get(String(id));
    checks.push(check(!!found, `discord.${key}`, found ? `Accessible: ${found.name || id}` : 'Configured ID is not accessible', false));
  }

  const essentialFailed = checks.some((item) => item.essential && !item.ok);
  const optionalFailed = checks.some((item) => !item.essential && !item.ok);
  lastReport = { status: essentialFailed ? 'not_ready' : optionalFailed ? 'degraded' : 'ready', checkedAt: new Date().toISOString(), checks };
  log[essentialFailed ? 'error' : optionalFailed ? 'warn' : 'info']('watcher.startup.validation', lastReport);
  return lastReport;
}
function report() { return lastReport; }
module.exports = { validateStartup, report };
