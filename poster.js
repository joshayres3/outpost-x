const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require("discord.js");
const { postGuidePanel } = require("./guide");

// Tracks what each admin selected in step 1 (what to post)
const pendingPosts = {};

// Auto-delete an interaction message after a delay
async function autoDelete(interaction, delayMs = 30000) {
  try {
    await new Promise((r) => setTimeout(r, delayMs));
    if (interaction.message) {
      await interaction.message.delete();
    } else {
      await interaction.deleteReply();
    }
  } catch (e) {} // ignore if already deleted
}

// ─── Step 1 result — admin picked WHAT to post ────────────────────────────────
async function handlePostWhatSelect(interaction) {
  if (interaction.customId !== "post_select_what") return false;

  const what = interaction.values[0];
  pendingPosts[interaction.user.id] = { what, sourceChannelId: interaction.channelId };

  const labels = {
    guide:         "📖 Player Survival Guide",
    rules:         "📋 Server Rules",
    assistant_on:  "🤖 Enable Assistant Mode",
    assistant_off: "🔇 Disable Assistant Mode",
    announce:      "📣 Announcement",
  };

  if (!labels[what]) {
    await interaction.reply({ content: "❌ Invalid selection.", ephemeral: true });
    return true;
  }

  // For guide, also use category selection
  if (what === "guide") {
    await interaction.reply({
      content: `**${labels[what]}**\n\nWhich category?`,
      components: [
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("post_category_select")
            .setPlaceholder("Choose a category...")
            .addOptions(
              interaction.guild.channels.cache
                .filter(ch => ch.type === 4) // Type 4 = Category
                .map(cat => ({
                  label: cat.name,
                  value: cat.id
                }))
                .slice(0, 25)
            )
        )
      ],
      ephemeral: true
    });
    return true;
  }

  // For assistant toggle, skip channel selection
  if (what === "assistant_on" || what === "assistant_off") {
    await interaction.reply({
      content: `**${labels[what]}**\n\nSelect the channel where you want to ${what === "assistant_on" ? "enable" : "disable"} the assistant:`,
      components: [
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("post_pick_channel")
            .setPlaceholder("Choose a channel...")
            .addOptions(
              { label: "Main Chat", value: "1516269437932670977" },
              { label: "Other Channel", value: "other" }
            )
        )
      ],
      ephemeral: true
    });
    return true;
  }

  // For rules and announcements, ask which channel CATEGORY to post in
  await interaction.reply({
    content: `**${labels[what]}**\n\nWhich category?`,
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("post_category_select")
          .setPlaceholder("Choose a category...")
          .addOptions(
            interaction.guild.channels.cache
              .filter(ch => ch.type === 4) // Type 4 = Category
              .map(cat => ({
                label: cat.name,
                value: cat.id
              }))
              .slice(0, 25) // Discord limit is 25 options
          )
      )
    ],
    ephemeral: true
  });

  return true;
}

// ─── Step 2a: Admin picked WHERE to post ──────────────────────────────────────
async function handlePostWhereSelect(interaction, liveRules) {
  if (interaction.customId !== "post_where_select") return false;

  const channelId = interaction.values[0];
  const pending = pendingPosts[interaction.user.id];

  if (!pending) {
    await interaction.reply({ content: "❌ Session expired. Start over with !post", ephemeral: true });
    return true;
  }

  if (channelId === "other") {
    await interaction.reply({
      content: "Paste the channel ID you want to use:",
      ephemeral: true
    });
    return true;
  }

  pending.targetChannelId = channelId;

  // If posting guide, post it directly
  if (pending.what === "guide") {
    try {
      const channel = await interaction.guild.channels.fetch(pending.targetChannelId);
      if (!channel) throw new Error("Channel not found");
      
      await postGuidePanel(channel);
      await interaction.update({
        content: `✅ Guide posted to <#${pending.targetChannelId}>!`,
        components: []
      });
      delete pendingPosts[interaction.user.id];
    } catch (err) {
      await interaction.update({ content: `❌ Error: ${err.message}`, components: [] });
    }
    return true;
  }

  // If posting rules, show rule section selector
  if (pending.what === "rules") {
    const { StringSelectMenuBuilder, ActionRowBuilder } = require("discord.js");
    const selectRules = new StringSelectMenuBuilder()
      .setCustomId("post_which_rules")
      .setPlaceholder("Which rules to post?")
      .addOptions([
        { label: "📋 All Rules", value: "all" },
        { label: "📡 Server Info", value: "server" },
        { label: "📋 General Rules", value: "general" },
        { label: "⚔️ PvP Rules", value: "pvp" },
        { label: "🏗️ Base Building", value: "base" },
        { label: "🚗 Vehicles", value: "vehicles" },
        { label: "🏪 Shops", value: "shops" },
        { label: "🗺️ Map Info", value: "map" },
      ]);

    await interaction.update({
      content: "**Which rule sections do you want to post?**",
      components: [new ActionRowBuilder().addComponents(selectRules)]
    });
    return true;
  }

  // If toggling assistant, proceed with confirmation
  if (pending.what === "assistant_on" || pending.what === "assistant_off") {
    const { guild } = interaction;
    const channel = await guild.channels.fetch(pending.targetChannelId).catch(() => null);

    if (!channel) {
      await interaction.reply({ content: "❌ Channel not found.", ephemeral: true });
      return true;
    }

    await interaction.update({
      content: `**${pending.what === "assistant_on" ? "Enable" : "Disable"} Assistant in ${channel.name}?**\n\nThe bot will ${pending.what === "assistant_on" ? "answer rule questions" : "stop answering rule questions"} in that channel.`,
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("post_confirm_assistant")
            .setLabel(pending.what === "assistant_on" ? "Enable" : "Disable")
            .setStyle(pending.what === "assistant_on" ? ButtonStyle.Success : ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId("post_cancel")
            .setLabel("Cancel")
            .setStyle(ButtonStyle.Secondary)
        )
      ]
    });
    return true;
  }

  // If announcing, ask for announcement text
  if (pending.what === "announce") {
    await interaction.update({
      content: "Type your announcement message in chat (next message you send).",
      components: []
    });
    return true;
  }

  return true;
}

// ─── Step 2b: Admin picked which CATEGORY ─────────────────────────────────────
async function handlePostCategorySelect(interaction) {
  if (interaction.customId !== "post_category_select") return false;

  const categoryId = interaction.values[0];
  const pending = pendingPosts[interaction.user.id];

  if (!pending) {
    await interaction.reply({ content: "❌ Session expired.", ephemeral: true });
    return true;
  }

  pending.categoryId = categoryId;

  // Get all channels in this category
  const category = interaction.guild.channels.cache.get(categoryId);
  const channelsInCategory = interaction.guild.channels.cache.filter(ch => ch.parentId === categoryId);

  if (channelsInCategory.size === 0) {
    await interaction.update({ content: "❌ No channels in this category.", components: [] });
    return true;
  }

  const { StringSelectMenuBuilder, ActionRowBuilder } = require("discord.js");
  const selectChannel = new StringSelectMenuBuilder()
    .setCustomId("post_channel_select")
    .setPlaceholder("Choose a channel...")
    .addOptions(
      channelsInCategory
        .map(ch => ({
          label: ch.name,
          value: ch.id
        }))
        .slice(0, 25) // Discord limit
    );

  await interaction.update({
    content: `**Which channel in ${category.name}?**`,
    components: [new ActionRowBuilder().addComponents(selectChannel)]
  });

  return true;
}

// ─── Step 2c: Admin picked which CHANNEL ───────────────────────────────────────
async function handlePostChannelSelect(interaction, liveRules) {
  if (interaction.customId !== "post_channel_select") return false;

  const channelId = interaction.values[0];
  const pending = pendingPosts[interaction.user.id];

  if (!pending) {
    await interaction.reply({ content: "❌ Session expired.", ephemeral: true });
    return true;
  }

  pending.targetChannelId = channelId;
  const channel = interaction.guild.channels.cache.get(channelId);

  // If posting rules, show rule section selector
  if (pending.what === "rules") {
    const { StringSelectMenuBuilder, ActionRowBuilder } = require("discord.js");
    const selectRules = new StringSelectMenuBuilder()
      .setCustomId("post_which_rules")
      .setPlaceholder("Which rules to post?")
      .addOptions([
        { label: "📋 All Rules", value: "all" },
        { label: "📡 Server Info", value: "server" },
        { label: "📋 General Rules", value: "general" },
        { label: "⚔️ PvP Rules", value: "pvp" },
        { label: "🏗️ Base Building", value: "base" },
        { label: "🚗 Vehicles", value: "vehicles" },
        { label: "🏪 Shops", value: "shops" },
        { label: "🗺️ Map Info", value: "map" },
      ]);

    await interaction.update({
      content: "**Which rule sections do you want to post?**",
      components: [new ActionRowBuilder().addComponents(selectRules)]
    });
    return true;
  }

  // If guide, post it directly
  if (pending.what === "guide") {
    try {
      const { postGuidePanel } = require("./guide");
      await postGuidePanel(channel);
      await interaction.update({
        content: `✅ Guide posted to <#${channelId}>!`,
        components: []
      });
      delete pendingPosts[interaction.user.id];
    } catch (err) {
      await interaction.update({ content: `❌ Error: ${err.message}`, components: [] });
    }
    return true;
  }

  // If announcing, ask for announcement text
  if (pending.what === "announce") {
    await interaction.update({
      content: "Type your announcement message in chat (next message you send):",
      components: []
    });
    return true;
  }

  return true;
}

// ─── Step 2b: Admin picked which channel from "other" ─────────────────────────
async function handlePostPickChannel(interaction) {
  if (interaction.customId !== "post_pick_channel") return false;

  const channelId = interaction.values[0];
  const pending = pendingPosts[interaction.user.id];

  if (!pending) {
    await interaction.reply({ content: "❌ Session expired.", ephemeral: true });
    return true;
  }

  pending.targetChannelId = channelId;

  if (pending.what === "assistant_on" || pending.what === "assistant_off") {
    const { guild } = interaction;
    const channel = await guild.channels.fetch(pending.targetChannelId).catch(() => null);

    if (!channel) {
      await interaction.reply({ content: "❌ Channel not found.", ephemeral: true });
      return true;
    }

    await interaction.update({
      content: `**${pending.what === "assistant_on" ? "Enable" : "Disable"} Assistant in ${channel.name}?**`,
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("post_confirm_assistant")
            .setLabel(pending.what === "assistant_on" ? "Enable" : "Disable")
            .setStyle(pending.what === "assistant_on" ? ButtonStyle.Success : ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId("post_cancel")
            .setLabel("Cancel")
            .setStyle(ButtonStyle.Secondary)
        )
      ]
    });
  }

  return true;
}

// ─── Confirmation buttons ─────────────────────────────────────────────────────
async function handlePostConfirm(interaction, liveRules, genAI, enabledChannels, supabase) {
  if (interaction.customId !== "post_confirm_assistant" && !interaction.customId.startsWith("post_final_")) return false;

  const pending = pendingPosts[interaction.user.id];
  if (!pending) {
    await interaction.reply({ content: "❌ Session expired.", ephemeral: true });
    return true;
  }

  // Confirm assistant toggle
  if (interaction.customId === "post_confirm_assistant") {
    try {
      if (pending.what === "assistant_on") {
        enabledChannels.add(pending.targetChannelId);
        await supabase.from("assistant_channels").upsert(
          { channel_id: pending.targetChannelId },
          { onConflict: "channel_id" }
        );
        await interaction.update({
          content: `✅ Assistant enabled in <#${pending.targetChannelId}>`,
          components: []
        });
      } else {
        enabledChannels.delete(pending.targetChannelId);
        await supabase
          .from("assistant_channels")
          .delete()
          .eq("channel_id", pending.targetChannelId);
        await interaction.update({
          content: `✅ Assistant disabled in <#${pending.targetChannelId}>`,
          components: []
        });
      }
      delete pendingPosts[interaction.user.id];
      autoDelete(interaction, 15000);
    } catch (err) {
      await interaction.update({ content: `❌ Error: ${err.message}`, components: [] });
    }
    return true;
  }

  return false;
}

async function handlePostCancel(interaction) {
  if (interaction.customId !== "post_cancel") return false;
  const userId = interaction.user.id;
  delete pendingPosts[userId];
  await interaction.update({ content: "❌ Cancelled.", components: [] });
  autoDelete(interaction, 10000);
  return true;
}

// ─── Rule Update handlers ─────────────────────────────────────────────────────

// ─── Post rules to a channel and track message IDs ──────────────────────────────
async function postRules(channel, liveRules, supabase) {
  const sectionEmojis = {
    server: "📡", general: "📋", pvp: "⚔️", base: "🏗️",
    vehicles: "🚗", shops: "🏪", map: "🗺️"
  };
  const sectionColors = {
    server: 0x60a5fa, general: 0xc8a04a, pvp: 0xef4444, base: 0xf59e0b,
    vehicles: 0x8b5cf6, shops: 0x22c55e, map: 0x3b82f6
  };

  const sectionMessages = {};
  const { EmbedBuilder } = require("discord.js");

  for (const [section, content] of Object.entries(liveRules)) {
    const lines = content.split("\n");
    const title = lines[0];
    const body = lines.slice(1).join("\n").trim();

    const embed = new EmbedBuilder()
      .setTitle(`${sectionEmojis[section] || "📋"} ${title}`)
      .setDescription(body || content)
      .setColor(sectionColors[section] || 0x3b82f6)
      .setFooter({ text: "Outpost X Server Rules" });

    try {
      const msg = await channel.send({ embeds: [embed] });
      sectionMessages[section] = msg.id;
    } catch (e) {
      console.error(`Failed to post ${section} rules:`, e.message);
    }
  }

  // Track the posted messages in Supabase
  try {
    await supabase.from("posted_rules_messages").upsert({
      channel_id: channel.id,
      section_messages: JSON.stringify(sectionMessages),
    }, { onConflict: "channel_id" });
  } catch (e) {
    console.error("Failed to track posted rules:", e.message);
  }
}

// ─── Auto-update posted rule messages when rules are changed ──────────────────
async function updatePostedRules(updatedSection, newContent, liveRules, supabase, discord) {
  try {
    const { data } = await supabase.from("posted_rules_messages").select("*");
    if (!data || data.length === 0) return;

    const sectionEmojis = {
      server: "📡", general: "📋", pvp: "⚔️", base: "🏗️",
      vehicles: "🚗", shops: "🏪", map: "🗺️"
    };
    const sectionColors = {
      server: 0x60a5fa, general: 0xc8a04a, pvp: 0xef4444, base: 0xf59e0b,
      vehicles: 0x8b5cf6, shops: 0x22c55e, map: 0x3b82f6
    };

    const { EmbedBuilder } = require("discord.js");

    for (const record of data) {
      const messageIds = JSON.parse(record.section_messages);
      const sectionMsgId = messageIds[updatedSection];
      if (!sectionMsgId) continue;

      try {
        const channel = await discord.channels.fetch(record.channel_id);
        if (!channel) continue;
        
        const message = await channel.messages.fetch(sectionMsgId);
        if (!message) continue;

        const lines = newContent.split("\n");
        const title = lines[0];
        const body = lines.slice(1).join("\n").trim();

        const embed = new EmbedBuilder()
          .setTitle(`${sectionEmojis[updatedSection]} ${title}`)
          .setDescription(body || newContent)
          .setColor(sectionColors[updatedSection])
          .setFooter({ text: "Outpost X Server Rules" });

        await message.edit({ embeds: [embed] });
        console.log(`✅ Updated ${updatedSection} rules in channel ${channel.name}`);
      } catch (e) {
        console.error(`Failed to update rules in channel ${record.channel_id}:`, e.message);
      }
    }
  } catch (e) {
    console.error("Failed to update posted rules:", e.message);
  }
}

async function handleRuleUpdateSectionSelect(interaction, liveRules, pendingUpdates) {
  if (interaction.customId !== "ruleupdate_select_section") return false;

  const section = interaction.values[0];
  const currentText = liveRules[section] || "";

  await interaction.reply({
    content: `**Current ${section.toUpperCase()} rules:**\n\`\`\`\n${currentText.substring(0, 1000)}${currentText.length > 1000 ? "...(truncated)" : ""}\n\`\`\`\n\nNow type the new rules for this section in chat.`,
    ephemeral: true
  });

  pendingUpdates[interaction.user.id] = { section, stage: "waiting_for_text" };
  return true;
}

async function handleRuleUpdateText(message, liveRules, genAI, supabase, pendingUpdates, hasAdminRole) {
  const pending = pendingUpdates[message.author.id];
  if (!pending || pending.stage !== "waiting_for_text") return false;
  if (!hasAdminRole(message.member)) return false;

  const newText = message.content.trim();
  if (!newText) return false;

  try {
    pending.newText = newText;
    pending.stage = "confirm";

    const { ButtonBuilder, ActionRowBuilder, ButtonStyle } = require("discord.js");
    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("ruleupdate_confirm")
        .setLabel("Save Rules")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("ruleupdate_cancel")
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Danger)
    );

    await message.reply({
      content: `**Preview of new ${pending.section} rules:**\n\`\`\`\n${newText.substring(0, 500)}${newText.length > 500 ? "...\n(preview truncated)" : ""}\n\`\`\`\n\nClick "Save Rules" to update, or "Cancel" to discard.`,
      components: [confirmRow]
    });

    try { await message.delete(); } catch(e) {}
    return true;
  } catch (err) {
    await message.reply(`❌ Error: ${err.message}`);
    return true;
  }
}

async function handleRuleUpdateCancel(interaction) {
  if (interaction.customId !== "ruleupdate_cancel") return false;
  delete pendingUpdates[interaction.user.id];
  await interaction.update({ content: "❌ Update cancelled.", components: [] });
  return true;
}

// ─── Announcement handler ──────────────────────────────────────────────────────
async function handleAnnouncementText(message, genAI, enabledChannels) {
  const pending = pendingPosts[message.author.id];
  if (!pending || pending.what !== "announce") return false;

  const announcementText = message.content.trim();
  if (!announcementText) return false;

  try {
    const channel = await message.guild.channels.fetch(pending.targetChannelId);
    if (!channel) throw new Error("Channel not found");

    const { EmbedBuilder } = require("discord.js");
    const embed = new EmbedBuilder()
      .setTitle("📣 Announcement")
      .setDescription(announcementText)
      .setColor(0xd4a574)
      .setFooter({ text: "Outpost X Server" });

    await channel.send({ embeds: [embed] });
    await message.reply("✅ Announcement posted!");

    delete pendingPosts[message.author.id];
    try { await message.delete(); } catch(e) {}
    return true;
  } catch (err) {
    await message.reply(`❌ Error posting announcement: ${err.message}`);
    return true;
  }
}

module.exports = {
  handlePostWhatSelect,
  handlePostCategorySelect,
  handlePostChannelSelect,
  handlePostWhereSelect,
  handlePostPickChannel,
  handlePostConfirm,
  handlePostCancel,
  handleRuleUpdateSectionSelect,
  handleRuleUpdateText,
  handleRuleUpdateCancel,
  handleAnnouncementText,
  postRules,
  updatePostedRules,
};
