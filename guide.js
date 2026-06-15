const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder
} = require("discord.js");

// ─── Guide content ────────────────────────────────────────────────────────────
const GUIDE = {

  start: {
    title: "🎯 Getting Started — Your First 30 Minutes",
    color: 0xc8a04a,
    content: `**Welcome to SCUM Island, Prisoner.**
You've been dropped into a brutal reality TV show run by TEC1. Your job is to survive, entertain, and not get eaten. Here's how to not die in the first 30 minutes.

**Step 1 — Craft your starter kit immediately**
You spawn with basically nothing. Before you do anything else:
• Cut down bushes to get small sticks and plant fibers
• Craft an **Improvised Rope** (5 small sticks or plant fibers)
• Craft a **Wooden Spear** (1 long stick) — your first weapon
• Craft an **Improvised Backpack** (rags + rope) — critical for carrying more loot
• Make 2-3 spears. You will lose them.

**Step 2 — Find food and water fast**
Your character is already hungry and thirsty on spawn. Priority targets:
• **Water** — Salt water makes you sick, fresh water from streams/rivers/ponds is safe. Drink by looking at water and pressing E.
• **Food** — search houses, farms, gardens. Berries, cans, vegetables all work early.
• Do NOT eat raw meat until you have a way to cook it.

**Step 3 — Find shelter before dark**
Nights in SCUM are extremely dark. Find a building to sleep in, start a small base, or find a headlamp, night vision goggles, or torch.

**Step 4 — Avoid Mechs early**
The mechanical robots patrol restricted zones (military areas). They will kill you instantly early game. The red circle on the map = stay away until you're geared.

**Step 5 — Check your BCU**
Press **Tab** to open your inventory. The BCU monitor shows your metabolism, health, and nutrition. Learn to read it — it's your lifeline.

> 💡 Tip: Use **scummap.com** to find food sources, water, buildings, and points of interest near your spawn.`
  },

  character: {
    title: "💪 Character Creation — Attributes & Skills",
    color: 0x3b82f6,
    content: `**Your character build determines everything about how you play.**

**The 4 Attributes**
• **Strength (STR)** — melee damage, carry weight, physical power
• **Constitution (CON)** — health points, stamina, endurance. *Most important for new players.*
• **Dexterity (DEX)** — speed, stealth, lock picking, weapon handling
• **Intelligence (INT)** — medical skill, engineering, crafting efficiency, affects XP gain speed and squad size capacity

**Recommended Starter Build**
Set Constitution to 5.0 — this gives you the most health and stamina to survive early game. Balance the rest based on playstyle.

**Skills (leveled by doing, not spending points)**
Each attribute has related skills that level up through use:

| Attribute | Skills |
|---|---|
| STR | Melee Weapons, Archery, Brawling |
| CON | Running, Endurance |
| DEX | Stealth, Thievery, Driving |
| INT | Medical, Engineering, Survival, Awareness |

**Skill Levels:** None → Basic → Medium → Advanced → Expert

**How to level skills fast**
• **Stealth** — crouch and move slowly near puppets without alerting them
• **Medical** — bandage wounds, give CPR, treat injuries
• **Running** — just run. A lot.
• **Engineering** — build base structures
• **Survival** — craft items, cook food, build fires

**Body Type affects gameplay**
• Heavier = stronger but slower
• Lighter = faster but weaker
• Fat reserves = survival buffer when food is scarce

> 💡 Tip: Starting with STR 4.5, CON 3, DEX 3, INT 2 is a solid all-rounder. Adjust based on solo vs squad play.`
  },

  metabolism: {
    title: "🧬 Metabolism & Survival — The Body System",
    color: 0x22c55e,
    content: `**SCUM has the most detailed survival simulation in any game. Your body is your biggest enemy.**

**The BCU Monitor (bottom left of screen)**
This is your dashboard. It tracks everything happening inside your character's body. Check it constantly.

**Calories**
• Every action burns calories — running, fighting, building, even sleeping
• Surplus calories = weight gain (more strength, less speed)
• Calorie deficit = weight loss (faster, but weaker)
• Balance intake vs burn shown in the top right of the metabolism tab

**Macronutrients**
• **Proteins** — muscle repair, found in meat, fish, eggs
• **Carbohydrates** — quick energy, found in bread, corn, fruit, canned food
• **Fats** — long-term energy reserves, found in fatty meats, cheese, nuts
• **Vitamins & Minerals** — missing these causes debuffs. Eat varied food.

**Hunger & Thirst — the realistic version**
Food and water don't instantly fill your bars. They work through your digestive system:
Stomach → Intestines → Colon → Bladder
Don't panic if you're still hungry right after eating a big meal. It takes time.

**Digestion Side Effects**
• Eating too much too fast = nausea or vomiting
• Dirty water = diarrhea (which makes noise and alerts puppets)
• Rotten food = food poisoning
• Always boil water if you're unsure of the source

**Temperature**
• Wet + cold = hypothermia risk
• Hot climate + heavy gear = overheating
• Wear appropriate clothing, dry off when wet

**Hygiene**
• Using dirty bandages causes infection
• Clean wounds properly with alcohol or antiseptic
• Infections left untreated can kill you slowly

**Defecation**
Yes, it's in the game. Check your colon and bladder in the BCU. Emptying your bladder/bowels in the wrong place can alert enemies via noise.

> 💡 Tip: Eat small amounts often rather than one big meal. Keep corn flakes and canned beans in your inventory — great shelf life and good nutrition.`
  },

  combat: {
    title: "⚔️ Combat — Puppets, Mechs, NPCs & Players",
    color: 0xef4444,
    content: `**There are 4 types of threats on the island. Each needs a different approach.**

**🧟 Puppets (Zombies)**
The standard enemy. They react to noise and movement.
• Crouch + slow walk = stealth approach for silent melee kills
• Noise (gunshots, running, loud actions) = they swarm your position
• Basic stealth skill lets you get close enough for a melee kill without alerting them
• Distract them by throwing items in a different direction
• They travel in packs — killing one quietly is very different from alerting a group

**🤖 Mechs (Robot Sentries)**
Patrol restricted/military zones. Do not engage early game.
• If a Mech spots you and yells "FREEZE" — stop moving immediately
• It will then say "SURRENDER" — press **F3 or F4** to raise your hands
• It will order you to leave the area — walk away calmly
• You have a short window to escape — use it
• If you run or fight, it will kill you. It is not worth fighting until late game.

**🧑 Armed NPCs (Added in 1.0)**
Human NPCs that patrol the island. They are intelligent and aggressive.
• They adapt to your behavior — do not underestimate them
• They have loot worth fighting for, but they fight back hard
• Use cover, flanking, and suppression rather than direct rushes

**🎯 Other Players (PvP)**
The most dangerous threat.
• 3rd person peeking is limited — you can't see around corners that your character couldn't see in 1st person
• Guns can jam — maintain your weapons and clean them regularly
• Melee combo tip: 2 punches without getting hit triggers a 3rd free strike with no stamina cost
• Ballistics are realistic — bullet drop and wind affect long range shots
• Always approach unknown situations with the assumption of hostility

**General Combat Tips**
• Noise discipline is everything — suppress shots when possible
• Flanking beats frontal assault every time
• Retreat is a valid tactic — there's no shame in running
• Carry extra bandages before any fight

> 💡 Tip: A wooden spear at melee range beats a gun at melee range — close the gap on armed enemies whenever possible.`
  },

  base: {
    title: "🏗️ Base Building — Shelter & Fortification",
    color: 0xf59e0b,
    content: `**A good base is the difference between keeping your loot and losing everything.**

**Getting Started**
• Place a **Flag** to claim your territory — this is required to build
• Solo players get 1 flag. Squads get 2 max.
• The flag radius defines where you can build

**Basic Base Priorities (in order)**
1. **Bed** — your respawn point. Build this first.
2. **Chests** — storage for food, weapons, and loot
3. **Improvised Oven or Fire Ring** — cooking station
4. **Improvised Workbench** — crafting station
5. **Walls** — security once you have the basics

**Building Materials**
• Start with wood — chop trees with an axe or chainsaw (chainsaw is faster and more efficient)
• Upgrade to metal over time for better durability
• Axes are for wood only — don't use them for fighting or you'll destroy them faster

**Base Health**
• Structures degrade over time
• Bases below 30% health may be removed by admins on this server
• Maintain your base regularly

**Location Tips**
• Build away from roads and POIs — less foot traffic = less attention
• Near water = easier survival
• Near forests = easier wood gathering
• Avoid building too close to high-traffic loot zones

**On This Server (Cobblestone Rules)**
• Do NOT build inside POIs, towns, or cities
• Do NOT build within 50m of roads (shops are an exception)
• Do NOT build within 100m of bridges
• Minimum 250m from POIs, 150m from settlements
• Flags may NOT cover prefabs, fences, loot spawns, or roads

> 💡 Tip: Building raises your Engineering, Survival, and Awareness skills passively. Your first base is also your best skill grind.`
  },

  vehicles: {
    title: "🚗 Vehicles — Transport & Rules",
    color: 0x8b5cf6,
    content: `**Vehicles are essential for covering the massive map efficiently — but they come with responsibility.**

**Available Vehicle Types**
• **Cars & Trucks** — standard land transport, vary in speed and cargo space
• **Motorcycles / Sports Bikes** — fast, nimble, good for solo players
• **ATVs** — off-road capable, good for rough terrain
• **Tractors** — slow but very durable and useful for hauling
• **Boats** — water travel, useful for coastal exploration
• **Seaplanes** — air travel, high mobility across the entire island
• **Wheelbarrows** — slow push carts, great for hauling base materials short distances

**Finding & Repairing Vehicles**
• Found at garages, farms, roads, and military areas
• Most spawned vehicles need repairs before they can be driven
• Use car parts (found at mechanics and garages) to repair
• Fix a vehicle enough to move it before locking it

**Fuel**
• Vehicles run on gasoline — found in cans at gas stations and garages
• Always carry a spare fuel can on long trips

**On This Server (Cobblestone Rules)**
• All vehicles must be registered through the DMV channel
• Unregistered vehicles are wiped every Friday — register yours!
• Vehicles not driven for 7 days may be deleted — drive each one weekly
• Vehicle limits by squad size (ask in the rules channel for specifics)
• Planes count toward your total vehicle limit
• Wheelbarrows do NOT count toward limits (max 2 per squad)
• No parking at traders for more than 4 hours — vehicle will be deleted
• Do NOT block POI entrances or road access with parked vehicles

> 💡 Tip: The Seaplane is the fastest way to travel the map but requires significant resources. A motorcycle is the best early-game vehicle for solo players.`
  },

  economy: {
    title: "💰 Economy & Fame Points",
    color: 0xfbbf24,
    content: `**SCUM has two currencies: in-game cash (SCUM$) and Fame Points (FP).**

**Fame Points (FP)**
• Earned by surviving, killing enemies, completing quests, and entertaining the audience
• Used to respawn with gear instead of starting naked
• Can be deposited at banks (ratio 2:1 converted to cash)
• Starting players get 0 FP — building it up is a priority

**SCUM$ (In-Game Cash)**
• Used at traders to buy weapons, ammo, food, clothes, and special items
• Earned by selling loot to traders or depositing fame points at banks
• Players start fresh with nothing — loot and sell early to build funds

**Traders**
• Found at marked locations on the map (green circles on Cobblestone's map)
• Each trader specializes in different categories (armory, mechanic, hospital, saloon, etc.)
• Stock rotates and is affected by player supply and demand
• Trader zones are no-parking zones — 4 hour limit on this server

**Quests**
• Full quest system added in 1.0
• Complete missions for cash and FP rewards
• Types include: survival tasks, exploration, combat challenges
• Custom quests can also be created by server admins

**Tips for Making Money Fast**
• Loot military zones (carefully) — high-value weapons sell well
• Sell excess food and clothing rather than hoarding it
• Complete quests early for reliable income
• Group up to clear bunkers — better loot, better payout

> 💡 Tip: Once you have 15 FP, buy corn flakes and baked beans from a trader. They have excellent shelf life and nutrition for their cost.`
  },

  crafting: {
    title: "🎒 Crafting & Loot",
    color: 0x6366f1,
    content: `**SCUM's crafting system is deep. Most survival tools can be made from natural materials.**

**Opening the Craft Menu**
Press **C** to open the crafting menu. Items are organized by category. If you're missing a material, click the small arrows on each ingredient to see if there's an alternate material.

**Essential Early Crafts**
| Item | Materials Needed |
|---|---|
| Improvised Rope | 5 small sticks or plant fiber |
| Wooden Spear | 1 long stick |
| Improvised Backpack | Rags + rope |
| Stone Knife | Stone + small stick |
| Fire Ring | Stones |
| Improvised Oven | Stones + clay |
| Improvised Workbench | Wood planks + nails |

**Workbench** — required for more advanced crafting. Build one early.

**Crafting Tip — Alternate Materials**
If you need rope but don't have plant fiber, you can often tear your clothing into rags and make rope from those instead. Always check the alternate materials before going on a resource hunt.

**Loading Guns**
This trips up new players:
1. Drag bullets to the magazine first
2. Make sure the gun is in your hands
3. Drag the loaded magazine to the attachment slot on the gun

**Best Loot Locations**
• **Military zones** — best weapons and gear, guarded by Mechs
• **Bunkers** — excellent loot, requires key cards (B-class, A-class)
• **Hospitals** — medical supplies, medications
• **Mechanic shops / Garages** — vehicle parts, tools
• **Farms** — food, farming tools
• **Houses** — general loot, clothing, basic tools

**Key Cards**
Required to access bunkers. Found in restricted military zones. Rarity was increased in the latest patch so they're harder to find than before. A-class > B-class for loot quality.

> 💡 Tip: Cut long sticks into short sticks using an axe — you get more sticks per tree that way. Use short sticks for crafting and building.`
  },

  medical: {
    title: "🏥 Medical & Health",
    color: 0xf87171,
    content: `**Injuries in SCUM are detailed and can kill you slowly if untreated.**

**Common Injuries & Treatment**

**Bleeding**
• Caused by bullets, sharp melee, falls
• Treat with: Bandage, Gauze, Rags (in order of effectiveness)
• Always use clean bandages — dirty ones cause infection

**Fractures / Broken Bones**
• Caused by falls, vehicle crashes, heavy damage
• Symptoms: limping, reduced combat ability
• Treat with: Splint (improvised = sticks + rags)
• Allow time to heal — do not push a broken limb

**Infections**
• Caused by dirty bandages, untreated wounds, dirty water
• Symptoms: fever, weakness, slow deterioration
• Treat with: Antibiotics, Charcoal Tablets (for food poisoning)
• Prevention is easier than treatment — keep wounds clean

**Concussion**
• Caused by head trauma (hits, explosions)
• Symptoms: blurred vision, disorientation
• Treat with rest and painkillers

**Blood Loss**
• Severe bleeding left untreated leads to blood loss debuffs
• At critical levels you become incapacitated
• Another player can give you a blood transfusion if blood types match

**Broken Ribs**
• From heavy impacts
• Treat with: Bandage wrap + time
• Avoid heavy activity while healing

**Food Poisoning / Diarrhea**
• From rotten food, undercooked meat, dirty water
• Treat with: Charcoal Tablets
• Diarrhea creates noise — dangerous near enemies

**Medical Skill Tips**
• Higher medical skill = more efficient bandage use (uses less material per bandage)
• Treat other players' injuries to level up faster
• Keep a dedicated medical pouch with: bandages, antiseptic, antibiotics, splint materials

**CPR**
• If a teammate is downed but not yet dead, you can perform CPR to revive them
• Requires no materials — just proximity and the interaction prompt

> 💡 Tip: Always carry at least 5 bandages and a bottle of alcohol or antiseptic. Running out of medical supplies during a fight is a death sentence.`
  },

  map: {
    title: "🗺️ Map & Locations",
    color: 0x60a5fa,
    content: `**SCUM Island is massive — 144 square kilometres. Knowing the map is a survival skill.**

**Opening the Map**
Press **M** to open the map. Your position is shown if you have a compass or GPS device.

**Map Grid System**
The map is divided into lettered columns (A-H) and numbered rows (1-9). When calling out locations, use the grid reference — e.g. "B2", "D4".

**Key Location Types**

**🟢 Traders (Green circles on Cobblestone map)**
Safe zones where you can buy and sell. No PvP allowed. 4-hour parking limit.

**🟣 Bunkers (Purple on Cobblestone map)**
• Purple squares = Abandoned Bunkers
• Purple circles = All other bunkers (except WW2)
• Require key cards to access fully
• Best loot in the game — worth the risk

**⚪ Military Zones**
Patrolled by Mechs. High-risk, high-reward. Best source of weapons, ammo, and military gear.

**Settlements & Towns**
The map was fully reworked in 1.0. Towns contain houses with general loot and NPCs.

**🔵 Cobblestone Community Center (Blue on map)**
The server's community hub.

**🟡 Taxi Pickup Points (Yellow circles)**
Designated taxi pickup locations on this server.

**Radiation Zone**
Light blue square in the C0 sector on Cobblestone's map. Avoid without proper protection.

**Navigation Tips**
• Use **scummap.com** — interactive map with food, water, buildings, and POI locations
• Find a compass or GPS early — spawn areas are always confusing
• Mark your base on the map as soon as you build it
• Learn the river and road network — they're the fastest way to navigate on foot

> 💡 Tip: The island has natural springs (fresh water sources) scattered around. scummap.com marks them. Finding the nearest one to your base early saves a lot of time.`
  },

  bunkers: {
    title: "🔐 Running Bunkers — Stealth & Survival",
    color: 0x8b5cf6,
    content: `**Bunkers are the most rewarding PvE content in SCUM. Success requires stealth, patience, and the right tactics. Guns are loud and attract hordes — melee is your friend.**

**Before You Go In**
• **Get a Keycard** — Found in military zones, bunkers require keycards (A-class > B-class for better loot)
• **Bring a squad** — 2-3 players is ideal. Solo runs are possible but risky when things go wrong.
• **Pack light, pack smart:**
  - Melee weapon (sword or spear — your primary tool)
  - Secondary weapon (bow for ranged silent kills, gun only as last resort)
  - Minimal armor (mobility > protection in bunkers)
  - 2-3 bandages & first aid kit (you WILL take hits)
  - Food & water (bunker runs take time)
  - Flashlight or headlamp (bunkers are dark)
• **Leave at base:** Heavy armor, bulky gear, excess supplies — you need speed and stealth

**The Golden Rule: Stealth > Bullets**
• Guns are loud and attract puppet hordes. One gunshot = multiple puppets converging
• A silent melee kill on an isolated puppet costs nothing but gives you complete control
• Headshots with a sword are instant kills and completely silent
• Your goal: move through bunkers without alerting entire rooms

**Inside the Bunker**
• **Move slowly and crouch** — slower = quieter. Puppets have limited sound detection when you're moving carefully
• **Listen for threats** — puppets make noise when they detect you. If you hear growling, you're about to be rushed
• **Use doorways as choke points** — let puppets come to you one or two at a time through doors, not in open rooms
• **Pick off stragglers** — find isolated puppets and take them down silently with melee before engaging groups
• **Break line of sight immediately** — if spotted, get behind cover or a wall. Puppets lose track quickly
• **Stick together as a squad** — separated players get overwhelmed. Stay within eyesight of your team

**Combat When It Happens (You Tried to Avoid It)**
• **Use doorways to funnel** — puppets can only come through one at a time, letting you handle them individually
• **Headshots are most effective** — aim for the head every time, especially with melee
• **Aim for weak points** — some puppets (Razors) have a growth/baby on their back, critical damage target
• **Melee for conserving ammo** — if you have a sword and one puppet is nearby, use the sword. Save bullets for groups
• **Beepers are PRIORITY kills** — if you see a puppet with explosives, kill it at range IMMEDIATELY before it gets close. One detonation ruins everything

**Special Puppet Types & How to Handle Them**
**Armored Puppets:** Slower, tankier, resistant to bullets. Use melee headshots or high-damage strikes. Stay mobile.
**Razors:** Spider-like, extremely fast, climb walls. Move quietly to avoid triggering them. Shotgun or high-caliber weapon if you must fight. Target the growth on their back.
**Beepers/Exploders:** Emit beeping when they spot you and detonate. Kill at range with silent headshots before they close distance. If they're beeping, you have seconds.

**Loot Management**
• Sort loot by weight-to-value — leave heavy/cheap items behind
• Medical supplies and ammunition have high weight but are essential
• Weapons found inside bunkers are typically higher quality than external loot
• Don't get greedy — take what you can carry and move to the next room

**Exiting the Bunker**
• Plan your route out before you enter (bunkers can be maze-like)
• Clear your exit path on the way out — don't assume cleared rooms stay clear
• If surrounded, melee your way out or find an alternate route. Running in a straight line = getting shot in the back
• If a squad mate goes down, grab what they had and get out. Don't die trying to revive someone in an ambush

**Squad Bunker Tactics**
• **Assign roles** — one person watches angles while others loot
• **One clears, one loots** — while one player engages threats, the other grabs gear
• **Cover each other's six** — always have someone watching the entrance/rear
• **Communication is critical** — call out puppet locations and threats
• **Split loot fairly after** — preset rules before entering (who takes weapons, who takes ammo, who takes medical)

**Key Differences: Standard vs Abandoned Bunkers**
• **Standard bunkers:** Medium difficulty, good loot, manageable puppet count. Great for mid-game
• **Abandoned bunkers:** Extreme difficulty, excellent loot, many more puppets + special dangerous types. Late-game only with high-tier gear

**Pro Tips**
• Bring fuses for abandoned bunkers (needed to power doors)
• Use lock picks and screwdrivers for chests and containers
• Deeper levels usually have better loot but more dangers
• Check under beds, inside lockers, and behind furniture for hidden stashes
• Remember: A successful bunker run where everyone survives beats a failed run where someone dies

> 💡 Tip: Start with hidden/secret bunkers — they're easier, lower puppet count, and great for learning bunker mechanics. Work your way up to standard bunkers, then abandoned bunkers once you're geared and skilled.`
  },

  npcs: {
    title: "🧑‍💼 Surviving NPCs — Tactical Encounters",
    color: 0xec4899,
    content: `**Armed NPCs are intelligent, adaptive enemies. They're dangerous but killable — and their loot is worth the risk. Here's how to survive encounters and come out with gear.**

**How NPCs Behave**
• **They learn from your tactics** — if you keep flanking left, they'll expect it. Change it up constantly
• **They communicate** — if one spots you, nearby NPCs know and converge on your position
• **They use cover and teamwork** — they're not mindless. They actually think tactically
• **They have valuable loot** — weapons, ammunition, armor. That's why they're worth engaging
• **They patrol in groups** — rarely solo. Usually 2-4 per patrol. Know before you engage

**Detection & Avoiding Unnecessary Combat**
• **Crouch walking reduces detection range** — NPCs have narrower sight lines when you're moving slowly and quietly
• **Stay out of direct sight lines** — they spot movement before still targets
• **Use terrain to your advantage** — buildings, hills, dense vegetation all hide you
• **Break line of sight immediately** — if spotted, get behind cover fast. Distance or obstacles muffle sounds and break tracking
• **Scout before engaging** — know how many NPCs, where they are, what weapons they have

**When You Decide to Engage**
• **Never attack head-on** — flanking is always better than direct assault
• **Use cover constantly** — never run across open areas. Bound from cover to cover
• **Pick your engagement range:**
  - **Long range (200+ meters):** Scoped rifle, take your time with shots, they can't hear precision fire from far away
  - **Medium range (50-200m):** Rifle with controlled bursts, use cover aggressively, suppress and maneuver
  - **Close range (under 50m):** High-caliber weapons or shotgun, but NPCs will suppress you

**Suppression & Movement Tactics**
• **Suppressed weapons are critical** — they don't pinpoint your location easily
• **Fire 2-3 shots to suppress** then shift position immediately. Static = dead
• **NPCs suppress each other** — use their confusion to advance or flank
• **Never reload in the open** — find cover first, always
• **Use their own suppression against them** — while one is pinned down, flank with your squad

**When You're Outgunned (Know When to Leave)**
• **Retreat immediately** — no shame in living to fight another day
• **Have an escape route planned before engaging** — know which direction you're running
• **Use terrain to slow them** — dense vegetation, hills, water slow pursuit
• **Head toward your squad** — isolated NPCs fight worse against groups they didn't expect
• **Regroup and reassess** — maybe you come back with better gear or more people

**Equipment Advantage Matters**
• **Body armor is critical** — absorbs hits that would one-shot you
• **Helmets reduce headshot damage significantly** — you'll take more hits to head
• **Suppressors on your weapon** — quieter shots, harder to locate you
• **Better weapons = faster kills** — higher caliber = more stopping power
• **Medical supplies before engaging** — always stock up before an NPC encounter

**Squad NPC Combat**
• **Assign targets** — focus fire eliminates NPCs faster than divided attention
• **One person suppresses** while others flank or advance
• **Stay in communication** — call out threats and positions constantly
• **Stick together** — separated squad members get isolated and eliminated
• **Plan extraction before combat starts** — know your exit route, regroup point, backup plan
• **Cover angles** — while one player loots, another watches for reinforcements

**Looting NPC Corpses**
• **Clear the entire area first** — multiple NPC patrols in one zone are common
• **Check ammo before engaging more NPCs** — you may need what they dropped
• **Leave your teammate covering while you loot** — never loot without security
• **Swap damaged gear for better drops** — only take upgrades to save inventory space
• **Watch for reinforcements** — NPC bases send patrols. Don't camp the corpse

**When NOT to Engage NPCs**
• **You're solo and outnumbered** — 2v1 is rough, 3v1 is suicide
• **You're low on ammo or health** — retreat, heal up, restock, come back
• **You don't know their squad size** — scout first, always
• **Near their base or patrol depot** — reinforcements incoming, not worth the risk
• **The loot isn't worth your life** — you can't spend gear if you're dead

**NPC Hot Zones (Avoid or Prepare Heavily)**
• **Military camps** — highest concentration of armed NPCs, best loot
• **Bunker entrances** — NPCs sometimes guard them, high-value objectives
• **Trader routes** — patrols moving between locations, usually smaller groups
• **Research facilities** — heavily defended with multiple NPCs coordinating
• **Radio towers** — communication hubs with dedicated guards

**Learning from Deaths & Failures**
• **NPCs adapt if you use the same tactics twice** — change it up every encounter
• **Watch how they move and coordinate** — steal their strategies for your squad
• **Learn their patrol routes** — timing helps you avoid or set up ambushes
• **Note their equipment** — knowing what they have helps you prepare and counter
• **Share intel with squad** — if you died, tell your team what you learned

**Difference Between Avoiding & Engaging**
Your choice depends on **gear level, squad size, and situation:**
• **Early game:** Avoid NPCs entirely. You don't have the gear or experience
• **Mid-game:** Engage small NPC patrols (1-2) with squad, not solo
• **Late-game:** Hunt NPC patrols for loot. You have the weapons and experience
• **Always:** Fight on your terms, not theirs. If it's a bad situation, leave

> 💡 Tip: NPC encounters are learning opportunities. Your first 3-5 encounters, focus on survival and observation. Learn how they think, how they react, where they patrol. Then hunt them with that knowledge. Patience beats impatience against intelligent enemies.`
  }
}

// ─── Post guide panel ─────────────────────────────────────────────────────────
async function postGuidePanel(channel) {
  const embed = new EmbedBuilder()
    .setTitle("📖 Cobblestone SCUM Guide")
    .setDescription(
      "New to SCUM or need a refresher? Click any topic below to get detailed information.\n\n" +
      "All responses are private — only you will see them.\n\n" +
      "**Updated for SCUM v1.2 — May 2026**"
    )
    .setColor(0xc8a04a)
    .addFields(
      { name: "🎯 Getting Started", value: "First 30 minutes survival", inline: true },
      { name: "💪 Character Creation", value: "Attributes & skills explained", inline: true },
      { name: "🧬 Metabolism", value: "The body system", inline: true },
      { name: "⚔️ Combat", value: "Puppets, Mechs, NPCs, players", inline: true },
      { name: "🏗️ Base Building", value: "Shelter & fortification", inline: true },
      { name: "🚗 Vehicles", value: "Transport & server rules", inline: true },
      { name: "💰 Economy", value: "Cash, fame points & traders", inline: true },
      { name: "🎒 Crafting & Loot", value: "What to make & where to find it", inline: true },
      { name: "🏥 Medical", value: "Injuries & treatment", inline: true },
      { name: "🗺️ Map", value: "Locations & navigation", inline: true },
      { name: "🔐 Bunkers", value: "Running bunkers & loot tactics", inline: true },
      { name: "🧑‍💼 NPCs", value: "Combat strategy against armed NPCs", inline: true },
    )
    .setFooter({ text: "Cobblestone SCUM Server • Player Guide" });

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("guide_start").setLabel("Getting Started").setStyle(ButtonStyle.Primary).setEmoji("🎯"),
    new ButtonBuilder().setCustomId("guide_character").setLabel("Character Creation").setStyle(ButtonStyle.Primary).setEmoji("💪"),
    new ButtonBuilder().setCustomId("guide_metabolism").setLabel("Metabolism").setStyle(ButtonStyle.Primary).setEmoji("🧬"),
    new ButtonBuilder().setCustomId("guide_combat").setLabel("Combat").setStyle(ButtonStyle.Danger).setEmoji("⚔️"),
    new ButtonBuilder().setCustomId("guide_base").setLabel("Base Building").setStyle(ButtonStyle.Secondary).setEmoji("🏗️"),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("guide_vehicles").setLabel("Vehicles").setStyle(ButtonStyle.Secondary).setEmoji("🚗"),
    new ButtonBuilder().setCustomId("guide_economy").setLabel("Economy").setStyle(ButtonStyle.Success).setEmoji("💰"),
    new ButtonBuilder().setCustomId("guide_crafting").setLabel("Crafting & Loot").setStyle(ButtonStyle.Secondary).setEmoji("🎒"),
    new ButtonBuilder().setCustomId("guide_medical").setLabel("Medical").setStyle(ButtonStyle.Danger).setEmoji("🏥"),
    new ButtonBuilder().setCustomId("guide_map").setLabel("Map").setStyle(ButtonStyle.Primary).setEmoji("🗺️"),
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("guide_bunkers").setLabel("Bunkers").setStyle(ButtonStyle.Danger).setEmoji("🔐"),
    new ButtonBuilder().setCustomId("guide_npcs").setLabel("NPCs").setStyle(ButtonStyle.Danger).setEmoji("🧑‍💼"),
  );

  await channel.send({ embeds: [embed], components: [row1, row2, row3] });
}

// ─── Handle guide button clicks ───────────────────────────────────────────────
async function handleGuideButton(interaction) {
  if (!interaction.customId.startsWith("guide_")) return false;

  const topic = interaction.customId.replace("guide_", "");
  const data  = GUIDE[topic];

  if (!data) return false;

  const embed = new EmbedBuilder()
    .setTitle(data.title)
    .setDescription(data.content)
    .setColor(data.color)
    .setFooter({ text: "Cobblestone SCUM Server • Player Guide | Updated v1.2 May 2026" });

  await interaction.reply({ embeds: [embed], ephemeral: true });
  return true;
}

module.exports = { postGuidePanel, handleGuideButton };
