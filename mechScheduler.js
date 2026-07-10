const SftpClient = require("ssh2-sftp-client");
const { createClient } = require("@supabase/supabase-js");
const { DateTime } = require("luxon");

const STAFF_ROLE_NAMES = new Set(["Owner", "Owners", "Admin", "Trial Admin"]);
const RUNTIME_STATE_TABLE = process.env.WATCHER_RUNTIME_STATE_TABLE || "watcher_runtime_state";
const STATE_KEY = "mech_schedule_config";

// Hardcoded by request. Password must stay in Railway only.
const SFTP_HOST = "169.150.251.137";
const SFTP_PORT = 8822;
const SFTP_USERNAME = "Joshuaa";
const SERVER_SETTINGS_PATH = "/169.150.251.137_7022/Config/WindowsServer/ServerSettings.ini";
const SETTING_NAME = "scum.DisableSentrySpawning";
const TIMEZONE = "America/Toronto";

const SCHEDULES = [
  { weekday: 7, hour: 23, minute: 45, action: "on", label: "Sunday 11:45 PM Toronto — Mechs ON" },
  { weekday: 1, hour: 23, minute: 45, action: "off", label: "Monday 11:45 PM Toronto — Mechs OFF" },
];

let supabase = null;
let mechScheduleTimer = null;
let mechScheduleNextSlot = null;
let mechScheduleRunning = false;

function hasStaffRole(member) {
  const roles = member?.roles?.cache;
  if (!roles) return false;
  return roles.some((role) => STAFF_ROLE_NAMES.has(role.name));
}

function isStaff(message) {
  return !!message.guild && hasStaffRole(message.member);
}

function getSupabase() {
  if (supabase) return supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!url || !key) return null;
  supabase = createClient(url, key, { auth: { persistSession: false } });
  return supabase;
}

async function loadRuntimeValue(key) {
  const db = getSupabase();
  if (!db) return null;

  const { data, error } = await db
    .from(RUNTIME_STATE_TABLE)
    .select("value")
    .eq("key", key)
    .maybeSingle();

  if (error) {
    console.warn(`⚠️ Mech schedule persistent read failed: ${error.message}`);
    return null;
  }

  return data?.value ?? null;
}

async function saveRuntimeValue(key, value) {
  const db = getSupabase();
  if (!db) throw new Error("Supabase is not configured for persistent schedule storage.");

  const { error } = await db
    .from(RUNTIME_STATE_TABLE)
    .upsert({ key, value: value || {}, updated_at: new Date().toISOString() }, { onConflict: "key" });

  if (error) throw new Error(`Persistent schedule save failed: ${error.message}`);
}

async function clearRuntimeValue(key) {
  const db = getSupabase();
  if (!db) return;

  const { error } = await db.from(RUNTIME_STATE_TABLE).delete().eq("key", key);
  if (error) throw new Error(`Persistent schedule clear failed: ${error.message}`);
}

async function loadMechScheduleConfig() {
  return await loadRuntimeValue(STATE_KEY);
}

async function saveMechScheduleConfig(config) {
  await saveRuntimeValue(STATE_KEY, config);
}

async function clearMechScheduleConfig() {
  await clearRuntimeValue(STATE_KEY);
}

function getSftpPassword() {
  const password = process.env.SCUM_SFTP_PASSWORD;
  if (!password) throw new Error("Missing Railway variable: SCUM_SFTP_PASSWORD");
  return password;
}

function settingValueForAction(action) {
  if (action === "on") return "False";  // DisableSentrySpawning=False means sentries/mechs ON.
  if (action === "off") return "True";  // DisableSentrySpawning=True means sentries/mechs OFF.
  throw new Error(`Unknown mech action: ${action}`);
}

function actionLabel(action) {
  return action === "on" ? "Mechs ON" : "Mechs OFF";
}

function parseSentrySetting(text) {
  const pattern = /^\s*scum\.DisableSentrySpawning\s*=\s*(True|False|true|false|0|1)\s*.*$/gmi;
  const matches = [...String(text || "").matchAll(pattern)];
  if (matches.length === 0) throw new Error(`Could not find ${SETTING_NAME} in ServerSettings.ini.`);
  if (matches.length > 1) throw new Error(`Found ${matches.length} ${SETTING_NAME} lines. Aborting so only one exact setting can be edited.`);

  const raw = matches[0][1];
  const normalized = raw === "1" ? "True" : raw === "0" ? "False" : raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
  return { raw, normalized };
}

function updateSentrySettingOnly(text, targetValue) {
  const source = String(text || "");
  parseSentrySetting(source);

  const pattern = /^(\s*scum\.DisableSentrySpawning\s*=\s*)(True|False|true|false|0|1)([^\r\n]*)$/gmi;
  let count = 0;
  const updated = source.replace(pattern, (full, prefix, oldValue, suffix) => {
    count += 1;
    return `${prefix}${targetValue}${suffix || ""}`;
  });

  if (count !== 1) throw new Error(`Safety check failed: expected to update exactly one ${SETTING_NAME} line, updated ${count}.`);
  return updated;
}

function getChangedLineSummary(before, after) {
  const beforeLines = String(before || "").split(/\r?\n/);
  const afterLines = String(after || "").split(/\r?\n/);
  const max = Math.max(beforeLines.length, afterLines.length);
  const changed = [];

  for (let i = 0; i < max; i += 1) {
    if ((beforeLines[i] || "") !== (afterLines[i] || "")) {
      changed.push({ line: i + 1, before: beforeLines[i] || "", after: afterLines[i] || "" });
    }
  }

  return changed;
}

async function withSftp(fn) {
  const sftp = new SftpClient();
  try {
    await sftp.connect({
      host: SFTP_HOST,
      port: SFTP_PORT,
      username: SFTP_USERNAME,
      password: getSftpPassword(),
      readyTimeout: 20000,
    });
    return await fn(sftp);
  } finally {
    await sftp.end().catch(() => {});
  }
}

async function downloadSettingsText(sftp) {
  const data = await sftp.get(SERVER_SETTINGS_PATH);
  return Buffer.isBuffer(data) ? data.toString("utf8") : String(data || "");
}

async function readCurrentSentrySetting() {
  return await withSftp(async (sftp) => {
    const text = await downloadSettingsText(sftp);
    const parsed = parseSentrySetting(text);
    return {
      value: parsed.normalized,
      mechsActiveAfterRestart: parsed.normalized === "False",
      path: SERVER_SETTINGS_PATH,
    };
  });
}

async function applyMechAction(action) {
  const targetValue = settingValueForAction(action);

  return await withSftp(async (sftp) => {
    // Fresh download every time so current server-setting changes are preserved.
    const before = await downloadSettingsText(sftp);
    const current = parseSentrySetting(before).normalized;
    const updated = updateSentrySettingOnly(before, targetValue);
    const changedLines = getChangedLineSummary(before, updated);

    if (changedLines.length > 1) {
      throw new Error(`Safety check failed: ${changedLines.length} lines would change. Aborting.`);
    }

    if (current === targetValue && changedLines.length === 0) {
      return {
        action,
        targetValue,
        previousValue: current,
        verifiedValue: current,
        changed: false,
        changedLines: [],
        path: SERVER_SETTINGS_PATH,
      };
    }

    if (changedLines.length !== 1 || !changedLines[0].before.includes(SETTING_NAME) || !changedLines[0].after.includes(SETTING_NAME)) {
      throw new Error("Safety check failed: the only changed line was not the sentry setting line. Aborting.");
    }

    await sftp.put(Buffer.from(updated, "utf8"), SERVER_SETTINGS_PATH);

    const verifyText = await downloadSettingsText(sftp);
    const verified = parseSentrySetting(verifyText).normalized;
    if (verified !== targetValue) {
      throw new Error(`Verification failed. Expected ${targetValue}, but file still shows ${verified}.`);
    }

    return {
      action,
      targetValue,
      previousValue: current,
      verifiedValue: verified,
      changed: true,
      changedLines,
      path: SERVER_SETTINGS_PATH,
    };
  });
}

function getTorontoParts(date = new Date()) {
  const dt = DateTime.fromJSDate(date).setZone(TIMEZONE);
  return {
    dt,
    weekday: dt.weekday,
    hour: dt.hour,
    minute: dt.minute,
    second: dt.second,
    keyDate: dt.toISODate(),
  };
}

function slotKey(dt, action) {
  return `${dt.toISODate()}-${action}`;
}

function buildSlotFromDateTime(dt, schedule) {
  return {
    key: slotKey(dt, schedule.action),
    action: schedule.action,
    label: `${dt.toFormat("cccc h:mm a")} Toronto — ${actionLabel(schedule.action)}`,
    iso: dt.toISO(),
  };
}

function getCurrentDueSlot(date = new Date()) {
  const now = DateTime.fromJSDate(date).setZone(TIMEZONE);
  for (const schedule of SCHEDULES) {
    if (now.weekday !== schedule.weekday) continue;
    const target = now.set({ hour: schedule.hour, minute: schedule.minute, second: 0, millisecond: 0 });
    const end = target.plus({ minutes: 14, seconds: 59 });
    if (now >= target && now <= end) return buildSlotFromDateTime(target, schedule);
  }
  return null;
}

function getNextMechScheduleSlot(date = new Date()) {
  const now = DateTime.fromJSDate(date).setZone(TIMEZONE);
  const candidates = [];

  for (let dayOffset = 0; dayOffset <= 14; dayOffset += 1) {
    const base = now.plus({ days: dayOffset });
    for (const schedule of SCHEDULES) {
      if (base.weekday !== schedule.weekday) continue;
      const target = base.set({ hour: schedule.hour, minute: schedule.minute, second: 0, millisecond: 0 });
      if (target > now.plus({ seconds: 2 })) {
        candidates.push({ dt: target, schedule });
      }
    }
  }

  candidates.sort((a, b) => a.dt.toMillis() - b.dt.toMillis());
  const next = candidates[0];
  const slot = buildSlotFromDateTime(next.dt, next.schedule);
  return {
    ...slot,
    delayMs: Math.max(1000, next.dt.toMillis() - now.toMillis() + 3000),
  };
}

function formatDelay(ms) {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  if (totalMinutes < 60) return `${totalMinutes} minute(s)`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

function scheduleSummaryLines() {
  return [
    "Sunday 11:45 PM Toronto → Mechs ON (`scum.DisableSentrySpawning=False`)",
    "Monday 11:45 PM Toronto → Mechs OFF (`scum.DisableSentrySpawning=True`)",
    "Midnight server restart applies the setting.",
  ];
}

async function runScheduledMechAction(bot, slot) {
  const config = await loadMechScheduleConfig();
  if (!config?.enabled || !config.channelId) return;
  if (config.lastRunKey === slot.key) return;
  if (mechScheduleRunning) return;

  const channel = await bot.channels.fetch(config.channelId).catch(() => null);
  if (!channel) return;

  mechScheduleRunning = true;
  try {
    const result = await applyMechAction(slot.action);
    await saveMechScheduleConfig({
      ...config,
      lastRunKey: slot.key,
      lastRunAt: Date.now(),
      lastRunAction: slot.action,
      lastRunLabel: slot.label,
    });

    await channel.send([
      `🤖 **Mech Schedule Applied — ${actionLabel(slot.action)}**`,
      `Slot: ${slot.label}`,
      `Edited Setting: \`${SETTING_NAME}=${result.verifiedValue}\``,
      result.changed ? "Result: ServerSettings.ini updated from a fresh copy." : "Result: Setting was already correct. No upload needed.",
      "Only `scum.DisableSentrySpawning` was checked/changed.",
      "This takes effect after the midnight server restart.",
    ].join("\n")).catch(() => {});
  } catch (err) {
    await channel.send([
      `🤖 **Mech Schedule Failed — ${actionLabel(slot.action)}**`,
      `Slot: ${slot.label}`,
      `Error: ${err.message}`,
      "No other settings were changed.",
    ].join("\n")).catch(() => {});
  } finally {
    mechScheduleRunning = false;
  }
}

function clearMechScheduleTimer() {
  if (mechScheduleTimer) {
    clearTimeout(mechScheduleTimer);
    mechScheduleTimer = null;
    mechScheduleNextSlot = null;
  }
}

async function ensureMechScheduleLoop(bot) {
  clearMechScheduleTimer();

  const config = await loadMechScheduleConfig();
  if (!config?.enabled || !config.channelId) return;

  const currentDue = getCurrentDueSlot();
  const nextSlot = currentDue && config.lastRunKey !== currentDue.key
    ? { ...currentDue, delayMs: 1000 }
    : getNextMechScheduleSlot();

  mechScheduleNextSlot = nextSlot;
  mechScheduleTimer = setTimeout(async () => {
    const slot = mechScheduleNextSlot;
    mechScheduleTimer = null;
    mechScheduleNextSlot = null;

    try {
      if (slot) await runScheduledMechAction(bot, slot);
    } catch (err) {
      console.error("❌ Mech schedule run failed:", err.message);
    } finally {
      await ensureMechScheduleLoop(bot).catch((err) => {
        console.error("❌ Mech schedule timer restart failed:", err.message);
      });
    }
  }, Math.max(1000, nextSlot.delayMs));
}

async function handleMechScheduleSetup(message, bot) {
  const existing = await loadMechScheduleConfig();
  const config = {
    enabled: true,
    channelId: message.channel.id,
    guildId: message.guild?.id || "default",
    setBy: message.author.id,
    setAt: Date.now(),
    lastRunKey: existing?.lastRunKey || null,
    lastRunAt: existing?.lastRunAt || null,
    lastRunAction: existing?.lastRunAction || null,
    lastRunLabel: existing?.lastRunLabel || null,
  };

  await saveMechScheduleConfig(config);
  await ensureMechScheduleLoop(bot);

  const nextSlot = mechScheduleNextSlot || getNextMechScheduleSlot();
  await message.reply([
    "🤖 **Mech scheduler is now enabled in this channel.**",
    ...scheduleSummaryLines(),
    `Next Run: ${nextSlot.label} (about ${formatDelay(nextSlot.delayMs)} from now)`,
    "Storage: persistent runtime state, survives bot restarts/redeploys.",
    "Safety: downloads a fresh ServerSettings.ini every run and only edits `scum.DisableSentrySpawning`.",
  ].join("\n")).catch(() => {});
}

async function handleMechScheduleOff(message) {
  await clearMechScheduleConfig();
  clearMechScheduleTimer();
  await message.reply("🤖 Mech scheduler is now disabled.").catch(() => {});
}

async function handleMechScheduleStatus(message) {
  const config = await loadMechScheduleConfig();
  const now = DateTime.now().setZone(TIMEZONE);
  const nextSlot = mechScheduleNextSlot || getNextMechScheduleSlot();

  let currentSetting = "Unknown";
  let currentMode = "Unknown";
  try {
    const current = await readCurrentSentrySetting();
    currentSetting = `${SETTING_NAME}=${current.value}`;
    currentMode = current.mechsActiveAfterRestart ? "Mechs ON after restart" : "Mechs OFF after restart";
  } catch (err) {
    currentSetting = `Could not read setting: ${err.message}`;
  }

  const lines = [
    "🤖 **Mech Schedule Status**",
    `Enabled: ${config?.enabled && config?.channelId ? "Yes" : "No"}`,
    `Report Channel: ${config?.channelId ? `<#${config.channelId}>` : "None"}`,
    `Toronto Time: ${now.toFormat("yyyy-MM-dd h:mm:ss a")}`,
    ...scheduleSummaryLines(),
    `Next Run: ${config?.enabled ? `${nextSlot.label} (about ${formatDelay(nextSlot.delayMs)} from now)` : "Not scheduled"}`,
    `Current File Setting: ${currentSetting}`,
    `Current Mode After Restart: ${currentMode}`,
    `Last Run: ${config?.lastRunAt ? new Date(config.lastRunAt).toLocaleString("en-US", { timeZone: TIMEZONE }) : "Never"}`,
    `Last Slot: ${config?.lastRunLabel || "None"}`,
  ];

  await message.reply(lines.join("\n")).catch(() => {});
}

async function handleMechTest(message) {
  const current = await readCurrentSentrySetting();
  await message.reply([
    "🤖 **Mech SFTP Test**",
    "Connection: OK",
    `Path: \`${current.path}\``,
    `Current Setting: \`${SETTING_NAME}=${current.value}\``,
    `Mode After Restart: **${current.mechsActiveAfterRestart ? "Mechs ON" : "Mechs OFF"}**`,
    "No settings were changed.",
  ].join("\n")).catch(() => {});
}

async function handleManualMechAction(message, action) {
  const result = await applyMechAction(action);
  await message.reply([
    `🤖 **${actionLabel(action)} setting applied.**`,
    `Edited Setting: \`${SETTING_NAME}=${result.verifiedValue}\``,
    result.changed ? `Previous Value: \`${result.previousValue}\`` : "Result: Setting was already correct. No upload needed.",
    "Only `scum.DisableSentrySpawning` was checked/changed from a fresh file.",
    "This takes effect after the next server restart.",
  ].join("\n")).catch(() => {});
}

async function handleMechCommand(message, bot) {
  if (!message.guild) return false;
  if (!message.content || !message.content.startsWith("!")) return false;

  const command = message.content.trim().split(/\s+/)[0].toLowerCase();
  const commands = new Set(["!mechtest", "!mechson", "!mechsoff", "!mechschedulesetup", "!mechschedulestatus", "!mechscheduleoff"]);
  if (!commands.has(command)) return false;

  if (!isStaff(message)) {
    await message.reply("The Watcher sees the request. This command is for staff only.").catch(() => {});
    return true;
  }

  try {
    if (command === "!mechtest") await handleMechTest(message);
    else if (command === "!mechson") await handleManualMechAction(message, "on");
    else if (command === "!mechsoff") await handleManualMechAction(message, "off");
    else if (command === "!mechschedulesetup") await handleMechScheduleSetup(message, bot);
    else if (command === "!mechschedulestatus") await handleMechScheduleStatus(message);
    else if (command === "!mechscheduleoff") await handleMechScheduleOff(message);
    return true;
  } catch (err) {
    console.error("❌ Mech command failed:", err);
    await message.reply(`Mech scheduler error: ${err.message}`).catch(() => {});
    return true;
  }
}

async function startMechScheduleOnBoot(bot) {
  const config = await loadMechScheduleConfig();
  if (!config?.enabled || !config.channelId) return;

  await ensureMechScheduleLoop(bot);

  const dueSlot = getCurrentDueSlot();
  if (dueSlot && config.lastRunKey !== dueSlot.key) {
    runScheduledMechAction(bot, dueSlot).catch((err) => {
      console.error("❌ Boot mech schedule catch-up failed:", err.message);
    });
  }
}

module.exports = {
  handleMechCommand,
  startMechScheduleOnBoot,
};
