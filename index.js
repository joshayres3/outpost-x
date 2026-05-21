require("dotenv").config();
const { Client, GatewayIntentBits, Events } = require("discord.js");
const { postGuidePanel, handleGuideButton } = require("./guide");
const { 
  handlePostWhatSelect, 
  handlePostThisChannel, 
  handlePostPickChannel, 
  handlePostWhereSelect, 
  handlePostConfirm, 
  handlePostCancel, 
  handleAnnouncementText, 
  handleRuleUpdateSectionSelect, 
  handleRuleUpdateText, 
  handleRuleUpdateCancel, 
  updatePostedRules 
} = require("./poster");
const { handleEventModal, handleDeleteEventButton, pendingEvents } = require("./event-handler");
const { handleEventRSVPButton } = require("./event-rsvp");
const { startReminderScheduler, stopReminderScheduler } = require("./event-reminders");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { createClient } = require("@supabase/supabase-js");
const eventDb = require("./event-db");

// ─── Config ───────────────────────────────────────────────────────────────────
const PLAYER_CHANNEL_ID = "1397942478379810887";
const ADMIN_CHANNEL_ID  = "1218303201464422631";
const EVENT_CHANNEL_ID  = "1504618527242326170";
const ALLOWED_ROLES     = ["Sr. Admin", "Owner"];

const discord  = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const genAI    = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

let liveRules = {};
let enabledChannels = new Set();

// ─── Load Data on Startup ──────────────────────────────────────────────────
discord.once("ready", async () => {
  console.log("✅ Mrs. Cobble is online as " + discord.user.tag);
  
  await loadRules();
  await loadEnabledChannels();

  startReminderScheduler(discord, supabase, EVENT_CHANNEL_ID);
});

// ─── Load Enabled Channels ────────────────────────────────────────────────────
async function loadEnabledChannels() {
  try {
    const { data } = await supabase.from("enabled_channels").select("channel_id");
    if (data) data.forEach((r) => enabledChannels.add(r.channel_id));
  } catch (err) {
    console.error("Error loading enabled channels:", err);
  }
}

// ─── Load Rules ───────────────────────────────────────────────────────────────
async function loadRules() {
  try {
    const { data } = await supabase.from("rules").select("section_name, content");
    if (data) {
      data.forEach((rule) => {
        liveRules[rule.section_name] = rule.content;
      });
      console.log(`📚 Loaded ${Object.keys(liveRules).length} rule sections from database.`);
    }
  } catch (err) {
    console.error("Error loading rules:", err);
  }
}

// ─── Save Rule ────────────────────────────────────────────────────────────────
async function saveRule(section, content) {
  const { error } = await supabase
    .from("rules")
    .upsert({ section_name: section, content }, { onConflict: "section_name" });
  if (error) console.error("Error saving rule:", error);
}

function buildSystemPrompt() {
  let rulesText = "";
  for (const [section, content] of Object.entries(liveRules)) {
    rulesText += `**${section}:**\n${content}\n\n`;
  }
  return `You are Mrs. Cobble, a sassy and helpful Discord bot for a SCUM survival game server.

**Your job:**
- Answer questions about server rules
- Be helpful but sassy
- Reference specific rules when relevant

**Server Rules:**
${rulesText}

**Tone:** Sassy, witty, helpful. Use emojis occasionally. Keep responses concise.`;
}

function hasSCUMTrigger(text) {
  return /vehicle|base|shop|pvp|griefing|raiding|flag|trader|bunker|radiation|inactivity|restart|wipe/i.test(text);
}

function shouldSass() { return Math.random() < 0.25; }

function hasAdminRole(member) {
  return member.roles.cache.some((r) => ALLOWED_ROLES.includes(r.name));
}

function hasSCUMAdminRole(member) {
  return member.roles.cache.some((r) => ["SCUM Admin", "Sr. Admin", "Owner"].includes(r.name));
}

// ─── Interactions ─────────────────────────────────────────────────────────────
discord.on("interactionCreate", async (interaction) => {
  if (interaction.isButton()) {
    if (await handleEventRSVPButton(interaction, supabase, discord)) return;
    if (await handleDeleteEventButton(interaction, supabase, eventDb)) return;
  }

  if (interaction.isStringSelectMenu()) {
    if (await handlePostWhatSelect(interaction)) return;
    if (await handlePostThisChannel(interaction, liveRules, genAI, enabledChannels, supabase)) return;
    if (await handlePostWhereSelect(interaction, liveRules)) return;
    if (await handlePostPickChannel(interaction)) return;
    if (await handleRuleUpdateSectionSelect(interaction)) return;
  }

  if (interaction.isModalSubmit()) {
    if (await handleEventModal(interaction, supabase, eventDb, discord)) return;
  }

  if (interaction.isButton()) {
    if (await handlePostConfirm(interaction, liveRules, genAI, enabledChannels, supabase)) return;
    if (await handlePostCancel(interaction)) return;
  }
});

// ─── Message Handler ──────────────────────────────────────────────────────────
discord.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  const userMessage = message.content.trim();
  if (!userMessage) return;

  // Handle event date/time input for event creation
  if (message.guild && !message.author.bot) {
    const userId = message.author.id;
    if (pendingEvents[userId]) {
      if (await handleEventDateTimeInput(message, userId, pendingEvents)) {
        return;
      }
      // Handle repeat type selection
      if (await handleEventRepeatTypeInput(message, userId, pendingEvents, supabase, discord)) {
        return;
      }
      // Handle custom repeat days input
      if (await handleEventRepeatDaysInput(message, userId, pendingEvents, supabase, discord)) {
        return;
      }
    }
  }

  // ── !events command — list all upcoming events ───────────────────────────
  if (userMessage.toLowerCase() === "!events" && message.guild) {
    try {
      const { getUpcomingEvents } = require("./event-db");
      const events = await getUpcomingEvents(supabase, 10);
      if (!events || events.length === 0) {
        await message.reply("📅 No upcoming events scheduled.");
        return;
      }

      let eventList = "📅 **Upcoming Events:**\n";
      events.forEach((e, i) => {
        eventList += `${i + 1}. **${e.title}** - ${new Date(e.event_date).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })} (RSVPs: ${e.rsvp_count})\n`;
      });

      await message.reply(eventList);
    } catch (err) {
      console.error("Events command error:", err);
      await message.reply("Error fetching events.");
    }
    return;
  }

  // ── !ruleupdate command works from ANY channel for admins ───────────────────
  if (userMessage.toLowerCase() === "!ruleupdate" && message.guild) {
    if (!hasSCUMAdminRole(message.member)) {
      await message.reply("🚫 Sr. Admin or Owner only.");
      return;
    }
    if (await handleRuleUpdateSectionSelect(message)) return;
  }

  // ── !post command works from ANY channel for admins ─────────────────────────
  if (userMessage.toLowerCase() === "!post" && message.guild) {
    if (!hasSCUMAdminRole(message.member)) {
      await message.reply("🚫 Sr. Admin or Owner only.");
      return;
    }
    await handleRuleUpdateSectionSelect(message);
  }

  // ── Rule Update Text Handler ──────────────────────────────────────────────────
  if (message.guild && hasSCUMAdminRole(message.member)) {
    if (await handleRuleUpdateText(message, liveRules, genAI, supabase, pendingUpdates, hasSCUMAdminRole)) return;
  }

  // ── Announcement Text Handler ─────────────────────────────────────────────────
  if (message.guild && hasSCUMAdminRole(message.member)) {
    const handled = await handleAnnouncementText(message, genAI, enabledChannels);
    if (handled) return;
  }

  // ── ASSISTANT MODE — only respond in channels where it is enabled ────────────
  if (!enabledChannels.has(message.channelId)) return;

  const looksLikeRule = /rule|limit|how|can i|dmv|register|pvp|park|vehicle|inactiv|ban|steal|cheat|map|restart|ip|flag|color|colour|trader|bunker|radiation|squad|wipe|ticket/i.test(userMessage);
  const hasTrigger    = hasSCUMTrigger(userMessage);

  if (!looksLikeRule && !hasTrigger) return;
  if (!looksLikeRule && hasTrigger && !shouldSass()) return;

  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: buildSystemPrompt(),
    });
    const result = await model.generateContent(userMessage);
    const reply  = result.response.text().trim();
    if (!reply || reply.toUpperCase().startsWith("NORESPONSE")) return;
    await message.reply(reply);
  } catch (err) {
    console.error("Gemini error:", err.message);
  }
});

discord.login(process.env.DISCORD_TOKEN);
