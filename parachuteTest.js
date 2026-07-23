const { createClient } = require("@supabase/supabase-js");

const DEFAULT_GGCON_BASE_URL = "https://ggcon.gghost.games/s/2788404";
const PLAYER_LINKS_TABLE = process.env.WATCHER_PLAYER_LINKS_TABLE || "watcher_player_links";

let dbClient = null;

function getDb() {
  if (dbClient) return dbClient;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
    throw new Error("Supabase is not configured.");
  }
  dbClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, {
    auth: { persistSession: false },
  });
  return dbClient;
}

function isOwner(message) {
  return !!message.guild && !!message.member?.roles?.cache?.some(
    (role) => role.name === "Owner" || role.name === "Owners"
  );
}

function serverBaseUrl() {
  return String(process.env.GGCON_BASE_URL || DEFAULT_GGCON_BASE_URL).replace(/\/+$/, "");
}

function serverPassword() {
  const password = process.env.GGCON_PASSWORD;
  if (!password) throw new Error("GGCON_PASSWORD is not configured.");
  return password;
}

async function runServerCommand(command) {
  const response = await fetch(`${serverBaseUrl()}/command`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Password": serverPassword(),
    },
    body: JSON.stringify({ command }),
  });

  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }

  if (!response.ok || data?.ok === false || data?.accepted === false) {
    throw new Error(data?.message || data?.reason || data?.error || `HTTP ${response.status}`);
  }
  return data || { ok: true };
}

async function resolveSteamId(message, rawTarget) {
  const direct = String(rawTarget || "").match(/^\d{15,20}$/)?.[0];
  if (direct) return direct;

  const mentioned = message.mentions?.users?.first();
  const discordId = mentioned?.id || String(rawTarget || "").match(/^<@!?(\d+)>$/)?.[1];
  if (!discordId) return null;

  const { data, error } = await getDb()
    .from(PLAYER_LINKS_TABLE)
    .select("steam_id")
    .eq("guild_id", String(message.guild.id))
    .eq("discord_id", String(discordId))
    .not("steam_id", "is", null)
    .maybeSingle();

  if (error) throw error;
  return data?.steam_id ? String(data.steam_id) : null;
}

async function handleParachuteTestCommand(message) {
  if (!message.guild || !message.content) return false;

  const parts = message.content.trim().split(/\s+/);
  const command = String(parts.shift() || "").toLowerCase();
  if (command !== "!parachutetest") return false;

  if (!isOwner(message)) {
    await message.reply("This isolated test command is owner-only.").catch(() => {});
    return true;
  }

  const rawTarget = parts[0];
  if (!rawTarget) {
    await message.reply("Use `!parachutetest @DiscordUser` or `!parachutetest Steam64ID` while that player is online.").catch(() => {});
    return true;
  }

  try {
    const steamId = await resolveSteamId(message, rawTarget);
    if (!steamId) {
      await message.reply("I could not find a linked Steam64 ID for that target. Try the Steam64 ID directly.").catch(() => {});
      return true;
    }

    const rawCommand = `#EquipParachute ${steamId}`;
    const result = await runServerCommand(rawCommand);
    const resultText = JSON.stringify(result);

    await message.reply([
      "🧪 **Parachute Command Test Sent**",
      `Target: \`${steamId}\``,
      `Command: \`${rawCommand}\``,
      "",
      "Check the player in-game now. This test does not change the current Airlift Taxi system.",
      `GGCON response: \`${resultText.slice(0, 600)}\``,
    ].join("\n")).catch(() => {});
  } catch (error) {
    await message.reply([
      "❌ **Parachute Command Test Failed**",
      `Reason: ${error.message}`,
      "The existing Airlift Taxi system was not changed.",
    ].join("\n")).catch(() => {});
  }

  return true;
}

module.exports = { handleParachuteTestCommand };
