const { EmbedBuilder } = require("discord.js");

const WELCOME_SOURCE_CHANNEL_ID =
  process.env.WELCOME_SOURCE_CHANNEL_ID || "1516313331089018890";

const RULES_CHANNEL_ID =
  process.env.RULES_CHANNEL_ID || "1516308380837220445";

const GAME_HELP_CHANNEL_ID =
  process.env.GAME_HELP_CHANNEL_ID || "1518081954119942227";

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

async function handleWelcomeMessage(msg, db) {
  if (!msg.guild) return false;
  if (msg.channelId !== WELCOME_SOURCE_CHANNEL_ID) return false;

  const mentionedUsers = [...msg.mentions.users.values()].filter((user) => !user.bot);

  if (!mentionedUsers.length) return false;

  for (const user of mentionedUsers) {
    const alreadyWelcomed = await hasAlreadyWelcomed(db, user.id);
    if (alreadyWelcomed) continue;

    const dmSent = await sendWelcomeDm(user);

    // Mark either way so every player is attempted only once ever.
    await markWelcomed(db, user, msg.id, dmSent);
  }

  return false;
}

module.exports = {
  handleWelcomeMessage,
};
