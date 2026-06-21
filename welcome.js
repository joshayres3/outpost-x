const { EmbedBuilder } = require("discord.js");

const WELCOME_SOURCE_CHANNEL_ID =
  process.env.WELCOME_SOURCE_CHANNEL_ID || "1516313331089018890";

const RULES_CHANNEL_ID =
  process.env.RULES_CHANNEL_ID || "1516308380837220445";

const GAME_HELP_CHANNEL_ID =
  process.env.GAME_HELP_CHANNEL_ID || "1518081954119942227";

const ADMIN_CH = process.env.ADMIN_CHANNEL_ID || "1518059656302301245";

function isStaff(member) {
  if (!member) return false;
  const own = member.roles.cache.some((r) => r.name === "Owners");
  const adm = member.roles.cache.some((r) => r.name === "Admin");
  return own || adm;
}

function isAdminChannel(channelId) {
  return channelId === ADMIN_CH;
}

function buildWelcomeEmbed() {
  return new EmbedBuilder()
    .setTitle("Welcome to Outpost X")
    .setDescription(
      [
        "Thanks for joining us — from Josh, Sowl, and the Outpost X team.",
        "",
        "You’re one of The Exiles now.",
        "",
        "**A few quick things:**",
        "• Check the rules before building, claiming vehicles, or starting trouble.",
        "• Use the Game Help channel if you’re new to SCUM or need survival help.",
        "• Ask questions early. It is easier to help before chaos becomes a ticket.",
        "• PvE focused, survival first, with enough chaos to keep things interesting.",
        "",
        "**Built To Last. Born To Survive.**",
        "",
        `📜 Rules: <#${RULES_CHANNEL_ID}>`,
        `📘 Game Help: <#${GAME_HELP_CHANNEL_ID}>`,
      ].join("\n")
    )
    .setColor(0x3b82f6)
    .setFooter({ text: "Outpost X" });
}

async function hasAlreadyWelcomed(db, userId) {
  const { data, error } = await db
    .from("welcome_dms")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("❌ Welcome DM lookup failed:", error);
    return true;
  }

  return !!data;
}

async function markWelcomed(db, user, sourceMessageId, dmSent) {
  const { error } = await db.from("welcome_dms").upsert(
    {
      user_id: user.id,
      username: user.tag || user.username,
      source_message_id: sourceMessageId,
      dm_sent: dmSent,
    },
    { onConflict: "user_id" }
  );

  if (error) {
    console.error("❌ Welcome DM save failed:", error);
  }
}

async function sendWelcomeDm(user) {
  try {
    await user.send({
      embeds: [buildWelcomeEmbed()],
    });

    return true;
  } catch {
    return false;
  }
}

async function welcomeUserOnce(db, user, sourceMessageId) {
  if (!user || user.bot) {
    return { skippedBot: true };
  }

  const alreadyWelcomed = await hasAlreadyWelcomed(db, user.id);
  if (alreadyWelcomed) {
    return { already: true };
  }

  const dmSent = await sendWelcomeDm(user);

  // Mark either way so every player is attempted only once ever.
  await markWelcomed(db, user, sourceMessageId, dmSent);

  return dmSent ? { sent: true } : { failed: true };
}

async function handleWelcomeMessage(msg, db) {
  if (!msg.guild) return false;
  if (msg.channelId !== WELCOME_SOURCE_CHANNEL_ID) return false;

  const mentionedUsers = [...msg.mentions.users.values()].filter((user) => !user.bot);

  if (!mentionedUsers.length) return false;

  for (const user of mentionedUsers) {
    await welcomeUserOnce(db, user, msg.id);
  }

  return false;
}

async function fetchWelcomeMessages(channel, limit) {
  const collected = [];
  let before;

  while (collected.length < limit) {
    const remaining = limit - collected.length;
    const batchSize = Math.min(100, remaining);

    const options = { limit: batchSize };
    if (before) options.before = before;

    const messages = await channel.messages.fetch(options);
    if (!messages.size) break;

    const batch = [...messages.values()];
    collected.push(...batch);

    before = batch[batch.length - 1].id;

    if (messages.size < batchSize) break;
  }

  return collected;
}

async function handleWelcomeBackfillCommand(msg, bot, db) {
  const lower = msg.content.toLowerCase();

  if (!lower.startsWith("!welcomebackfill")) return false;

  if (!msg.guild) return true;

  if (!isAdminChannel(msg.channelId)) {
    await msg.reply(`Use \`!welcomebackfill\` in the admin channel only: <#${ADMIN_CH}>.`).catch(() => {});
    return true;
  }

  if (!isStaff(msg.member)) return true;

  const parts = msg.content.trim().split(/\s+/);
  const requestedLimit = Number.parseInt(parts[1], 10);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(requestedLimit, 500))
    : 200;

  const progressMsg = await msg.reply(
    `⏳ Running welcome DM backfill. Checking the last ${limit} welcome messages...`
  ).catch(() => null);

  try {
    const welcomeChannel = await bot.channels.fetch(WELCOME_SOURCE_CHANNEL_ID);

    if (!welcomeChannel || !welcomeChannel.messages) {
      if (progressMsg) {
        await progressMsg.edit("Could not read the welcome channel. Check bot permissions.").catch(() => {});
      }
      return true;
    }

    const messages = await fetchWelcomeMessages(welcomeChannel, limit);

    let checkedMessages = 0;
    let mentionedUsers = 0;
    let sent = 0;
    let already = 0;
    let failed = 0;
    let skippedBot = 0;

    const seenThisRun = new Set();

    for (const welcomeMsg of messages.reverse()) {
      checkedMessages++;

      const users = [...welcomeMsg.mentions.users.values()].filter((user) => !user.bot);

      for (const user of users) {
        if (seenThisRun.has(user.id)) continue;
        seenThisRun.add(user.id);

        mentionedUsers++;

        const result = await welcomeUserOnce(db, user, welcomeMsg.id);

        if (result.sent) sent++;
        if (result.already) already++;
        if (result.failed) failed++;
        if (result.skippedBot) skippedBot++;

        // Light throttle so we do not hammer Discord DMs.
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
    }

    const summary = [
      "✅ Welcome DM backfill complete.",
      "",
      `Checked welcome messages: ${checkedMessages}`,
      `Unique mentioned players: ${mentionedUsers}`,
      `DMs sent: ${sent}`,
      `Already welcomed/skipped: ${already}`,
      `DMs blocked/failed, silently marked: ${failed}`,
      skippedBot ? `Bot mentions skipped: ${skippedBot}` : null,
      "",
      "Players are marked after the attempt, so this command will not spam the same people again.",
    ].filter(Boolean).join("\n");

    if (progressMsg) {
      await progressMsg.edit(summary).catch(() => {});
    } else {
      await msg.reply(summary).catch(() => {});
    }

    return true;
  } catch (err) {
    console.error("❌ Welcome backfill failed:", err);

    if (progressMsg) {
      await progressMsg.edit(`❌ Welcome backfill failed: ${err.message}`).catch(() => {});
    } else {
      await msg.reply(`❌ Welcome backfill failed: ${err.message}`).catch(() => {});
    }

    return true;
  }
}

module.exports = {
  handleWelcomeMessage,
  handleWelcomeBackfillCommand,
};
