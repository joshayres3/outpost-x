const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} = require("discord.js");

const RULES_CHANNEL_ID = process.env.RULES_CHANNEL_ID || "1516308380837220445";
const EXILES_ROLE_ID = process.env.EXILES_ROLE_ID || "1516270776272031796";
const MAIN_CHAT_CHANNEL_ID = process.env.MAIN_CHAT_CHANNEL_ID || "1516269437932670977";
const BUTTON_ID = "watcher_accept_rules";
const PANEL_MARKER = "WATCHER_RULES_ACCEPT_PANEL";


function isStaff(member) {
  return member?.roles?.cache?.some((role) =>
    ["Owner", "Owners", "Admin", "Trial Admin"].includes(role.name)
  );
}


async function handleRulesAcceptCommand(message) {
  const content = message.content.trim().toLowerCase();
  if (content !== "!rulesacceptsetup") return false;

  if (!isStaff(message.member)) return true;

  if (message.channelId !== RULES_CHANNEL_ID) {
    await message.reply(`Run this command in <#${RULES_CHANNEL_ID}>.`).catch(() => {});
    return true;
  }

  const me = message.guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    await message.reply("The Watcher needs the **Manage Roles** permission before this can be posted.").catch(() => {});
    return true;
  }

  const role = message.guild.roles.cache.get(EXILES_ROLE_ID);
  if (!role) {
    await message.reply("I could not find The Exiles role. Check the configured role ID.").catch(() => {});
    return true;
  }

  if (role.position >= me.roles.highest.position) {
    await message.reply("Move The Watcher bot role above **The Exiles** role so I can assign it.").catch(() => {});
    return true;
  }

  // Keep the rules channel clean by removing older Watcher acceptance panels.
  const recent = await message.channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (recent) {
    for (const oldMessage of recent.values()) {
      if (
        oldMessage.author.id === message.client.user.id &&
        oldMessage.embeds?.[0]?.footer?.text === PANEL_MARKER
      ) {
        await oldMessage.delete().catch(() => {});
      }
    }
  }

  const embed = new EmbedBuilder()
    .setTitle("Welcome to Outpost X")
    .setDescription(
      [
        "Read the server rules above, then use the button below to accept them and join the community.",
        "",
        "By clicking, you confirm that you understand and agree to follow the rules.",
      ].join("\n")
    )
    .setFooter({ text: PANEL_MARKER });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(BUTTON_ID)
      .setLabel("Click to Accept Rules and Join!")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success)
  );

  await message.channel.send({ embeds: [embed], components: [row] });
  await message.delete().catch(() => {});
  return true;
}

async function handleRulesAcceptInteraction(interaction) {
  if (!interaction.isButton() || interaction.customId !== BUTTON_ID) return false;

  if (!interaction.guild || !interaction.member) {
    await interaction.reply({
      content: "This button only works inside the Outpost X Discord server.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) {
    await interaction.reply({
      content: "I could not load your server membership. Please try again.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (member.roles.cache.has(EXILES_ROLE_ID)) {
    await interaction.reply({
      content: "You already accepted the rules and are one of **The Exiles**.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const role = interaction.guild.roles.cache.get(EXILES_ROLE_ID);
  const me = interaction.guild.members.me;
  if (!role || !me || role.position >= me.roles.highest.position) {
    await interaction.reply({
      content: "I could not assign The Exiles role. Please contact an admin.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    await member.roles.add(role, "Accepted the Outpost X server rules");

    const mainChatUrl = `https://discord.com/channels/${interaction.guild.id}/${MAIN_CHAT_CHANNEL_ID}`;
    const mainChatRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel("Go to Main Chat")
        .setEmoji("💬")
        .setStyle(ButtonStyle.Link)
        .setURL(mainChatUrl)
    );

    await interaction.editReply({
      content: "Rules accepted! You are now one of **The Exiles**. Head to Main Chat and say hello.",
      components: [mainChatRow],
    });

    const mainChat = await interaction.guild.channels.fetch(MAIN_CHAT_CHANNEL_ID).catch(() => null);
    if (mainChat?.isTextBased()) {
      await mainChat.send({
        content: `<@${interaction.user.id}>, welcome to Outpost X — you are now one of **The Exiles**!`,
        allowedMentions: { users: [interaction.user.id] },
      }).catch((err) => console.error("❌ Rules welcome post failed:", err.message));
    }
  } catch (err) {
    console.error("❌ Rules acceptance failed:", err);
    await interaction.editReply(
      "I could not assign The Exiles role. Please contact an admin."
    );
  }

  return true;
}

module.exports = {
  handleRulesAcceptCommand,
  handleRulesAcceptInteraction,
};
