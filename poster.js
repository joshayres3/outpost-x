const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  EmbedBuilder,
  ChannelType,
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
    return interaction.followUp(payload).catch(() => {});
  }

  return interaction.reply(payload).catch(() => {});
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
  const order = ["server", "general", "pvp", "base", "vehicles", "shops", "map"];

  for (const sectionKey of order) {
    const content = liveRules[sectionKey];
    if (!content) continue;

    const embed = buildRuleEmbed(sectionKey, content);
    await channel.send({ embeds: [embed] });
  }
}

async function finishAction(interaction, session, liveRules, discord, supabase, enabledChannels) {
  const chan = await discord.channels.fetch(session.ch);

  if (session.act === "help") {
    await postGuide(chan);
    await safeReply(interaction, {
      content: "✅ Help Center posted.",
      ephemeral: true,
    });
    delete userSession[interaction.user.id];
    return;
  }

  if (session.act === "rules") {
    if (session.ruleMode === "all") {
      await postAllRules(chan, liveRules);

      await safeReply(interaction, {
        content: "✅ All rules posted.",
        ephemeral: true,
      });

      delete userSession[interaction.user.id];
      return;
    }

    if (session.ruleMode === "server") {
      const cont = liveRules.server;

      if (!cont) {
        await safeReply(interaction, {
          content: "Server Info section not found.",
          ephemeral: true,
        });
        delete userSession[interaction.user.id];
        return;
      }

      const embed = buildRuleEmbed("server", cont);
      await chan.send({ embeds: [embed] });

      await safeReply(interaction, {
        content: "✅ Server Info posted.",
        ephemeral: true,
      });

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

    await safeReply(interaction, {
      content: `✅ Assistant enabled in <#${session.ch}>.`,
      ephemeral: true,
    });

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

    await safeReply(interaction, {
      content: `✅ Assistant disabled in <#${session.ch}>.`,
      ephemeral: true,
    });

    delete userSession[interaction.user.id];
    return;
  }

  if (session.act === "ann") {
    await safeReply(interaction, {
      content: `Type the announcement message now. I will post it in <#${session.ch}>.`,
      ephemeral: true,
    });
    return;
  }
}

async function handlePostMenu(interaction, liveRules, discord, supabase, enabledChannels) {
  const uid = interaction.user.id;

  try {
    if (interaction.customId === "post_act") {
      const act = interaction.values[0];

      userSession[uid] = {
        act,
        startedAt: Date.now(),
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
      return;
    }

    const age = Date.now() - session.startedAt;
    if (age > 5 * 60 * 1000) {
      delete userSession[uid];
      await safeReply(interaction, {
        content: "That menu expired. Run `!post` again.",
        ephemeral: true,
      });
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
      await finishAction(interaction, session, liveRules, discord, supabase, enabledChannels);
      return;
    }
  } catch (err) {
    console.error("❌ Post menu error:", err);
    await safeReply(interaction, {
      content: `Error: ${err.message}`,
      ephemeral: true,
    });
  }
}

async function handleAnnText(msg) {
  const sess = userSession[msg.author.id];

  if (!sess || sess.act !== "ann" || !sess.ch) return false;

  try {
    const chan = await msg.client.channels.fetch(sess.ch);
    await chan.send(msg.content);
    await msg.reply("✅ Announcement posted.");
    delete userSession[msg.author.id];
    return true;
  } catch (err) {
    console.error("❌ Announcement error:", err);
    msg.reply("I could not post that announcement.").catch(() => {});
    return true;
  }
}

module.exports = {
  handlePostMenu,
  handleAnnText,
  userSession,
};
