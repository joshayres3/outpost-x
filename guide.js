const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

async function postHelpPanel(channel) {
  const embed = new EmbedBuilder()
    .setTitle("📚 Outpost X Player Help Center")
    .setDescription("Complete survival guides for Outpost X PvE")
    .setColor(0xd4a574)
    .addFields(
      { name: "🎯 Getting Started", value: "First steps & character setup", inline: true },
      { name: "⚙️ Game Mechanics", value: "Metabolism & health systems", inline: true },
      { name: "🏗️ Base Building", value: "Base design & placement", inline: true },
      { name: "💰 Crafting & Looting", value: "Craft advanced items & loot effectively", inline: true },
      { name: "⚔️ Combat & Weapons", value: "Weapons, combat tips & stealth", inline: true },
      { name: "🚗 Vehicles", value: "Finding & using vehicles", inline: true },
      { name: "🍖 Food & Nutrition", value: "Metabolism & optimal diet", inline: true },
      { name: "⚕️ Health & Medical", value: "Staying alive & wound treatment", inline: true },
      { name: "👥 Multiplayer Tips", value: "Surviving with other players", inline: true },
    )
    .setFooter({ text: "Outpost X Help | PvE Survival Guide" });

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("help_start").setLabel("Getting Started").setStyle(ButtonStyle.Primary).setEmoji("🎯"),
    new ButtonBuilder().setCustomId("help_mechanics").setLabel("Mechanics").setStyle(ButtonStyle.Secondary).setEmoji("⚙️"),
    new ButtonBuilder().setCustomId("help_building").setLabel("Base Building").setStyle(ButtonStyle.Secondary).setEmoji("🏗️"),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("help_crafting").setLabel("Crafting & Loot").setStyle(ButtonStyle.Secondary).setEmoji("💰"),
    new ButtonBuilder().setCustomId("help_combat").setLabel("Combat").setStyle(ButtonStyle.Secondary).setEmoji("⚔️"),
    new ButtonBuilder().setCustomId("help_vehicles").setLabel("Vehicles").setStyle(ButtonStyle.Secondary).setEmoji("🚗"),
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("help_nutrition").setLabel("Food & Nutrition").setStyle(ButtonStyle.Secondary).setEmoji("🍖"),
    new ButtonBuilder().setCustomId("help_health").setLabel("Health & Medical").setStyle(ButtonStyle.Secondary).setEmoji("⚕️"),
    new ButtonBuilder().setCustomId("help_multiplayer").setLabel("Multiplayer").setStyle(ButtonStyle.Secondary).setEmoji("👥"),
  );

  await channel.send({ embeds: [embed], components: [row1, row2, row3] });
}

// Detailed help content
const HELP = {
  start: {
    title: "🎯 Getting Started on Outpost X",
    color: 0x3498db,
    content: `**First Steps for New Players:**

**INITIAL SPAWN:**
• Survive your first landing - avoid loud areas with Puppets/Zombies
• Immediately gather rocks from the ground
• Craft a Stone Knife (vital early tool)

**FIRST HOUR PRIORITIES:**
1. **Find water** - Look for streams, lakes, or natural springs on the map (use scum-map.com)
2. **Gather food** - Hunt animals or find berries, mushrooms, canned goods
3. **Build a campfire** - Process meat and cook water for drinking
4. **Craft basic tools** - Stone Knife, Stone Axe, Wooden Spear
5. **Find shelter** - Locate a house or build a camp before dark

**CHARACTER SETUP:**
• Strength & Constitution = Carry capacity & damage reduction
• Dexterity = Movement speed & aim precision
• Intelligence = Crafting recipes & awareness
• Survival skill = Critical for early game equipment crafting

**LEARNING THE MENUS:**
• **Tab** = Metabolism (health, vitamins, calories)
• **I** = Inventory (manage gear)
• **C** = Crafting menu (huge - learn it fast!)
• **M** = Map (shows POIs, resources, water)
• **Right Click** = Focus Mode (better aiming, shows compass at high Awareness)

**EARLY GAME TIPS:**
• Move slowly - running attracts Puppets and wastes energy
• Avoid bright orange prison clothes (change them immediately)
• Use stealth in towns and POIs with zombies
• Keep your survival knife - it's multi-purpose (fire, compass, processing)
• Save frequently at your camp

💡 **Pro Tip:** Spend 2-3 hours in Sandbox mode learning the mechanics before joining a real server!`
  },

  mechanics: {
    title: "⚙️ Game Mechanics Deep Dive",
    color: 0x9b59b6,
    content: `**METABOLISM SYSTEM (The Key to Everything):**

Your body is simulated in detail. Managing it is survival:

• **Calories** = Energy for actions. Burning = stamina drain, running, combat
• **Hydration** = Water level in your body (separate from thirst)
• **Vitamins** = A, B, C, D. Missing vitamins = slow health degradation
• **Proteins** = Muscle repair. Needed for carry capacity
• **Fats** = Long-term energy storage
• **Carbs** = Quick energy burst

**BODY COMPOSITION:**
• Affects metabolism rate - muscle burns more calories, fat survives longer
• Affects your stamina and speed
• Monitor in the BCU (Bio Control Unit) tab

**KEY STAT SYSTEM:**
Attributes govern skills that level with use:
• **Strength** = Melee damage, carrying capacity
• **Constitution** = Health pool, disease resistance
• **Dexterity** = Movement speed, aim precision, reload speed
• **Intelligence** = Crafting recipes unlocked, awareness radius

Skills improve faster when well-rested and fed - maintain your body!

**FOCUS MODE:**
• Right-click to enter Focus Mode (better aiming)
• High Awareness skill shows you a compass at top
• Helps with precision shooting at Puppets/NPCs

**INVENTORY & ENCUMBRANCE:**
• You have weight limits based on Strength
• Over capacity = slower movement, stamina drain
• Equipment durability matters - maintain your gear

**STAMINA & FATIGUE:**
• Running depletes stamina quickly
• Exhaustion reduces damage dealt and increases food burning
• Rest in shade or sleep to recover

💡 **Critical:** Your metabolism affects EVERYTHING. Food, nutrition, rest = power!`
  },

  building: {
    title: "🏗️ Base Building Guide",
    color: 0xe74c3c,
    content: `**BASE BUILDING ESSENTIALS:**

**WHAT YOU NEED:**
1. **Foundation** - Level terrain, place wooden/metal foundation
2. **Walls** - Vertical barriers for protection (upgrade from wood to metal)
3. **Doors & Windows** - Access points (lock them!)
4. **Roof** - Protection from elements and observers
5. **Storage** - Chests, crates, safes for items
6. **Crafting Stations** - Workbench, stove, furnace

**WHERE TO BUILD:**

✅ **SAFE LOCATIONS:**
• Off roads and away from settlements
• At least 100 meters from POIs (Points of Interest)
• Not blocking rivers or important paths
• Elevated terrain (harder to raid)
• Near water sources and resources

❌ **FORBIDDEN AREAS:**
• On roads or bridges
• Blocking rivers (boats need passage!)
• Within 100m of POIs or settlements
• Exploit bases or unreachable locations
• Structures abusing game mechanics

**MATERIALS & DURABILITY:**
• **Wood** = Quick to build, low durability, loud to breach
• **Stone** = Medium durability, moderate build time
• **Metal** = High durability, expensive, time-consuming

**SECURITY TIPS:**
• Multiple layers of doors = slower breaches
• Hidden rooms for valuables
• Spike traps at entrances (requires Demolition skill)
• Keep valuable items in safes
• Don't store everything in one place

**EXPANSION:**
• Start small, expand carefully
• Plan layout for efficiency (crafting near storage)
• Build multiple storage areas to distribute loot
• Create hidden exits for emergency escape

**STAFF RULES:**
Staff can remove bases that:
• Break building rules
• Block the map for other players
• Cause server issues
• Use exploit mechanics

**Base Progression:**
1. Small wooden shack (early game)
2. Expanded wooden base (mid game)
3. Mixed wood/metal (late game)
4. Full metal fortress (endgame, rare)

💡 **Pro Tip:** Build near multiple water sources and loot spawns. Ask staff if unsure about location!`
  },

  crafting: {
    title: "💰 Crafting & Advanced Looting",
    color: 0xf39c12,
    content: `**CRAFTING SYSTEM BASICS:**

Press **C** to open crafting menu. The menu is HUGE but essential:

**TIER 1 CRAFTING (First Day):**
• Stone Knife (rocks + stick)
• Stone Axe (rock + stick + fiber)
• Wooden Spear (sticks + fiber)
• Wooden Bow (sticks + fiber)
• Backpack (cloth + rope)
• Fire (use survival knife with flint + steel)

**TIP:** Left side of crafting menu shows alternative materials!

**KEY INTERMEDIATE ITEMS:**
• **Soda Can Suppressor** - Reduces gunshot noise (craft early!)
• **Lockpick** - Required for locked doors & containers
• **Rope** - Essential for many crafts
• **Nails/Screws** - Building materials (scavenge from houses)
• **Clean Rags** - Wound patching (clean clothes cut into rags)

**ADVANCED CRAFTING (Late Game):**
• Ammunition (requires gunpowder, different for each caliber)
• Traps & explosives (Demolition skill required)
• Advanced weapons (metal components + blueprints)
• Vehicle repairs (Engineering skill required)

**LOOTING STRATEGY:**

**CIVILIAN ZONES (Safer):**
• Towns, houses, shops
• Lower tier loot but reasonable
• Start here - learn Puppet behavior
• Avoid nighttime, use stealth

**MILITARY ZONES (High Reward, High Risk):**
• Military bases, barracks, bunkers
• Best weapons, armor, attachments
• HEAVILY guarded by Puppets & Mechs
• Go in squads, bring suppressed weapons
• Loot marked on scum-map.com

**LOOT PRIORITY:**
1. Weapons (upgrade from bow to rifle ASAP)
2. Ammo & suppressors (critical for safety)
3. Medical supplies (bandages, antibiotics)
4. Tools & components (for crafting/repairs)
5. Food & water (always grab food)

**WEAPON PROGRESSION:**
• Early: Wooden bow (silent, effective)
• Mid: Rifles (AK family most accessible)
• Late: Military rifles (M16, M24, etc.)

**SUPPRESS YOUR WEAPONS:**
• Unsuppressed shots attract Puppet hordes
• Suppressed pistols heard within 30m
• Suppressed rifles heard within 60-120m
• Bow with silencer = most silent option

💡 **Golden Rule:** Many items have alternative crafting materials. Experiment with the arrows in crafting menu!`
  },

  combat: {
    title: "⚔️ Combat & Weapons",
    color: 0xc0392b,
    content: `**COMBAT FUNDAMENTALS:**

**WEAPONS PROGRESSION:**

1. **Early Game (First Day):**
   • Wooden Spear - Against animals & weak Puppets
   • Wooden Bow - Silent, effective, uses regular arrows
   • Stone Knife - Last resort, also crafting tool

2. **Mid Game (Week 1-2):**
   • Pistols (9mm, .45) - Decent stopping power
   • Bolt-action rifles (Mosin, M24) - One-shot kills, loud
   • SMGs (MP5) - Fast-fire, controllable

3. **Late Game (Week 3+):**
   • Assault rifles (AK, M16) - Best all-arounder
   • Sniper rifles (M24, M107) - One-shot elimination
   • Military gear (NATO/Russian)

**STEALTH IS KING:**

In PvE, avoid combat entirely:
• Use a soda can suppressor on all guns
• Headshots = instant kills, less noise
• Stealth melee = silent elimination
• Hide bodies to avoid alerting others
• Use bushes, buildings, darkness

**FOCUS MODE AIMING:**
• Right-click to enter Focus Mode
• Better accuracy for ranged weapons
• Steady aim by holding still
• Works with bows, guns, spears

**SUPPRESSION MECHANICS:**
• Unsuppressed weapons are LOUD
• Every shot alerts nearby Puppets
• Horde can be called by single Puppet
• Hordes = death for most players

**AMMUNITION:**
• Different calibers for different weapons
• Craft ammo with gunpowder + components
• 9mm, 5.56, 7.62, .45, .308 most common
• Always carry extra ammo

**COMBAT AGAINST PUPPETS:**
• Headshots = 1 hit kill (usually)
• Body shots = 3-5 shots to kill
• Use cover - they return fire!
• Melee = risky but silent
• Retreat if overwhelmed

**COMBAT TACTICS:**
• Never fight directly (you'll lose)
• Use cover and distance
• Aim for the head
• Use suppressors ALWAYS
• Retreat > Die every time
• Use traps if you must defend base

**AVOIDING COMBAT (Best Strategy):**
• Move slowly, attract no attention
• Avoid NPCs (military, bandits)
• Avoid zombie spawns
• Use back roads and stealth routes
• Scout locations before entering
• Listen for sounds before advancing

**DAMAGE & INJURY:**
• Bullet wounds require bandages
• Infections require antibiotics
• Bleeding causes health drain
• Fractures limit movement
• Treat injuries immediately

💡 **Pro Combat Tip:** The best fight is the one you avoid. Stealth and silence = survival!`
  },

  vehicles: {
    title: "🚗 Vehicles Guide",
    color: 0x2ecc71,
    content: `**FINDING VEHICLES:**

Use **scum-map.com** to locate vehicle spawns:
• Mark locations on your map
• Multiple vehicle types at each spawn
• Check which vehicles spawn where

**VEHICLE TYPES:**

**Civilian Vehicles (Easy):**
• Mountain Bike - Fast, quiet, no fuel needed
• Cars (Sedan, SUV) - Medium speed, requires fuel
• Trucks - Slow, heavy carry capacity

**Military Vehicles (Dangerous):**
• Humvee - Heavy armor, fast, hard to find
• Jeep - Light, maneuverable, rare
• Tank - Extremely rare, military spawn only

**CLAIMING A VEHICLE:**

1. **Push it off spawn point** - Multiple vehicles at same spot, push off to clear
2. **Clear Puppets** - Kill nearby zombies first
3. **Loot components** - Find keys, fuel, parts
4. **Build the vehicle** - Combine components to make it operational
5. **Lock it** - Once built, lock to prevent theft

**VEHICLE MAINTENANCE:**

• **Fuel** - Gasoline or diesel depending on vehicle
• **Oil & Filters** - Regular maintenance extends life
• **Battery** - Required to start, can degrade
• **Tires** - Repair if damaged before long trips
• **Radiator** - Prevent overheating on hills

**STEALING VEHICLES:**
• Requires lockpick (craft it)
• Risky - owner might defend
• Use as raiding tool if desperate
• Remember: "Kill on sight" rule

**VEHICLE COMBAT:**
• Drive-bys with rifles (dangerous, hard)
• Ram enemies (risky, damages vehicle)
• Escape routes (use vehicles to flee)
• Don't rely on vehicles for combat

**PARKING TIPS:**
• Park away from POIs & settlements
• Hidden locations = longer survival
• Some servers limit parking zones
• Don't leave unattended (can get stolen)
• Keep gas in storage for later

**VEHICLE PROGRESSION:**
• Mountain Bike → Car → Truck → Military Vehicle
• Each tier is faster, stronger, needs more fuel
• Endgame = Military Humvee with armor

**FUEL STRATEGY:**
• Keep spare fuel in base (in containers!)
• Long trips = plan fuel stops
• Military bases have fuel caches
• Trade for fuel with other players if needed

💡 **Vehicle Pro Tip:** A hidden mountain bike beats a visible military truck. Speed isn't everything!`
  },

  nutrition: {
    title: "🍖 Food & Nutrition System",
    color: 0xd4a574,
    content: `**METABOLISM & CALORIE SYSTEM:**

Your body burns calories with every action:
• **Running** = High calorie burn (avoid!)
• **Walking** = Moderate burn
• **Standing** = Low burn
• **Resting** = Minimal burn

Keep calories balanced: eaten ≈ burned

**OPTIMAL FOODS FOR OUTPOST X:**

**THE MIRACLE DIET (Beans, Corn Flakes, Mushrooms):**
Combining these 3 provides:
• Complete proteins (muscle maintenance)
• Full carbs & energy (no exhaustion)
• Essential vitamins (prevents deficiency)
• Hydration (drink less often)
• You'll almost never need healing!

This is THE recommended diet - use it.

**FOOD CATEGORIES:**

**Proteins** (Muscle, Carry Capacity):
• Meat (cooked) - Best source
• Fish - Good alternative
• Eggs - Easy to cook
• Beans - Plant-based protein

**Carbs** (Quick Energy):
• Corn Flakes - Easy nutrition
• Bread - Common loot
• Fruits (apples, bananas)
• Vegetables (carrots, potatoes)

**Fats** (Long-term Energy):
• Nuts - Often looted
• Animal fat - From hunting
• Cooking oil - Used in recipes

**Vitamins** (Health Maintenance):
• Mushrooms - Multiple vitamins
• Greens (spinach, lettuce)
• Fruits - Especially citrus
• Vitamin supplements (rare)

**WATER & HYDRATION:**

Your character needs water just like food:
• Natural springs (map shows these)
• Boiled water (cook at fire)
• Rainwater collection (build barrel)
• Purification tablets (craft or loot)

**Dehydration = Health drain** - Stay hydrated!

**COOKING:**
• Boil meat at fire (prevents disease)
• Cook multiple items at once
• Store cooked food in base
• Cooked meat lasts longer than raw

**HUNTING ANIMALS:**
• Spear = easiest early weapon
• First-person aiming helps
• Aim for head/heart for quick kills
• Butcher with survival knife
• Get multiple meat steaks per animal

**EATING STRATEGY:**
• Eat little and often (don't wait until hungry)
• Carry beans + corn flakes + mushrooms
• Eat before combat (better performance)
• Rest in shade after eating (faster digestion)
• Monitor metabolism tab regularly

**BODY WEIGHT EFFECTS:**
• Muscular = Higher damage, higher metabolism (burns more)
• Fat = Lasts longer without food, slower
• Find balance for your playstyle

**DISEASE & POISONING:**
• Eat uncooked meat = risk of parasites
• Drink dirty water = sickness
• Illness causes health drain
• Antibiotics cure infections
• Prevention = cook & boil

**ADVANCED NUTRITION:**
Monitor the Metabolism tab (Tab → Metabolism) for:
• Specific vitamin levels (A, B, C, D)
• Macronutrient balance
• Calorie deficit/surplus
• Digestion progress

When you eat, it takes time to digest through:
Stomach → Intestines → Colon → Absorbed!

💡 **Golden Nutrition Rule:** Beans + Corn Flakes + Mushrooms = Complete survival! Learn this combo!`
  },

  health: {
    title: "⚕️ Health & Medical System",
    color: 0xe67e22,
    content: `**HEALTH MECHANICS:**

Your health is tracked in detail (Tab → Health):

**VITAL SIGNS TO MONITOR:**
• **Blood Pressure** - Normal is good, high = bad
• **Heart Rate** - Should be 60-100 resting
• **Body Temperature** - 37°C is normal
• **Health % - Don't let it drop below 50%!

**INJURIES & TREATMENT:**

**BLEEDING:**
• Clean Rags patch wounds immediately
• Dirty rags DON'T work - must be clean!
• Cut clean clothes into rags
• Stop bleeding before it kills you

**FRACTURES:**
• Splints immobilize broken limbs
• Limits movement speed temporarily
• Rest to heal fractures
• Medical skill helps (use bandages+splint)

**INFECTIONS:**
• Untreated wounds = infection risk
• Antibiotics cure infections
• Infections cause fever & health drain
• Untreated = death

**DISEASES:**
• Eating uncooked meat = parasites
• Dirty water = dysentery
• Cold/wet = hypothermia
• Cure with appropriate medicine

**MEDICAL SUPPLIES PRIORITY:**
1. **Bandages** - Most important, common
2. **Antibiotics** - Prevent infections
3. **Morphine** - Pain relief, prevents shock
4. **Medical Kits** - Full healing (rare)
5. **Splints** - For fractures
6. **Vitamins** - Prevent deficiencies

**HEALING STRATEGIES:**

**Early Game:**
• Eat well (best healer)
• Rest in safe location
• Use bandages for bleeding only
• Antibiotics for infections

**Late Game:**
• Medical Skill unlocks advanced treatment
• Use medical kits for rapid healing
• Morphine for emergency situations
• Sleep to natural heal

**REST & RECOVERY:**
• Sleep restores significant health
• Building at night = faster healing
• Resting in shade during day = slow healing
• Being sick slows recovery

**DISEASE PREVENTION:**
• Cook ALL meat before eating
• Boil or purify water only
• Wear appropriate clothing for weather
• Stay dry (moisture = illness risk)
• Maintain nutrition (improves immunity)

**TEMPERATURE MANAGEMENT:**

**Too Cold:**
• Hypothermia develops slowly
• Wear warm clothing
• Build fires, camp indoors
• Coats, jackets, military gear help

**Too Hot:**
• Heat exhaustion = stamina drain
• Avoid sun exposure
• Wear light clothing
• Rest in shade

**COMBAT INJURIES:**
• Gunshot wounds bleed badly
• Apply bandages immediately
• Use antibiotics if available
• Medical Kit = full restoration (rare)

**POISONING:**
• Bad water causes sickness
• Bad food causes parasites
• Symptoms appear in Metabolism tab
• Antibiotics cure most poisons

**ADVANCED MEDICAL:**
With high Medical skill:
• Bone setting for fractures
• Disease diagnosis & treatment
• Faster healing with items
• Can treat other players

**PREVENTION IS KEY:**
• Stealth = no injury risk
• Proper nutrition = better healing
• Hygiene = less disease
• Preparation = survival

💡 **Medical Golden Rule:** Bandages + Food = Survival. Keep both in your inventory!`
  },

  multiplayer: {
    title: "👥 Multiplayer Tips & Safety",
    color: 0x16a085,
    content: `**MULTIPLAYER REALITY CHECK:**

Welcome to the server. A few truths:

1. **Trust No One** - Other players WILL kill you
2. **Your stuff can be stolen** - Lock everything
3. **Betrayal happens** - Often at crucial moments
4. **Teamwork is rare** - Most play solo/small squads
5. **Raiding is real** - Your base can be attacked

**SURVIVAL TIPS:**

**HIDE YOUR BASE:**
• Build in remote locations (off map)
• Use natural cover (forest, mountains)
• Multiple hidden exits for escape
• Don't broadcast your location in chat
• Vary your routine/arrival times

**HIDE YOUR LOOT:**
• Never carry entire inventory openly
• Split loot between multiple bases
• Use hidden rooms/safe locations
• Some valuable items = backpack bait

**AVOID PLAYERS:**
• Stay away from popular looting spots
• Hunt at odd hours (server quiet times)
• Use back roads, not main paths
• Listen for gunshots = danger zone
• If you see a player, assume hostile

**PLAYER INTERACTIONS:**

**Safe Interactions:**
• Trading in well-lit neutral areas
• Small trades (not valuable items)
• With known players (reputation)
• Near witnesses (other players watching)

**Dangerous Interactions:**
• Remote locations (high rob/kill risk)
• Trading rare weapons/gear
• Solo vs multiple players
• Low-visibility areas

**KILL ON SIGHT (KOS) MENTALITY:**
Some servers/players practice KOS:
• Shoot first, loot later
• No questions, no mercy
• Assume everyone is a threat
• Defend your camp immediately

**TEAM PLAY (If You Squad):**
• Communicate constantly
• Cover each other's backs
• Split resources fairly
• Watch for squad betrayal

**SQUAD DYNAMICS:**
• Small squads (2-4) = most effective
• Larger groups = attract attention
• Trust-building takes time
• Allies > Solo, but risky

**SERVER ETIQUETTE:**
• Don't spam chat (staff warning)
• Report cheaters/glitchers
• Respect base proximity rules
• Follow server raid windows (if any)
• Don't grief excessively

**COMMUNICATION:**
• Use Discord for team coordination
• Voice chat for combat
• Text for planning/logistics
• Be respectful (no racism/harassment)

**RAIDING & DEFENSE:**

**If You Get Raided:**
• Expect to lose base & loot
• Emergency supplies hidden elsewhere
• Retreat & rebuild mentality
• Learn from the raid

**If You Want to Raid:**
• Scout target base first
• Plan timing & approach
• Bring proper tools (lockpicks, explosives)
• Have exit route planned
• Team of 3-4+ minimum
• Expect counter-raid response

**AVOIDING RAIDS:**
• Hide base location (most important)
• Multiple storage areas (split loot)
• Strong construction (slow breaches)
• Spike traps at entrance
• Play times when no one raids

**REPUTATION:**
• Good players get traded with
• Killers get targeted
• Thieves get hunted
• Helpful players = allies

**SERVER POLITICS:**
• Power alliances form
• Grudges last weeks
• Revenge raids happen
• Staff mediate disputes (sometimes)

**FINAL MULTIPLAYER RULE:**

Play like everyone is a threat. Because they are.

But find 1-2 trusted teammates and survival becomes possible.

💡 **Multiplayer Pro Tip:** Your best defense isn't walls - it's being unknown. Anonymity = survival!`
  },
};

async function handleHelpButton(interaction) {
  if (!interaction.customId.startsWith("help_")) return false;

  const topic = interaction.customId.replace("help_", "");
  const data  = HELP[topic];

  if (!data) return false;

  const embed = new EmbedBuilder()
    .setTitle(data.title)
    .setDescription(data.content)
    .setColor(data.color)
    .setFooter({ text: "Outpost X Help Center | Created 2026" });

  await interaction.reply({ embeds: [embed], ephemeral: true });
  return true;
}

module.exports = { postHelpPanel, handleHelpButton };
