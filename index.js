require("dotenv").config();
const { Client, Events, GatewayIntentBits, ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder } = require("discord.js");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { createClient } = require("@supabase/supabase-js");

// ═══════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════

const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const enabledChannels = new Set();
let liveRules = {};

const ADMIN_CHANNEL_ID = "1518059656302301245";
const ASSISTANT_CHANNEL_ID = "1516269437932670977";

// ═══════════════════════════════════════════════════════════════════════════
// STARTUP
// ═══════════════════════════════════════════════════════════════════════════

discord.on(Events.ClientReady, async () => {
  console.log(`✅ The Watcher is online as ${discord.user.tag}`);

  // Load rules from Supabase
  try {
    const { data } = await supabase.from("rules").select("*");
    data.forEach(({ section, content }) => {
      liveRules[section] = content;
    });
    console.log(`📚 Loaded ${Object.keys(liveRules).length} rule sections from database.`);
  } catch (err) {
    console.error("❌ Failed to load rules:", err.message);
  }

  // Load enabled channels
  try {
    const { data } = await supabase.from("assistant_channels").select("channel_id");
    data.forEach(({ channel_id }) => enabledChannels.add(channel_id));
    console.log(`✅ Assistant enabled in ${enabledChannels.size} channel(s).`);
  } catch (err) {
    console.error("❌ Failed to load assistant channels:", err.message);
  }

  console.log(`📡 Admin channel: ${ADMIN_CHANNEL_ID}`);
  console.log(`💬 Assistant channel: ${ASSISTANT_CHANNEL_ID}`);
});

// ═══════════════════════════════════════════════════════════════════════════
// INTERACTION HANDLER
// ═══════════════════════════════════════════════════════════════════════════

const userSessions = {}; // Store {channelId, action, section}

discord.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isStringSelectMenu()) return;

  const userId = interaction.user.id;
  const session = userSessions[userId] || {};

  try {
    // STEP 1: Channel selection
    if (interaction.customId === "post_channel") {
      session.channelId = interaction.values[0];
      userSessions[userId] = session;

      await interaction.reply({
        content: "**What do you want to post?**",
        components: [buildActionMenu()],
        ephemeral: true,
      });
      return;
    }

    // STEP 2: Action selection
    if (interaction.customId === "post_action") {
      const action = interaction.values[0];
      session.action = action;
      userSessions[userId] = session;

      // Help Center - post immediately
      if (action === "help") {
        const channel = await discord.channels.fetch(session.channelId);
        await postHelpCenter(channel);
        await interaction.reply({ content: `✅ Help Center posted!`, ephemeral: true });
        delete userSessions[userId];
        return;
      }

      // Rules - pick section
      if (action === "rules") {
        await interaction.reply({
          content: "**Which rule section?**",
          components: [buildRulesMenu()],
          ephemeral: true,
        });
        return;
      }

      // Assistant - toggle immediately
      if (action === "assistant_on" || action === "assistant_off") {
        const channelId = session.channelId;
        if (action === "assistant_on") {
          await supabase.from("assistant_channels").insert({ channel_id: channelId });
          enabledChannels.add(channelId);
        } else {
          await supabase.from("assistant_channels").delete().eq("channel_id", channelId);
          enabledChannels.delete(channelId);
        }
        const verb = action === "assistant_on" ? "enabled" : "disabled";
        await interaction.reply({ content: `✅ Assistant ${verb}!`, ephemeral: true });
        delete userSessions[userId];
        return;
      }

      // Announcement - wait for text
      if (action === "announce") {
        await interaction.reply({
          content: "Type your announcement in chat:",
          ephemeral: true,
        });
        return;
      }
    }

    // STEP 3: Rules section
    if (interaction.customId === "post_rules") {
      session.section = interaction.values[0];
      userSessions[userId] = session;

      const channel = await discord.channels.fetch(session.channelId);
      const content = liveRules[session.section];

      if (!content) {
        await interaction.reply({
          content: `❌ Rule section not found`,
          ephemeral: true,
        });
        delete userSessions[userId];
        return;
      }

      const embed = buildRuleEmbed(session.section, content);
      await channel.send({ embeds: [embed] });
      await interaction.reply({ content: `✅ Posted!`, ephemeral: true });
      delete userSessions[userId];
      return;
    }
  } catch (err) {
    console.error(`❌ Error:`, err.message);
    await interaction.reply({
      content: `❌ Error: ${err.message}`,
      ephemeral: true,
    }).catch(() => {});
    delete userSessions[userId];
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// MESSAGE HANDLER
// ═══════════════════════════════════════════════════════════════════════════

discord.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;

  const userMessage = message.content.toLowerCase();

  // !post command
  if (userMessage === "!post") {
    const isOwner = message.member.roles.cache.some((r) => r.name === "Owners");
    const isAdmin = message.member.roles.cache.some((r) => r.name === "Admin");

    if (!isOwner && !isAdmin) return;
    if (!isOwner && isAdmin && message.channelId !== ADMIN_CHANNEL_ID) return;

    try {
      await message.reply({
        content: "**Which channel?**",
        components: [buildChannelMenu()],
      });
      try { await message.delete(); } catch(e) {}
    } catch (err) {
      console.error("❌ !post error:", err.message);
    }
    return;
  }

  // Announcement text (after user selected channel & announce action)
  const session = userSessions[message.author.id];
  if (session && session.action === "announce" && session.channelId) {
    try {
      const channel = await discord.channels.fetch(session.channelId);
      await channel.send(message.content);
      await message.reply(`✅ Posted!`);
      delete userSessions[message.author.id];
      return;
    } catch (err) {
      console.error("❌ Announcement error:", err.message);
    }
  }

  // Rule Q&A (assistant)
  if (!enabledChannels.has(message.channelId)) return;

  const looksLikeRule = /rule|limit|how|can i|building|vehicle|steal|cheat|map|restart|shop|bot|server|allow/i.test(userMessage);
  if (!looksLikeRule) return;

  try {
    const rulesText = Object.values(liveRules).join("\n\n");
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent(`
You are a SCUM server rules expert. Answer this question about our server rules:

RULES:
${rulesText}

QUESTION: ${message.content}

Answer concisely (1-2 sentences max). If not about rules, say "That's not a rules question."
    `);

    const response = result.response.text();
    await message.reply(response);
  } catch (err) {
    console.error("❌ Assistant error:", err.message);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function buildChannelMenu() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("post_channel")
      .setPlaceholder("Select channel...")
      .addOptions([
        { label: "Admin Channel", value: ADMIN_CHANNEL_ID },
        { label: "Main Chat", value: ASSISTANT_CHANNEL_ID },
      ])
  );
}

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
  const emojis = { server: "📡", general: "📋", pvp: "⚔️", base: "🏗️", vehicles: "🚗", shops: "🏪", map: "🗺️" };
  const colors = { server: 0x60a5fa, general: 0xc8a04a, pvp: 0xef4444, base: 0xf59e0b, vehicles: 0x8b5cf6, shops: 0x22c55e, map: 0x3b82f6 };

  const lines = content.split("\n");
  const title = lines[0];
  const body = lines.slice(1).join("\n").trim();

  return new EmbedBuilder()
    .setTitle(`${emojis[section] || "📋"} ${title}`)
    .setDescription(body || content)
    .setColor(colors[section] || 0x3b82f6)
    .setFooter({ text: "Outpost X Server Rules" });
}

async function postHelpCenter(channel) {
  const helpSections = [
    { emoji: "🎯", title: "Getting Started", content: "Welcome to Outpost X! Spawn, orient yourself, learn the menus and character creation." },
    { emoji: "⚙️", title: "Game Mechanics", content: "Metabolism, BCU, attributes, focus mode, stamina - the core survival systems." },
    { emoji: "🏗️", title: "Base Building", content: "Build smart. Placement rules, materials, security, expansion basics." },
    { emoji: "💰", title: "Crafting & Looting", content: "Tier progression, suppressors, loot zones, weapon progression paths." },
    { emoji: "⚔️", title: "Combat & Weapons", content: "Weapon tiers, stealth mechanics, suppression, injury system." },
    { emoji: "🚗", title: "Vehicles", content: "Finding vehicles, claiming, maintenance, fuel strategy." },
    { emoji: "🍖", title: "Food & Nutrition", content: "Beans + Corn + Mushrooms miracle diet, vitamins, digestion." },
    { emoji: "⚕️", title: "Health & Medical", content: "Injuries, infections, temperature, medicine priority." },
    { emoji: "👥", title: "Multiplayer Tips", content: "KOS mentality, raiding, hiding bases, squad dynamics." },
  ];

  for (const section of helpSections) {
    const embed = new EmbedBuilder()
      .setTitle(`${section.emoji} ${section.title}`)
      .setDescription(section.content)
      .setColor(0x3b82f6)
      .setFooter({ text: "Outpost X Help Center" });

    await channel.send({ embeds: [embed] });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// LOGIN
// ═══════════════════════════════════════════════════════════════════════════

discord.login(process.env.DISCORD_TOKEN);
