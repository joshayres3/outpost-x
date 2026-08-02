'use strict';

const { createClient } = require('@supabase/supabase-js');
const ggcon = require('./ggcon/client');
const { registerChatRowConsumer } = require('./popupEvents');

const RUNTIME_TABLE = process.env.WATCHER_RUNTIME_STATE_TABLE || 'watcher_runtime_state';
const STATE_KEY = 'global-chat-bridge';
const ALLOWED_ROLES = new Set(['Owner', 'Owners', 'Admin', 'The Exiles']);
const STAFF_ROLES = new Set(['Owner', 'Owners', 'Admin']);
const USER_COOLDOWN_MS = Math.max(2, Number(process.env.GLOBAL_CHAT_USER_COOLDOWN_SECONDS || '5')) * 1000;
const MAX_MESSAGE_LENGTH = Math.max(40, Math.min(220, Number(process.env.GLOBAL_CHAT_MAX_LENGTH || '160')));

let botRef = null;
let dbRef = null;
let configCache = null;
let configLoadedAt = 0;
let unregisterConsumer = null;
const userCooldowns = new Map();
const mirroredRows = new Map();

function db() {
  if (dbRef) return dbRef;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) throw new Error('Supabase is not configured.');
  dbRef = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, { auth: { persistSession: false } });
  return dbRef;
}

function normalizeConfig(value = {}) {
  const mode = ['off', 'read', 'twoway'].includes(String(value.mode || '').toLowerCase())
    ? String(value.mode).toLowerCase()
    : 'off';
  return {
    mode,
    guildId: value.guildId ? String(value.guildId) : null,
    channelId: value.channelId ? String(value.channelId) : null,
    updatedAt: value.updatedAt || null,
    updatedBy: value.updatedBy || null,
  };
}

async function loadConfig(force = false) {
  if (!force && configCache && Date.now() - configLoadedAt < 30_000) return configCache;
  const { data, error } = await db().from(RUNTIME_TABLE).select('value').eq('key', STATE_KEY).maybeSingle();
  if (error) throw error;
  configCache = normalizeConfig(data?.value || {});
  configLoadedAt = Date.now();
  return configCache;
}

async function saveConfig(next) {
  const value = normalizeConfig(next);
  value.updatedAt = new Date().toISOString();
  const { error } = await db().from(RUNTIME_TABLE).upsert({ key: STATE_KEY, value, updated_at: value.updatedAt }, { onConflict: 'key' });
  if (error) throw error;
  configCache = value;
  configLoadedAt = Date.now();
  return value;
}

function hasRole(member, allowed) {
  return Boolean(member?.roles?.cache?.some?.((role) => allowed.has(role.name)));
}

function sanitizeDiscordText(text) {
  return String(text || '')
    .replace(/<@!?(\d+)>/g, '@user')
    .replace(/<@&(\d+)>/g, '@role')
    .replace(/<#(\d+)>/g, '#channel')
    .replace(/@everyone/gi, 'everyone')
    .replace(/@here/gi, 'here')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseGlobalLine(row) {
  const line = String(row?.line || row?.message || row?.text || '');
  const match = line.match(/'([0-9]{17}):(.+?)\(\d+\)'\s+'Global:\s*([\s\S]*?)'\s*$/i);
  if (!match) return null;
  return {
    steamId: match[1],
    name: match[2].trim(),
    text: match[3].trim(),
    timestamp: Number(row?.t || row?.timestamp || row?.time || 0),
    raw: line,
  };
}

function rowKey(parsed) {
  return `${parsed.timestamp || 0}:${parsed.steamId}:${parsed.text}`;
}

function rememberRow(key) {
  mirroredRows.set(key, Date.now());
  if (mirroredRows.size > 1000) {
    const cutoff = Date.now() - 10 * 60_000;
    for (const [entry, at] of mirroredRows) if (at < cutoff) mirroredRows.delete(entry);
  }
}

function shouldHideScumMessage(text) {
  const value = String(text || '').trim();
  if (!value) return true;
  if (value.startsWith('!')) return true;
  if (/^\[discord\]/i.test(value)) return true;
  return false;
}

async function consumeChatRows(rows) {
  const cfg = await loadConfig().catch(() => null);
  if (!cfg || cfg.mode === 'off' || !cfg.channelId || !botRef) return;
  const channel = await botRef.channels.fetch(cfg.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;

  for (const row of rows) {
    const parsed = parseGlobalLine(row);
    if (!parsed || shouldHideScumMessage(parsed.text)) continue;
    const key = rowKey(parsed);
    if (mirroredRows.has(key)) continue;
    rememberRow(key);
    await channel.send({
      content: `**${parsed.name.replace(/[*_`~|>]/g, '')}:** ${parsed.text}`.slice(0, 1900),
      allowedMentions: { parse: [] },
    }).catch((err) => console.error('❌ Global chat mirror send failed:', err.message));
  }
}

async function sendDiscordToScum(message, cfg) {
  if (cfg.mode !== 'twoway' || message.channelId !== cfg.channelId) return false;
  if (!hasRole(message.member, ALLOWED_ROLES)) {
    await message.reply({ content: 'You do not have permission to send messages into SCUM Global Chat.', allowedMentions: { repliedUser: false } }).catch(() => {});
    return true;
  }
  if (message.attachments?.size || message.stickers?.size) {
    await message.reply({ content: 'Attachments and stickers cannot be sent into SCUM. Send text only.', allowedMentions: { repliedUser: false } }).catch(() => {});
    return true;
  }

  let text = sanitizeDiscordText(message.content);
  if (!text || text.startsWith('!')) return false;
  if (text.length > MAX_MESSAGE_LENGTH) {
    await message.reply({ content: `That message is too long for SCUM. Keep it under ${MAX_MESSAGE_LENGTH} characters.`, allowedMentions: { repliedUser: false } }).catch(() => {});
    return true;
  }

  const now = Date.now();
  const readyAt = userCooldowns.get(message.author.id) || 0;
  if (now < readyAt) {
    await message.reply({ content: `Please wait ${Math.ceil((readyAt - now) / 1000)} seconds before sending another SCUM message.`, allowedMentions: { repliedUser: false } }).catch(() => {});
    return true;
  }
  userCooldowns.set(message.author.id, now + USER_COOLDOWN_MS);

  const name = String(message.member?.displayName || message.author.globalName || message.author.username || 'Discord').replace(/[\r\n:]+/g, ' ').slice(0, 28);
  const outgoing = `[Discord] ${name}: ${text}`;
  try {
    await ggcon.post('/message', { text: outgoing, type: 'ServerMessage' }, { requireConfirmed: true });
    await message.react('✅').catch(() => {});
  } catch (err) {
    userCooldowns.delete(message.author.id);
    await message.react('❌').catch(() => {});
    await message.reply({ content: `SCUM message failed: ${err.message}`, allowedMentions: { repliedUser: false } }).catch(() => {});
  }
  return true;
}

async function handleGlobalChatCommand(message) {
  if (!message.guild || !message.content) return false;
  const parts = message.content.trim().split(/\s+/);
  if (String(parts.shift() || '').toLowerCase() !== '!globalchat') return false;
  if (!hasRole(message.member, STAFF_ROLES)) {
    await message.reply('Global chat bridge controls are for staff only.').catch(() => {});
    return true;
  }

  const action = String(parts.shift() || 'status').toLowerCase();
  try {
    let cfg = await loadConfig(true);
    if (action === 'setup') {
      cfg = await saveConfig({ ...cfg, guildId: message.guild.id, channelId: message.channel.id, mode: 'twoway', updatedBy: message.author.id });
      await message.reply('✅ This channel is now the two-way SCUM Global Chat bridge. Only Global chat is mirrored.').catch(() => {});
      return true;
    }
    if (['off', 'disable', 'disabled'].includes(action)) {
      cfg = await saveConfig({ ...cfg, mode: 'off', updatedBy: message.author.id });
      await message.reply('⛔ SCUM Global Chat bridge disabled.').catch(() => {});
      return true;
    }
    if (['read', 'readonly', 'read-only'].includes(action)) {
      cfg = await saveConfig({ ...cfg, guildId: message.guild.id, channelId: message.channel.id, mode: 'read', updatedBy: message.author.id });
      await message.reply('👁️ This channel now mirrors SCUM Global Chat in read-only mode.').catch(() => {});
      return true;
    }
    if (['twoway', 'two-way', 'on', 'enable'].includes(action)) {
      if (!cfg.channelId) cfg.channelId = message.channel.id;
      cfg = await saveConfig({ ...cfg, guildId: message.guild.id, mode: 'twoway', updatedBy: message.author.id });
      await message.reply('🔁 SCUM Global Chat bridge is now two-way.').catch(() => {});
      return true;
    }
    await message.reply([
      '🌐 **SCUM Global Chat Bridge**',
      `Mode: **${cfg.mode}**`,
      `Channel: ${cfg.channelId ? `<#${cfg.channelId}>` : 'Not configured'}`,
      'Commands: `!globalchat setup`, `!globalchat read`, `!globalchat twoway`, `!globalchat off`',
      'Only SCUM `Global:` chat is mirrored. Local, squad, admin and private chat are ignored.',
    ].join('\n')).catch(() => {});
  } catch (err) {
    await message.reply(`Global chat bridge error: ${err.message}`).catch(() => {});
  }
  return true;
}

async function handleGlobalChatMessage(message) {
  if (!message.guild || message.author?.bot) return false;
  if (await handleGlobalChatCommand(message)) return true;
  const cfg = await loadConfig().catch(() => null);
  if (!cfg || cfg.mode === 'off' || message.channelId !== cfg.channelId) return false;
  return sendDiscordToScum(message, cfg);
}

async function startGlobalChatBridge(bot) {
  botRef = bot;
  if (!unregisterConsumer) unregisterConsumer = registerChatRowConsumer(consumeChatRows);
  const cfg = await loadConfig().catch((err) => {
    console.error('❌ Global chat bridge startup failed:', err.message);
    return null;
  });
  if (cfg?.mode !== 'off' && cfg?.channelId) {
    console.log(`🌐 SCUM Global Chat bridge ready (${cfg.mode}).`);
  }
}

module.exports = { startGlobalChatBridge, handleGlobalChatMessage };
