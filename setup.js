require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

console.log("\n🔧 The Watcher - Outpost X Supabase Setup");
console.log("==========================================\n");

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
  try {
    // ─── Step 1: Clear rules table ─────────────────────────────────────
    console.log("📋 Step 1: Clearing rules table...");
    const { error: deleteRulesError } = await supabase
      .from("rules")
      .delete()
      .neq("section", "");
    
    if (deleteRulesError && !deleteRulesError.message.includes("does not exist")) {
      console.log(`   ⚠️  Could not clear (table might not exist yet): ${deleteRulesError.message}`);
    } else if (!deleteRulesError) {
      console.log("   ✅ Old rules cleared");
    }

    // ─── Step 2: Populate rules ────────────────────────────────────────
    console.log("\n📝 Step 2: Populating rules...");
    for (const [section, content] of Object.entries(DEFAULT_RULES)) {
      const { error: insertError } = await supabase
        .from("rules")
        .upsert({ section, content }, { onConflict: "section" });
      
      if (insertError) {
        console.error(`   ❌ Error inserting ${section}:`, insertError.message);
        throw insertError;
      }
      console.log(`   ✅ Inserted: ${section}`);
    }

    // ─── Step 3: Clear assistant_channels ──────────────────────────────
    console.log("\n🔊 Step 3: Clearing assistant_channels table...");
    const { error: deleteChannelsError } = await supabase
      .from("assistant_channels")
      .delete()
      .neq("channel_id", "");
    
    if (deleteChannelsError && !deleteChannelsError.message.includes("does not exist")) {
      console.log(`   ⚠️  Could not clear (table might not exist yet): ${deleteChannelsError.message}`);
    } else if (!deleteChannelsError) {
      console.log("   ✅ Old channels cleared");
    }

    // ─── Step 4: Verify tables exist ───────────────────────────────────
    console.log("\n🔍 Step 4: Verifying tables...");
    const tables = ["rules", "assistant_channels", "posted_rules_messages"];
    
    for (const table of tables) {
      const { data, error } = await supabase.from(table).select("*").limit(1);
      if (error) {
        console.log(`   ⚠️  ${table} - ${error.message}`);
      } else {
        console.log(`   ✅ ${table} - OK`);
      }
    }

    // ─── Step 5: Verify rules were inserted ────────────────────────────
    console.log("\n✓ Step 5: Verifying rules were inserted...");
    const { data: verifyRules, error: verifyError } = await supabase
      .from("rules")
      .select("section, content")
      .limit(10);
    
    if (verifyError) {
      console.error(`   ❌ Error verifying: ${verifyError.message}`);
      throw verifyError;
    }

    if (!verifyRules || verifyRules.length === 0) {
      console.error("   ❌ NO RULES FOUND IN DATABASE!");
      throw new Error("Rules were not inserted");
    }

    console.log(`   ✅ Found ${verifyRules.length} rules in database:`);
    verifyRules.forEach(rule => {
      console.log(`      • ${rule.section} (${rule.content.length} chars)`);
    });

    // ─── Success ───────────────────────────────────────────────────────
    console.log("\n" + "=".repeat(50));
    console.log("✅ SETUP COMPLETE!");
    console.log("=".repeat(50));
    console.log("\n📊 Summary:");
    console.log(`   • Inserted ${Object.keys(DEFAULT_RULES).length} rule sections`);
    console.log("   • All tables verified");
    console.log(`   • ${verifyRules.length} rules confirmed in database`);
    console.log("\n🚀 Next steps:");
    console.log("   1. Upload index.js, poster.js, guide.js to GitHub");
    console.log("   2. Push to GitHub");
    console.log("   3. Railway will auto-deploy");
    console.log("   4. The Watcher bot will be live!\n");
    
    process.exit(0);

  } catch (err) {
    console.error("\n" + "=".repeat(50));
    console.error("❌ SETUP FAILED");
    console.error("=".repeat(50));
    console.error(`\nError: ${err.message}\n`);
    console.error("Troubleshooting:");
    console.error("  • Check your SUPABASE_URL and SUPABASE_KEY in .env");
    console.error("  • Make sure Supabase project is accessible");
    console.error("  • Check table permissions\n");
    
    process.exit(1);
  }
}

// Run setup
runSetup();
