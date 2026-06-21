require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Outpost X Default Rules
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

async function runSetup() {
  console.log("\n🔧 Starting Outpost X Supabase Setup...\n");

  try {
    // ─── Step 1: Clear old rules ───────────────────────────────────────
    console.log("📋 Step 1: Clearing old rules from 'rules' table...");
    const { data: existingRules, error: fetchError } = await supabase
      .from("rules")
      .select("section");
    
    if (fetchError) {
      console.error("❌ Error fetching rules:", fetchError.message);
      return;
    }

    if (existingRules && existingRules.length > 0) {
      console.log(`   Found ${existingRules.length} old rule(s). Deleting...`);
      const { error: deleteError } = await supabase
        .from("rules")
        .delete()
        .neq("section", ""); // Delete all rows
      
      if (deleteError) {
        console.error("❌ Error deleting old rules:", deleteError.message);
        return;
      }
      console.log("   ✅ Old rules deleted.");
    } else {
      console.log("   ✅ No old rules found (table already clean).");
    }

    // ─── Step 2: Populate with Outpost X rules ─────────────────────────
    console.log("\n📝 Step 2: Populating with Outpost X rules...");
    for (const [section, content] of Object.entries(DEFAULT_RULES)) {
      const { error: insertError } = await supabase
        .from("rules")
        .insert({ section, content });
      
      if (insertError) {
        console.error(`❌ Error inserting ${section}:`, insertError.message);
        return;
      }
      console.log(`   ✅ Inserted: ${section}`);
    }

    // ─── Step 3: Clear old assistant channels ──────────────────────────
    console.log("\n🔊 Step 3: Clearing old assistant channels...");
    const { data: existingChannels, error: fetchChannelsError } = await supabase
      .from("assistant_channels")
      .select("channel_id");
    
    if (fetchChannelsError) {
      console.error("❌ Error fetching channels:", fetchChannelsError.message);
      return;
    }

    if (existingChannels && existingChannels.length > 0) {
      console.log(`   Found ${existingChannels.length} old channel(s). Deleting...`);
      const { error: deleteChannelsError } = await supabase
        .from("assistant_channels")
        .delete()
        .neq("channel_id", ""); // Delete all rows
      
      if (deleteChannelsError) {
        console.error("❌ Error deleting old channels:", deleteChannelsError.message);
        return;
      }
      console.log("   ✅ Old channels deleted.");
    } else {
      console.log("   ✅ No old channels found (table already clean).");
    }

    // ─── Step 4: Verify table structures ───────────────────────────────
    console.log("\n🔍 Step 4: Verifying table structures...");
    
    const tables = ["rules", "assistant_channels", "posted_rules_messages"];
    for (const table of tables) {
      const { data, error } = await supabase.from(table).select("*").limit(0);
      if (error) {
        console.error(`❌ Error verifying ${table}:`, error.message);
        return;
      }
      console.log(`   ✅ ${table} - OK`);
    }

    // ─── Step 5: Verify column names ───────────────────────────────────
    console.log("\n✓ Step 5: Verifying column names...");
    const { data: rulesData, error: rulesError } = await supabase
      .from("rules")
      .select("*")
      .limit(1);
    
    if (rulesError) {
      console.error("❌ Error checking rules columns:", rulesError.message);
      return;
    }

    if (rulesData && rulesData.length > 0) {
      const columns = Object.keys(rulesData[0]);
      console.log(`   Rules table columns: ${columns.join(", ")}`);
      
      if (columns.includes("section") && columns.includes("content")) {
        console.log("   ✅ Column names correct!");
      } else {
        console.error("   ❌ Column names are wrong! Expected 'section' and 'content'");
        return;
      }
    }

    // ─── Success ───────────────────────────────────────────────────────
    console.log("\n" + "=".repeat(50));
    console.log("✅ SETUP COMPLETE!");
    console.log("=".repeat(50));
    console.log("\n📊 Summary:");
    console.log(`   • Inserted ${Object.keys(DEFAULT_RULES).length} rule sections`);
    console.log("   • Cleared old Cobblestone data");
    console.log("   • Verified all table structures");
    console.log("   • Verified all column names");
    console.log("\n🚀 You can now run the production bot (index.js)");
    console.log("   The bot will load rules from Supabase automatically.\n");
    
  } catch (err) {
    console.error("\n❌ SETUP FAILED:", err.message);
    process.exit(1);
  }
}

// Run setup
runSetup();
