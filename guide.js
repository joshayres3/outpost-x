const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

async function postGuidePanel(channel) {
  const embed = new EmbedBuilder()
    .setTitle("📖 Outpost X Survival Guide")
    .setDescription("Essential information for surviving on Outpost X")
    .setColor(0xd4a574)
    .addFields(
      { name: "🎯 Getting Started", value: "First steps on the server", inline: true },
      { name: "🏗️ Base Building", value: "Building and base mechanics", inline: true },
      { name: "🚗 Vehicles", value: "Vehicle mechanics and rules", inline: true },
      { name: "💰 Economy", value: "Loot, money, and trading", inline: true },
      { name: "🎒 Survival", value: "Food, water, and basics", inline: true },
      { name: "⚠️ Safety", value: "Staying alive and avoiding danger", inline: true },
    )
    .setFooter({ text: "Outpost X Survival Guide | Updated 2026" });

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("guide_start").setLabel("Getting Started").setStyle(ButtonStyle.Primary).setEmoji("🎯"),
    new ButtonBuilder().setCustomId("guide_building").setLabel("Base Building").setStyle(ButtonStyle.Secondary).setEmoji("🏗️"),
    new ButtonBuilder().setCustomId("guide_vehicles").setLabel("Vehicles").setStyle(ButtonStyle.Secondary).setEmoji("🚗"),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("guide_economy").setLabel("Economy").setStyle(ButtonStyle.Success).setEmoji("💰"),
    new ButtonBuilder().setCustomId("guide_survival").setLabel("Survival").setStyle(ButtonStyle.Secondary).setEmoji("🎒"),
    new ButtonBuilder().setCustomId("guide_safety").setLabel("Safety").setStyle(ButtonStyle.Danger).setEmoji("⚠️"),
  );

  await channel.send({ embeds: [embed], components: [row1, row2] });
}

// Guide content
const GUIDE = {
  start: {
    title: "🎯 Getting Started on Outpost X",
    color: 0x3498db,
    content: `Welcome to Outpost X! Here's how to get started:

1. **Spawn and Survive** — You'll spawn with basic items. Find shelter, gather supplies, and stay alive.

2. **Learn the Map** — Explore cautiously. Find POIs (Points of Interest) for loot, but watch for danger.

3. **Find a Safe Location** — Look for a spot to build your base away from roads and POIs (at least 100m away).

4. **Gather Resources** — Collect wood, metal, and other materials. Use them to build and craft.

5. **Stay Healthy** — Monitor hunger, thirst, and health. Find food and water regularly.

6. **Don't Rush** — Outpost X is a survival server. Take your time, learn the mechanics, and play at your own pace.

7. **Read the Rules** — Check the server rules channel. Breaking rules can result in consequences.

8. **Ask for Help** — If you're lost or confused, ask in main chat or open a support ticket.

💡 Tip: The first day is the hardest. Focus on survival, not wealth. You'll get stronger as you learn the server.`
  },

  building: {
    title: "🏗️ Base Building Guide",
    color: 0xe74c3c,
    content: `Building a base on Outpost X:

**WHERE YOU CAN BUILD:**
- Off roads and away from settlements
- At least 100 meters from POIs
- Not blocking rivers or important paths
- Not on loot spawns or exploit locations

**WHERE YOU CANNOT BUILD:**
- On roads or across roads
- Blocking rivers (boats need passage)
- Within 100 meters of POIs or settlements
- In exploit bases or unreachable locations
- In structures designed to abuse game mechanics

**BUILDING TIPS:**
- Build smart and think ahead
- Don't block the map for other players
- Start small and expand over time
- Keep your base secure (locked doors!)
- Store valuables in safes

**STAFF CAN REMOVE:**
- Bases that break building rules
- Exploit or unreachable bases
- Structures causing server issues
- Builds blocking important areas

💡 Tip: Check with staff if unsure about a location. Better to ask first than build and have it removed!`
  },

  vehicles: {
    title: "🚗 Vehicle Mechanics",
    color: 0x2ecc71,
    content: `Understanding vehicles on Outpost X:

**VEHICLE RULES:**
- Don't lock vehicles until they're built
- Push vehicles off spawn points before claiming
- Don't hoard vehicles to keep from others
- Lost, flipped, or destroyed vehicles are normal game
- Staff only replace if there's proof of server issues

**VEHICLE SPAWNS:**
- Find vehicles at spawn locations throughout the map
- Push them off spawn before locking
- Multiple vehicle types available

**MAINTENANCE:**
- Keep vehicles in working condition
- Repair damage before storing
- Lock doors when leaving unattended
- Damaged vehicles can be recovered if moved

**PARKING:**
- Park away from POIs and settlements
- Some areas have parking restrictions
- Traders have limited parking zones
- Park smartly to avoid penalties

💡 Tip: Always check if a vehicle spawn has been claimed before trying to take it!`
  },

  economy: {
    title: "💰 Economy & Loot",
    color: 0xf39c12,
    content: `Making money and finding loot on Outpost X:

**LOOTING:**
- Loot POIs for guns, armor, and supplies
- Search buildings, storage, and containers
- Higher-tier locations have better loot
- Be careful of dangers while looting

**MONEY:**
- Sell items to the BotShop
- Trade with other players
- Complete events for rewards
- Use money to buy supplies

**AVOIDING EXPLOITATION:**
- Don't abuse bot delivery systems
- Don't exploit shop mechanics
- Report if systems give wrong items
- Anything gained through abuse can be removed

**TRADING:**
- Buy and sell with other players
- Negotiate fairly
- Don't use false trades as theft
- Keep agreements honest

💡 Tip: Focus on finding useful items first, wealth comes naturally as you survive longer!`
  },

  survival: {
    title: "🎒 Survival Basics",
    color: 0x9b59b6,
    content: `Staying alive on Outpost X:

**HUNGER & THIRST:**
- Find food and water sources
- Eat and drink regularly to survive
- Different foods have different values
- Purify water when needed

**HEALTH:**
- Stay above 0 HP to survive
- Find medical supplies to heal
- Avoid injuries when possible
- Rest to recover stamina

**TEMPERATURE:**
- Wear appropriate gear for weather
- Find shelter when temperature is extreme
- Build fires for warmth
- Stay dry in wet weather

**THREATS:**
- Avoid NPCs and zombies
- Be cautious in unfamiliar areas
- Travel in groups when possible
- Know escape routes from danger

**BASICS:**
- Always keep supplies on you
- Build a base for storage
- Sleep to recover energy
- Stay calm under pressure

💡 Tip: Carry a knife, water, and food at all times. These three things keep you alive!`
  },

  safety: {
    title: "⚠️ Staying Safe on Outpost X",
    color: 0xc0392b,
    content: `Safety guidelines for Outpost X:

**PROTECTING YOUR STUFF:**
- Don't leave items lying around
- Lock your base and storage
- Hide valuables in safes
- Don't trust strangers with your gear

**AVOIDING PROBLEMS:**
- Don't steal from other players
- Don't exploit game mechanics
- Don't use third-party tools
- Don't break server rules

**REPORTING ISSUES:**
- Use the support ticket system for problems
- Report cheaters and exploiters
- Be honest and clear in reports
- Provide evidence when possible

**PLAYING SMART:**
- Don't broadcast your loot locations
- Don't build in obvious spots
- Vary your routes to avoid ambush
- Keep valuable gear in base, not on you

**IF SOMETHING GOES WRONG:**
- Stay calm and assess the situation
- Retreat to safety if needed
- Report to staff if rules are broken
- Don't retaliate, let staff handle it

💡 Tip: The best survival strategy is staying smart, quiet, and aware. Avoid trouble before it finds you!`
  },
};

async function handleGuideButton(interaction) {
  if (!interaction.customId.startsWith("guide_")) return false;

  const topic = interaction.customId.replace("guide_", "");
  const data  = GUIDE[topic];

  if (!data) return false;

  const embed = new EmbedBuilder()
    .setTitle(data.title)
    .setDescription(data.content)
    .setColor(data.color)
    .setFooter({ text: "Outpost X Survival Guide | Updated 2026" });

  await interaction.reply({ embeds: [embed], ephemeral: true });
  return true;
}

module.exports = { postGuidePanel, handleGuideButton };
