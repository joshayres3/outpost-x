const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ChannelType,
} = require("discord.js");
const { postGuidePanel } = require("./guide");

// Tracks what each admin selected in step 1 (what to post)
const pendingPosts = {};
const postedRulesMessages = new Map(); // Track posted rule messages for auto-update

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
    guide:         "📖 SCUM Player Guide",
    rules:         "📋 Server Rules",
    assistant_on:  "🤖 Enable Assistant Mode",
    assistant_off: "🔇 Disable Assistant Mode",
    announce:      "📣 Announcement",
    create_event:  "📅 Create Event",
  };

  // For create_event, skip channel selection and go straight to modal
  if (what === "create_event") {
    // Check if user has SCUM Admin, Sr. Admin, or Owner role
    const hasPermission = interaction.member.roles.cache.some(role => 
      ["SCUM Admin", "Sr. Admin", "Owner"].includes(role.name)
    );
    if (!hasPermission) {
      await interaction.reply({
        content: "❌ You don't have permission to create events. Required role: SCUM Admin or higher.",
        ephemeral: true
      });
      delete pendingPosts[interaction.user.id];
      return true;
    }
    
    // Initialize pending event
    const { pendingEvents } = require("./event-handler");
    pendingEvents[interaction.user.id] = { step: 1 };
    
    // Show single modal with all event info (5 fields ONLY - Location & Details combined)
    const { ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
    const modal = new ModalBuilder()
      .setCustomId("event_create_all")
      .setTitle("Create Event")
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("event_title")
            .setLabel("Event Title")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("e.g., Weekly Raid Night")
            .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("event_location_desc")
            .setLabel("Location & Details")
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder("e.g., Grid D5, bring guns and meds, meet at base entrance")
            .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("event_datetime")
            .setLabel("Date & Time")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("MM/DD/YYYY HH:MM AM/PM (e.g., 05/14/2026 7:30 PM)")
            .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("event_repeat")
            .setLabel("Repeat")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("never, weekly, monthly, or custom 3")
            .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("event_image")
            .setLabel("Image URL (optional)")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("https://example.com/image.png")
            .setRequired(false)
        )
      );
    
    try {
      await interaction.showModal(modal);
    } catch (err) {
      console.error("Modal error:", err);
      await interaction.reply({
        content: "❌ Error showing event form. Try again.",
        ephemeral: true
      });
    }
    return true;
  }

  // Show two buttons: this channel or pick a channel
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("post_this_channel")
      .setLabel("This Channel")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("📍"),
    new ButtonBuilder()
      .setCustomId("post_pick_channel")
      .setLabel("Pick a Channel")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("🔍"),
    new ButtonBuilder()
      .setCustomId("post_cancel")
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Danger),
  );

  await interaction.update({
    content: `**${labels[what] || what}**\n\nWhich channel?`,
    components: [row],
  });

  return true;
}

// ─── "This Channel" button ────────────────────────────────────────────────────
async function handlePostThisChannel(interaction, liveRules, genAI, enabledChannels, supabase) {
  if (interaction.customId !== "post_this_channel") return false;

  const pending = pendingPosts[interaction.user.id];
  if (!pending) {
    await interaction.update({ content: "❌ Session expired. Type `!post` again.", components: [] });
    return true;
  }

  pending.channelId = interaction.channelId;
  await confirmAndExecute(interaction, pending, liveRules, genAI, enabledChannels, supabase);
  return true;
}

// ─── "Pick a Channel" button — show dropdown ─────────────────────────────────
async function handlePostPickChannel(interaction) {
  if (interaction.customId !== "post_pick_channel") return false;

  const pending = pendingPosts[interaction.user.id];
  if (!pending) {
    await interaction.update({ content: "❌ Session expired. Type `!post` again.", components: [] });
    return true;
  }

  await interaction.guild.channels.fetch();
  
  // Get all text channels grouped by category
  const categoryMap = new Map();
  const uncategorized = [];

  interaction.guild.channels.cache
    .filter((c) => c.type === ChannelType.GuildText && c.viewable)
    .forEach((channel) => {
      if (channel.parent) {
        if (!categoryMap.has(channel.parent.id)) {
          categoryMap.set(channel.parent.id, { name: channel.parent.name, channels: [] });
        }
        categoryMap.get(channel.parent.id).channels.push(channel);
      } else {
        uncategorized.push(channel);
      }
    });

  // Build category select menu
  const options = [];
  
  categoryMap.forEach((category) => {
    options.push({
      label: category.name,
      value: `cat_${category.channels[0].parentId}`,
      description: `${category.channels.length} channels`
    });
  });

  if (uncategorized.length > 0) {
    options.push({
      label: "Other Channels",
      value: "cat_none",
      description: `${uncategorized.length} channels`
    });
  }

  if (options.length === 0) {
    await interaction.update({ content: "❌ No text channels found.", components: [] });
    return true;
  }

  const selectCategory = new StringSelectMenuBuilder()
    .setCustomId("post_select_category")
    .setPlaceholder("Choose a category...")
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(selectCategory);
  await interaction.update({ content: "**Pick a category:**", components: [row] });
  return true;
}


// ─── Category selection — show channels in category ───────────────────────────
async function handleCategorySelect(interaction) {
  const categoryId = interaction.values[0];
  
  await interaction.guild.channels.fetch();
  
  let channels = [];
  if (categoryId === "cat_none") {
    channels = interaction.guild.channels.cache
      .filter((c) => c.type === ChannelType.GuildText && c.viewable && !c.parent)
      .sort((a, b) => a.position - b.position);
  } else {
    const parentId = categoryId.replace("cat_", "");
    channels = interaction.guild.channels.cache
      .filter((c) => c.type === ChannelType.GuildText && c.viewable && c.parentId === parentId)
      .sort((a, b) => a.position - b.position);
  }

  channels = [...channels.values()];

  if (channels.length === 0) {
    await interaction.update({ content: "❌ No channels in this category.", components: [] });
    return true;
  }

  const options = channels.map((c) => ({
    label: c.name,
    value: c.id,
  }));

  const selectWhere = new StringSelectMenuBuilder()
    .setCustomId("post_select_where")
    .setPlaceholder("Choose a channel...")
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(selectWhere);
  await interaction.update({ content: "**Pick a channel:**", components: [row] });
  return true;
}

// ─── Step 2 result — admin picked WHERE to post ───────────────────────────────
async function handlePostWhereSelect(interaction, liveRules) {
  if (interaction.customId === "post_select_category") {
    return await handleCategorySelect(interaction);
  }
  
  if (interaction.customId !== "post_select_where") return false;

  const pending = pendingPosts[interaction.user.id];
  if (!pending) {
    await interaction.update({ content: "❌ Session expired. Type `!post` again.", components: [] });
    return true;
  }

  const channelId = interaction.values[0];
  const targetChannel = interaction.guild.channels.cache.get(channelId);

  if (!targetChannel) {
    await interaction.update({ content: "❌ Channel not found.", components: [] });
    return true;
  }

  pending.channelId = channelId;

  // Show confirm button
  const labels = {
    guide:         "📖 SCUM Player Guide",
    rules:         "📋 Server Rules",
    assistant_on:  "🤖 Enable Assistant Mode",
    assistant_off: "🔇 Disable Assistant Mode",
    announce:      "📣 Announcement",
    create_event:  "📅 Create Event",
  };

  const confirmRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("post_confirm")
      .setLabel(`Post ${labels[pending.what] || pending.what} to #${targetChannel.name}`)
      .setStyle(ButtonStyle.Success)
      .setEmoji("✅"),
    new ButtonBuilder()
      .setCustomId("post_cancel")
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Danger)
  );

  await interaction.update({
    content: `**Step 3 — Confirm**\n\nPost **${labels[pending.what]}** to <#${channelId}>?`,
    components: [confirmRow],
  });

  return true;
}

// ─── Shared execute logic ─────────────────────────────────────────────────────
async function confirmAndExecute(interaction, pending, liveRules, genAI, enabledChannels, supabase) {
  const targetChannel = interaction.guild.channels.cache.get(pending.channelId);
  if (!targetChannel) {
    await interaction.update({ content: "❌ Channel not found.", components: [] });
    return;
  }

  delete pendingPosts[interaction.user.id];

  try {
    if (pending.what === "guide") {
      await postGuidePanel(targetChannel);
      await interaction.update({ content: `✅ **SCUM Player Guide** posted in <#${targetChannel.id}>`, components: [] });
      autoDelete(interaction, 30000);

    } else if (pending.what === "rules") {
      await postRules(targetChannel, liveRules, supabase);
      await interaction.update({ content: `✅ **Server Rules** posted in <#${targetChannel.id}>`, components: [] });
      autoDelete(interaction, 30000);

    } else if (pending.what === "assistant_on") {
      enabledChannels.add(targetChannel.id);
      try { await supabase.from("assistant_channels").upsert({ channel_id: targetChannel.id }, { onConflict: "channel_id" }); } catch(e) {}
      await interaction.update({ content: `✅ **Assistant Mode enabled** in <#${targetChannel.id}>`, components: [] });
      autoDelete(interaction, 30000);

    } else if (pending.what === "assistant_off") {
      enabledChannels.delete(targetChannel.id);
      try { await supabase.from("assistant_channels").delete().eq("channel_id", targetChannel.id); } catch(e) {}
      await interaction.update({ content: `✅ **Assistant Mode disabled** in <#${targetChannel.id}>`, components: [] });
      autoDelete(interaction, 30000);

    } else if (pending.what === "announce") {
      pending.waitingForAnnouncement = true;
      pendingPosts[interaction.user.id] = pending; // put back so announcement text handler can find it
      await interaction.update({
        content: `📣 **Type your announcement now.**\n\nJust send it in this channel and Mrs. Cobble will format and post it to <#${targetChannel.id}>.`,
        components: [],
      });

    } else {
      await interaction.update({ content: "❌ Unknown post type.", components: [] });
    }
  } catch (err) {
    console.error("Post error:", err.message);
    await interaction.update({ content: `❌ Error: ${err.message}`, components: [] });
  }
}

// ─── Step 3 — Confirm button (from dropdown path) ────────────────────────────
async function handlePostConfirm(interaction, liveRules, genAI, enabledChannels, supabase) {
  if (interaction.customId !== "post_confirm") return false;
  const pending = pendingPosts[interaction.user.id];
  if (!pending) {
    await interaction.update({ content: "❌ Session expired. Type `!post` again.", components: [] });
    return true;
  }
  await confirmAndExecute(interaction, pending, liveRules, genAI, enabledChannels, supabase);
  return true;
}

// ─── Cancel button ────────────────────────────────────────────────────────────
async function handlePostCancel(interaction) {
  if (interaction.customId !== "post_cancel") return false;
  delete pendingPosts[interaction.user.id];
  await interaction.update({ content: "❌ Cancelled.", components: [] });
  autoDelete(interaction, 30000);
  return true;
}

// ─── Handle announcement text from admin after confirm ────────────────────────
async function handleAnnouncementText(message, genAI, enabledChannels) {
  // Find a pending announcement for this user
  const pending = pendingPosts[message.author.id];
  if (!pending || !pending.waitingForAnnouncement) return false;

  const targetChannel = message.guild?.channels.cache.get(pending.channelId);
  if (!targetChannel) {
    delete pendingPosts[message.author.id];
    await message.reply("❌ Target channel not found. Type `!post` to start again.");
    return true;
  }

  delete pendingPosts[message.author.id];

  // Show typing indicator
  const thinking = await message.reply("✍️ Formatting your announcement...");

  try {
    // Use Gemini to format the announcement
    const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash" });
    const prompt = [
      "You are formatting a Discord server announcement for the Cobblestone SCUM server.",
      "An admin typed this raw announcement text:",
      message.content,
      "",
      "Format it as a clean, professional Discord announcement. Return ONLY a JSON object with these fields:",
      '{ "title": "short punchy title", "body": "formatted announcement body with line breaks where appropriate", "footer": "short footer note if relevant, or empty string" }',
      "",
      "Rules:",
      "- Title should be short and descriptive (max 60 chars)",
      "- Body should be clean and easy to read — use line breaks, bold key info with **text**",
      "- Keep the original meaning exactly — do not add info that wasn't there",
      "- Do not use emojis unless the admin used them",
      "- Output ONLY the JSON, no explanation, no markdown code blocks"
    ].join("\n");

    const result = await model.generateContent(prompt);
    let raw = result.response.text().trim();
    raw = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(raw);

    const { EmbedBuilder } = require("discord.js");
    const embed = new EmbedBuilder()
      .setTitle(`📣 ${parsed.title}`)
      .setDescription(parsed.body)
      .setColor(0xc8a04a)
      .setTimestamp();

    if (parsed.footer) {
      embed.setFooter({ text: parsed.footer });
    }

    await targetChannel.send({ embeds: [embed] });
    await thinking.edit(`✅ Announcement posted in <#${targetChannel.id}>.`);
    autoDelete({ deleteReply: () => thinking.delete() }, 3000);

  } catch (err) {
    console.error("Announce error:", err.message);
    await thinking.edit(`❌ Error formatting announcement: ${err.message}`);
  }

  return true;
}

// ─── Post rules ───────────────────────────────────────────────────────────────
async function postRules(channel, liveRules, supabase) {
  const sections = [
    { key: "server",   emoji: "📡", color: 0x60a5fa },
    { key: "general",  emoji: "📋", color: 0xc8a04a },
    { key: "pvp",      emoji: "⚔️",  color: 0xef4444 },
    { key: "base",     emoji: "🏗️",  color: 0xf59e0b },
    { key: "vehicles", emoji: "🚗",  color: 0x8b5cf6 },
    { key: "shops",    emoji: "🏪",  color: 0x22c55e },
    { key: "map",      emoji: "🗺️",  color: 0x3b82f6 },
  ];

  // Header
  const headerMsg = await channel.send({
    embeds: [new EmbedBuilder()
      .setTitle("📜 Cobblestone Server Rules")
      .setDescription("Welcome to Cobblestone. Our goal is to keep the game fun, fair, and enjoyable for everyone.\n\nAll bans include a discussion with the player before action is finalized.\n\n**18+ ONLY SERVER**")
      .setColor(0xc8a04a)
      .setFooter({ text: "Cobblestone SCUM Server • Rules" })]
  });

  // Track message IDs for each section
  const messageIds = { header: headerMsg.id };

  // One embed per section
  for (const s of sections) {
    const content = liveRules[s.key];
    if (!content) continue;
    const lines = content.split("\n");
    const title = lines[0]; // First line is the section title
    const body  = lines.slice(1).join("\n").trim();

    const embed = new EmbedBuilder()
      .setTitle(`${s.emoji} ${title}`)
      .setDescription(body || content)
      .setColor(s.color);

    const msg = await channel.send({ embeds: [embed] });
    messageIds[s.key] = msg.id;
    await new Promise((r) => setTimeout(r, 400));
  }

  // Save to Supabase and local map
  try {
    await supabase.from("posted_rules_messages").upsert({
      message_id: headerMsg.id,
      channel_id: channel.id,
      posted_at: new Date().toISOString(),
      section_messages: JSON.stringify(messageIds)
    }, { onConflict: "message_id" });
    
    postedRulesMessages.set(channel.id, messageIds);
  } catch (e) {
    console.error("Failed to save posted rules tracking:", e.message);
  }
}

// ─── Update posted rules when rules change ────────────────────────────────────
async function updatePostedRules(updatedSection, newContent, liveRules, supabase, discord) {
  try {
    // Fetch all tracked rule posts
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
          .setColor(sectionColors[updatedSection]);

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

// ─── Rule Update — section selected ──────────────────────────────────────────
async function handleRuleUpdateSectionSelect(interaction, liveRules, pendingUpdates) {
  if (interaction.customId !== "ruleupdate_select_section") return false;

  const section = interaction.values[0];
  const sectionLabels = {
    general:  "📋 General Rules",
    pvp:      "⚔️ PvP Rules",
    base:     "🏗️ Base Building Rules",
    vehicles: "🚗 Vehicle Rules",
    shops:    "🏪 Business & Shop Rules",
    map:      "🗺️ Map Color Key",
    server:   "📡 Server Info",
  };

  pendingUpdates[interaction.user.id] = { section, waitingForText: true };

  // Show current rule content so admin knows what they're editing
  const current = liveRules[section] || "No content found.";
  const preview = current.length > 800 ? current.slice(0, 800) + "..." : current;

  await interaction.update({
    content:
      `**${sectionLabels[section]}**\n\n` +
      `**Current content:**\n\`\`\`${preview}\`\`\`\n\n` +
      `📝 **Now type your change in plain English.**\n` +
      `_Example: "the pvp poi now rotates every 1 week instead of 2"_\n\n` +
      `Send your message in this channel and Mrs. Cobble will rewrite the section.`,
    components: [],
  });

  return true;
}

// ─── Rule Update — admin typed their change ───────────────────────────────────
async function handleRuleUpdateText(message, liveRules, genAI, supabase, pendingUpdates, hasAdminRole) {
  if (!message.guild) return false;
  if (!hasAdminRole(message.member)) return false;

  const pending = pendingUpdates[message.author.id];
  if (!pending || !pending.waitingForText) return false;

  delete pendingUpdates[message.author.id];

  const { section } = pending;
  const changeText  = message.content.trim();

  const thinking = await message.reply("✍️ Rewriting that cleanly, one sec...");

  let polishedText = changeText;
  try {
    const rwModel = genAI.getGenerativeModel({ model: "gemini-3.5-flash" });
    const rwLines = [
      "You are editing the official rules for a SCUM game server called Cobblestone.",
      "Here is the CURRENT " + section.toUpperCase() + " section:",
      liveRules[section],
      "",
      "An admin wants to make this change: " + changeText,
      "",
      "Rewrite the ENTIRE " + section.toUpperCase() + " section incorporating this change.",
      "Keep the exact same formatting style, bullet points, and tone as the original.",
      "Output ONLY the rewritten section. No explanation. No preamble."
    ];
    const rwResult = await rwModel.generateContent(rwLines.join("\n"));
    polishedText = rwResult.response.text().trim();
  } catch (err) {
    console.error("Rewrite error:", err.message);
  }

  // Show confirm/cancel buttons
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
  const preview = polishedText.length > 900 ? polishedText.slice(0, 900) + "..." : polishedText;

  const confirmRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ruleupdate_confirm")
      .setLabel("Save Permanently")
      .setStyle(ButtonStyle.Success)
      .setEmoji("✅"),
    new ButtonBuilder()
      .setCustomId("ruleupdate_cancel")
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Danger),
  );

  // Store the polished text for when they confirm
  pendingUpdates[message.author.id] = { section, newText: polishedText };

  await thinking.edit({
    content:
      `**Confirm update for ${section.toUpperCase()}**\n\n` +
      `**Rewritten as:**\n\`\`\`${preview}\`\`\`\n\n` +
      `Does this look correct?`,
    components: [confirmRow],
  });

  // Auto delete the admin's typed message to keep channel clean
  try { await message.delete(); } catch(e) {}

  return true;
}

// ─── Rule Update — cancel button ───────────────────────────────────────────────
async function handleRuleUpdateCancel(interaction) {
  if (interaction.customId !== "ruleupdate_cancel") return false;
  await interaction.update({ content: "❌ Rule update cancelled. No changes made.", components: [] });
  autoDelete(interaction, 10000);
  return true;
}

module.exports = {
  // Post handlers
  handlePostWhatSelect,
  handlePostThisChannel,
  handlePostPickChannel,
  handlePostWhereSelect,
  handlePostConfirm,
  handlePostCancel,
  // Announcement handler
  handleAnnouncementText,
  // Rule update handlers
  handleRuleUpdateSectionSelect,
  handleRuleUpdateText,
  handleRuleUpdateCancel,
  // Utility
  updatePostedRules,
};
