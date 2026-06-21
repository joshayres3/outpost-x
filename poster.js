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

  // For guide, post it directly to the channel they specify
  if (what === "guide") {
    await interaction.reply({
      content: `**${labels[what]}**\n\nWhich channel do you want to post the guide in?`,
      components: [
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("post_where_select")
            .setPlaceholder("Choose a channel...")
            .addOptions(
              { label: "Admin Channel", value: "1518059656302301245" },
              { label: "Main Chat", value: "1516269437932670977" },
              { label: "Other Channel", value: "other" }
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

  // For rules and announcements, ask which channel to post in
  await interaction.reply({
    content: `**${labels[what]}**\n\nWhere do you want to post this?`,
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("post_where_select")
          .setPlaceholder("Choose a channel...")
          .addOptions(
            { label: "Admin Channel", value: "1518059656302301245" },
            { label: "Main Chat", value: "1516269437932670977" },
            { label: "Other Channel", value: "other" }
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
  handlePostWhereSelect,
  handlePostPickChannel,
  handlePostConfirm,
  handlePostCancel,
  handleRuleUpdateSectionSelect,
  handleRuleUpdateText,
  handleRuleUpdateCancel,
  handleAnnouncementText,
};
