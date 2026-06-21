require("dotenv").config();

const {
  Client,
  Events,
  GatewayIntentBits,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} = require("discord.js");

const { GoogleGenerativeAI } = require("@google/generative-ai");
const { createClient } = require("@supabase/supabase-js");
const WebSocket = require("ws");

const { handlePostMenu, handleAnnText } = require("./poster");
const { handleHelpButton } = require("./guide");
const {
  handleEventCommand,
  handleEventInteraction,
  handleEventText,
  startEventScheduler,
} = require("./events");
const {
  handleWelcomeMessage,
  handleWelcomeBackfillCommand,
} = require("./welcome");

const REQUIRED_ENV = ["DISCORD_TOKEN", "GEMINI_API_KEY", "SUPABASE_URL", "SUPABASE_KEY"];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`❌ Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const ADMIN_CH = process.env.ADMIN_CHANNEL_ID || "1518059656302301245";
const TICKET_CHANNEL_ID = process.env.TICKET_CHANNEL_ID || "1516323094548185139";

const bot = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, {
  realtime: {
    transport: WebSocket,
  },
});

let rules = {};
const channels = new Set();

bot.once(Events.ClientReady, async () => {
  console.log(`✅ The Watcher is online as ${bot.user.tag}`);

  try {
    const { data: ruleRows, error: rulesError } = await db.from("rules").select("*");
    if (rulesError) throw rulesError;

    rules = {};
    for (const r of ruleRows || []) {
      rules[r.section] = r.content;
    }

    console.log(`📚 Loaded ${Object.keys(rules).length} rule sections`);

    const { data: channelRows, error: channelsError } = await db
      .from("assistant_channels")
      .select("channel_id");

    if (channelsError) throw channelsError;

    channels.clear();
    for (const c of channelRows || []) {
      channels.add(c.channel_id);
    }

    console.log(`✅ Assistant in ${channels.size} channel(s)`);

    startEventScheduler(bot, db);
  } catch (err) {
    console.error("❌ Startup database load failed:", err);
  }
});

bot.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isButton()) {
      if (interaction.customId.startsWith("help_")) {
        await handleHelpButton(interaction);
        return;
      }

      if (interaction.customId.startsWith("event_")) {
        await handleEventInteraction(interaction, bot, db);
        return;
      }

      return;
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId.startsWith("event_")) {
        await handleEventInteraction(interaction, bot, db);
        return;
      }

      await handlePostMenu(interaction, rules, bot, db, channels);
      return;
    }
  } catch (err) {
    console.error("❌ Interaction error:", err);

    const payload = {
      content: `Error: ${err.message}`,
      ephemeral: true,
    };

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
});

bot.on(Events.MessageCreate, async (msg) => {
  try {
    if (msg.author.bot) return;

    if (!msg.guild) {
      await msg.reply(
        [
          "Thanks for the message!",
          "",
          "[The Watcher] does not handle private support through DMs yet.",
          `If you need staff, please open a ticket in <#${TICKET_CHANNEL_ID}>.`,
        ].join("\n")
      ).catch(() => {});

      return;
    }

    // Must run before normal server message handling because Sapphire posts the welcome message.
    await handleWelcomeMessage(msg, db);

    if (await handleWelcomeBackfillCommand(msg, bot, db)) return;

    if (await handleEventCommand(msg)) return;

    if (msg.content.toLowerCase() === "!post") {
      const own = msg.member.roles.cache.some((r) => r.name === "Owners");
      const adm = msg.member.roles.cache.some((r) => r.name === "Admin");

      if (!own && !adm) return;
      if (!own && adm && msg.channelId !== ADMIN_CH) return;

      await msg.reply({
        content: "What do you want to do?",
        components: [
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId("post_act")
              .setPlaceholder("Choose an action")
              .addOptions([
                { label: "Post Help Center", value: "help", emoji: "🎯" },
                { label: "Post Rules", value: "rules", emoji: "📋" },
                { label: "Enable Assistant", value: "ast_on", emoji: "✅" },
                { label: "Disable Assistant", value: "ast_off", emoji: "⛔" },
                { label: "Announcement", value: "ann", emoji: "📢" },
              ])
          ),
        ],
      });

      msg.delete().catch(() => {});
      return;
    }

    if (await handleEventText(msg)) return;

    if (await handleAnnText(msg)) return;

    if (!channels.has(msg.channelId)) return;

    if (
      !/rule|limit|how|can i|building|vehicle|steal|cheat|map|restart|shop|bot|server|allow/i.test(
        msg.content
      )
    ) {
      return;
    }

    const txt = Object.values(rules).join("\n\n");

    if (!txt.trim()) {
      await msg.reply("I do not have the server rules loaded right now.");
      return;
    }

    const model = genai.getGenerativeModel({ model: "gemini-2.5-flash" });

    const res = await model.generateContent(
      `You are The Watcher, the Outpost X SCUM server assistant.

Answer this question about our SCUM server rules.

RULES:
${txt}

QUESTION:
${msg.content}

Answer in 1-2 sentences. Be clear, helpful, and do not invent rules.`
    );

    await msg.reply(res.response.text());
  } catch (err) {
    console.error("❌ Message error:", err);
    msg.reply("Something went wrong while processing that.").catch(() => {});
  }
});

bot.on("error", (err) => console.error("❌ Discord error:", err));

process.on("unhandledRejection", (err) => {
  console.error("❌ Unhandled rejection:", err);
});

process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught exception:", err);
});

process.on("SIGTERM", () => {
  console.log("🛑 SIGTERM received. Shutting down cleanly.");
  bot.destroy();
  process.exit(0);
});

bot.login(process.env.DISCORD_TOKEN);
