const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");

const ADMIN_CH = process.env.ADMIN_CHANNEL_ID || "1518059656302301245";

const sessions = new Map();

function isOwner(member) {
  if (!member) return false;

  return member.roles.cache.some((r) => {
    return r.name === "Owner" || r.name === "Owners";
  });
}

function isAdminChannel(channelId) {
  return channelId === ADMIN_CH;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanMessage(text) {
  return String(text || "").trim().slice(0, 1800);
}

function buildPreviewEmbed(count, message) {
  return new EmbedBuilder()
    .setTitle("📨 Watcher DM Broadcast")
    .setColor(0x3b82f6)
    .setDescription(
      [
        "This will DM everyone who has already received a Watcher welcome DM.",
        "",
        `**Recipients found:** ${count}`,
        "",
        "**Message Preview:**",
        "```",
        message,
        "```",
      ].join("\n")
    )
    .setFooter({ text: "Outpost X • The Watcher" })
    .setTimestamp();
}

function confirmButtons(userId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`watcherdm_confirm:${userId}`)
        .setLabel("Send DMs")
        .setEmoji("📨")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`watcherdm_cancel:${userId}`)
        .setLabel("Cancel")
        .setEmoji("❌")
        .setStyle(ButtonStyle.Secondary)
    ),
  ];
}

async function loadWelcomeDmRecipients(db) {
  const { data, error } = await db
    .from("welcome_dms")
    .select("user_id, username")
    .eq("dm_sent", true);

  if (error) throw error;

  const unique = new Map();

  for (const row of data || []) {
    if (!row.user_id) continue;
    unique.set(row.user_id, {
      user_id: row.user_id,
      username: row.username || "Unknown",
    });
  }

  return Array.from(unique.values());
}

async function handleWatcherDmCommand(msg, context) {
  if (!msg.guild) return false;

  const text = msg.content || "";
  const lower = text.trim().toLowerCase();

  const existing = sessions.get(msg.author.id);

  if (existing && existing.step === "awaiting_message") {
    if (msg.channelId !== existing.channelId) return false;

    if (!isOwner(msg.member)) {
      sessions.delete(msg.author.id);
      return true;
    }

    const dmMessage = cleanMessage(msg.content);

    if (!dmMessage) {
      await msg.reply("Message cannot be empty. Send the DM text again, or type `cancel`.").catch(() => {});
      return true;
    }

    if (lower === "cancel") {
      sessions.delete(msg.author.id);
      await msg.reply("❌ Watcher DM setup cancelled.").catch(() => {});
      msg.delete().catch(() => {});
      return true;
    }

    const { db } = context;

    try {
      const recipients = await loadWelcomeDmRecipients(db);

      sessions.set(msg.author.id, {
        step: "preview",
        channelId: msg.channelId,
        message: dmMessage,
        createdAt: Date.now(),
      });

      const preview = await msg.reply({
        embeds: [buildPreviewEmbed(recipients.length, dmMessage)],
        components: recipients.length ? confirmButtons(msg.author.id) : [],
      });

      msg.delete().catch(() => {});

      if (existing.promptMessageId) {
        const oldPrompt = await msg.channel.messages.fetch(existing.promptMessageId).catch(() => null);
        if (oldPrompt) oldPrompt.delete().catch(() => {});
      }

      sessions.set(msg.author.id, {
        step: "preview",
        channelId: msg.channelId,
        message: dmMessage,
        previewMessageId: preview.id,
        createdAt: Date.now(),
      });
    } catch (err) {
      console.error("❌ Watcher DM preview failed:", err);

      await msg.reply([
        "❌ Could not prepare the Watcher DM broadcast.",
        "",
        `Error: ${err.message}`,
      ].join("\n")).catch(() => {});
    }

    return true;
  }

  if (lower !== "!watcherdm") return false;

  if (!isAdminChannel(msg.channelId)) {
    await msg.reply(`Use \`!watcherdm\` in the admin channel only: <#${ADMIN_CH}>.`).catch(() => {});
    return true;
  }

  if (!isOwner(msg.member)) {
    await msg.reply("Only Owners can use `!watcherdm`.").catch(() => {});
    return true;
  }

  sessions.set(msg.author.id, {
    step: "awaiting_message",
    channelId: msg.channelId,
    createdAt: Date.now(),
  });

  const prompt = await msg.reply({
    content: [
      "📨 **Watcher DM Broadcast**",
      "",
      "Send the exact message you want The Watcher to DM to everyone who already received a welcome DM.",
      "",
      "Limit: 1800 characters.",
      "Type `cancel` to stop.",
    ].join("\n"),
  }).catch(() => null);

  if (prompt) {
    sessions.set(msg.author.id, {
      step: "awaiting_message",
      channelId: msg.channelId,
      promptMessageId: prompt.id,
      createdAt: Date.now(),
    });
  }

  msg.delete().catch(() => {});
  return true;
}

async function handleWatcherDmInteraction(interaction, context) {
  const customId = interaction.customId || "";

  if (!customId.startsWith("watcherdm_")) return false;

  if (!interaction.guild) return true;

  const [action, ownerId] = customId.split(":");

  if (interaction.user.id !== ownerId) {
    await interaction.reply({
      content: "Only the owner who started this Watcher DM broadcast can use these buttons.",
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return true;
  }

  if (!isAdminChannel(interaction.channelId)) {
    await interaction.reply({
      content: `Use Watcher DM controls in the admin channel only: <#${ADMIN_CH}>.`,
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return true;
  }

  if (!isOwner(interaction.member)) {
    await interaction.reply({
      content: "Only Owners can use Watcher DM controls.",
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return true;
  }

  if (action === "watcherdm_cancel") {
    sessions.delete(ownerId);

    await interaction.update({
      content: "❌ Watcher DM broadcast cancelled.",
      embeds: [],
      components: [],
    }).catch(() => {});

    return true;
  }

  if (action !== "watcherdm_confirm") return false;

  const session = sessions.get(ownerId);

  if (!session || !session.message) {
    await interaction.reply({
      content: "No Watcher DM message found. Run `!watcherdm` again.",
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return true;
  }

  await interaction.deferUpdate().catch(() => {});

  const { bot, db } = context;

  await interaction.editReply({
    content: "📨 Sending Watcher DMs now. This may take a moment.",
    embeds: [],
    components: [],
  }).catch(() => {});

  let recipients = [];

  try {
    recipients = await loadWelcomeDmRecipients(db);
  } catch (err) {
    console.error("❌ Watcher DM recipient load failed:", err);

    await interaction.editReply({
      content: [
        "❌ Watcher DM broadcast failed before sending.",
        "",
        `Error: ${err.message}`,
      ].join("\n"),
      embeds: [],
      components: [],
    }).catch(() => {});

    return true;
  }

  let sent = 0;
  let failed = 0;
  const failedUsers = [];

  for (const recipient of recipients) {
    try {
      const user = await bot.users.fetch(recipient.user_id);
      await user.send(session.message);
      sent += 1;
    } catch (err) {
      failed += 1;
      failedUsers.push(`${recipient.username || "Unknown"} (${recipient.user_id})`);
    }

    await sleep(750);
  }

  sessions.delete(ownerId);

  const failedText = failedUsers.length
    ? `\n\n**Failed / blocked DMs:**\n${failedUsers.slice(0, 20).join("\n")}${failedUsers.length > 20 ? "\n...and more" : ""}`
    : "";

  await interaction.editReply({
    content: [
      "✅ Watcher DM broadcast complete.",
      "",
      `Sent: **${sent}**`,
      `Failed/blocked: **${failed}**`,
      failedText,
    ].join("\n"),
    embeds: [],
    components: [],
  }).catch(() => {});

  return true;
}

module.exports = {
  handleWatcherDmCommand,
  handleWatcherDmInteraction,
};
