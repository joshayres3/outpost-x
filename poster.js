const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  EmbedBuilder,
  ChannelType,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const { postGuide } = require("./guide");

const userSession = {};

function trimEmbedText(text, max = 4000) {
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 20)}\n\n...continued`;
}

async function safeReply(interaction, payload) {
  if (interaction.deferred || interaction.replied) {
    if (interaction.deferred && !interaction.replied) {
      return interaction.editReply(payload).catch(() => {});
    }

    return interaction.followUp(payload).catch(() => {});
  }

  return interaction.reply(payload).catch(() => {});
}

async function deferIfNeeded(interaction) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});
  }
}

async function cleanupMenuMessage(interaction) {
  if (interaction.message && interaction.message.deletable) {
    await interaction.message.delete().catch(() => {});
  }
}

function buildCategoryOptions(guild) {
  return guild.channels.cache
    .filter((c) => c.type === ChannelType.GuildCategory)
    .map((c) => ({ label: c.name.slice(0, 100), value: c.id }))
    .slice(0, 25);
}

function buildChannelOptions(guild, categoryId) {
  return guild.channels.cache
    .filter((c) => c.parentId === categoryId && c.type === ChannelType.GuildText)
    .map((c) => ({ label: c.name.slice(0, 100), value: c.id }))
    .slice(0, 25);
}

async function askForCategory(interaction) {
  const cats = buildCategoryOptions(interaction.guild);

  if (!cats.length) {
    await safeReply(interaction, {
      content: "No categories found.",
      ephemeral: true,
    });
    delete userSession[interaction.user.id];
    return;
  }

  await safeReply(interaction, {
    content: "Where should this happen? Choose a category.",
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("post_cat")
          .setPlaceholder("Choose a category")
          .setOptions(cats)
      ),
    ],
    ephemeral: true,
  });
}

async function askForChannel(interaction, session) {
  const chans = buildChannelOptions(interaction.guild, session.cat);

  if (!chans.length) {
    await safeReply(interaction, {
      content: "No text channels found in that category.",
      ephemeral: true,
    });
    delete userSession[interaction.user.id];
    return;
  }

  await safeReply(interaction, {
    content: "Choose the channel.",
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("post_ch")
          .setPlaceholder("Choose a channel")
          .setOptions(chans)
      ),
    ],
    ephemeral: true,
  });
}

function buildRuleEmbed(sectionKey, content) {
  const lines = content.split("\n");
  const title = lines[0];
  const body = lines.slice(1).join("\n").trim();

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

  return new EmbedBuilder()
    .setTitle(`${emojis[sectionKey] || "📋"} ${title}`)
    .setDescription(trimEmbedText(body || content))
    .setColor(colors[sectionKey] || 0x3b82f6)
    .setFooter({ text: "Outpost X Rules" });
}

async function postAllRules(channel, liveRules) {
  const order = ["general", "pvp", "base", "vehicles", "shops", "map"];

  for (const sectionKey of order) {
    const content = liveRules[sectionKey];
    if (!content) continue;

    const embed = buildRuleEmbed(sectionKey, content);
    await channel.send({ embeds: [embed] });
  }
}

function buildAnnouncementEmbed(content) {
  return new EmbedBuilder()
    .setTitle("📢 Outpost X Announcement")
    .setDescription(trimEmbedText(content, 3900))
    .setColor(0x3b82f6)
    .setFooter({ text: "Built To Last. Born To Survive." })
    .setTimestamp();
}

function buildAnnouncementButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ann_confirm")
      .setLabel("Post Announcement")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("ann_revise")
      .setLabel("Revise")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("ann_cancel")
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary)
  );
}

async function polishAnnouncement(genai, roughText) {
  if (!genai) return roughText.trim();

  const model = genai.getGenerativeModel({ model: "gemini-2.5-flash" });

  const res = await model.generateContent(
    `You are polishing a Discord announcement for Outpost X, a SCUM server.

Raw announcement text:
${roughText}

Rewrite it into a clean, ready-to-post Discord announcement.

Rules:
- Keep the meaning exactly the same.
- Correct spelling, punctuation, grammar, and formatting.
- Make it clear and professional, but still natural for a game server.
- Do not invent details, dates, rewards, rules, wipes, events, or promises.
- Do not add @everyone, @here, role pings, or channel links unless they were already included.
- Keep it concise.
- Use Discord-friendly formatting.
- Return only the announcement body text.`
  );

  const text = (res.response.text() || "").trim();
  return text || roughText.trim();
}

async function finishAction(interaction, session, liveRules, discord, supabase, enabledChannels) {
  await deferIfNeeded(interaction);

  if (session.completed || session.processing) {
    await safeReply(interaction, {
      content: "This action is already being processed.",
      ephemeral: true,
    });
    return;
  }

  session.processing = true;

  const chan = await discord.channels.fetch(session.ch);

  if (session.act === "help") {
    await safeReply(interaction, {
      content: "Posting Help Center...",
      ephemeral: true,
    });

    await postGuide(chan);

    session.completed = true;

    await safeReply(interaction, {
      content: "✅ Help Center posted.",
      ephemeral: true,
    });

    await cleanupMenuMessage(interaction);
    delete userSession[interaction.user.id];
    return;
  }

  if (session.act === "rules") {
    if (session.ruleMode === "all") {
      await safeReply(interaction, {
        content: "Posting all rules...",
        ephemeral: true,
      });

      await postAllRules(chan, liveRules);

      session.completed = true;

      await safeReply(interaction, {
        content: "✅ All rules posted.",
        ephemeral: true,
      });

      await cleanupMenuMessage(interaction);
      delete userSession[interaction.user.id];
      return;
    }

    if (session.ruleMode === "server") {
      await safeReply(interaction, {
        content: "Posting Server Info...",
        ephemeral: true,
      });

      const cont = liveRules.server;

      if (!cont) {
        session.completed = true;

        await safeReply(interaction, {
          content: "Server Info section not found.",
          ephemeral: true,
        });

        await cleanupMenuMessage(interaction);
        delete userSession[interaction.user.id];
        return;
      }

      const embed = buildRuleEmbed("server", cont);
      await chan.send({ embeds: [embed] });

      session.completed = true;

      await safeReply(interaction, {
        content: "✅ Server Info posted.",
        ephemeral: true,
      });

      await cleanupMenuMessage(interaction);
      delete userSession[interaction.user.id];
      return;
    }
  }

  if (session.act === "ast_on") {
    const { error } = await supabase
      .from("assistant_channels")
      .upsert({ channel_id: session.ch });

    if (error) throw error;

    enabledChannels.add(session.ch);
    session.completed = true;

    await safeReply(interaction, {
      content: `✅ Assistant enabled in <#${session.ch}>.`,
      ephemeral: true,
    });

    await cleanupMenuMessage(interaction);
    delete userSession[interaction.user.id];
    return;
  }

  if (session.act === "ast_off") {
    const { error } = await supabase
      .from("assistant_channels")
      .delete()
      .eq("channel_id", session.ch);

    if (error) throw error;

    enabledChannels.delete(session.ch);
    session.completed = true;

    await safeReply(interaction, {
      content: `✅ Assistant disabled in <#${session.ch}>.`,
      ephemeral: true,
    });

    await cleanupMenuMessage(interaction);
    delete userSession[interaction.user.id];
    return;
  }

  if (session.act === "ann") {
    session.processing = false;
    session.stage = "ann_waiting_text";

    await safeReply(interaction, {
      content: [
        `Type the rough announcement message now.`,
        "",
        `I will clean it up, format it, and show you a preview before posting in <#${session.ch}>.`,
      ].join("\n"),
      ephemeral: true,
    });
    return;
  }

  session.processing = false;
}

async function handlePostMenu(interaction, liveRules, discord, supabase, enabledChannels) {
  const uid = interaction.user.id;

  try {
    if (["ann_confirm", "ann_revise", "ann_cancel"].includes(interaction.customId)) {
      const session = userSession[uid];

      if (!session || session.act !== "ann") {
        await safeReply(interaction, {
          content: "That announcement session expired. Run `!post` again.",
          ephemeral: true,
        });
        return;
      }

      if (interaction.customId === "ann_cancel") {
        delete userSession[uid];
        await interaction.update({
          content: "Announcement cancelled.",
          embeds: [],
          components: [],
        }).catch(() => {});
        return;
      }

      if (interaction.customId === "ann_revise") {
        session.stage = "ann_waiting_text";
        session.processing = false;

        await interaction.update({
          content: [
            "Type the revised announcement instructions or full replacement text.",
            "",
            "I will polish it again and show another preview.",
          ].join("\n"),
          embeds: [],
          components: [],
        }).catch(() => {});
        return;
      }

      if (interaction.customId === "ann_confirm") {
        if (!session.polishedAnnouncement || !session.ch) {
          await safeReply(interaction, {
            content: "Missing announcement draft. Run `!post` again.",
            ephemeral: true,
          });
          return;
        }

        await interaction.deferUpdate().catch(() => {});

        const chan = await interaction.client.channels.fetch(session.ch);
        await chan.send({ embeds: [buildAnnouncementEmbed(session.polishedAnnouncement)] });

        await interaction.editReply({
          content: `✅ Announcement posted in <#${session.ch}>.`,
          embeds: [],
          components: [],
        }).catch(() => {});

        if (session.menuChannelId && session.menuMessageId) {
          const menuChannel = await interaction.client.channels.fetch(session.menuChannelId).catch(() => null);
          if (menuChannel) {
            const menuMessage = await menuChannel.messages.fetch(session.menuMessageId).catch(() => null);
            if (menuMessage) await menuMessage.delete().catch(() => {});
          }
        }

        delete userSession[uid];
        return;
      }
    }

    if (interaction.customId === "post_act") {
      const act = interaction.values[0];

      userSession[uid] = {
        act,
        startedAt: Date.now(),
        processing: false,
        completed: false,
      };

      if (act === "rules") {
        await safeReply(interaction, {
          content: "What rules do you want to post?",
          components: [
            new ActionRowBuilder().addComponents(
              new StringSelectMenuBuilder()
                .setCustomId("post_rule_mode")
                .setPlaceholder("Choose rule post type")
                .addOptions([
                  {
                    label: "Post All Rules Together",
                    value: "all",
                    emoji: "📚",
                  },
                  {
                    label: "Post Server Info Only",
                    value: "server",
                    emoji: "📡",
                  },
                ])
            ),
          ],
          ephemeral: true,
        });
        return;
      }

      await askForCategory(interaction);
      return;
    }

    const session = userSession[uid];

    if (!session) {
      await safeReply(interaction, {
        content: "That menu expired. Run `!post` again.",
        ephemeral: true,
      });
      await cleanupMenuMessage(interaction);
      return;
    }

    const age = Date.now() - session.startedAt;
    if (age > 10 * 60 * 1000) {
      delete userSession[uid];
      await safeReply(interaction, {
        content: "That menu expired. Run `!post` again.",
        ephemeral: true,
      });
      await cleanupMenuMessage(interaction);
      return;
    }

    if (interaction.customId === "post_rule_mode") {
      session.ruleMode = interaction.values[0];
      await askForCategory(interaction);
      return;
    }

    if (interaction.customId === "post_cat") {
      session.cat = interaction.values[0];
      await askForChannel(interaction, session);
      return;
    }

    if (interaction.customId === "post_ch") {
      session.ch = interaction.values[0];

      if (interaction.message) {
        session.menuMessageId = interaction.message.id;
        session.menuChannelId = interaction.channelId;
      }

      await finishAction(interaction, session, liveRules, discord, supabase, enabledChannels);
      return;
    }
  } catch (err) {
    console.error("❌ Post menu error:", err);

    const session = userSession[uid];
    if (session) session.processing = false;

    await safeReply(interaction, {
      content: `Error: ${err.message}`,
      ephemeral: true,
    });

    await cleanupMenuMessage(interaction);
  }
}

async function handleAnnText(msg, genai = null) {
  const sess = userSession[msg.author.id];

  if (!sess || sess.act !== "ann" || !sess.ch) return false;
  if (sess.stage !== "ann_waiting_text" && sess.stage !== "ann_preview") return false;

  if (sess.processing) {
    await msg.reply("That announcement is already being processed.").catch(() => {});
    return true;
  }

  sess.processing = true;

  try {
    const roughText = msg.content.trim();

    if (!roughText) {
      sess.processing = false;
      await msg.reply("Announcement text cannot be empty.").catch(() => {});
      return true;
    }

    await msg.reply("Polishing announcement and preparing preview...").catch(() => {});

    const polished = await polishAnnouncement(genai, roughText);

    sess.rawAnnouncement = roughText;
    sess.polishedAnnouncement = polished;
    sess.stage = "ann_preview";
    sess.processing = false;

    await msg.reply({
      content: [
        `Preview for <#${sess.ch}>`,
        "",
        "Confirm to post, revise to change it, or cancel.",
      ].join("\n"),
      embeds: [buildAnnouncementEmbed(polished)],
      components: [buildAnnouncementButtons()],
    }).catch(() => {});

    return true;
  } catch (err) {
    console.error("❌ Announcement polish error:", err);
    sess.processing = false;
    msg.reply("I could not prepare that announcement preview.").catch(() => {});
    return true;
  }
}

module.exports = {
  handlePostMenu,
  handleAnnText,
  userSession,
};
