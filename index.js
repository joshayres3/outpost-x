require("dotenv").config();

const {
  Client,
  Events,
  GatewayIntentBits,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ChannelType,
} = require("discord.js");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { createClient } = require("@supabase/supabase-js");
const { handlePostMenu, handleAnnText } = require("./poster");

const ADMIN_CH = process.env.ADMIN_CHANNEL_ID || "1518059656302301245";

function requireEnv(name) {
  if (!process.env[name]) {
    console.error(`❌ Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return process.env[name];
}

const DISCORD_TOKEN = requireEnv("DISCORD_TOKEN");
const GEMINI_API_KEY = requireEnv("GEMINI_API_KEY");
const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SUPABASE_KEY = requireEnv("SUPABASE_KEY");

const bot = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const genai = new GoogleGenerativeAI(GEMINI_API_KEY);
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

let rules = {};
const channels = new Set();

async function loadRulesAndChannels() {
  const { data: ruleRows, error: ruleError } = await db.from("rules").select("section, content");
  if (ruleError) throw ruleError;

  rules = {};
  for (const row of ruleRows || []) {
    rules[row.section] = row.content;
  }
  console.log(`📚 Loaded ${Object.keys(rules).length} rule section(s)`);

  const { data: channelRows, error: channelError } = await db
    .from("assistant_channels")
    .select("channel_id");
  if (channelError) throw channelError;

  channels.clear();
  for (const row of channelRows || []) {
    channels.add(row.channel_id);
  }
  console.log(`✅ Assistant enabled in ${channels.size} channel(s)`);
}

bot.once(Events.ClientReady, async () => {
  console.log(`✅ The Watcher is online as ${bot.user.tag}`);

  try {
    await loadRulesAndChannels();
  } catch (err) {
    console.error("❌ Failed to load Supabase data:", err);
  }
});

bot.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isStringSelectMenu()) return;
  await handlePostMenu(interaction, rules, bot, db, channels);
});

bot.on(Events.MessageCreate, async (msg) => {
  try {
    if (msg.author.bot || !msg.guild) return;

    if (msg.content.toLowerCase() === "!post") {
      const owns = msg.member.roles.cache.some((r) => r.name === "Owners");
      const admins = msg.member.roles.cache.some((r) => r.name === "Admin");

      if (!owns && !admins) return;
      if (!owns && admins && msg.channelId !== ADMIN_CH) return;

      const categories = msg.guild.channels.cache
        .filter((c) => c.type === ChannelType.GuildCategory)
        .map((c) => ({ label: c.name.slice(0, 100), value: c.id }))
        .slice(0, 25);

      if (!categories.length) {
        await msg.reply("No categories found.");
        return;
      }

      await msg.reply({
        content: "Which category?",
        components: [
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId("post_cat")
              .setPlaceholder("Choose a category")
              .setOptions(categories)
          ),
        ],
      });

      await msg.delete().catch(() => {});
      return;
    }

    if (await handleAnnText(msg)) return;

    if (!channels.has(msg.channelId)) return;
    if (!/rule|limit|how|can i|building|vehicle|steal|cheat|map|restart|shop|bot|server|allow/i.test(msg.content)) return;

    const rulesText = Object.values(rules).join("\n\n");
    if (!rulesText.trim()) {
      await msg.reply("I do not have the server rules loaded yet. Try again in a minute.");
      return;
    }

    const model = genai.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent(
      `You are The Watcher, the Outpost X Discord assistant. Answer only using these SCUM server rules. Be clear, calm, and concise.\n\nRULES:\n${rulesText}\n\nQUESTION: ${msg.content}\n\nAnswer in 1-2 sentences.`
    );

    await msg.reply(result.response.text());
  } catch (err) {
    console.error("❌ Message handler error:", err);
    await msg.reply("Something went wrong while I processed that.").catch(() => {});
  }
});

bot.on("error", (err) => console.error("❌ Discord client error:", err));
process.on("unhandledRejection", (err) => console.error("❌ Unhandled rejection:", err));
process.on("uncaughtException", (err) => console.error("❌ Uncaught exception:", err));
process.on("SIGTERM", () => {
  console.log("⚠️ Received SIGTERM from Railway. Destroying Discord client cleanly.");
  bot.destroy();
  process.exit(0);
});

bot.login(DISCORD_TOKEN);
