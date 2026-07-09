require("dotenv").config();

process.on("uncaughtException", (err) => {
  console.error("🔥 UNCAUGHT EXCEPTION:");
  console.error(err);
});

process.on("unhandledRejection", (reason) => {
  console.error("🔥 UNHANDLED REJECTION:");
  console.error(reason);
});

process.on("SIGINT", () => {
  console.log("⚠️ SIGINT received. Bot was manually stopped.");
  bot?.destroy?.();
  process.exit(0);
});

const {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  MessageFlags,
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
const { handleSupportRedirect } = require("./support");
const { handleWatcherFlavor } = require("./watcherFlavor");
const {
  handleWatcherCommand,
  isPublicRepliesEnabled,
} = require("./watcherControls");
const {
  handleRuleUpdateCommand,
  handleRuleUpdateInteraction,
  handleRuleUpdateText,
} = require("./rulesEditor");
const { handleIssueCommand, handleIssueInteraction } = require("./staffIssues");
const {
  handleWatcherDmCommand,
  handleWatcherDmInteraction,
} = require("./watcherDm");
const {
  handleGgconCommand,
  handleGgconInteraction,
  startGgconStatusOnBoot,
} = require("./ggcon");

const REQUIRED_ENV = ["DISCORD_TOKEN", "GEMINI_API_KEY", "SUPABASE_URL", "SUPABASE_KEY"];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`❌ Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const ADMIN_CH = process.env.ADMIN_CHANNEL_ID || "1518059656302301245";
const TICKET_CHANNEL_ID = process.env.TICKET_CHANNEL_ID || "1516323094548185139";
const MAIN_CHAT_CHANNEL_ID = process.env.MAIN_CHAT_CHANNEL_ID || "1516269437932670977";

const bot = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, {
  realtime: {
    transport: WebSocket,
  },
});

let rules = {};
const channels = new Set();

async function loadWatcherData() {
  const { data: ruleRows, error: rulesError } = await db.from("rules").select("*");
  if (rulesError) throw rulesError;

  rules = {};
  for (const r of ruleRows || []) {
    rules[r.section] = r.content;
  }

  const { data: channelRows, error: channelsError } = await db
    .from("assistant_channels")
    .select("channel_id");

  if (channelsError) throw channelsError;

  channels.clear();
  for (const c of channelRows || []) {
    channels.add(c.channel_id);
  }

  return {
    ruleCount: Object.keys(rules).length,
    channelCount: channels.size,
  };
}

function getWatcherContext() {
  return {
    bot,
    db,
    genai,
    rules,
    channels,
    reloadData: loadWatcherData,
  };
}

function shouldAnswerWithAssistant(content) {
  if (!content) return false;
  if (content.startsWith("!")) return false;

  const text = content.toLowerCase().trim().replace(/\s+/g, " ");

  // Avoid obvious casual/meta statements that contain rule-ish words.
  const casualBlocks = [
    /\bnow i'?m on cooldown\b/i,
    /\bi'?m on cooldown\b/i,
    /\bon cooldown\b/i,
    /\bnot a rule\b/i,
    /\bthat'?s not a rule\b/i,
  ];

  if (casualBlocks.some((pattern) => pattern.test(text))) return false;

  const ruleQuestionPatterns = [
    // Direct rule wording.
    /\bwhat (are|is).*\b(rule|rules|limit|limits)\b/i,
    /\bdo we have .*\brules\b/i,
    /\bare there .*\brules\b/i,
    /\brules for\b/i,

    // Common allowed/not allowed wording.
    /\b(can i|can we|am i allowed to|are we allowed to|is it allowed to|are players allowed to)\b.*\b(build|park|claim|own|have|use|kill|raid|steal|lockpick|camp)\b/i,

    // Specific server limit questions.
    /\bhow many\b.*\b(flags|flag|vehicles|vehicle|cars|car|trucks|truck|bases|base|claims|claim)\b.*\b(can i|can we|am i allowed|are we allowed|own|have|place|build)\b/i,
    /\bwhat('?s| is| are)?\b.*\b(limit|limits)\b.*\b(flags|flag|vehicles|vehicle|cars|car|trucks|truck|bases|base|claims|claim)\b/i,

    // PvP / player combat questions.
    /\b(can i|can we|am i allowed to|are we allowed to|is it allowed to)\b.*\b(kill|shoot|raid|rob|steal from|lockpick)\b.*\b(player|players|someone|people|base|vehicle|car|truck)\b/i,

    // Trader / safezone / parking rule questions.
    /\b(can i|can we|am i allowed to|are we allowed to|is it allowed to)\b.*\b(park|leave|store|claim)\b.*\b(trader|safezone|safe zone|outpost|vehicle|car|truck)\b/i,

    // Timers/cooldowns only when clearly about server mechanics.
    /\b(raid timer|raid timers|raid cooldown|raid cooldowns|restart timer|restart timers|restart cooldown|restart cooldowns|purge timer|purge timers|purge cooldown|purge cooldowns|pvp timer|pvp timers|pvp cooldown|pvp cooldowns)\b/i,
    /\b(how long|when|what time).*\b(raid|restart|purge|pvp).*\b(timer|cooldown)\b/i,
  ];

  return ruleQuestionPatterns.some((pattern) => pattern.test(text));
}

bot.once(Events.ClientReady, async () => {
  console.log(`✅ The Watcher is online as ${bot.user.tag}`);

  try {
    const result = await loadWatcherData();

    console.log(`📚 Loaded ${result.ruleCount} rule sections`);
    console.log(`✅ Assistant in ${result.channelCount} channel(s)`);

    startEventScheduler(bot, db);
    startGgconStatusOnBoot(bot);
  } catch (err) {
    console.error("❌ Startup database load failed:", err);
  }
});

bot.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (await handleGgconInteraction(interaction)) return;

    if (await handleRuleUpdateInteraction(interaction, getWatcherContext())) return;

    if (await handleWatcherDmInteraction(interaction, getWatcherContext())) return;

    if (await handleIssueInteraction(interaction)) return;

    if (interaction.isButton()) {
      if (interaction.customId.startsWith("help_")) {
        await handleHelpButton(interaction);
        return;
      }

      if (interaction.customId.startsWith("event_")) {
        await handleEventInteraction(interaction, bot, db);
        return;
      }

      // Poster buttons such as ann_confirm / ann_revise / ann_cancel
      // must be routed here or Discord will show "This interaction failed."
      await handlePostMenu(interaction, rules, bot, db, channels);
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
      flags: MessageFlags.Ephemeral,
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
    if (!msg.guild) {
      if (msg.author.bot) return;

      await msg.reply(
        [
          "Thanks for the message!",
          "",
          "[The Watcher] does not handle private support through DMs yet.",
          `If you need staff, please open a ticket in <#${TICKET_CHANNEL_ID}>.`,
        ].join("\n")
      ).catch((err) => {
        console.error("❌ Failed to send DM auto-reply:", err.message);
      });

      return;
    }

    // Must run before ignoring bot messages because Sapphire posts the welcome message.
    await handleWelcomeMessage(msg, db);

    if (msg.author.bot) return;

    if (await handleGgconCommand(msg, bot)) return;

    if (await handleWatcherCommand(msg, getWatcherContext())) return;

    if (await handleWatcherDmCommand(msg, getWatcherContext())) return;

    if (await handleRuleUpdateCommand(msg, getWatcherContext())) return;

    if (await handleRuleUpdateText(msg, getWatcherContext())) return;

    if (await handleIssueCommand(msg)) return;

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

    if (await handleAnnText(msg, genai)) return;

    // Public automatic responses below this point are locked to the main chat only.
    if (msg.channelId !== MAIN_CHAT_CHANNEL_ID) return;

    if (!isPublicRepliesEnabled()) return;

    if (await handleSupportRedirect(msg)) return;

    if (channels.has(msg.channelId) && shouldAnswerWithAssistant(msg.content)) {
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

Answer in 1-2 sentences. Be clear, helpful, and do not invent rules.

If the rules do not clearly answer the question, say:
"I do not see that covered clearly in the posted rules. Open a ticket or ask staff before assuming."`
      );

      await msg.reply(res.response.text());
      return;
    }

    if (await handleWatcherFlavor(msg, genai)) return;
  } catch (err) {
    console.error("❌ Message error:", err);
    msg.reply("Something went wrong while processing that.").catch(() => {});
  }
});

bot.on("error", (err) => console.error("❌ Discord error:", err));

process.on("SIGTERM", () => {
  console.log("⚠️ SIGTERM received. The host/container is stopping the bot.");
  bot.destroy();
  process.exit(0);
});

setInterval(() => {
  console.log(`💓 Watcher heartbeat: ${new Date().toISOString()}`);
}, 5 * 60 * 1000);

bot.login(process.env.DISCORD_TOKEN);