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

// ═══════════════════════════════════════════════════════════════════════════
// !POST FLOW: Channel First → Action Second
// ═══════════════════════════════════════════════════════════════════════════

// ─── STEP 1: Pick channel ──────────────────────────────────────────────────
async function handlePostChannelSelect(interaction) {
  if (interaction.customId !== "post_channel") return false;

  const channelId = interaction.values[0];
  tempData[interaction.user.id] = { channelId };

  await interaction.reply({
    content: "**What do you want to post to this channel?**",
    components: [buildPostActionMenu()],
    ephemeral: true,
  });
  return true;
}

// ─── STEP 2: Pick what to post ─────────────────────────────────────────────
async function handlePostActionSelect(interaction) {
  if (interaction.customId !== "post_action") return false;

  const action = interaction.values[0];
  const data = tempData[interaction.user.id];

  if (!data) {
    await interaction.reply({ content: "❌ Session expired.", ephemeral: true });
    return true;
  }

  // HELP CENTER - post directly
  if (action === "help") {
    data.action = "help";
    await interaction.reply({
      content: "**Posting Help Center...**",
      ephemeral: true,
    });
    return true;
  }

  // RULES - pick section
  if (action === "rules") {
    data.action = "rules";
    await interaction.reply({
      content: "**Which rule section?**",
      components: [buildRuleSectionMenu()],
      ephemeral: true,
    });
    return true;
  }

  // ASSISTANT ON/OFF - do it now
  if (action === "assistant_on" || action === "assistant_off") {
    data.action = action;
    await interaction.reply({
      content: `**${action === "assistant_on" ? "Enabling" : "Disabling"} assistant...**`,
      ephemeral: true,
    });
    return true;
  }

  // ANNOUNCEMENT - wait for text
  if (action === "announce") {
    data.action = "announce";
    await interaction.reply({
      content: `**Type your announcement** (will post to <#${data.channelId}>):`,
      ephemeral: true,
    });
    return true;
  }

  return true;
}

// ─── STEP 3: Rule section selected ─────────────────────────────────────────
async function handlePostRuleSectionSelect(interaction) {
  if (interaction.customId !== "post_rule_section") return false;

  const section = interaction.values[0];
  const data = tempData[interaction.user.id];

  if (!data || data.action !== "rules") {
    await interaction.reply({ content: "❌ Session expired.", ephemeral: true });
    return true;
  }

  data.section = section;
  await interaction.reply({
    content: `**Posting ${section}...**`,
    ephemeral: true,
  });
  return true;
}

// ─── STEP 4: Execute the action ────────────────────────────────────────────
async function executePostAction(interaction, liveRules, discord, supabase) {
  const data = tempData[interaction.user.id];
  
  if (!data || !data.channelId) {
    await interaction.reply({ content: "❌ Session expired.", ephemeral: true });
    return false;
  }

  try {
    const channel = await discord.channels.fetch(data.channelId);
    if (!channel) throw new Error("Channel not found");

    // HELP CENTER
    if (data.action === "help") {
      console.log(`   → Posting Help Center to ${channel.name}`);
      await postHelpPanel(channel);
      console.log(`   ✅ Help Center posted`);
      await interaction.reply({ content: `✅ Help Center posted to <#${data.channelId}>!`, ephemeral: true });
      delete tempData[interaction.user.id];
      return true;
    }

    // RULES
    if (data.action === "rules" && data.section) {
      console.log(`   → Posting rules section: ${data.section} to ${channel.name}`);
      
      const content = liveRules[data.section];
      if (!content) {
        console.error(`   ❌ Rule section "${data.section}" not found`);
        console.log(`   Available: ${Object.keys(liveRules).join(", ")}`);
        throw new Error(`Rule section "${data.section}" not found`);
      }

      const sectionEmojis = {
        server: "📡", general: "📋", pvp: "⚔️", base: "🏗️",
        vehicles: "🚗", shops: "🏪", map: "🗺️",
      };
      const sectionColors = {
        server: 0x60a5fa, general: 0xc8a04a, pvp: 0xef4444, base: 0xf59e0b,
        vehicles: 0x8b5cf6, shops: 0x22c55e, map: 0x3b82f6,
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
      console.log(`   ✅ Rules posted`);
      await interaction.reply({ content: `✅ Posted to <#${data.channelId}>!`, ephemeral: true });
      delete tempData[interaction.user.id];
      return true;
    }

    // ASSISTANT ON
    if (data.action === "assistant_on") {
      console.log(`   → Enabling assistant in ${channel.name}`);
      await supabase.from("assistant_channels").insert({ channel_id: data.channelId });
      console.log(`   ✅ Assistant enabled`);
      await interaction.reply({ content: `✅ Assistant enabled in <#${data.channelId}>!`, ephemeral: true });
      delete tempData[interaction.user.id];
      return true;
    }

    // ASSISTANT OFF
    if (data.action === "assistant_off") {
      console.log(`   → Disabling assistant in ${channel.name}`);
      await supabase.from("assistant_channels").delete().eq("channel_id", data.channelId);
      console.log(`   ✅ Assistant disabled`);
      await interaction.reply({ content: `✅ Assistant disabled in <#${data.channelId}>!`, ephemeral: true });
      delete tempData[interaction.user.id];
      return true;
    }

  } catch (err) {
    console.error(`   ❌ Error: ${err.message}`);
    await interaction.reply({ content: `❌ Error: ${err.message}`, ephemeral: true });
    delete tempData[interaction.user.id];
    throw err;
  }
  
  return false;
}

// ─── Handle announcement text ──────────────────────────────────────────────
async function handleAnnouncementText(message, discord) {
  const data = tempData[message.author.id];
  if (!data || data.action !== "announce" || !data.channelId) return false;

  try {
    const channel = await discord.channels.fetch(data.channelId);
    if (!channel) throw new Error("Channel not found");

    console.log(`   → Posting announcement to ${channel.name}`);
    await channel.send(message.content);
    console.log(`   ✅ Announcement posted`);
    await message.reply({ content: `✅ Posted to <#${data.channelId}>!` });
    delete tempData[message.author.id];
  } catch (err) {
    console.error(`   ❌ Announcement error: ${err.message}`);
    await message.reply({ content: `❌ Error: ${err.message}` });
    delete tempData[message.author.id];
  }
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// UI BUILDERS
// ═══════════════════════════════════════════════════════════════════════════

function buildPostChannelMenu() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("post_channel")
      .setPlaceholder("Select channel...")
      .addOptions([
        { label: "Admin Channel", value: "1518059656302301245" },
        { label: "Main Chat", value: "1516269437932670977" },
      ])
  );
}

function buildPostActionMenu() {
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

function buildRuleSectionMenu() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("post_rule_section")
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

module.exports = {
  buildPostChannelMenu,
  handlePostChannelSelect,
  handlePostActionSelect,
  handlePostRuleSectionSelect,
  executePostAction,
  handleAnnouncementText,
  tempData,
};
