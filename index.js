require("dotenv").config();
const { Client, Events, GatewayIntentBits, ActionRowBuilder, StringSelectMenuBuilder, ChannelType } = require("discord.js");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { createClient } = require("@supabase/supabase-js");

const { handlePostInteraction, handleAnnouncementText, userSessions } = require("./poster");

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════

const ADMIN_CHANNEL_ID = "1518059656302301245";
const ASSISTANT_CHANNEL_ID = "1516269437932670977";

// ═══════════════════════════════════════════════════════════════════════════
// INITIALIZE
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

let liveRules = {};
const enabledChannels = new Set();

// ═══════════════════════════════════════════════════════════════════════════
// STARTUP
// ═══════════════════════════════════════════════════════════════════════════

discord.on(Events.ClientReady, async () => {
  console.log(`✅ The Watcher is online as ${discord.user.tag}`);

  try {
    console.log("   → Loading rules from Supabase...");
    const { data } = await supabase.from("rules").select("*");
    data.forEach(({ section, content }) => {
      liveRules[section] = content;
    });
    console.log(`📚 Loaded ${Object.keys(liveRules).length} rule sections from database.`);
  } catch (err) {
    console.error("❌ Rules load failed:", err.message);
  }

  try {
    console.log("   → Loading enabled assistant channels...");
    const { data } = await supabase.from("assistant_channels").select("channel_id");
    data.forEach(({ channel_id }) => enabledChannels.add(channel_id));
    console.log(`✅ Assistant enabled in ${enabledChannels.size} channel(s).`);
  } catch (err) {
    console.error("❌ Assistant channels load failed:", err.message);
  }

  console.log(`📡 Admin channel: ${ADMIN_CHANNEL_ID}`);
  console.log(`💬 Assistant channel: ${ASSISTANT_CHANNEL_ID}`);
  console.log("   ✅ Bot fully ready");
});

// ═══════════════════════════════════════════════════════════════════════════
// INTERACTIONS
// ═══════════════════════════════════════════════════════════════════════════

discord.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isStringSelectMenu()) return;
  await handlePostInteraction(interaction, liveRules, discord, supabase, enabledChannels);
});

// ═══════════════════════════════════════════════════════════════════════════
// MESSAGES
// ═══════════════════════════════════════════════════════════════════════════

discord.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guild) return;

  const userMessage = message.content.toLowerCase();

  // !post command
  if (userMessage === "!post") {
    const isOwner = message.member.roles.cache.some(r => r.name === "Owners");
    const isAdmin = message.member.roles.cache.some(r => r.name === "Admin");

    if (!isOwner && !isAdmin) return;
    if (!isOwner && isAdmin && message.channelId !== ADMIN_CHANNEL_ID) return;

    try {
      const guild = message.guild;
      const categories = guild.channels.cache
        .filter(ch => ch.type === ChannelType.GuildCategory)
        .map(cat => ({ name: cat.name, value: cat.id }))
        .slice(0, 25);

      if (categories.length === 0) {
        await message.reply("❌ No categories found");
        return;
      }

      await message.reply({
        content: "**Which category?**",
        components: [
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId("post_category")
              .setPlaceholder("Select category...")
              .addOptions(categories)
          ),
        ],
      });
      try { await message.delete(); } catch(e) {}
      console.log("   ✅ !post menu sent");
    } catch (err) {
      console.error("❌ !post error:", err.message);
    }
    return;
  }

  // Announcement text
  if (await handleAnnouncementText(message, discord)) return;

  // Assistant Q&A
  if (!enabledChannels.has(message.channelId)) return;

  const looksLikeRule = /rule|limit|how|can i|building|vehicle|steal|cheat|map|restart|shop|bot|server|allow/i.test(userMessage);
  if (!looksLikeRule) return;

  try {
    const rulesText = Object.values(liveRules).join("\n\n");
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent(`
You are a helpful SCUM server expert. Answer this question about our server rules:

RULES:
${rulesText}

QUESTION: ${message.content}

Answer concisely (1-2 sentences). Be helpful and friendly.
    `);

    await message.reply(result.response.text());
  } catch (err) {
    console.error("❌ Assistant error:", err.message);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ERROR HANDLING & KEEP-ALIVE
// ═══════════════════════════════════════════════════════════════════════════

discord.on("error", err => {
  console.error("❌ Discord client error:", err);
});

discord.on("warn", msg => {
  console.warn("⚠️ Discord warning:", msg);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", err => {
  console.error("❌ Uncaught exception:", err);
  process.exit(1);
});

// Keep process alive
process.on("SIGTERM", () => {
  console.log("⚠️ SIGTERM received, but keeping bot alive...");
});

process.on("SIGINT", () => {
  console.log("⚠️ SIGINT received, but keeping bot alive...");
});

// ═══════════════════════════════════════════════════════════════════════════
// LOGIN
// ═══════════════════════════════════════════════════════════════════════════

console.log("   → Attempting to login...");
discord.login(process.env.DISCORD_TOKEN).catch(err => {
  console.error("❌ Login failed:", err);
  process.exit(1);
});
