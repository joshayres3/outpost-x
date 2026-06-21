const { EmbedBuilder } = require("discord.js");
const { DateTime } = require("luxon");

const ADMIN_CHANNEL_ID =
  process.env.ADMIN_CHANNEL_ID || "1518059656302301245";

const MAIN_CHAT_CHANNEL_ID =
  process.env.MAIN_CHAT_CHANNEL_ID || "1516269437932670977";

const SUPPORT_CHANNEL_ID =
  process.env.SUPPORT_CHANNEL_ID || "1516269437932670977";

const TICKET_CHANNEL_ID =
  process.env.TICKET_CHANNEL_ID || "1516323094548185139";

const SERVER_TIMEZONE =
  process.env.SERVER_TIMEZONE || "America/New_York";

let publicRepliesEnabled = true;

function isStaff(msg) {
  return msg.member?.roles?.cache?.some((r) =>
    ["Owners", "Owner", "Admin"].includes(r.name)
  );
}

function isAdminChannel(msg) {
  return msg.channelId === ADMIN_CHANNEL_ID;
}

function isMainChat(msg) {
  return msg.channelId === MAIN_CHAT_CHANNEL_ID;
}

function isAdminOrMainChat(msg) {
  return isAdminChannel(msg) || isMainChat(msg);
}

function isPublicRepliesEnabled() {
  return publicRepliesEnabled;
}

function setPublicRepliesEnabled(value) {
  publicRepliesEnabled = Boolean(value);
}

function statusEmoji(value) {
  return value ? "✅" : "⛔";
}

async function safeCount(label, queryBuilder) {
  try {
    const { count, error } = await queryBuilder;
    if (error) throw error;
    return String(count ?? 0);
  } catch (err) {
    return "Unavailable";
  }
}

async function buildHealthEmbed(ctx) {
  const { bot, db, rules, channels } = ctx;

  const openEvents = await safeCount(
    "open events",
    db.from("events").select("*", { count: "exact", head: true }).eq("status", "open")
  );

  const welcomeSent = await safeCount(
    "welcome sent",
    db.from("welcome_dms").select("*", { count: "exact", head: true }).eq("dm_sent", true)
  );

  const welcomeFailed = await safeCount(
    "welcome failed",
    db.from("welcome_dms").select("*", { count: "exact", head: true }).eq("dm_sent", false)
  );

  const now = DateTime.now().setZone(SERVER_TIMEZONE);
  const serverTime = now.toFormat("ccc, LLL d • h:mm a ZZZZ");

  return new EmbedBuilder()
    .setTitle("Watcher Health Check")
    .setColor(0x2f80ed)
    .setDescription("Observation systems responding.")
    .addFields(
      {
        name: "Core",
        value: [
          `${statusEmoji(Boolean(bot?.user))} Bot online: ${bot?.user?.tag || "Unknown"}`,
          `📚 Rules loaded: ${Object.keys(rules || {}).length}`,
          `💬 Assistant channels: ${channels?.size ?? 0}`,
          `🕒 Server Time: ${serverTime}`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "Public Behavior",
        value: [
          `${statusEmoji(publicRepliesEnabled)} Public replies: ${publicRepliesEnabled ? "ON" : "QUIET"}`,
          `📍 Main chat: <#${MAIN_CHAT_CHANNEL_ID}>`,
          `🎫 Ticket redirect: <#${SUPPORT_CHANNEL_ID}> → <#${TICKET_CHANNEL_ID}>`,
          `🎭 Watcher personality: ${publicRepliesEnabled ? "Available" : "Suspended"}`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "Systems",
        value: [
          `📅 Open events: ${openEvents}`,
          `📨 Welcome DMs sent: ${welcomeSent}`,
          `⚠️ Welcome DMs failed/blocked: ${welcomeFailed}`,
        ].join("\n"),
        inline: false,
      }
    )
    .setFooter({ text: "The Watcher sees many things. This is one of them." })
    .setTimestamp();
}

function buildModeEmbed() {
  return new EmbedBuilder()
    .setTitle("Watcher Mode")
    .setColor(publicRepliesEnabled ? 0x2ecc71 : 0xe67e22)
    .addFields(
      {
        name: "Public Replies",
        value: publicRepliesEnabled ? "✅ ON" : "⛔ QUIET",
        inline: true,
      },
      {
        name: "Main Chat",
        value: `<#${MAIN_CHAT_CHANNEL_ID}>`,
        inline: true,
      },
      {
        name: "Enabled Systems",
        value: publicRepliesEnabled
          ? [
              "✅ Rules assistant",
              "✅ Support redirect",
              "✅ Watcher personality",
            ].join("\n")
          : [
              "⛔ Rules assistant suspended",
              "⛔ Support redirect suspended",
              "⛔ Watcher personality suspended",
            ].join("\n"),
        inline: false,
      }
    )
    .setFooter({
      text: publicRepliesEnabled
        ? "Main chat observation restored."
        : "Observation continues. Commentary suspended.",
    })
    .setTimestamp();
}

async function handleWatcherCommand(msg, ctx) {
  if (!msg.content) return false;

  const command = msg.content.trim().toLowerCase();

  const commands = new Set([
    "!watcherhealth",
    "!watcherquiet",
    "!watcherlive",
    "!watchermode",
    "!watcherreload",
  ]);

  if (!commands.has(command)) return false;

  if (!isStaff(msg)) {
    await msg.reply("Staff control commands are restricted to staff.").catch(() => {});
    return true;
  }

  if (!isAdminOrMainChat(msg)) {
    await msg.reply("Watcher control commands can only be used in admin or main chat.").catch(() => {});
    return true;
  }

  if (command === "!watcherquiet") {
    setPublicRepliesEnabled(false);

    await msg.reply(
      [
        "The Watcher has entered quiet mode.",
        "",
        "Observation continues. Commentary suspended.",
      ].join("\n")
    ).catch(() => {});

    return true;
  }

  if (command === "!watcherlive") {
    setPublicRepliesEnabled(true);

    await msg.reply(
      [
        "The Watcher is live again.",
        "",
        "Main chat observation restored.",
      ].join("\n")
    ).catch(() => {});

    return true;
  }

  if (command === "!watchermode") {
    await msg.reply({ embeds: [buildModeEmbed()] }).catch(() => {});
    return true;
  }

  if (command === "!watcherhealth") {
    await msg.reply({ embeds: [await buildHealthEmbed(ctx)] }).catch(() => {});
    return true;
  }

  if (command === "!watcherreload") {
    try {
      const result = await ctx.reloadData();

      await msg.reply(
        [
          "Watcher data reloaded.",
          "",
          `Rules loaded: ${result.ruleCount}`,
          `Assistant channels: ${result.channelCount}`,
        ].join("\n")
      ).catch(() => {});
    } catch (err) {
      console.error("❌ Watcher reload failed:", err);
      await msg.reply(`Reload failed: ${err.message}`).catch(() => {});
    }

    return true;
  }

  return false;
}

module.exports = {
  handleWatcherCommand,
  isPublicRepliesEnabled,
};
