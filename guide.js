const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require("discord.js");

const GUIDE_SECTIONS = {
  first30: {
    emoji: "🎯",
    title: "First 30 Minutes",
    goal: "Get stable before chasing high-tier loot.",
    doFirst: [
      "Do not sprint everywhere. Save stamina for escape.",
      "Check your BCU/metabolism before blaming the island.",
      "Find small stones and craft a stone knife.",
      "Cut bushes for sticks and craft a starter weapon.",
      "Make rags/bandages before entering towns.",
      "Find water before chasing guns.",
      "Loot small towns, farms, and isolated buildings before military POIs.",
      "Make a small stash if you are overloaded.",
    ],
    lookFor: [
      "Small stones",
      "Sticks",
      "Rags/bandages",
      "Food and water",
      "Backpack or clothing with storage",
      "Basic melee weapon",
    ],
    avoid: [
      "Running straight into bunkers or military areas.",
      "Carrying every item you see.",
      "Entering POIs with no bandages and no stamina.",
    ],
    note: "Early SCUM is not about being rich. It is about being hard to kill."
  },

  build: {
    emoji: "🧍",
    title: "Character Build",
    goal: "Create a forgiving character that can survive mistakes.",
    doFirst: [
      "Balanced attributes are easier for new players than extreme builds.",
      "Strength helps melee damage and carrying.",
      "Constitution helps running, endurance, and travel.",
      "Dexterity helps movement, stealth, and thievery style play.",
      "Intelligence supports medical and utility skills.",
      "Melee, running/endurance, thievery, and medical are strong beginner picks.",
    ],
    lookFor: [
      "Melee or archery for early fighting",
      "Running/endurance for travel",
      "Medical for efficient healing",
      "Thievery if you want to handle locks",
    ],
    avoid: [
      "Making a character great at one thing but helpless at basic survival.",
      "Ignoring medical skill if you are new and likely to get hurt often.",
    ],
    note: "There is no single perfect build. The best beginner build is one that lets you recover from bad decisions."
  },

  tools: {
    emoji: "🪓",
    title: "Starter Tools & Weapons",
    goal: "Stop being helpless as fast as possible.",
    doFirst: [
      "Find 2 small stones and craft a stone knife.",
      "Use the knife to cut bushes and gather sticks.",
      "Craft a stone axe, spear, or club depending on your style.",
      "Cut spare clothing into rags if you need emergency bandages.",
      "Work toward a basic carrier/backpack.",
      "Upgrade to a cleaver, crowbar, better axe, bow, or sword when you find one.",
    ],
    lookFor: [
      "Stone knife",
      "Stone axe",
      "Club or spear",
      "Bow and arrows",
      "Cleaver or crowbar",
      "Survival knife",
      "Military shovel",
      "Sewing kits",
    ],
    avoid: [
      "Using your good weapons as base-building tools.",
      "Going into towns with no melee weapon.",
      "Assuming a gun is safer if you cannot control the noise.",
    ],
    note: "A bow is valuable because it is quiet. A loud gun may solve one puppet and invite the rest of the neighborhood."
  },

  bcu: {
    emoji: "🧠",
    title: "BCU / Metabolism",
    goal: "Use your body screen before a small problem becomes death.",
    doFirst: [
      "Check hydration and energy separately.",
      "Watch stomach volume before panic-eating.",
      "Watch vitamin/nutrition warnings.",
      "Rest when exhaustion is building.",
      "Watch temperature, especially rain, cold nights, and heavy layers.",
      "Relieve bladder/bowels before combat or long travel.",
      "Check wounds and infection after every fight.",
    ],
    lookFor: [
      "Hydration",
      "Energy/calories",
      "Stomach volume",
      "Vitamins/nutrition",
      "Exhaustion",
      "Temperature",
      "Wounds/infection",
      "Carry weight",
    ],
    avoid: [
      "Thinking food fixes dehydration.",
      "Thinking water fixes blood loss.",
      "Eating spoiled/low-condition food unless you understand the risk.",
      "Ignoring exhaustion until you cannot fight or run.",
    ],
    note: "The BCU is not decoration. It tells you exactly which system is trying to kill you."
  },

  food: {
    emoji: "🍖",
    title: "Food, Water & Rest",
    goal: "Keep your body working long enough to travel, loot, and recover.",
    doFirst: [
      "Secure water early: springs, rivers, ponds, wells, or containers when available.",
      "Avoid ocean water.",
      "Carry emergency food and water in your bag.",
      "Store backup food/water at home or in a stash.",
      "Eat gradually instead of filling your stomach in panic.",
      "Rest in shade or shelter when exhausted or overheated.",
      "Cooked food usually lasts longer than raw/perishable ingredients.",
    ],
    lookFor: [
      "Canteen or water bottle",
      "Beans",
      "Corn flakes",
      "Mushrooms",
      "Pears/crops",
      "Salt and pepper",
      "Pan or grill grid",
      "Cooked meat",
    ],
    avoid: [
      "Panic-eating junk food when you are not starving.",
      "Letting meat spoil before cooking or preserving it.",
      "Traveling far with no water plan.",
    ],
    note: "Food, water, digestion, temperature, and exhaustion are different problems. Check the right one."
  },

  home: {
    emoji: "🏠",
    title: "Shelter, Beds & Stashes",
    goal: "Protect progress without building a giant obvious target.",
    doFirst: [
      "Check Outpost X base rules before building.",
      "Start small, hidden, and useful.",
      "Build near water if possible, but not somewhere obvious.",
      "Build a bed as soon as you can; home markers matter.",
      "Use chests/shelves to organize supplies.",
      "Consider buried chests or temporary stashes if solo or nomadic.",
      "Split valuables instead of storing everything in one box.",
    ],
    lookFor: [
      "Rope",
      "Nails/bolts",
      "Toolbox",
      "Saw or axe",
      "Wood/planks/sticks",
      "Chest materials",
      "Cooking setup",
      "Bed materials",
    ],
    avoid: [
      "Building huge before you can finish or defend/maintain it.",
      "Keeping every valuable item in one obvious room.",
      "Using good knives/weapons for construction tasks.",
    ],
    note: "A small finished base is better than a giant unfinished announcement that says, 'loot is here.'"
  },

  poi: {
    emoji: "🗺️",
    title: "POI Scouting & Loot Runs",
    goal: "Get in, get what you came for, and leave alive.",
    doFirst: [
      "Stop outside the POI and listen.",
      "Circle or scout the area before entering.",
      "Watch windows, doors, rooftops, and alleys.",
      "Enter with a goal: food, tools, medical, parts, clothing, or weapons.",
      "Leave when you have the goal. Greed adds weight and risk.",
      "Return home or to a stash to drop loot before another run.",
    ],
    lookFor: [
      "Small towns and villages for starter loot",
      "Farms and crops for food",
      "Police stations for early weapons/ammo risk",
      "Traders for supplies",
      "Water sources",
      "Remote stash locations",
    ],
    avoid: [
      "Rushing bunkers or military POIs early.",
      "Approaching open windows blindly.",
      "Assuming a cleared building stays empty.",
      "Carrying so much that you cannot run or fight.",
    ],
    note: "Concealment hides you. Cover stops bullets. Bushes are not armor."
  },

  combat: {
    emoji: "⚔️",
    title: "Puppets, NPCs & Noise",
    goal: "Win fights without turning every encounter into a medical emergency.",
    doFirst: [
      "Walk or crouch near towns when possible.",
      "Keep stamina available before fighting.",
      "Use reach, doors, fences, windows, corners, and height.",
      "Back up before swinging; do not trap yourself.",
      "Check wounds immediately after combat.",
      "Use bows or quiet weapons when you want to avoid attention.",
      "Treat gunfire as a dinner bell for problems.",
    ],
    lookFor: [
      "Melee weapon",
      "Bow and arrows",
      "Bandages/rags",
      "Armor when available",
      "Helmet",
      "Suppressor if using firearms",
      "Escape route",
    ],
    avoid: [
      "Fighting exhausted or overloaded.",
      "Using unsuppressed guns in towns unless you accept the consequences.",
      "Assuming suppressed firearms are silent.",
      "Standing in doorways while multiple enemies stack on you.",
    ],
    note: "Puppets react to sight and sound. NPCs and animals can punish players who never stop to listen."
  },

  medical: {
    emoji: "⚕️",
    title: "Medical & Recovery",
    goal: "Fix the thing that kills you first.",
    doFirst: [
      "Stop active bleeding first.",
      "Open the health tab and check the actual injury.",
      "Use the correct medical item when available.",
      "Disinfect dirty wounds if possible.",
      "Rest in hard cover if badly injured.",
      "Replace food/water after recovery.",
      "Do not keep sprinting and fighting while wounds are trying to reopen.",
    ],
    lookFor: [
      "Clean rags/bandages",
      "Disinfectant",
      "Painkillers",
      "Antibiotics",
      "Garlic as an emergency substitute when appropriate",
      "Emergency food/water",
      "A safe room or hard cover to rest",
    ],
    avoid: [
      "Ignoring C1/C2 wounds because they look small.",
      "Treating everything with the wrong item.",
      "Running around hurt until the injury gets worse.",
    ],
    note: "Medical skill affects efficiency. Better medical skill means fewer wasted supplies and better recovery."
  },

  vehicles: {
    emoji: "🚗",
    title: "Vehicles & Parking",
    goal: "Use vehicles without losing your entire life at once.",
    doFirst: [
      "Check fuel, battery, tires, damage, and storage.",
      "Learn Outpost X vehicle rules before claiming or taking one.",
      "Keep repair/fuel supplies somewhere accessible.",
      "Park away from POIs so noise and visibility do not betray you.",
      "Hide vehicles in cover when possible.",
      "Do not use one vehicle as your entire base.",
    ],
    lookFor: [
      "Fuel container",
      "Vehicle repair kit",
      "Tire repair kit",
      "Battery/charger if needed",
      "Locks if applicable",
      "Storage bags/parts",
      "Backup stash",
    ],
    avoid: [
      "Parking directly outside high-risk POIs.",
      "Leaving your best gear in a vehicle.",
      "Dropping bags/items on the ground and logging out.",
    ],
    note: "A vehicle is transport, not a guaranteed vault. Treat it like something you may lose."
  },

  traders: {
    emoji: "💰",
    title: "Traders, Fame & Selling",
    goal: "Use traders without selling your future.",
    doFirst: [
      "Check Outpost X shop/trader rules before assuming something is allowed.",
      "Repair gear before selling when it makes sense.",
      "Keep rare tools, locks, repair kits, and vehicle parts unless you truly do not need them.",
      "Use traders for basics when available: food, water containers, clothing, repair, and medical.",
      "Remember stock, prices, fame, and access can depend on server settings.",
    ],
    lookFor: [
      "Canteen/water container",
      "Military or durable clothing",
      "Food staples",
      "Medical basics",
      "Repair supplies",
      "Ammo/mags if allowed",
      "Vehicle upgrades/storage if available",
    ],
    avoid: [
      "Selling every useful item because you are broke.",
      "Assuming all servers use the same economy.",
      "Dropping valuable items at trader and logging out.",
    ],
    note: "Money helps, but rare utility items often help more than a quick sale."
  },

  weather: {
    emoji: "🌧️",
    title: "Weather, Clothing & Weight",
    goal: "Stay mobile, dry, and alive without cooking or freezing yourself.",
    doFirst: [
      "Wear layers you can change as temperature changes.",
      "Take shelter in rain when possible.",
      "Use fire/shelter to dry gear if soaked.",
      "Carry sewing kits if traveling on foot; boots and gloves wear down.",
      "Watch heat rating and weight.",
      "Swap clothing for day/night, hot/cold zones, and snow areas.",
    ],
    lookFor: [
      "Socks/gloves/hat/scarf for cold",
      "Lighter clothing for hot zones",
      "Boot repair options",
      "Sewing kits",
      "Shelter/fire materials",
      "Backpack or harness with good storage/weight tradeoff",
    ],
    avoid: [
      "Overheating because you refuse to change clothes.",
      "Freezing because you packed only hot-weather gear.",
      "Becoming overburdened with heavy weapons/armor you do not need.",
    ],
    note: "The best gear is not always the heaviest gear. Mobility is a survival tool."
  },

  mistakes: {
    emoji: "⚠️",
    title: "Common Mistakes",
    goal: "Avoid the predictable deaths and tickets.",
    doFirst: [
      "Read server rules before risky actions.",
      "Ask staff if a rule is unclear before the problem happens.",
      "Do focused loot runs instead of grabbing everything.",
      "Keep backup supplies away from your main vehicle/base.",
      "Use screenshots when reporting issues.",
    ],
    lookFor: [
      "BCU warnings",
      "Open doors/windows",
      "Animal/NPC sounds",
      "Carry weight",
      "Food condition",
      "Vehicle hiding spots",
      "Medical supplies before POIs",
    ],
    avoid: [
      "Sprinting everywhere.",
      "Ignoring BCU/metabolism.",
      "Going military before basic medical.",
      "Fighting exhausted.",
      "Building too big too early.",
      "Keeping all valuables in one place.",
      "Parking vehicles obviously.",
      "Eating/drinking blindly.",
      "Assuming another player broke rules without proof.",
    ],
    note: "Most disasters are preventable before they become tickets."
  },
};

function makeList(items) {
  return items.map((item) => `• ${item}`).join("\n");
}

function buildHelpRows() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("help_first30")
        .setLabel("First 30 Min")
        .setEmoji("🎯")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("help_build")
        .setLabel("Build")
        .setEmoji("🧍")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("help_tools")
        .setLabel("Tools")
        .setEmoji("🪓")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("help_bcu")
        .setLabel("BCU")
        .setEmoji("🧠")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("help_food")
        .setLabel("Food")
        .setEmoji("🍖")
        .setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("help_home")
        .setLabel("Shelter")
        .setEmoji("🏠")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("help_poi")
        .setLabel("POIs")
        .setEmoji("🗺️")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("help_combat")
        .setLabel("Combat")
        .setEmoji("⚔️")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("help_medical")
        .setLabel("Medical")
        .setEmoji("⚕️")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("help_vehicles")
        .setLabel("Vehicles")
        .setEmoji("🚗")
        .setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("help_traders")
        .setLabel("Traders")
        .setEmoji("💰")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("help_weather")
        .setLabel("Weather")
        .setEmoji("🌧️")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("help_mistakes")
        .setLabel("Mistakes")
        .setEmoji("⚠️")
        .setStyle(ButtonStyle.Danger)
    ),
  ];
}

async function postGuide(channel) {
  const embed = new EmbedBuilder()
    .setTitle("📘 Outpost X Help Center")
    .setDescription(
      [
        "Choose a topic below. The info is sent privately so the channel stays clean.",
        "",
        "**Good starting path:**",
        "🎯 First 30 Min → 🪓 Tools → 🧠 BCU → 🗺️ POIs → 🏠 Shelter",
      ].join("\n")
    )
    .setColor(0x3b82f6)
    .setFooter({ text: "Built to Last. Born to Survive." });

  await channel.send({
    embeds: [embed],
    components: buildHelpRows(),
  });
}

async function handleHelpButton(interaction) {
  const key = interaction.customId.replace("help_", "");
  const section = GUIDE_SECTIONS[key];

  if (!section) {
    await interaction.reply({
      content: "That help topic was not found.",
      ephemeral: true,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(`${section.emoji} ${section.title}`)
    .setColor(0x3b82f6)
    .setDescription(`**Goal:**\n${section.goal}`)
    .addFields(
      {
        name: "Do first",
        value: makeList(section.doFirst).slice(0, 1024),
      },
      {
        name: "Look for / carry",
        value: makeList(section.lookFor).slice(0, 1024),
      },
      {
        name: "Avoid",
        value: makeList(section.avoid).slice(0, 1024),
      },
      {
        name: "Note",
        value: section.note.slice(0, 1024),
      }
    )
    .setFooter({ text: "Outpost X Help Center" });

  await interaction.reply({
    embeds: [embed],
    ephemeral: true,
  });
}

module.exports = {
  postGuide,
  handleHelpButton,
};
