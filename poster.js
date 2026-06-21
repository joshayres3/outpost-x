const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  EmbedBuilder,
  ChannelType,
} = require("discord.js");
const { postGuide } = require("./guide");

const userSession = {};

const RULE_OPTIONS = [
  { label: "Server Info", value: "server" },
  { label: "General", value: "general" },
  { label: "PvP", value: "pvp" },
  { label: "Base", value: "base" },
  { label: "Vehicles", value: "vehicles" },
  { label: "Shops", value: "shops" },
  { label: "Map", value: "map" },
];

const ACTION_OPTIONS = [
  { label: "Help", value: "help" },
  { label: "Rules", value: "rules" },
  { label: "Enable Assistant", value: "ast_on" },
  { label: "Disable Assistant", value: "ast_off" },
  { label: "Announcement", value: "ann" },
];

function makeSelect(customId, placeholder, options) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(placeholder)
      .setOptions(options.slice(0, 25))
  );
}

async function safeReply(interaction, payload) {
  if (interaction.replied || interaction.deferred) {
    return interaction.followUp(payload).catch(() => {});
  }
  return interaction.reply(payload).catch(() => {});
}

async function handlePostMenu(interaction, liveRules, discord, supabase, enabledChannels) {
  const uid = interaction.user.id;

  try {
    if (interaction.customId === "post_cat") {
      userSession[uid] = { cat: interaction.values[0] };

      const channels = interaction.guild.channels.cache
        .filter((c) => c.parentId === userSession[uid].cat && c.type === ChannelType.GuildText)
        .map((c) => ({ label: c.name.slice(0, 100), value: c.id }))
        .slice(0, 25);

      if (!channels.length) {
        await safeReply(interaction, { content: "No text channels found in that category.", ephemeral: true });
        delete userSession[uid];
        return;
      }

      await safeReply(interaction, {
        content: "Which channel?",
        components: [makeSelect("post_ch", "Choose a channel", channels)],
        ephemeral: true,
      });
      return;
    }

    if (interaction.customId === "post_ch") {
      if (!userSession[uid]) userSession[uid] = {};
      userSession[uid].ch = interaction.values[0];

      await safeReply(interaction, {
        content: "What should I post?",
        components: [makeSelect("post_act", "Choose an action", ACTION_OPTIONS)],
        ephemeral: true,
      });
      return;
    }

    if (interaction.customId === "post_act") {
      if (!userSession[uid]?.ch) {
        await safeReply(interaction, { content: "Session expired. Run `!post` again.", ephemeral: true });
        delete userSession[uid];
        return;
      }

      const act = interaction.values[0];
      userSession[uid].act = act;
      const chan = await discord.channels.fetch(userSession[uid].ch);

      if (act === "help") {
        await postGuide(chan);
        await safeReply(interaction, { content: "✅ Help Center posted.", ephemeral: true });
        delete userSession[uid];
        return;
      }

      if (act === "rules") {
        await safeReply(interaction, {
          content: "Which rule section?",
          components: [makeSelect("post_sec", "Choose a rule section", RULE_OPTIONS)],
          ephemeral: true,
        });
        return;
      }

      if (act === "ast_on") {
        const { error } = await supabase
          .from("assistant_channels")
          .upsert({ channel_id: userSession[uid].ch }, { onConflict: "channel_id" });
        if (error) throw error;

        enabledChannels.add(userSession[uid].ch);
        await safeReply(interaction, { content: "✅ Assistant enabled in that channel.", ephemeral: true });
        delete userSession[uid];
        return;
      }

      if (act === "ast_off") {
        const { error } = await supabase
          .from("assistant_channels")
          .delete()
          .eq("channel_id", userSession[uid].ch);
        if (error) throw error;

        enabledChannels.delete(userSession[uid].ch);
        await safeReply(interaction, { content: "✅ Assistant disabled in that channel.", ephemeral: true });
        delete userSession[uid];
        return;
      }

      if (act === "ann") {
        await safeReply(interaction, {
          content: "Type the announcement as your next message. I will post it in the selected channel.",
          ephemeral: true,
        });
        return;
      }
    }

    if (interaction.customId === "post_sec") {
      if (!userSession[uid]?.ch) {
        await safeReply(interaction, { content: "Session expired. Run `!post` again.", ephemeral: true });
        delete userSession[uid];
        return;
      }

      userSession[uid].sec = interaction.values[0];
      const chan = await discord.channels.fetch(userSession[uid].ch);
      const cont = liveRules[userSession[uid].sec];

      if (!cont) {
        await safeReply(interaction, { content: "That rule section was not found in Supabase.", ephemeral: true });
        delete userSession[uid];
        return;
      }

      const lines = cont.split("\n");
      const title = lines[0] || "Rules";
      const body = lines.slice(1).join("\n").trim() || cont;
      const emojis = { server: "📡", general: "📋", pvp: "⚔️", base: "🏗️", vehicles: "🚗", shops: "🏪", map: "🗺️" };
      const colors = { server: 0x60a5fa, general: 0xc8a04a, pvp: 0xef4444, base: 0xf59e0b, vehicles: 0x8b5cf6, shops: 0x22c55e, map: 0x3b82f6 };

      const embed = new EmbedBuilder()
        .setTitle(`${emojis[userSession[uid].sec] || "📋"} ${title}`)
        .setDescription(body.slice(0, 4096))
        .setColor(colors[userSession[uid].sec] || 0x3b82f6)
        .setFooter({ text: "Outpost X Rules" });

      await chan.send({ embeds: [embed] });
      await safeReply(interaction, { content: "✅ Rule section posted.", ephemeral: true });
      delete userSession[uid];
    }
  } catch (err) {
    console.error("❌ Menu handler error:", err);
    await safeReply(interaction, { content: `Error: ${err.message}`, ephemeral: true });
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
    console.error("❌ Announcement handler error:", err);
    await msg.reply("I could not post that announcement.").catch(() => {});
    return true;
  }
}

module.exports = { handlePostMenu, handleAnnText, userSession };
