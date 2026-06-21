const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require("discord.js");
const { postHelpPanel } = require("./guide");

// Store temporary data per user (cleared after use)
const tempData = {};

// ─── STEP 1: What do you want to do? ───────────────────────────────────────
async function handlePostWhatSelect(interaction) {
  if (interaction.customId !== "post_what") return false;

  const what = interaction.values[0];

  if (what === "rules") {
    // Go directly to section selection
    await interaction.reply({
      content: "**Which rule section to post?**",
      components: [buildRuleSectionMenu()],
      ephemeral: true,
    });
    return true;
  }

  if (what === "help") {
    // Go directly to channel selection
    tempData[interaction.user.id] = { action: "help" };
    await interaction.reply({
      content: "**Where to post Help Center?**",
      components: [buildChannelMenu("help_channel")],
      ephemeral: true,
    });
    return true;
  }

  if (what === "assistant_on" || what === "assistant_off") {
    tempData[interaction.user.id] = { action: what };
    await interaction.reply({
      content: `**Which channel to ${what === "assistant_on" ? "enable" : "disable"} assistant?**`,
      components: [buildChannelMenu("assistant_channel")],
      ephemeral: true,
    });
    return true;
  }

  if (what === "announce") {
    tempData[interaction.user.id] = { action: "announce" };
    await interaction.reply({
      content: "**Which channel for announcement?**",
      components: [buildChannelMenu("announce_channel")],
      ephemeral: true,
    });
    return true;
  }

  return true;
}

// ─── STEP 2: Rule section selected ─────────────────────────────────────────
async function handleRuleSectionSelect(interaction, liveRules) {
  if (interaction.customId !== "rule_section") return false;

  const section = interaction.values[0];
  tempData[interaction.user.id] = { action: "rules", section };

  await interaction.reply({
    content: `**Post **${section}** to which channel?**`,
    components: [buildChannelMenu("rules_channel")],
    ephemeral: true,
  });
  return true;
}

// ─── STEP 3: Channel selected (for any action) ─────────────────────────────
async function handleChannelSelect(interaction, liveRules, discord, supabase) {
  const customId = interaction.customId;
  if (!customId.endsWith("_channel")) return false;

  const channelId = interaction.values[0];
  const userId = interaction.user.id;
  const data = tempData[userId];

  if (!data) {
    await interaction.reply({ content: "❌ Session expired.", ephemeral: true });
    return true;
  }

  try {
    const channel = await discord.channels.fetch(channelId);
    if (!channel) throw new Error("Channel not found");

    // HELP CENTER
    if (data.action === "help") {
      await postHelpPanel(channel);
      await interaction.reply({
        content: `✅ Help Center posted to <#${channelId}>!`,
        ephemeral: true,
      });
      delete tempData[userId];
      return true;
    }

    // RULES
    if (data.action === "rules" && data.section) {
      const content = liveRules[data.section];
      if (!content) throw new Error("Rule section not found");

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
        .setTitle(`${sectionEmojis[data.section] || "📋"} ${title}`)
        .setDescription(body || content)
        .setColor(sectionColors[data.section] || 0x3b82f6)
        .setFooter({ text: "Outpost X Server Rules" });

      await channel.send({ embeds: [embed] });
      await interaction.reply({
        content: `✅ Posted to <#${channelId}>!`,
        ephemeral: true,
      });
      delete tempData[userId];
      return true;
    }

    // ASSISTANT ON/OFF
    if (data.action === "assistant_on") {
      await supabase
        .from("assistant_channels")
        .insert({ channel_id: channelId });
      await interaction.reply({
        content: `✅ Assistant enabled in <#${channelId}>!`,
        ephemeral: true,
      });
      delete tempData[userId];
      return true;
    }

    if (data.action === "assistant_off") {
      await supabase
        .from("assistant_channels")
        .delete()
        .eq("channel_id", channelId);
      await interaction.reply({
        content: `✅ Assistant disabled in <#${channelId}>!`,
        ephemeral: true,
      });
      delete tempData[userId];
      return true;
    }

    // ANNOUNCEMENT
    if (data.action === "announce") {
      tempData[userId].channelId = channelId;
      await interaction.reply({
        content: `Type your announcement (will post to <#${channelId}>):`,
        ephemeral: true,
      });
      return true;
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    await interaction.reply({
      content: `❌ Error: ${err.message}`,
      ephemeral: true,
    });
    delete tempData[userId];
  }

  return true;
}

// ─── Handle announcement text ──────────────────────────────────────────────
async function handleAnnouncementText(message, discord) {
  const data = tempData[message.author.id];
  if (!data || data.action !== "announce" || !data.channelId) return false;

  try {
    const channel = await discord.channels.fetch(data.channelId);
    if (!channel) throw new Error("Channel not found");

    await channel.send(message.content);
    await message.reply({
      content: `✅ Announcement posted to <#${data.channelId}>!`,
    });
    delete tempData[message.author.id];
  } catch (err) {
    console.error(`Announcement error: ${err.message}`);
    await message.reply({
      content: `❌ Error: ${err.message}`,
    });
  }
  return true;
}

// ─── UI Builders ───────────────────────────────────────────────────────────
function buildRuleSectionMenu() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("rule_section")
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

function buildChannelMenu(customId) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder("Select channel...")
      .addOptions([
        { label: "Admin Channel", value: "1518059656302301245" },
        { label: "Main Chat", value: "1516269437932670977" },
      ])
  );
}

module.exports = {
  handlePostWhatSelect,
  handleRuleSectionSelect,
  handleChannelSelect,
  handleAnnouncementText,
  tempData, // For debugging
};
