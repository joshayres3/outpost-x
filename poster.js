const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require("discord.js");
const { postHelpPanel } = require("./guide");

// ─── STEP 1: What do you want to post? ──────────────────────────────────────
async function handlePostWhatSelect(interaction) {
  if (interaction.customId !== "post_what_select") return false;

  const what = interaction.values[0];

  if (what === "help") {
    // Go straight to channel selection
    await interaction.reply({
      content: "Which channel?",
      components: [
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("post_help_channel")
            .setPlaceholder("Select channel...")
            .addOptions([
              { label: "Admin Channel", value: "1518059656302301245" },
              { label: "Main Chat", value: "1516269437932670977" },
            ])
        ),
      ],
      ephemeral: true,
    });
    return true;
  }

  if (what === "rules") {
    // Go straight to rules selection
    await interaction.reply({
      content: "Which section?",
      components: [
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("post_rules_section")
            .setPlaceholder("Select rules...")
            .addOptions([
              { label: "📡 Server Info", value: "server" },
              { label: "📋 General Rules", value: "general" },
              { label: "⚔️ PvP Rules", value: "pvp" },
              { label: "🏗️ Base Building", value: "base" },
              { label: "🚗 Vehicles", value: "vehicles" },
              { label: "🏪 Shops", value: "shops" },
              { label: "🗺️ Map Info", value: "map" },
            ])
        ),
      ],
      ephemeral: true,
    });
    return true;
  }

  if (what === "assistant_on" || what === "assistant_off") {
    await interaction.reply({
      content: "Which channel?",
      components: [
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("post_assistant_channel")
            .setPlaceholder("Select channel...")
            .addOptions([
              { label: "Admin Channel", value: "1518059656302301245" },
              { label: "Main Chat", value: "1516269437932670977" },
            ])
        ),
      ],
      ephemeral: true,
    });
    return true;
  }

  if (what === "announce") {
    await interaction.reply({
      content: "Which channel?",
      components: [
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("post_announce_channel")
            .setPlaceholder("Select channel...")
            .addOptions([
              { label: "Admin Channel", value: "1518059656302301245" },
              { label: "Main Chat", value: "1516269437932670977" },
            ])
        ),
      ],
      ephemeral: true,
    });
    return true;
  }

  return true;
}

// ─── STEP 2: Process selections ──────────────────────────────────────────────
async function handlePostHelpChannel(interaction, discord) {
  if (interaction.customId !== "post_help_channel") return false;

  const channelId = interaction.values[0];
  try {
    const channel = await discord.channels.fetch(channelId);
    if (!channel) throw new Error("Channel not found");

    await postHelpPanel(channel);
    await interaction.reply({
      content: `✅ Help Center posted to <#${channelId}>!`,
      ephemeral: true,
    });
  } catch (err) {
    console.error("Help posting error:", err.message);
    await interaction.reply({
      content: `❌ Error: ${err.message}`,
      ephemeral: true,
    });
  }
  return true;
}

async function handlePostRulesSection(interaction, liveRules, discord) {
  if (interaction.customId !== "post_rules_section") return false;

  const rulesSection = interaction.values[0];

  // Ask for channel
  await interaction.reply({
    content: `Where to post ${rulesSection}?`,
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`post_rules_to_${rulesSection}`)
          .setPlaceholder("Select channel...")
          .addOptions([
            { label: "Admin Channel", value: "1518059656302301245" },
            { label: "Main Chat", value: "1516269437932670977" },
          ])
      ),
    ],
    ephemeral: true,
  });
  return true;
}

async function handlePostRulesChannel(interaction, liveRules, rulesSection, discord) {
  // Match custom IDs like post_rules_to_server, post_rules_to_general, etc.
  const match = interaction.customId.match(/^post_rules_to_(.+)$/);
  if (!match) return false;

  const section = match[1];
  const channelId = interaction.values[0];

  try {
    const channel = await discord.channels.fetch(channelId);
    if (!channel) throw new Error("Channel not found");

    const content = liveRules[section];
    if (!content) throw new Error(`Rule section "${section}" not found`);

    const sectionEmojis = {
      server: "📡",
      general: "📋",
      pvp: "⚔️",
      base: "🏗️",
      vehicles: "🚗",
      shops: "🏪",
      map: "🗺️",
    };

    const sectionColors = {
      server: 0x60a5fa,
      general: 0xc8a04a,
      pvp: 0xef4444,
      base: 0xf59e0b,
      vehicles: 0x8b5cf6,
      shops: 0x22c55e,
      map: 0x3b82f6,
    };

    const lines = content.split("\n");
    const title = lines[0];
    const body = lines.slice(1).join("\n").trim();

    const embed = new EmbedBuilder()
      .setTitle(`${sectionEmojis[section] || "📋"} ${title}`)
      .setDescription(body || content)
      .setColor(sectionColors[section] || 0x3b82f6)
      .setFooter({ text: "Outpost X Server Rules" });

    await channel.send({ embeds: [embed] });
    await interaction.reply({
      content: `✅ Posted to <#${channelId}>!`,
      ephemeral: true,
    });
  } catch (err) {
    console.error("Rules posting error:", err.message);
    await interaction.reply({
      content: `❌ Error: ${err.message}`,
      ephemeral: true,
    });
  }
  return true;
}

async function handlePostAssistantChannel(
  interaction,
  discord,
  supabase,
  what
) {
  if (interaction.customId !== "post_assistant_channel") return false;

  const channelId = interaction.values[0];

  try {
    const channel = await discord.channels.fetch(channelId);
    if (!channel) throw new Error("Channel not found");

    if (what === "assistant_on") {
      // Enable assistant
      await supabase
        .from("assistant_channels")
        .insert({ channel_id: channelId });
      await interaction.reply({
        content: `✅ Assistant enabled in <#${channelId}>!`,
        ephemeral: true,
      });
    } else {
      // Disable assistant
      await supabase
        .from("assistant_channels")
        .delete()
        .eq("channel_id", channelId);
      await interaction.reply({
        content: `✅ Assistant disabled in <#${channelId}>!`,
        ephemeral: true,
      });
    }
  } catch (err) {
    console.error("Assistant toggle error:", err.message);
    await interaction.reply({
      content: `❌ Error: ${err.message}`,
      ephemeral: true,
    });
  }
  return true;
}

async function handlePostAnnounceChannel(interaction, what) {
  if (interaction.customId !== "post_announce_channel") return false;

  const channelId = interaction.values[0];

  // Store channel ID in interaction for later use in messageCreate
  interaction.client.announceChannelId = channelId;

  await interaction.reply({
    content: `Type your announcement (it will be posted to <#${channelId}>):`,
    ephemeral: true,
  });

  return true;
}

async function handleAnnouncementText(message, discord) {
  const channelId = message.client.announceChannelId;
  if (!channelId) return false;

  try {
    const channel = await discord.channels.fetch(channelId);
    if (!channel) throw new Error("Channel not found");

    await channel.send(message.content);
    await message.reply({
      content: `✅ Announcement posted!`,
      ephemeral: true,
    });
    delete message.client.announceChannelId;
  } catch (err) {
    console.error("Announcement error:", err.message);
    await message.reply({
      content: `❌ Error: ${err.message}`,
      ephemeral: true,
    });
  }
  return true;
}

module.exports = {
  handlePostWhatSelect,
  handlePostHelpChannel,
  handlePostRulesSection,
  handlePostRulesChannel,
  handlePostAssistantChannel,
  handlePostAnnounceChannel,
  handleAnnouncementText,
};
