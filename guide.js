const { EmbedBuilder } = require("discord.js");

const GUIDE_SECTIONS = [
  { emoji: "🎯", title: "Getting Started", content: "Spawn, orient yourself, learn the menus and character setup." },
  { emoji: "⚙️", title: "Game Mechanics", content: "Metabolism, BCU, attributes, focus mode, stamina - core survival systems." },
  { emoji: "🏗️", title: "Base Building", content: "Build smart. Placement rules, materials, security, and expansion." },
  { emoji: "💰", title: "Crafting & Looting", content: "Tier progression, suppressors, loot zones, weapon advancement." },
  { emoji: "⚔️", title: "Combat & Weapons", content: "Weapon tiers, stealth mechanics, suppression, injury system." },
  { emoji: "🚗", title: "Vehicles", content: "Finding vehicles, claiming, maintenance, fuel strategy." },
  { emoji: "🍖", title: "Food & Nutrition", content: "Beans + Corn + Mushrooms miracle diet, vitamins, digestion." },
  { emoji: "⚕️", title: "Health & Medical", content: "Injuries, infections, temperature, medicine priority." },
  { emoji: "👥", title: "Multiplayer Tips", content: "KOS mentality, raiding, base hiding, squad dynamics." },
];

async function postGuide(channel) {
  for (const section of GUIDE_SECTIONS) {
    const embed = new EmbedBuilder()
      .setTitle(`${section.emoji} ${section.title}`)
      .setDescription(section.content)
      .setColor(0x3b82f6)
      .setFooter({ text: "Outpost X Help Center" });
    await channel.send({ embeds: [embed] });
  }
}

module.exports = { postGuide };
