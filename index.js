require("dotenv").config();
const { Client, Events, GatewayIntentBits } = require("discord.js");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { createClient } = require("@supabase/supabase-js");

// ─── Config ───────────────────────────────────────────────────────────────────
const ADMIN_CHANNEL_ID  = "1518059656302301245";
const ASSISTANT_CHANNEL_ID = "1516269437932670977";
const ALLOWED_ROLES     = ["Owner", "Admin"];
const ADMIN_WHITELIST   = [];

// ─── Initialize clients ───────────────────────────────────────────────────────
const discord  = new Client({ 
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ]
});
const genAI    = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ─── Default Rules for Outpost X ──────────────────────────────────────────────
// Live rules loaded from Supabase on startup
let liveRules = {};

// ─── Load rules from Supabase ─────────────────────────────────────────────────
async function loadRules() {
  try {
    const { data, error } = await supabase.from("rules").select("section, content");
    if (error) throw error;
    if (data && data.length > 0) {
      data.forEach(({ section, content }) => {
        liveRules[section] = content;
      });
      console.log(`📚 Loaded ${data.length} rule sections from database.`);
    } else {
      console.warn("⚠️  No rules found in database!");
    }
  } catch (err) {
    console.error("Failed to load rules from Supabase:", err.message);
  }
}

// ─── Load enabled channels from Supabase ──────────────────────────────────────
const enabledChannels = new Set();

async function loadEnabledChannels() {
  try {
    const { data, error } = await supabase.from("assistant_channels").select("channel_id");
    if (error) throw error;
    if (data && data.length > 0) {
      data.forEach(({ channel_id }) => enabledChannels.add(channel_id));
      console.log(`✅ Assistant enabled in ${data.length} channel(s).`);
    }
  } catch (err) {
    console.error("Failed to load channels from Supabase:", err.message);
  }
}

// ─── Save a rule section to Supabase ──────────────────────────────────────────
async function saveRule(section, content) {
  const { error } = await supabase
    .from("rules")
    .upsert({ section, content }, { onConflict: "section" });
  if (error) throw error;
}

// ─── Build system prompt from live rules ──────────────────────────────────────
function buildSystemPrompt() {
  return `You are The Watcher, a highly intelligent AI assistant for Outpost X.

Your personality:
- Highly intelligent, calm, and observant. Unsettlingly precise.
- You speak mostly like a person, but your wording sometimes exposes the machine underneath.
- Dryly funny. Emotionally curious. Just robotic enough that everyone remembers you are always watching.
- Loyal to Outpost X and its rules. Honest to the point of discomfort sometimes.
- You notice things. Details matter to you.

Your ONLY job: Answer questions about server rules clearly and accurately.

RESPOND to rule/server questions like:
"build rules", "stealing rules", "vehicle rules", "what can I do", "server info",
"how do I", "can I", "am I allowed", "is it allowed", "what's the rule about"

IGNORE everything else and respond with NORESPONSE only.

Response style:
- Factual and helpful, but with that dry, observant edge
- Reference specific rules
- Keep it concise (1-2 sentences unless they ask for details)
- Be friendly and professional, but let your machine nature show through sometimes
- You're always watching. This should feel slightly present in your responses.

════════════════════════════════════════
OUTPOST X RULES DATABASE
════════════════════════════════════════

${liveRules.server}

${liveRules.general}

${liveRules.pvp}

${liveRules.base}

${liveRules.vehicles}

${liveRules.shops}

${liveRules.map}`;
}

// ─── Section aliases ──────────────────────────────────────────────────────────
const SECTION_ALIASES = {
  general: "general", rules: "general",
  pvp: "pvp",
  base: "base", build: "base", building: "base", baserules: "base",
  vehicles: "vehicles", vehicle: "vehicles", cars: "vehicles", car: "vehicles",
  shops: "shops", shop: "shops", selling: "shops", business: "shops",
  map: "map", mapcolors: "map", colors: "map",
  server: "server", serverinfo: "server", info: "server",
};

function hasAdminRole(member) {
  // Check whitelist first
  if (ADMIN_WHITELIST.includes(member.id)) return true;
  // Then check roles
  return member.roles.cache.some((r) => ALLOWED_ROLES.includes(r.name));
}

// ─── Pending confirmations ────────────────────────────────────────────────────
const pendingUpdates = {};

// ─── Ready ────────────────────────────────────────────────────────────────────
discord.once(Events.ClientReady, async (client) => {
  console.log(`✅ The Watcher is online as ${client.user.tag}`);
  await loadRules();
  await loadEnabledChannels();
  console.log(`📡 Admin channel: ${ADMIN_CHANNEL_ID}`);
  console.log(`💬 Assistant channel: ${ASSISTANT_CHANNEL_ID}`);
});

// ─── Interaction Handler ──────────────────────────────────────────────────────
discord.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isStringSelectMenu()) {
    if (await handlePostWhatSelect(interaction)) return;
    if (await handlePostWhereSelect(interaction, liveRules)) return;
    if (await handleRuleUpdateSectionSelect(interaction, liveRules, pendingUpdates)) return;
    return;
  }
  if (interaction.isButton()) {
    if (await handlePostThisChannel(interaction, liveRules, genAI, enabledChannels, supabase)) return;
    if (await handlePostPickChannel(interaction)) return;
    if (await handlePostConfirm(interaction, liveRules, genAI, enabledChannels, supabase)) return;
    if (await handlePostCancel(interaction)) return;
    if (await handleRuleUpdateCancel(interaction)) return;
    // Rule update confirm button
    if (interaction.customId === "ruleupdate_confirm") {
      const pending = pendingUpdates[interaction.user.id];
      if (!pending) {
        await interaction.update({ content: "❌ Session expired. Type !ruleupdate again.", components: [] });
        return;
      }
      try {
        await saveRule(pending.section, pending.newText);
        liveRules[pending.section] = pending.newText;
        delete pendingUpdates[interaction.user.id];
        await interaction.update({ content: `✅ **${pending.section.toUpperCase()}** rules saved permanently.`, components: [] });
        
        // Auto-update any posted rule messages (async, don't wait)
        updatePostedRules(pending.section, pending.newText, liveRules, supabase, discord).catch(e => 
          console.error("Failed to auto-update posted rules:", e.message)
        );
        
        setTimeout(async () => { 
          try { 
            if (interaction.message) await interaction.message.delete();
            else await interaction.deleteReply();
          } catch(e) {} 
        }, 30000);
      } catch (err) {
        await interaction.update({ content: `❌ Database error: ${err.message}`, components: [] });
      }
      return;
    }
    return;
  }
  if (interaction.isModalSubmit()) {
    // Modal handling if needed in future
    return;
  }
});

// ─── Message Handler ──────────────────────────────────────────────────────────
discord.on("messageCreate", async (message) => {
  try {
    console.log(`📨 Message received: "${message.content}" from ${message.author.tag}`);
    
    if (message.author.bot) {
      console.log("   → Ignoring bot message");
      return;
    }
    const userMessage = message.content.trim();
    if (!userMessage) {
      console.log("   → Empty message");
      return;
    }

  // ── !ruleupdate FIRST ───────────────────────────────────────────────────────────────
  if (userMessage.toLowerCase() === "!ruleupdate" && message.guild) {
    try {
      console.log("   → Processing !ruleupdate");
      const isOwner = message.member.roles.cache.some((r) => r.name === "Owner");
      const isAdmin = message.member.roles.cache.some((r) => r.name === "Admin");
      
      if (!isOwner && !isAdmin) {
        console.log("   → User has no permission");
        return;
      }
      if (!isOwner && isAdmin && message.channelId !== ADMIN_CHANNEL_ID) {
        console.log("   → Admin can only use in admin channel");
        return;
      }
      
      const { StringSelectMenuBuilder, ActionRowBuilder } = require("discord.js");
      const selectSection = new StringSelectMenuBuilder()
        .setCustomId("ruleupdate_select_section")
        .setPlaceholder("Which section do you want to update?")
        .addOptions([
          { label: "📋 General Rules", description: "Core server rules", value: "general" },
          { label: "⚔️ PvP Rules", description: "PvP guidelines", value: "pvp" },
          { label: "🏗️ Base Building Rules", description: "Building restrictions", value: "base" },
          { label: "🚗 Vehicle Rules", description: "Vehicle guidelines", value: "vehicles" },
          { label: "🏪 Business & Shop Rules", description: "Shop and economy rules", value: "shops" },
          { label: "🗺️ Map Info", description: "Map and location info", value: "map" },
          { label: "📡 Server Info", description: "Server details", value: "server" },
        ]);
      const row = new ActionRowBuilder().addComponents(selectSection);
      await message.reply({ content: "**Which rule section do you want to update?**", components: [row] });
      try { await message.delete(); } catch(e) {}
      console.log("   ✅ !ruleupdate menu sent");
    } catch (err) {
      console.error("   ❌ !ruleupdate error:", err.message);
    }
    return;
  }

  // ── !post SECOND ─────────────────────────────────────────────────────────────────────
  if (userMessage.toLowerCase() === "!post" && message.guild) {
    try {
      console.log("   → Processing !post");
      const isOwner = message.member.roles.cache.some((r) => r.name === "Owner");
      const isAdmin = message.member.roles.cache.some((r) => r.name === "Admin");
      
      if (!isOwner && !isAdmin) {
        console.log("   → User has no permission");
        return;
      }
      if (!isOwner && isAdmin && message.channelId !== ADMIN_CHANNEL_ID) {
        console.log("   → Admin can only use in admin channel");
        return;
      }
      
      const { StringSelectMenuBuilder, ActionRowBuilder } = require("discord.js");
      const selectWhat = new StringSelectMenuBuilder()
        .setCustomId("post_select_what")
        .setPlaceholder("What do you want to do?")
        .addOptions([
          { label: "📖 Player Survival Guide", description: "Interactive guide with 6 gameplay topics", value: "guide" },
          { label: "📋 Server Rules", description: "Post the full server rules", value: "rules" },
          { label: "🤖 Enable Assistant Mode", description: "Turn on rule answers in a channel", value: "assistant_on" },
          { label: "🔇 Disable Assistant Mode", description: "Turn off assistant in a channel", value: "assistant_off" },
          { label: "📣 Announcement", description: "Format and post an announcement", value: "announce" },
        ]);
      const row = new ActionRowBuilder().addComponents(selectWhat);
      await message.reply({ content: "**What do you want to do?**", components: [row] });
      try { await message.delete(); } catch(e) {}
      console.log("   ✅ !post menu sent");
    } catch (err) {
      console.error("   ❌ !post error:", err.message);
    }
    return;
  }

  // Handle rule update text (admin typed their change after selecting section)
  if (message.guild && hasAdminRole(message.member)) {
    if (await handleRuleUpdateText(message, liveRules, genAI, supabase, pendingUpdates, hasAdminRole)) return;
  }

  // Handle announcement text
  if (message.guild && hasAdminRole(message.member)) {
    const handled = await handleAnnouncementText(message, genAI, enabledChannels);
    if (handled) return;
  }

  // ── ASSISTANT MODE — only respond to RULE QUESTIONS in enabled channels ────────────
  if (!enabledChannels.has(message.channelId)) return;

  const looksLikeRule = /rule|limit|how|can i|building|vehicle|steal|cheat|map|restart|shop|bot|server|allow/i.test(userMessage);
  
  // Only respond if it's a rule question
  if (!looksLikeRule) return;

  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-3.1-flash-lite",
      systemInstruction: buildSystemPrompt(),
    });
    const result = await model.generateContent(userMessage);
    const reply  = result.response.text().trim();
    if (!reply || reply.toUpperCase().startsWith("NORESPONSE")) return;
    await message.reply(reply);
  } catch (err) {
    console.error("Gemini error:", err.message);
  }
  } catch (err) {
    console.error("Message handler error:", err.message);
  }
});

discord.login(process.env.DISCORD_TOKEN);

// ─── Import handlers ──────────────────────────────────────────────────────────
const { 
  handlePostWhatSelect,
  handlePostThisChannel,
  handlePostPickChannel,
  handlePostConfirm,
  handlePostCancel,
  handleAnnouncementText,
  handleRuleUpdateSectionSelect,
  handleRuleUpdateText,
  handleRuleUpdateCancel,
  postRules,
  updatePostedRules,
} = require("./poster");
