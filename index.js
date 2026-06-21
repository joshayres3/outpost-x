require("dotenv").config();
const { Client, Events, ChannelType } = require("discord.js");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { createClient } = require("@supabase/supabase-js");

// ─── Config ───────────────────────────────────────────────────────────────────
const ADMIN_CHANNEL_ID  = "1518059656302301245";
const ASSISTANT_CHANNEL_ID = "1516269437932670977";
const ALLOWED_ROLES     = ["Owner", "Admin"];
const ADMIN_WHITELIST   = [];

// ─── Initialize clients ───────────────────────────────────────────────────────
const discord  = new Client({ intents: 131072 });
const genAI    = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ─── Default Rules for Outpost X ──────────────────────────────────────────────
const DEFAULT_RULES = {
  server: `SERVER INFO
Name: [ENG] Outpost X PvE - 3xLoot - 3xXP - BotShop
Direct Connect: 74.63.231.2:7002
Server Type: PvE Survival
Age Requirement: 18+ Community
Outpost X is built around survival, freedom, chaos, and common sense. We protect the server from cheating, exploiting, stealing, and anything that ruins the game.
Server Features: 3x Loot • 3x XP • BotShop • Events • Active Staff
Server Restarts (Eastern Time USA): 12:00 AM • 4:00 AM • 8:00 AM • 12:00 PM • 4:00 PM • 8:00 PM
Discord: https://discord.gg/pnwUXSFKwp
Need Help? Open a ticket in ┃Open-a-Ticket
Server Motto: Built to Last. Born to Survive.`,

  general: `GENERAL RULES
1. Respect the Server - No cheating, duping, exploiting, scripting, bug abuse, or third-party tools that give an unfair advantage. If something is broken, report it. Do not farm it. Anything gained through abuse can be removed.
2. No Stealing - Do not steal from other players. This includes vehicles, bases, storage, dropped items, event items, bot deliveries, or anything that clearly belongs to someone else. If it is not yours, leave it alone. Nudging a vehicle a little does not count as stealing. Taking it, locking it, claiming it, stripping it, hiding it, or moving it away so someone else loses it does. Do not use loopholes, unlocked doors, vehicle locks, squad issues, or game mechanics as an excuse to take another player's stuff.
3. Respect Players - Trash talk is part of gaming. Harassment is not. No racism, hate speech, doxxing, real-life threats, targeted harassment, or dragging real-life issues into the game. Keep conflict in-game.
4. Building Rules - Build smart and do not block the map. You may not build: On roads, Across roads, Blocking rivers, Within 100 meters of POIs, Within 100 meters of settlements. Do not build exploit bases, unreachable bases, or structures designed to abuse game mechanics. Staff may remove builds that break these rules, cause server issues, or create problems beyond normal gameplay.
5. Vehicles - Do not lock vehicles until they are built. If you find a vehicle spawn, push it off the spawn point as much as you can before building or claiming it. Do not hoard vehicles just to keep them away from other players. Keep in mind other people play the game too. Lost, flipped, damaged, or destroyed vehicles are usually part of the game. Staff will only replace vehicles when there is clear proof of a server-side issue.
6. Bots, Shop, Taxi, and Delivery - Do not abuse bot systems, shop systems, taxi systems, or loot delivery. If a system gives you something by mistake, report it. Do not exploit it. Do not take another player's bot delivery. Anything gained through system abuse can be removed.
7. Tickets and Staff Help - Use tickets when you need staff. Do not spam staff DMs, demand instant answers, or argue across multiple channels. Be clear, be honest, and provide screenshots or clips when possible. False reports, fake evidence, or wasting staff time can lead to punishment.
8. No Admin Shopping - If staff gives you an answer, that answer stands unless ownership reviews it. Do not jump from admin to admin trying to get a different result. You can ask for clarification, but arguing in circles will not change the decision.
9. Events - Event rules will be explained before each event. If you join an event, follow the event rules. Do not grief, stall, exploit, steal event items, or argue mid-event. Admins running events have final say during that event.
10. New Players - Outpost X is not a handout server, but new players still need a reason to stay. Do not make hunting fresh players your entire personality. Help them, ignore them, or mess with them through normal gameplay — just do not be the reason new people quit before they even learn the server.
11. Staff Decisions - Rules are handled with context and common sense. If something is clearly harmful to the server, staff can act even if the exact situation is not listed here. Ownership has final say.
Final Rule: Do not be the reason we have to add more rules. Play the game. Survive. Cause a little chaos. Keep Outpost X worth logging into.`,

  pvp: `PVP RULES
Currently PvE focused. No active PvP zones at this time.`,

  base: `BASE BUILDING RULES
DO NOT BUILD:
• On roads
• Across roads
• Blocking rivers
• Within 100 meters of POIs
• Within 100 meters of settlements

Build smart and do not block the map. Do not build exploit bases, unreachable bases, or structures designed to abuse game mechanics. Staff may remove builds that break these rules, cause server issues, or create problems beyond normal gameplay.`,

  vehicles: `VEHICLE RULES
Do not lock vehicles until they are built. If you find a vehicle spawn, push it off the spawn point as much as you can before building or claiming it. Do not hoard vehicles just to keep them away from other players. Keep in mind other people play the game too. Lost, flipped, damaged, or destroyed vehicles are usually part of the game. Staff will only replace vehicles when there is clear proof of a server-side issue.`,

  shops: `BUSINESS / SELLING RULES
Do not abuse bot systems, shop systems, taxi systems, or loot delivery. If a system gives you something by mistake, report it. Do not exploit it. Do not take another player's bot delivery. Anything gained through system abuse can be removed.`,

  map: `MAP INFO
Outpost X features a custom map with various POIs and survival locations. Build smartly, avoid restricted areas, and always check with staff if unsure about building locations.`,
};

// Live rules loaded from Supabase on startup
let liveRules = { ...DEFAULT_RULES };

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
      console.log("📚 No saved rules found — populating with defaults...");
      // Auto-populate if empty
      for (const [section, content] of Object.entries(DEFAULT_RULES)) {
        const { error: insertError } = await supabase
          .from("rules")
          .upsert({ section, content }, { onConflict: "section" });
        if (insertError) console.error(`Failed to insert ${section}:`, insertError.message);
      }
      console.log("✅ Default rules auto-populated to database.");
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
  if (message.author.bot) return;
  const userMessage = message.content.trim();
  if (!userMessage) return;

  // ── !ruleupdate command works from ANY channel for OWNERS, admin channel only for ADMINS ───────────────────
  if (userMessage.toLowerCase() === "!ruleupdate" && message.guild) {
    const isOwner = message.member.roles.cache.some((r) => r.name === "Owner");
    const isAdmin = message.member.roles.cache.some((r) => r.name === "Admin");
    
    if (!isOwner && !isAdmin) return; // No permission
    if (!isOwner && isAdmin && message.channelId !== ADMIN_CHANNEL_ID) return; // Admin must be in admin channel
    
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
    return;
  }

  // ── !post command works from ANY channel for OWNERS, admin channel only for ADMINS ─────────────────────────
  if (userMessage.toLowerCase() === "!post" && message.guild) {
    const isOwner = message.member.roles.cache.some((r) => r.name === "Owner");
    const isAdmin = message.member.roles.cache.some((r) => r.name === "Admin");
    
    if (!isOwner && !isAdmin) return; // No permission
    if (!isOwner && isAdmin && message.channelId !== ADMIN_CHANNEL_ID) return; // Admin must be in admin channel
    
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
