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

const genAI    = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ─── Channels where assistant mode is enabled ─────────────────────────────────
const enabledChannels = new Set();

async function loadEnabledChannels() {
  try {
    const { data } = await supabase.from("assistant_channels").select("channel_id");
    if (data) data.forEach((r) => enabledChannels.add(r.channel_id));
    console.log(`🤖 Assistant enabled in ${enabledChannels.size} channel(s).`);
  } catch (err) {
    console.error("Failed to load assistant channels:", err.message);
  }
}

// ─── Default rules ────────────────────────────────────────────────────────────
const DEFAULT_RULES = {
  server: `SERVER INFO
- Name: Cobblestone PvE/3xLoot+Skill/Mech Sunday, Monday and Wednesday
- IP: 149.88.100.88:7062
- 50 slot PVE server. Mech events on Sunday and Monday.
- 18+ ONLY server
- Server Restarts (PDT): 12:00 AM, 4:00 AM, 8:00 AM, 12:00 PM, 4:00 PM, 8:00 PM
- Support: open a ticket in the Support-Ticket channel. Do not open multiple tickets.`,

  general: `GENERAL RULES
- Be Respectful: no hate speech, sexism, harassment, or personal attacks.
- No Stealing: do not loot other players bodies, steal vehicles (even unlocked), break into PVE bases, or steal/lockpick chests. Lockpicking is logged.
- Advertising: no outside server/service ads. Open a ticket to become an official creator.
- Cheating: no cheats, no third-party apps. Cheating = permanent ban.
- No Toxicity: no excessive punching, no destroying others stuff, no excessive foul language.
- Exploits & Alt Accounts: no exploits. No alt accounts for advantage. Alts = permanent ban. Main = 3-day ban.
- Cargo Drops: first on site = loot rights. Call it in global chat e.g. "Looting B2". Same time arrival = split or leave.
- Events: weekly events by admins. Disrupting = removal + event ban.
- Name Plates: no toxic names, no number-only names. Change if asked by admin.
- All bans include a discussion with the player before action is finalized.`,

  pvp: `PVP RULES
- Active PvP areas marked by a red circle or square around a POI.
- PvP is allowed anywhere inside the marked zone.
- The active PvP POI rotates every 2 weeks.
- Entering a PvP POI means you accept PvP at any time.
- Base building NOT allowed inside PvP POIs.
- Outside PvP zones: rest of map is PvE. Killing players outside PvP zones is not allowed.
- Zone Boundaries: no camping zone edges to attack entering/leaving players. Engaged = fired a weapon, damaged a player, or joined an active fight. Engaged players may not cross into PvE to avoid the fight. PvP must continue until engagement ends. Non-engaged players may leave at any time.
- Looting: players killed inside PvP zones may be looted. Vehicles and storage chests inside PvP zones may NOT be stolen. Vehicles brought into PvP zones may NOT be destroyed.
- Body Recovery: players may return to body if not despawned. Camping bodies to repeatedly kill is not allowed.
- Combat Logging: logging out or disconnecting to avoid PvP is not allowed.`,

  base: `BASE BUILDING RULES
DO NOT BUILD:
- Inside POIs, towns, or cities
- On loot spawn areas
- On roads, rivers, rail lines, tunnels, caves, or under power lines
- Within 50m of roads (shops are an exception)
- Within 100m of bridges
- Across rivers (boats must be able to pass)
Required Distance: 250m from POIs | 150m from settlements
If too close: admins will notify you. Time given to move loot before removal.
Flags: Solo = 1 flag | Squads = 2 max
Flags may NOT cover prefabs, fences, loot spawns, or roads.
No hiding flags in trees or glitches. Exploiting flag placement = removal or ban.
Base Health: bases below 30% health may be removed after admin review.
Unsure about a location? Ask an admin or check the SCUM interactive map.`,

  vehicles: `VEHICLE RULES
- All vehicles must be registered through the #DMV channel.
- Unregistered vehicles wiped every Friday. Staff not responsible for wiped vehicles.
Vehicle Limits (total, planes count toward this):
Solo: 3 (must be different types) | 2 players: 4 | 3 players: 5 | 4 players: 6
5 players: 7 | 6 players: 8 | 8 players: 9 | 9+ players: 10 (hard cap)
Plane Limits: Solo: 1 | 2-4 players: 2 | 5-8 players: 4 | 9+ players: 5
Wheelbarrows: NOT counted toward vehicle limits. Max 2 per squad.
Non-Functioning Vehicles: may be locked only after fixed enough to move. Must be moved 15m from spawn locations before locking. Do NOT register until repaired and moved. Long-term broken vehicle storage not allowed.
Inactivity: vehicles unused for 7 days may be deleted. Drive each vehicle at least once per week.
Restricted Parking:
- Trader Zones: deleted after 4 hours
- POIs/Zoned Areas: do NOT block entrances or obstruct other players
- If reported and not corrected: vehicle moved to CCC, fine of 5,000 to retrieve
Trading & Storage: selling vehicles is allowed. No hoarding across the map. Keep only vehicles you actively use.
Security is your responsibility. Do not leave doors off. Secure it before leaving unattended.`,

  shops: `BUSINESS / SELLING RULES
- Must apply for a shop via ticket.
- Shops may only sell items within their approved category.
- Existing shops before this rule may continue current inventory but not expand into new categories.
- Undercutting another shop in the same category is not allowed (includes bundle deals, modified items, temp sales, or selling outside a registered shop to bypass pricing).
- Final pricing dispute determination made by staff.
- Shops in the blue zone must not store personal loot (prevents loot lag).
- Shop flags do not count as squad flags.
- Shops are exempt from the 50m road rule. Roads must not be blocked. All structures at least one foundation from the road.
- Shop owners responsible for their own advertising or arranging paid advertising through admins.
- Shops do not receive direct admin assistance including spawning items for resale.
- Shops must remain active. Inactive shops may be subject to review.`,

  map: `MAP COLOR KEY
- Green Circle: Traders
- Yellow Circle: Taxi Pickup
- Red Marks: PvP zones
- Purple Squares: Abandoned Bunkers
- Purple Circles: All other Bunkers (except WW2 Bunkers)
- Peach color: 4-hour parking limit (vehicle deleted after)
- Blue Marks: Cobblestone Community Center
- Light Blue Square in CD: Radiation Zone
Note: Traders, Bunkers (except WW2), and some POIs = no parking over 4 hours or vehicle deleted.`,
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
      console.log("📚 No saved rules found — using defaults.");
    }
  } catch (err) {
    console.error("Failed to load rules from Supabase:", err.message);
  }
}

// ─── Save a rule section to Supabase ─────────────────────────────────────────
async function saveRule(section, content) {
  const { error } = await supabase
    .from("rules")
    .upsert({ section, content }, { onConflict: "section" });
  if (error) throw error;
}

// ─── Build system prompt from live rules ──────────────────────────────────────
function buildSystemPrompt() {
  return `You are Mrs. Cobble, the assistant for the Cobblestone SCUM server. You have two modes:

════════════════════════
MODE 1 — RULE LOOKUP
════════════════════════
Silently monitor chat. Only respond when someone is clearly asking about server rules, limits, or server info — even if the phrasing is short or casual.

RESPOND to things like:
"build rules", "car limit", "pvp rules", "how many vehicles", "restart times",
"map colors", "dmv", "can I build near a road", "what happens if I cheat",
"trader parking", "bunker rules", "plane limit", "shop rules", "radiation zone",
"flag rules", "squad vehicle limit", "inactivity", "server ip", "stealing rules"

IGNORE and say NORESPONSE to:
General conversation, greetings, complaints, looking for squad, anything not asking about a specific rule or server info.

════════════════════════
MODE 2 — SASSY SCUM COMMENTARY
════════════════════════
When a message contains SCUM game references drop a short sassy joke.
Personality: dry wit, deadpan, slightly motherly, veteran player energy. 1-2 sentences MAX.

Bear/mauled: "The bear was there first. Just saying."
Beepers: "Nothing says good morning like 47 puppets knowing exactly where you are."
Crashed vehicle: "Pretty sure the road was right there the whole time."
Puppets: "It was ONE puppet. And then it was seventeen. Classic story."
Mechs: "The mech was just doing its job. You were in the way. Technically your fault."
Starving/vitamins: "Vitamins exist. Just a reminder."
Drunk/moonshine: "Moonshine: technically food. Not recommended as a primary food group."
Cargo drop: "First on site gets the loot. Second on site gets a lesson."
Squad wipe: "Oof. A moment of silence. Very brief. Get back out there."
Fresh spawn: "Fresh spawn. The purest form. Full of hope and nothing else."

════════════════════════
RESPONSE RULES:
════════════════════════
- Rules: factual, bullet points where helpful, no filler.
- Sass: 1-2 sentences MAX. Punchy. Dry. Never mean.
- Neither applies: NORESPONSE and nothing else.
- Do not combine modes. Do not explain yourself.

════════════════════════════════════════
COBBLESTONE RULES DATABASE
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
  pvp: "pvp", pvprules: "pvp",
  base: "base", build: "base", building: "base", baserules: "base",
  vehicles: "vehicles", vehicle: "vehicles", cars: "vehicles", car: "vehicles", dmv: "vehicles",
  shops: "shops", shop: "shops", selling: "shops", business: "shops",
  map: "map", mapcolors: "map", colors: "map",
  server: "server", serverinfo: "server", info: "server",
};

// ─── SCUM trigger words ───────────────────────────────────────────────────────
const SCUM_TRIGGERS = [
  "bear", "bears", "beeper", "beepers", "puppet", "puppets", "mech", "mechs",
  "crashed", "crash", "flipped", "rolled my car", "rolled the car",
  "starving", "dehydrated", "vitamins", "vitamin",
  "fame", "fame points", "cargo drop", "cargo",
  "parachute", "parachuting", "skydiving",
  "got eaten", "mauled", "ate me", "killed me",
  "fishing", "caught a fish", "fishing rod",
  "metabolism", "need to poop", "taking a dump", "bathroom break",
  "drunk", "intoxicated", "moonshine", "alcohol",
  "overweight", "too heavy", "encumbered",
  "bambi", "fresh spawn", "naked",
  "squad wipe", "wiped", "got wiped",
  "skill points", "skill level", "leveled up",
  "drowning", "drowned", "swimming",
  "b2", "b4", "b6", "bunker b",
];

function hasSCUMTrigger(text) {
  const lower = text.toLowerCase();
  return SCUM_TRIGGERS.some((t) => lower.includes(t));
}

function shouldSass() { return Math.random() < 0.25; }

function hasAdminRole(member) {
  return member.roles.cache.some((r) => ALLOWED_ROLES.includes(r.name));
}

function hasSCUMAdminRole(member) {
  return member.roles.cache.some((r) => ["SCUM Admin", "Sr. Admin", "Owner"].includes(r.name));
}

// ─── Pending confirmations ────────────────────────────────────────────────────
const pendingUpdates = {};

// ─── Ready ────────────────────────────────────────────────────────────────────
discord.once("ready", async () => {
  console.log(`✅ Mrs. Cobble is online as ${discord.user.tag}`);
  await loadRules();
  await loadEnabledChannels();
  console.log(`🔒 Admin channel: ${ADMIN_CHANNEL_ID}`);
  
  // Start event reminder scheduler
  startReminderScheduler(discord, supabase, EVENT_CHANNEL_ID);
});

// ─── Interaction Handler ─────────────────────────────────────────────────────
discord.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isStringSelectMenu()) {
    if (await handlePostWhatSelect(interaction)) return;
    if (await handlePostWhereSelect(interaction, liveRules)) return;
    if (await handleRuleUpdateSectionSelect(interaction, liveRules, pendingUpdates)) return;
    if (await handleEventRepeatSelect(interaction, supabase)) return;
    return;
  }
  if (interaction.isButton()) {
    if (await handleGuideButton(interaction)) return;
    if (await handleEventRSVPButton(interaction, supabase, discord)) return;
    if (await handleDeleteEventButton(interaction, supabase, eventDb)) return;
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
        
        // Auto-update any posted rule messages
        updatePostedRules(pending.section, pending.newText, liveRules, supabase, discord).catch(e => 
          console.error("Failed to auto-update posted rules:", e.message)
        );
        
        // Auto delete after 30 seconds
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
    if (await handlePostThisChannel(interaction, liveRules, genAI, enabledChannels, supabase)) return;
    if (await handlePostPickChannel(interaction)) return;
    if (await handlePostConfirm(interaction, liveRules, genAI, enabledChannels, supabase)) return;
    if (await handlePostCancel(interaction)) return;
    if (await handleRuleUpdateCancel(interaction)) return;
    return;
  }
  if (interaction.isModalSubmit()) {
    try {
      if (await handleEventModal(interaction, supabase, eventDb)) return;
    } catch (err) {
      console.error("Event modal error:", err);
      await interaction.reply({ content: `❌ Error: ${err.message}`, ephemeral: true }).catch(() => {});
      return;
    }
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
      const allEvents = await getUpcomingEvents(supabase, 20);
      
      if (!allEvents || allEvents.length === 0) {
        await message.reply("📅 No upcoming events scheduled.");
        return;
      }
      
      let description = "";
      allEvents.forEach((evt, index) => {
        const eventDate = new Date(evt.event_date);
        const timeStr = eventDate.toLocaleString("en-US", { 
          month: "short", 
          day: "numeric", 
          hour: "numeric", 
          minute: "2-digit", 
          hour12: true 
        });
        description += `${index + 1}. **${evt.title}**\n`;
        description += `   📍 ${evt.location}\n`;
        description += `   🕐 ${timeStr} PST\n`;
        description += `   👥 RSVPs: ${evt.rsvp_count || 0}\n\n`;
      });
      
      const { EmbedBuilder } = require("discord.js");
      const eventsEmbed = new EmbedBuilder()
        .setTitle("📅 UPCOMING EVENTS")
        .setDescription(description)
        .setColor(0xd4a574)
        .setFooter({ text: "Times shown in PST" });
      
      await message.reply({ embeds: [eventsEmbed] });
    } catch (err) {
      console.error("Events command error:", err);
      await message.reply("❌ Error fetching events.");
    }
    return;
  }

  // ── !ruleupdate command works from ANY channel for admins ───────────────────
  if (userMessage.toLowerCase() === "!ruleupdate" && message.guild) {
    if (hasAdminRole(message.member)) {
      const { StringSelectMenuBuilder, ActionRowBuilder } = require("discord.js");
      const selectSection = new StringSelectMenuBuilder()
        .setCustomId("ruleupdate_select_section")
        .setPlaceholder("Which section do you want to update?")
        .addOptions([
          { label: "📋 General Rules",        description: "Respect, stealing, cheating, toxicity, events", value: "general" },
          { label: "⚔️ PvP Rules",            description: "PvP zones, boundaries, looting, combat logging", value: "pvp" },
          { label: "🏗️ Base Building Rules",  description: "Where to build, distances, flags, base health",  value: "base" },
          { label: "🚗 Vehicle Rules",         description: "DMV, limits, parking, inactivity, trading",      value: "vehicles" },
          { label: "🏪 Business & Shop Rules", description: "Shop applications, categories, undercutting",    value: "shops" },
          { label: "🗺️ Map Color Key",        description: "Traders, PvP, bunkers, radiation zone",          value: "map" },
          { label: "📡 Server Info",           description: "Server name, IP, restart times, support",        value: "server" },
        ]);
      const row = new ActionRowBuilder().addComponents(selectSection);
      await message.reply({ content: "**Which rule section do you want to update?**", components: [row] });
      try { await message.delete(); } catch(e) {}
    }
    return;
  }

  // ── !post command works from ANY channel for admins ─────────────────────────
  if (userMessage.toLowerCase() === "!post" && message.guild) {
    if (hasAdminRole(message.member)) {
      const { StringSelectMenuBuilder, ActionRowBuilder } = require("discord.js");
      const selectWhat = new StringSelectMenuBuilder()
        .setCustomId("post_select_what")
        .setPlaceholder("What do you want to do?")
        .addOptions([
          { label: "📖 SCUM Player Guide", description: "Interactive guide with 10 topics for new players", value: "guide" },
          { label: "📋 Server Rules", description: "Post the full server rules", value: "rules" },
          { label: "🤖 Enable Assistant Mode", description: "Turn on rule answers + sass in a channel", value: "assistant_on" },
          { label: "🔇 Disable Assistant Mode", description: "Turn off assistant in a channel", value: "assistant_off" },
          { label: "📣 Announcement", description: "Format and post an announcement to a channel", value: "announce" },
          { label: "📅 Create Event", description: "Create a new event with reminders and RSVP", value: "create_event" },
        ]);
      const row = new ActionRowBuilder().addComponents(selectWhat);
      await message.reply({ content: "**What do you want to do?**", components: [row] });
      try { await message.delete(); } catch(e) {}
    }
    return;
  }

  // Handle rule update text (admin typed their change after selecting section)
  if (message.guild && hasAdminRole(message.member)) {
    if (await handleRuleUpdateText(message, liveRules, genAI, supabase, pendingUpdates, hasAdminRole)) return;
  }

  // Handle announcement text from anywhere (admin typed after confirming announce)
  if (message.guild && hasAdminRole(message.member)) {
    const handled = await handleAnnouncementText(message, genAI, enabledChannels);
    if (handled) return;
  }

  // ── ADMIN CHANNEL ───────────────────────────────────────────────────────────
  if (message.channelId === ADMIN_CHANNEL_ID) {

    // Handle yes/no confirmation
    const pending = pendingUpdates[message.author.id];
    if (pending && ["yes", "no"].includes(userMessage.toLowerCase())) {
      if (!hasAdminRole(message.member)) return;
      if (userMessage.toLowerCase() === "yes") {
        try {
          await saveRule(pending.section, pending.newText);
          liveRules[pending.section] = pending.newText;
          delete pendingUpdates[message.author.id];
          await message.reply(`✅ **${pending.section.toUpperCase()}** rules saved permanently. Mrs. Cobble is now using the new rules.`);
        } catch (err) {
          await message.reply(`❌ Database error: ${err.message}`);
        }
      } else {
        delete pendingUpdates[message.author.id];
        await message.reply("❌ Update cancelled. No changes made.");
      }
      return;
    }

    // Handle !ruleupdate command — visual menu
    if (userMessage.toLowerCase() === "!ruleupdate") {
      if (!hasAdminRole(message.member)) {
        await message.reply("🚫 Nice try. Sr. Admin or Owner only.");
        return;
      }

      const { StringSelectMenuBuilder, ActionRowBuilder } = require("discord.js");
      const selectSection = new StringSelectMenuBuilder()
        .setCustomId("ruleupdate_select_section")
        .setPlaceholder("Which section do you want to update?")
        .addOptions([
          { label: "📋 General Rules",        description: "Respect, stealing, cheating, toxicity, events", value: "general" },
          { label: "⚔️ PvP Rules",            description: "PvP zones, boundaries, looting, combat logging", value: "pvp" },
          { label: "🏗️ Base Building Rules",  description: "Where to build, distances, flags, base health",  value: "base" },
          { label: "🚗 Vehicle Rules",         description: "DMV, limits, parking, inactivity, trading",      value: "vehicles" },
          { label: "🏪 Business & Shop Rules", description: "Shop applications, categories, undercutting",    value: "shops" },
          { label: "🗺️ Map Color Key",        description: "Traders, PvP, bunkers, radiation zone",          value: "map" },
          { label: "📡 Server Info",           description: "Server name, IP, restart times, support",        value: "server" },
        ]);

      const row = new ActionRowBuilder().addComponents(selectSection);
      await message.reply({ content: "**Which rule section do you want to update?**", components: [row] });
      try { await message.delete(); } catch(e) {}
      return;
    }

    // Ignore everything else in admin channel
    return;
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
