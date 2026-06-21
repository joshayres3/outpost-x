require("dotenv").config();
const { Client, Events, GatewayIntentBits, ActionRowBuilder, StringSelectMenuBuilder } = require("discord.js");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { createClient } = require("@supabase/supabase-js");

// ─── Config ───────────────────────────────────────────────────────────────────
const ADMIN_CHANNEL_ID  = "1518059656302301245";
const ASSISTANT_CHANNEL_ID = "1516269437932670977";
const ALLOWED_ROLES     = ["Owners", "Admin"];
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
const pendingPosts = {};

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
    if (await handlePostChannelSelect(interaction)) return;
    if (await handlePostActionSelect(interaction)) return;
    if (await handlePostRuleSectionSelect(interaction)) return;
    
    // After all selections, execute the post action
    const { tempData } = require("./poster");
    const data = tempData[interaction.user.id];
    if (data && data.channelId && data.action) {
      try {
        await executePostAction(interaction, liveRules, discord, supabase);
        // Success - user already got response from executePostAction
      } catch (err) {
        console.error(`❌ Post error: ${err.message}`);
        try {
          await interaction.reply({ content: `❌ Error: ${err.message}`, ephemeral: true });
        } catch(e) {}
      }
    }
    return;
  }
  if (interaction.isButton()) {
    const { handleHelpButton } = require("./guide");
    if (await handleHelpButton(interaction)) return;
    // Posting handlers - currently disabled while rebuilding
    // if (await handlePostPickChannel(interaction)) return;
    // if (await handlePostConfirm(interaction, liveRules, genAI, enabledChannels, supabase)) return;
    // if (await handlePostCancel(interaction)) return;
    // if (await handleRuleUpdateCancel(interaction)) return;
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
      const isOwner = message.member.roles.cache.some((r) => r.name === "Owners");
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
      const isOwner = message.member.roles.cache.some((r) => r.name === "Owners");
      const isAdmin = message.member.roles.cache.some((r) => r.name === "Admin");
      
      if (!isOwner && !isAdmin) {
        console.log("   → User has no permission");
        return;
      }
      if (!isOwner && isAdmin && message.channelId !== ADMIN_CHANNEL_ID) {
        console.log("   → Admin can only use in admin channel");
        return;
      }
      
      const row = new ActionRowBuilder().addComponents(buildPostChannelMenu());
      await message.reply({ content: "**Which channel?**", components: [row] });
      try { await message.delete(); } catch(e) {}
      console.log("   ✅ !post menu sent");
    } catch (err) {
      console.error("   ❌ !post error:", err.message);
    }
    return;
  }

  // Handle channel selection for !post
  if (message.guild && hasAdminRole(message.member)) {
    const pending = pendingPosts[message.author.id];
    if (pending && pending.awaitingChannel) {
      try {
        console.log("   → Processing channel selection");
        const channelInput = userMessage.trim();
        let targetChannel = null;
        
        // Try to find channel by ID or name
        targetChannel = await message.guild.channels.fetch(channelInput).catch(() => null);
        
        if (!targetChannel) {
          // Try by name
          targetChannel = message.guild.channels.cache.find(ch => 
            ch.name.toLowerCase() === channelInput.toLowerCase()
          );
        }
        
        if (!targetChannel) {
          await message.reply(`❌ Channel not found: "${channelInput}". Try using the channel name or ID.`);
          return;
        }
        
        pending.targetChannelId = targetChannel.id;
        pending.awaitingChannel = false;
        
        // If posting rules, show rule section selector
        if (pending.what === "rules") {
          const { StringSelectMenuBuilder, ActionRowBuilder } = require("discord.js");
          const selectRules = new StringSelectMenuBuilder()
            .setCustomId("post_which_rules")
            .setPlaceholder("Which rules to post?")
            .addOptions([
              { label: "📋 All Rules", value: "all" },
              { label: "📡 Server Info", value: "server" },
              { label: "📋 General Rules", value: "general" },
              { label: "⚔️ PvP Rules", value: "pvp" },
              { label: "🏗️ Base Building", value: "base" },
              { label: "🚗 Vehicles", value: "vehicles" },
              { label: "🏪 Shops", value: "shops" },
              { label: "🗺️ Map Info", value: "map" },
            ]);
          await message.reply({
            content: "**Which rule sections do you want to post?**",
            components: [new ActionRowBuilder().addComponents(selectRules)]
          });
          console.log(`   ✅ Selected channel: ${targetChannel.name}`);
          try { await message.delete(); } catch(e) {}
          return;
        }
        
        // If guide, post it directly
        if (pending.what === "help") {
          const { postHelpPanel } = require("./guide");
          await postHelpPanel(targetChannel);
          await message.reply(`✅ Guide posted to <#${targetChannel.id}>!`);
          delete pendingPosts[message.author.id];
          try { await message.delete(); } catch(e) {}
          return;
        }
        
        // If announcing, ask for announcement text
        if (pending.what === "announce") {
          await message.reply("Now type your announcement message:");
          console.log(`   ✅ Selected channel: ${targetChannel.name}`);
          try { await message.delete(); } catch(e) {}
          return;
        }
      } catch (err) {
        console.error("   ❌ Channel selection error:", err.message);
        await message.reply(`❌ Error: ${err.message}`);
      }
      return;
    }
  }

  // Handle rule update text (admin typed their change after selecting section)
  if (message.guild && hasAdminRole(message.member)) {
    // Rule update handlers - currently disabled while rebuilding
    // if (await handleRuleUpdateText(message, liveRules, genAI, supabase, pendingUpdates, hasAdminRole)) return;
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
  buildPostChannelMenu,
  handlePostChannelSelect,
  handlePostActionSelect,
  handlePostRuleSectionSelect,
  executePostAction,
  handleAnnouncementText,
} = require("./poster");
