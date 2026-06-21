const { ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder, ChannelType } = require("discord.js");
const { postHelpPanel } = require("./guide");

const userSessions = {};

function buildActionMenu() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("post_action")
      .setPlaceholder("What to post?")
      .addOptions([
        { label: "📚 Help Center", value: "help" },
        { label: "📋 Rules", value: "rules" },
        { label: "🤖 Enable Assistant", value: "assistant_on" },
        { label: "🔇 Disable Assistant", value: "assistant_off" },
        { label: "📣 Announcement", value: "announce" },
      ])
  );
}

function buildRulesMenu() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("post_rules")
      .setPlaceholder("Select section...")
      .addOptions([
        { label: "📡 Server Info", value: "server" },
        { label: "📋 General Rules", value: "general" },
        { label: "⚔️ PvP Rules", value: "pvp" },
        { label: "🏗️ Base Building", value: "base" },
        { label: "🚗 Vehicles", value: "vehicles" },
        { label: "🏪 Shops", value: "shops" },
        { label: "🗺️ Map Info", value: "map" },
      ])
  );
}

function buildRuleEmbed(section, content) {
  const emojis = {
    server: "📡",
    general: "📋",
    pvp: "⚔️",
    base: "🏗️",
    vehicles: "🚗",
    shops: "🏪",
    map: "🗺️",
  };
  const colors = {
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

  return new EmbedBuilder()
    .setTitle(`${emojis[section] || "📋"} ${title}`)
    .setDescription(body || content)
    .setColor(colors[section] || 0x3b82f6)
    .setFooter({ text: "Outpost X Server Rules" });
}

async function handlePostInteraction(interaction, liveRules, discord, supabase, enabledChannels) {
  const userId = interaction.user.id;
  const session = userSessions[userId] || {};

  try {
    // Category selection
    if (interaction.customId === "post_category") {
      session.categoryId = interaction.values[0];
      userSessions[userId] = session;

      const guild = interaction.guild;
      const channels = guild.channels.cache
        .filter(ch => ch.parentId === session.categoryId && ch.type === ChannelType.GuildText)
        .map(ch => ({ name: ch.name, value: ch.id }));

      if (channels.length === 0) {
        await interaction.reply({ content: "❌ No channels in this category", ephemeral: true });
        delete userSessions[userId];
        return true;
      }

      await interaction.reply({
        content: "**Which channel?**",
        components: [
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId("post_channel")
              .setPlaceholder("Select channel...")
              .addOptions(channels)
          ),
        ],
        ephemeral: true,
      });
      return true;
    }

    // Channel selection
    if (interaction.customId === "post_channel") {
      session.channelId = interaction.values[0];
      userSessions[userId] = session;

      await interaction.reply({
        content: "**What to post?**",
        components: [buildActionMenu()],
        ephemeral: true,
      });
      return true;
    }

    // Action selection
    if (interaction.customId === "post_action") {
      const action = interaction.values[0];
      session.action = action;
      userSessions[userId] = session;

      const channel = await discord.channels.fetch(session.channelId);

      // Help Center
      if (action === "help") {
        await postHelpPanel(channel);
        await interaction.reply({ content: "✅ Help Center posted!", ephemeral: true });
        delete userSessions[userId];
        return true;
      }

      // Rules
      if (action === "rules") {
        await interaction.reply({
          content: "**Which section?**",
          components: [buildRulesMenu()],
          ephemeral: true,
        });
        return true;
      }

      // Assistant
      if (action === "assistant_on" || action === "assistant_off") {
        if (action === "assistant_on") {
          await supabase.from("assistant_channels").insert({ channel_id: session.channelId });
          enabledChannels.add(session.channelId);
        } else {
          await supabase.from("assistant_channels").delete().eq("channel_id", session.channelId);
          enabledChannels.delete(session.channelId);
        }
        const verb = action === "assistant_on" ? "enabled" : "disabled";
        await interaction.reply({ content: `✅ Assistant ${verb}!`, ephemeral: true });
        delete userSessions[userId];
        return true;
      }

      // Announcement
      if (action === "announce") {
        await interaction.reply({ content: "Type your announcement:", ephemeral: true });
        return true;
      }
    }

    // Rules section
    if (interaction.customId === "post_rules") {
      session.section = interaction.values[0];
      userSessions[userId] = session;

      const channel = await discord.channels.fetch(session.channelId);
      const content = liveRules[session.section];

      if (!content) {
        await interaction.reply({ content: "❌ Section not found", ephemeral: true });
        delete userSessions[userId];
        return true;
      }

      const embed = buildRuleEmbed(session.section, content);
      await channel.send({ embeds: [embed] });
      await interaction.reply({ content: "✅ Posted!", ephemeral: true });
      delete userSessions[userId];
      return true;
    }
  } catch (err) {
    console.error("❌ Interaction error:", err.message);
    await interaction.reply({
      content: `❌ Error: ${err.message}`,
      ephemeral: true,
    }).catch(() => {});
  }

  return false;
}

async function handleAnnouncementText(message, discord) {
  const session = userSessions[message.author.id];
  if (!session || session.action !== "announce" || !session.channelId) return false;

  try {
    const channel = await discord.channels.fetch(session.channelId);
    await channel.send(message.content);
    await message.reply("✅ Posted!");
    delete userSessions[message.author.id];
    return true;
  } catch (err) {
    console.error("❌ Announcement error:", err.message);
    return false;
  }
}

module.exports = {
  userSessions,
  buildActionMenu,
  handlePostInteraction,
  handleAnnouncementText,
};
