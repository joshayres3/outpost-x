const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");

const STAFF_ROLE_NAMES = new Set(["Owner", "Owners", "Admin", "Trial Admin"]);

function isStaffMember(member) {
  if (!member?.roles?.cache) return false;
  return member.roles.cache.some((role) => STAFF_ROLE_NAMES.has(role.name));
}

function replyFlags() {
  return MessageFlags?.Ephemeral ? MessageFlags.Ephemeral : undefined;
}

const CATEGORIES = {
  core: {
    emoji: "🧠",
    label: "Core",
    title: "🧠 WATCHER CORE",
    aliases: ["core", "watcher", "bot", "mode", "health"],
    lines: [
      ["!watcherhealth", "Bot health/status."],
      ["!watcherquiet", "Quiet mode."],
      ["!watcherlive", "Live mode."],
      ["!watchermode", "Current mode."],
      ["!watcherreload", "Reload rules/config."],
    ],
  },
  setup: {
    emoji: "📜",
    label: "Setup",
    title: "📜 RULES / WELCOME / SETUP",
    aliases: ["setup", "rules", "welcome", "dm", "post", "assistant"],
    lines: [
      ["!post", "Post help/rules, enable assistant, or make announcement."],
      ["!ruleupdate", "Owner rule update flow."],
      ["!welcomebackfill [limit]", "Backfill welcome DMs."],
      ["!watcherdm", "Owner DM broadcast to welcomed users."],
      ["Ticket helper", "Auto-redirects help/admin/bug/lost vehicle mentions."],
      ["Rules intelligence", "Answers rule questions from posted rules."],
    ],
  },
  server: {
    emoji: "📡",
    label: "Server",
    title: "📡 SERVER + STATUS",
    aliases: ["server", "status", "online", "announce"],
    lines: [
      ["!poststatus", "Live status panel."],
      ["!server", "Quick server info."],
      ["!online", "Online player list."],
      ["!announce <message>", "In-game announcement."],
    ],
  },
  players: {
    emoji: "👥",
    label: "Players",
    title: "👥 PLAYERS + SQUADS + ECONOMY",
    aliases: ["players", "player", "squad", "cash", "fame", "money", "economy", "econ"],
    lines: [
      ["!player <name/SteamID>", "Full player lookup."],
      ["!squad <player>", "Squad info."],
      ["!cash <player> add/remove/set <amount>", "Change cash."],
      ["!fame <player> add/remove/set <amount>", "Change fame."],
    ],
  },
  vehicles: {
    emoji: "🚗",
    label: "Vehicles",
    title: "🚗 VEHICLES",
    aliases: ["vehicles", "vehicle", "cars", "car", "truck", "trucks", "givevehicle"],
    lines: [
      ["!vehicle <player>", "Player/squad vehicles."],
      ["!nearvehicles <player>", "Vehicles near player."],
      ["!givevehicle <player> <type>", "Spawn vehicle near player."],
      ["Vehicle types", "duster, tractor, laika, mariner, rager, ww, wolfswagen."],
      ["!destroyvehicle <vehicleID>", "Destroy vehicle after confirmation."],
    ],
  },
  bases: {
    emoji: "🚩",
    label: "Bases",
    title: "🚩 FLAGS + BASES",
    aliases: ["bases", "base", "flags", "flag", "overcap", "destroybase"],
    lines: [
      ["!flag <player>", "Player flags/bases."],
      ["!flag all", "All flags, paged."],
      ["!overcap", "Over-cap bases."],
      ["!destroybase <flagID>", "Destroy base by flag after confirmation."],
    ],
  },
  jail: {
    emoji: "🚔",
    label: "Jail",
    title: "🚔 JAIL",
    aliases: ["jail", "prison", "unjail"],
    lines: [
      ["!jail <player>", "Save return point, then jail."],
      ["!unjail <player>", "Return player from jail."],
      ["Storage", "Return points save to Supabase."],
    ],
  },
  logs: {
    emoji: "👁️",
    label: "Logs",
    title: "👁️ LOGS + WATCHERS",
    aliases: ["logs", "log", "vehiclelog", "killlog", "watchers"],
    lines: [
      ["!vehiclelogsetup", "Start vehicle disappearance log."],
      ["!vehiclelogstatus", "Vehicle log status."],
      ["!vehiclelogscan", "Force an immediate vehicle scan."],
      ["!vehiclelogoff", "Stop vehicle log."],
      ["!killlogsetup", "Start player death log."],
      ["!killlogstatus", "Kill log status."],
      ["!killlogscan", "Force an immediate kill scan."],
      ["!killlogoff", "Stop kill log."],
    ],
  },
  cargo: {
    emoji: "📦",
    label: "Cargo",
    title: "📦 CARGO + SCHEDULE",
    aliases: ["cargo", "cargofrenzy", "drop", "drops", "cargoschedule", "schedule"],
    lines: [
      ["!cargotest", "Test one cargo drop."],
      ["!cargofrenzy", "Launch 10 safe cargo drops."],
      ["!cargoschedulesetup", "Enable automatic Cargo Frenzy."],
      ["!cargoschedulestatus", "Cargo schedule status."],
      ["!cargoscheduleoff", "Disable automatic Cargo Frenzy."],
      ["Auto times", "12:30, 4:30, 8:30 AM/PM Eastern."],
    ],
  },
  events: {
    emoji: "📣",
    label: "Events",
    title: "📣 EVENTS + ISSUES",
    aliases: ["events", "event", "announcement", "announcements", "issues", "issue", "staff"],
    lines: [
      ["!event", "Event creation/admin menu."],
      ["Event buttons", "RSVPs, reminders, recurring events, auto-close."],
      ["!issue", "Create a staff issue log entry."],
      ["Issue buttons", "Notify Admin, Notify Owners, Completed, Assign."],
      ["Announcement formatting", "Use !post → Announcement."],
    ],
  },
  safety: {
    emoji: "⚠️",
    label: "Safety",
    title: "⚠️ SAFETY NOTES",
    aliases: ["safety", "safe", "notes", "tips"],
    lines: [
      ["Use singular", "!vehicle and !flag."],
      ["Partial names", "Multiple matches use buttons."],
      ["Destroy commands", "Require confirmation."],
      ["Cargo safety", "Checks live flags before drops."],
      ["Kill logs", "Ignore puppet/animal farming spam."],
      ["Player lookup", "Uses SCUM name or Steam ID, not Discord name."],
    ],
  },
};

const ORDER = [
  "core",
  "setup",
  "server",
  "players",
  "vehicles",
  "bases",
  "jail",
  "logs",
  "cargo",
  "events",
  "safety",
];

function categoryFromInput(input) {
  const raw = String(input || "").trim().toLowerCase();
  if (!raw) return null;
  const clean = raw.replace(/^!+/, "").replace(/^help\s+/, "").trim();

  for (const key of ORDER) {
    const section = CATEGORIES[key];
    if (key === clean || section.aliases.includes(clean)) return key;
  }

  return null;
}

function buildMenuContent() {
  const rows = ORDER.map((key) => {
    const section = CATEGORIES[key];
    return `${section.emoji} **${section.label}**`;
  });

  return [
    "# 🛰️ OUTPOST X | THE WATCHER",
    "## Admin Command Menu",
    "**Staff only:** Owner / Admin / Trial Admin",
    "**Partial names work. Multiple matches = buttons.**",
    "",
    "Pick a category below, or type `!help <category>`.",
    "",
    rows.join("  •  "),
    "",
    "Examples: `!help vehicle`, `!help cargo`, `!help jail`",
  ].join("\n");
}

function buildMenuComponents() {
  const buttons = ORDER.map((key) => {
    const section = CATEGORIES[key];
    return new ButtonBuilder()
      .setCustomId(`cmdhelp:${key}`)
      .setLabel(section.label)
      .setEmoji(section.emoji)
      .setStyle(key === "safety" ? ButtonStyle.Secondary : ButtonStyle.Primary);
  });

  const rows = [];
  for (let i = 0; i < buttons.length; i += 4) {
    rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 4)));
  }
  return rows;
}

function buildBackComponent() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("cmdhelp:menu")
        .setLabel("Back to Command Menu")
        .setEmoji("🛰️")
        .setStyle(ButtonStyle.Secondary)
    ),
  ];
}

function buildCategoryContent(key) {
  const section = CATEGORIES[key];
  if (!section) return null;

  const lines = [
    `## ${section.title}`,
  ];

  for (const [cmd, desc] of section.lines) {
    const isCommand = String(cmd).startsWith("!");
    lines.push(`${isCommand ? "🔹" : "▫️"} **\`${cmd}\`**`);
    lines.push(desc);
  }

  lines.push("");
  lines.push("Type `!commands` for the full menu.");
  return lines.join("\n");
}

async function handleCommandHelpInteraction(interaction) {
  if (!interaction.isButton?.()) return false;
  const customId = String(interaction.customId || "");
  if (!customId.startsWith("cmdhelp:")) return false;

  if (!isStaffMember(interaction.member)) {
    await interaction.reply({
      content: "The Watcher sees the request. This command guide is for staff only.",
      flags: replyFlags(),
    }).catch(() => {});
    return true;
  }

  const key = customId.split(":")[1];

  if (key === "menu") {
    await interaction.reply({
      content: buildMenuContent(),
      components: buildMenuComponents(),
      flags: replyFlags(),
    }).catch(() => {});
    return true;
  }

  const content = buildCategoryContent(key);
  if (!content) {
    await interaction.reply({ content: "Unknown command category.", flags: replyFlags() }).catch(() => {});
    return true;
  }

  await interaction.reply({
    content,
    components: buildBackComponent(),
    flags: replyFlags(),
  }).catch(() => {});

  return true;
}

async function handleCommandHelpMessage(message) {
  if (!message.guild || !message.content) return false;
  if (!message.content.startsWith("!")) return false;

  const parts = message.content.trim().split(/\s+/);
  const command = parts.shift().toLowerCase();
  const args = parts;

  if (command !== "!commands" && command !== "!help") return false;

  if (!isStaffMember(message.member)) {
    await message.reply("The Watcher sees the request. This command guide is for staff only.").catch(() => {});
    return true;
  }

  if (command === "!commands" || args.length === 0 || args[0].toLowerCase() === "all" || args[0].toLowerCase() === "menu") {
    await message.reply({
      content: buildMenuContent(),
      components: buildMenuComponents(),
    }).catch(() => {});
    return true;
  }

  const key = categoryFromInput(args.join(" "));
  if (!key) {
    await message.reply([
      "Unknown help category.",
      "Use `!commands` to see the menu.",
      "Examples: `!help vehicle`, `!help cargo`, `!help jail`",
    ].join("\n")).catch(() => {});
    return true;
  }

  await message.reply({
    content: buildCategoryContent(key),
    components: buildBackComponent(),
  }).catch(() => {});
  return true;
}

module.exports = {
  handleCommandHelpMessage,
  handleCommandHelpInteraction,
};
