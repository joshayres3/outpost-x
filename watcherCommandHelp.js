const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");

const STAFF_ROLE_NAMES = new Set(["Owner", "Owners", "Admin", "Trial Admin"]);

function isStaffMember(member) {
  return !!member?.roles?.cache?.some((role) => STAFF_ROLE_NAMES.has(role.name));
}

function ephemeralFlags() {
  return MessageFlags?.Ephemeral ? MessageFlags.Ephemeral : undefined;
}

const SECTIONS = {
  essentials: {
    emoji: "⭐",
    label: "Essentials",
    aliases: ["essential", "essentials", "common", "start"],
    lines: [
      ["!manage <player>", "Private admin player panel: details, vehicles, squad, money, fame, jail, ban, unban, and Discord unlinking."],
      ["!unban <Steam64/@user>", "Private unban confirmation when a banned player cannot be opened with `!manage`."],
      ["!player <name/Steam64>", "Full player lookup."],
      ["!online", "Current online player list."],
      ["!announce <message>", "Send an in-game announcement."],
      ["!close", "Close the current Watcher ticket and enter a reason."],
    ],
  },
  players: {
    emoji: "👥",
    label: "Players",
    aliases: ["player", "players", "squad", "cash", "fame", "jail", "ban", "unban"],
    lines: [
      ["!player <name/Steam64>", "Player details, registration, previous names, and snapshot."],
      ["!squad <player>", "Squad details."],
      ["!cash <player> add/remove/set <amount>", "Change player cash."],
      ["!fame <player> add/remove/set <amount>", "Change player fame."],
      ["!refund <player> <amount>", "Refund cash."],
      ["!jail <player>", "Save return point and jail."],
      ["!unjail <player>", "Return player from jail."],
      ["!manage <player>", "Private control panel with Ban Player, Unban Player, and Unlink Discord confirmations."],
      ["!unban <Steam64/@user>", "Unban from SCUM and linked Discord account."],
    ],
  },
  world: {
    emoji: "🚗",
    label: "Vehicles & Bases",
    aliases: ["vehicle", "vehicles", "base", "bases", "flag", "flags"],
    lines: [
      ["!vehicle <player>", "Player or squad vehicles."],
      ["!nearvehicles <player>", "Vehicles near a player."],
      ["!givevehicle <player> <type>", "Spawn a supported vehicle near a player."],
      ["!destroyvehicle <vehicleID>", "Destroy a vehicle after confirmation."],
      ["!flag <player|all>", "Player flags or all flags."],
      ["!overcap", "Show bases over the component cap."],
      ["!destroybase <flagID>", "Destroy a base after confirmation."],
    ],
  },
  systems: {
    emoji: "🎮",
    label: "Player Systems",
    aliases: ["systems", "dashboard", "insurance", "lottery", "airlift", "mechpacks", "register"],
    lines: [
      ["!dashboard", "Post the private player dashboard launcher."],
      ["!taxisetup", "Post the dedicated Airlift Taxi panel."],
      ["!dirtbikerentalsetup", "Post the automated 30-minute dirtbike rental panel."],
      ["!shopsetup", "Post the Discord-native Watcher Server Shop panel."],
      ["Dashboard", "Profile, vehicles and locations, squad, insurance, lottery, and Airlift Taxi cooldown."],
      ["Airlift Taxi", "$1,000, once per hour, C0 excluded."],
      ["Dirtbike Rental", "$500 for 30 minutes; 5-minute in-game warning; automatic removal; cannot be insured."],
      ["Watcher Shop", "Medical Kit $2,000 and Emergency Gas $750; instant delivery while online."],
      ["!registersetup", "Post the Steam registration panel."],
      ["!insurancesetup", "Post the vehicle insurance panel."],
      ["!mechpacksetup", "Post the mech hunting pack shop."],
      ["!lotterysetup", "Enable and post the hourly lottery."],
      ["!lotterystatus", "Lottery status and next draw."],
      ["!popupeventsetup", "Enable in-game Watcher Pop-Up Events and use this channel for private event logs."],
      ["!popupevent status", "Show eligible players, active event, and chat-event cooldown."],
      ["!popupevent quick", "Manually launch an in-game chat event; add `force` for testing."],
    ],
  },
  server: {
    emoji: "📡",
    label: "Server & Logs",
    aliases: ["server", "logs", "status", "mechs", "cargo"],
    lines: [
      ["!poststatus", "Post live server status."],
      ["!server", "Quick server information."],
      ["!watcherhealth", "Watcher and integration status."],
      ["!watcherquiet / !watcherlive", "Change Watcher response mode."],
      ["!vehiclelogsetup", "Vehicle destruction log."],
      ["!killlogsetup", "Player death log."],
      ["!killlogpull <player/Steam64> 24h", "Inspect recent kill-feed entries, including ignored puppet/NPC kills."],
      ["!rawlogpull <search> 2h", "Search raw logs; examples: puppet, npc, razor, brenner, guard."],
      ["!npclogpull [type] [range]", "Quick NPC log search; examples: `!npclogpull npc 2h` or `!npclogpull razor 2h`."],
      ["!logsources [range]", "List every log source visible to the API; example: `!logsources 30m`."],
      ["!logsample [range]", "Attach beginning, middle, and ending samples from every visible source."],
      ["!logexport [range] [sources:name]", "Follow API cursors and export every available log page, up to 24 hours."],
      ["!loginventory [range]", "Export all visible logs plus a source/count inventory."],
      ["!loginlogsetup", "Player login/logout log."],
      ["!mechschedulesetup", "Enable the scheduled mech window."],
      ["!cargoschedulesetup", "Enable scheduled Cargo Frenzy."],
    ],
  },
  support: {
    emoji: "🎟️",
    label: "Events & Tickets",
    aliases: ["events", "event", "tickets", "ticket", "support", "transcript"],
    lines: [
      ["!event", "Create and manage an event."],
      ["!issue", "Create a staff issue entry."],
      ["!ticketsetup", "Post or refresh the Open-a-Ticket panel; attach the logo when running it."],
      ["!ticketlogsetup", "Set the transcript log channel."],
      ["!ticketstatus", "Show ticket panel, log channel, and retention status."],
      ["!close", "Close the current ticket with a required reason."],
      ["Ticket tools", "Claim, Refresh Player Data, Open Player Panel, Close Ticket."],
      ["Inactive reminder", "Pings @Admin after 2 hours with no ticket activity; repeats no more than every 6 hours."],
      ["Transcripts", "Close summary plus private Show Transcript button; removed after 30 days."],
    ],
  },
  setup: {
    emoji: "🛠️",
    label: "Setup",
    aliases: ["setup", "welcome", "rules", "help", "commands"],
    lines: [
      ["!helpsetup", "Clean this channel and post one permanent Watcher Admin Help button."],
      ["!rulesacceptsetup", "Post the Accept Rules button; assigns The Exiles and links to Main Chat."],
      ["!post", "Post rules/help, enable assistant, or create an announcement."],
      ["!ruleupdate", "Owner rule update flow."],
      ["!welcomebackfill [limit]", "Backfill welcome DMs."],
      ["!watcherdm", "Owner broadcast to welcomed users."],
      ["!watcherreload", "Reload Watcher rules/config."],
    ],
  },
  safety: {
    emoji: "⚠️",
    label: "Safety",
    aliases: ["safety", "safe", "notes"],
    lines: [
      ["Private panels", "`!manage`, `!unban`, and dashboard details open through private button interactions."],
      ["Ban protection", "Watcher blocks bans against the server owner and linked staff accounts."],
      ["Destructive actions", "Require confirmation."],
      ["Player lookup", "Use SCUM name or Steam64; Discord mentions require a linked account."],
      ["Multiple matches", "Use the Steam64 ID Watcher returns."],
    ],
  },
};

const ORDER = ["essentials", "players", "world", "systems", "server", "support", "setup", "safety"];

function sectionFromInput(input) {
  const clean = String(input || "").toLowerCase().replace(/^!+/, "").replace(/^help\s+/, "").trim();
  return ORDER.find((key) => key === clean || SECTIONS[key].aliases.includes(clean)) || null;
}

function menuEmbed() {
  return new EmbedBuilder()
    .setTitle("🛰️ Watcher Admin Help")
    .setDescription([
      "Clean, private command help for **Owner / Admin / Trial Admin**.",
      "Choose a section below. Nothing else is posted in the channel.",
    ].join("\n"))
    .setFooter({ text: "Outpost X • Watcher Bot" });
}

function helpPanelPayload() {
  return {
    embeds: [new EmbedBuilder()
      .setTitle("🛰️ Watcher Admin Help")
      .setDescription("Use the button below to privately open the current Watcher command guide.")
      .setFooter({ text: "Staff only • Clean and private" })],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("cmdhelp:open").setLabel("Open Watcher Help").setEmoji("🛰️").setStyle(ButtonStyle.Primary)
    )],
  };
}

function menuComponents() {
  const buttons = ORDER.map((key) => new ButtonBuilder()
    .setCustomId(`cmdhelp:${key}`)
    .setLabel(SECTIONS[key].label)
    .setEmoji(SECTIONS[key].emoji)
    .setStyle(key === "safety" ? ButtonStyle.Secondary : ButtonStyle.Primary));
  return [
    new ActionRowBuilder().addComponents(buttons.slice(0, 4)),
    new ActionRowBuilder().addComponents(buttons.slice(4, 8)),
  ];
}

function sectionEmbed(key) {
  const section = SECTIONS[key];
  const description = section.lines.map(([command, description]) => {
    const commandText = command.startsWith("!") ? `\`${command}\`` : `**${command}**`;
    return `${commandText}\n${description}`;
  }).join("\n\n");
  return new EmbedBuilder().setTitle(`${section.emoji} ${section.label}`).setDescription(description);
}

function backRow() {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("cmdhelp:menu").setLabel("Back to Help Menu").setEmoji("↩️").setStyle(ButtonStyle.Secondary)
  )];
}

async function cleanupOldHelpPosts(channel) {
  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (!messages) return;
  for (const message of messages.values()) {
    if (!message.author?.bot) continue;
    const text = [message.content, ...message.embeds.map((embed) => `${embed.title || ""} ${embed.description || ""}`)].join(" ");
    if (/Watcher (Command Center|Admin Help)|WATCHER CORE|PLAYER SYSTEMS|SERVER \+ STATUS/i.test(text)) {
      await message.delete().catch(() => {});
    }
  }
}

async function temporaryLauncher(message, target = "open") {
  await message.delete().catch(() => {});
  const launcher = await message.channel.send({
    content: `${message.author}, open your private Watcher help.`,
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`cmdhelp:launch:${message.author.id}:${target}`)
        .setLabel("Open Watcher Help")
        .setEmoji("🛰️")
        .setStyle(ButtonStyle.Primary)
    )],
    allowedMentions: { users: [message.author.id] },
  });
  setTimeout(() => launcher.delete().catch(() => {}), 120000);
}

async function handleCommandHelpInteraction(interaction) {
  if (!interaction.isButton?.()) return false;
  const customId = String(interaction.customId || "");
  if (!customId.startsWith("cmdhelp:")) return false;

  if (!isStaffMember(interaction.member)) {
    await interaction.reply({ content: "This help panel is for Watcher staff only.", flags: ephemeralFlags() }).catch(() => {});
    return true;
  }

  const parts = customId.split(":");
  const action = parts[1];

  if (action === "launch") {
    if (interaction.user.id !== parts[2]) {
      await interaction.reply({ content: "This private help launcher belongs to another staff member.", flags: ephemeralFlags() }).catch(() => {});
      return true;
    }
    const target = parts[3] || "open";
    if (target !== "open" && SECTIONS[target]) {
      await interaction.reply({ embeds: [sectionEmbed(target)], components: backRow(), flags: ephemeralFlags() });
    } else {
      await interaction.reply({ embeds: [menuEmbed()], components: menuComponents(), flags: ephemeralFlags() });
    }
    await interaction.message.delete().catch(() => {});
    return true;
  }

  if (action === "open") {
    await interaction.reply({ embeds: [menuEmbed()], components: menuComponents(), flags: ephemeralFlags() });
    return true;
  }

  if (action === "menu") {
    await interaction.update({ embeds: [menuEmbed()], components: menuComponents() });
    return true;
  }

  if (SECTIONS[action]) {
    await interaction.update({ embeds: [sectionEmbed(action)], components: backRow() });
    return true;
  }

  await interaction.reply({ content: "Unknown help section.", flags: ephemeralFlags() }).catch(() => {});
  return true;
}

async function handleCommandHelpMessage(message) {
  if (!message.guild || !message.content?.startsWith("!")) return false;
  const parts = message.content.trim().split(/\s+/);
  const command = parts.shift().toLowerCase();
  if (!["!commands", "!help", "!helpsetup"].includes(command)) return false;

  if (!isStaffMember(message.member)) {
    await message.reply("This command guide is for Watcher staff only.").catch(() => {});
    return true;
  }

  if (command === "!helpsetup") {
    await cleanupOldHelpPosts(message.channel);
    await message.delete().catch(() => {});
    await message.channel.send(helpPanelPayload());
    return true;
  }

  const requested = sectionFromInput(parts.join(" ")) || "open";
  await temporaryLauncher(message, requested);
  return true;
}

module.exports = {
  handleCommandHelpMessage,
  handleCommandHelpInteraction,
};
