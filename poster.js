const { ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder, ChannelType } = require("discord.js");
const { postGuide } = require("./guide");

const userSession = {};

async function handlePostMenu(interaction, liveRules, discord, supabase, enabledChannels) {
  const uid = interaction.user.id;
  
  try {
    // Category
    if (interaction.customId === "post_cat") {
      userSession[uid] = { cat: interaction.values[0] };
      const cat = interaction.guild.channels.cache.get(userSession[uid].cat);
      const chans = interaction.guild.channels.cache
        .filter(c => c.parentId === userSession[uid].cat && c.type === ChannelType.GuildText)
        .map(c => ({ label: c.name, value: c.id }));
      
      if (!chans.length) {
        await interaction.reply({ content: "No channels", ephemeral: true });
        delete userSession[uid];
        return;
      }

      await interaction.reply({
        content: "Which channel?",
        components: [new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder().setCustomId("post_ch").setOptions(chans)
        )],
        ephemeral: true,
      });
      return;
    }

    // Channel
    if (interaction.customId === "post_ch") {
      userSession[uid].ch = interaction.values[0];
      await interaction.reply({
        content: "What to post?",
        components: [new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder().setCustomId("post_act").addOptions([
            { label: "Help", value: "help" },
            { label: "Rules", value: "rules" },
            { label: "Enable Assistant", value: "ast_on" },
            { label: "Disable Assistant", value: "ast_off" },
            { label: "Announcement", value: "ann" },
          ])
        )],
        ephemeral: true,
      });
      return;
    }

    // Action
    if (interaction.customId === "post_act") {
      const act = interaction.values[0];
      userSession[uid].act = act;
      const chan = await discord.channels.fetch(userSession[uid].ch);

      if (act === "help") {
        await postGuide(chan);
        await interaction.reply({ content: "✅ Posted!", ephemeral: true });
        delete userSession[uid];
        return;
      }

      if (act === "rules") {
        await interaction.reply({
          content: "Which section?",
          components: [new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId("post_sec").addOptions([
              { label: "Server Info", value: "server" },
              { label: "General", value: "general" },
              { label: "PvP", value: "pvp" },
              { label: "Base", value: "base" },
              { label: "Vehicles", value: "vehicles" },
              { label: "Shops", value: "shops" },
              { label: "Map", value: "map" },
            ])
          )],
          ephemeral: true,
        });
        return;
      }

      if (act === "ast_on" || act === "ast_off") {
        if (act === "ast_on") {
          await supabase.from("assistant_channels").insert({ channel_id: userSession[uid].ch });
          enabledChannels.add(userSession[uid].ch);
        } else {
          await supabase.from("assistant_channels").delete().eq("channel_id", userSession[uid].ch);
          enabledChannels.delete(userSession[uid].ch);
        }
        await interaction.reply({ content: "✅ Done!", ephemeral: true });
        delete userSession[uid];
        return;
      }

      if (act === "ann") {
        await interaction.reply({ content: "Type announcement:", ephemeral: true });
        return;
      }
    }

    // Section
    if (interaction.customId === "post_sec") {
      userSession[uid].sec = interaction.values[0];
      const chan = await discord.channels.fetch(userSession[uid].ch);
      const cont = liveRules[userSession[uid].sec];

      if (!cont) {
        await interaction.reply({ content: "Not found", ephemeral: true });
        delete userSession[uid];
        return;
      }

      const lines = cont.split("\n");
      const title = lines[0];
      const body = lines.slice(1).join("\n").trim();
      const emojis = { server: "📡", general: "📋", pvp: "⚔️", base: "🏗️", vehicles: "🚗", shops: "🏪", map: "🗺️" };
      const colors = { server: 0x60a5fa, general: 0xc8a04a, pvp: 0xef4444, base: 0xf59e0b, vehicles: 0x8b5cf6, shops: 0x22c55e, map: 0x3b82f6 };

      const embed = new EmbedBuilder()
        .setTitle(`${emojis[userSession[uid].sec]} ${title}`)
        .setDescription(body || cont)
        .setColor(colors[userSession[uid].sec] || 0x3b82f6)
        .setFooter({ text: "Outpost X Rules" });

      await chan.send({ embeds: [embed] });
      await interaction.reply({ content: "✅ Posted!", ephemeral: true });
      delete userSession[uid];
      return;
    }
  } catch (err) {
    console.error(err);
    await interaction.reply({ content: `Error: ${err.message}`, ephemeral: true }).catch(() => {});
  }
}

async function handleAnnText(msg) {
  const sess = userSession[msg.author.id];
  if (!sess || sess.act !== "ann" || !sess.ch) return false;

  try {
    const chan = await msg.client.channels.fetch(sess.ch);
    await chan.send(msg.content);
    await msg.reply("✅ Posted!");
    delete userSession[msg.author.id];
    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
}

module.exports = { handlePostMenu, handleAnnText, userSession };
