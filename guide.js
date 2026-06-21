const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require("discord.js");

const GUIDE_SECTIONS = {
  getting: {
    emoji: "🎯",
    title: "Getting Started",
    content:
      "Spawn in, get your bearings, check your basic needs, and learn the menus. Focus on food, water, clothing, tools, and a safe place to stash early loot.",
  },
  mechanics: {
    emoji: "⚙️",
    title: "Game Mechanics",
    content:
      "SCUM has deeper survival systems like metabolism, BCU data, attributes, stamina, focus mode, injuries, temperature, and body management. Take it slow and learn one system at a time.",
  },
  base: {
    emoji: "🏗️",
    title: "Base Building",
    content:
      "Build smart, not huge. Think about location, visibility, access, storage, locks, flags, expansion space, and server placement rules before you commit materials.",
  },
  loot: {
    emoji: "💰",
    title: "Crafting & Looting",
    content:
      "Loot carefully and upgrade gradually. Prioritize tools, food, medical supplies, ammo, weapon parts, repair items, and materials that help you survive longer.",
  },
  combat: {
    emoji: "⚔️",
    title: "Combat & Weapons",
    content:
      "Weapons are only part of combat. Sound, stealth, stamina, injuries, armor, ammo choice, suppression, positioning, and knowing when to leave matter just as much.",
  },
  vehicles: {
    emoji: "🚗",
    title: "Vehicles",
    content:
      "Vehicles are valuable. Keep fuel, repair supplies, locks, and backup parts in mind. Park smart, maintain them, and understand the server rules before claiming or taking one.",
  },
  food: {
    emoji: "🍖",
    title: "Food & Nutrition",
    content:
      "Food and water keep you alive, but nutrition matters too. Watch calories, hydration, vitamins, digestion, temperature, and sickness. Beans, corn, and mushrooms can carry you early.",
  },
  medical: {
    emoji: "⚕️",
    title: "Health & Medical",
    content:
      "Treat injuries early. Bleeding, infection, sickness, temperature, pain, and exhaustion can spiral fast. Carry bandages, disinfectant, painkillers, antibiotics, and backup food/water.",
  },
  multiplayer: {
    emoji: "👥",
    title: "Multiplayer Tips",
    content:
      "Trust carefully, communicate clearly, learn the map, avoid unnecessary drama, and know the server rules. Outpost X is easier when you work with the right people.",
  },
};

function buildHelpRows() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("help_getting")
        .setLabel("Getting Started")
        .setEmoji("🎯")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("help_mechanics")
        .setLabel("Mechanics")
        .setEmoji("⚙️")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("help_base")
        .setLabel("Base Building")
        .setEmoji("🏗️")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("help_loot")
        .setLabel("Crafting & Looting")
        .setEmoji("💰")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("help_combat")
        .setLabel("Combat")
        .setEmoji("⚔️")
        .setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("help_vehicles")
        .setLabel("Vehicles")
        .setEmoji("🚗")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("help_food")
        .setLabel("Food")
        .setEmoji("🍖")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("help_medical")
        .setLabel("Medical")
        .setEmoji("⚕️")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("help_multiplayer")
        .setLabel("Multiplayer")
        .setEmoji("👥")
        .setStyle(ButtonStyle.Secondary)
    ),
  ];
}

async function postGuide(channel) {
  const embed = new EmbedBuilder()
    .setTitle("📘 Outpost X Help Center")
    .setDescription(
      "Choose a topic below. The Watcher will send the information privately so the channel stays clean."
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
    .setDescription(section.content)
    .setColor(0x3b82f6)
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
