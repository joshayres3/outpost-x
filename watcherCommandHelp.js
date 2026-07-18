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
  register: {
    emoji: "🔗",
    label: "Register",
    title: "🔗 REGISTER STEAM",
    aliases: ["register", "steam", "link", "linksteam", "registersetup", "verify"],
    lines: [
      ["!registersetup", "Post/move the player Register Steam panel."],
      ["!unregister <Steam64/@user/name>", "Owner-only. Remove a Discord ↔ Steam link so a player can re-register."],
      ["Register Steam button", "Player gets a code to type in SCUM chat."],
      ["Verify Code button", "Links Discord to the player’s SCUM character."],
      ["Used for", "Vehicle insurance, mech hunting packs, and lottery."],
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
    aliases: ["players", "player", "squad", "cash", "fame", "refund", "money", "economy", "econ"],
    lines: [
      ["!player <name/SteamID>", "Full lookup, Discord registration, recent IP, previous names, and last-known snapshot."],
      ["!squad <player>", "Squad info."],
      ["!cash <player> add/remove/set <amount>", "Change cash."],
      ["!fame <player> add/remove/set <amount>", "Change fame."],
      ["!refund <player> <amount>", "Refund cash to a player."],
      ["!manage <player>", "Open the private Admin Player Control Panel."],
      ["!dashboard", "Post the player dashboard launcher with vehicles, insurance, lottery, and Airlift Taxi."],
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
    aliases: ["logs", "log", "vehiclelog", "vehiclelogs", "killlog", "killlogs", "loginlog", "loginlogs", "watchers"],
    lines: [
      ["!vehiclelogsetup", "Start vehicle destruction log."],
      ["!vehiclelogstatus", "Vehicle log status."],
      ["!vehiclelogscan", "Force an immediate vehicle scan."],
      ["!vehiclelogoff", "Stop vehicle log."],
      ["!killlogsetup", "Start player death log."],
      ["!killlogstatus", "Kill log status."],
      ["!killlogscan", "Force an immediate kill scan."],
      ["!killlogoff", "Stop kill log."],
      ["!loginlogsetup", "Start player login/logout log with player name, fake name, IP, and location."],
      ["!loginlogstatus", "Login log status."],
      ["!loginlogscan", "Force an immediate login scan."],
      ["!loginlogoff", "Stop login log."],
    ],
  },

  insurance: {
    emoji: "🛡️",
    label: "Insurance",
    title: "🛡️ VEHICLE INSURANCE",
    aliases: ["insurance", "insure", "insured", "vehicleinsurance"],
    lines: [
      ["!insurancesetup", "Post/move the insurance menu."],
      ["!registersetup", "Post a standalone Register Steam panel."],
      ["!insurancestatus", "Insurance system status."],
      ["!insurancescan", "Force an insurance destruction scan."],
      ["!wipeinsurance", "Owner-only wipe after server wipe."],
      ["Player buttons", "Rates, Buy Insurance, My Insurance, Claim Insurance."],
    ],
  },

  mechs: {
    emoji: "🤖",
    label: "Mechs",
    title: "🤖 MECH SCHEDULE",
    aliases: ["mechs", "mech", "sentry", "sentries", "mechschedule"],
    lines: [
      ["!mechtest", "Test SFTP and read current sentry setting."],
      ["!mechson", "Set mechs ON after next restart."],
      ["!mechsoff", "Set mechs OFF after next restart."],
      ["!mechschedulesetup", "Sunday 11:45 PM ON / Monday 11:45 PM OFF Toronto."],
      ["!mechschedulestatus", "Mech schedule and current setting status."],
      ["!mechscheduleoff", "Disable automatic mech schedule."],
      ["Panel", "Clean player-facing status post that edits itself."],
    ],
  },

  mechpacks: {
    emoji: "🎯",
    label: "Mech Packs",
    title: "🎯 MECH HUNTING PACKS",
    aliases: ["mechpacks", "mechpack", "rpg", "rpg7", "pg7m", "rockets"],
    lines: [
      ["!mechpacksetup", "Post/move the player mech hunting pack shop."],
      ["!mechpackstatus", "Check RPG-7 and Rockets PG-7M item resolution."],
      ["RPG-7 x1", "$50,000."],
      ["Rockets PG-7M x10", "$15,000."],
      ["Register first", "Players must register before buying."],
    ],
  },
  lottery: {
    emoji: "🎟️",
    label: "Lottery",
    title: "🎟️ HOURLY LOTTERY",
    aliases: ["lottery", "draw", "winner", "claim", "code"],
    lines: [
      ["!lotterysetup", "Owner-only. Enable hourly lottery and post player info in this channel."],
      ["!lotterylogsetup", "Owner-only. Save this hidden/admin channel for winner and claim logs."],
      ["!lotterystatus", "Show player channel, admin log channel, next warning, next draw, and status."],
      ["!lotteryoff", "Owner-only. Pause lottery without deleting codes/history."],
      ["!lotterydraw", "Admin/Owner. Run an extra one-off lottery right now using normal rules."],
      ["Repeat protection", "Recent winners have reduced odds for 6 hours when 4+ players qualify."],
      ["Claiming", "Winner types the DM code directly in SCUM chat. Codes expire after 7 days by default."],
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
  tickets: {
    emoji: "🎟️",
    label: "Tickets",
    title: "🎟️ WATCHER TICKETS",
    aliases: ["tickets", "ticket", "support", "transcript"],
    lines: [
      ["!ticketsetup", "Run in Open-a-Ticket. Attach the Outpost X logo to use it on the panel."],
      ["!ticketlogsetup", "Run in ticket-logs to save transcripts there."],
      ["!ticketstatus", "Show panel, log channel, and retention status."],
      ["Ticket creation", "Pings @Admin and creates a private channel directly below Open-a-Ticket."],
      ["Staff buttons", "Claim, Refresh Player Data, Open Player Panel, and Close Ticket."],
      ["Closing", "Requires a reason, DMs the player, saves a transcript, and removes the ticket channel."],
      ["Transcript logs", "Show opener, closer, close reason, dates, and a Show Transcript button."],
      ["Retention", "Transcript log entries are automatically removed after 30 days."],
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
  "register",
  "server",
  "players",
  "vehicles",
  "bases",
  "jail",
  "logs",
  "insurance",
  "mechs",
  "mechpacks",
  "lottery",
  "cargo",
  "events",
  "tickets",
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
  const label = (key) => {
    const section = CATEGORIES[key];
    return `${section.emoji} **${section.label}**`;
  };

  return [
    "# 🛰️ Outpost X | Watcher Command Center",
    "**Staff only:** Owner / Admin / Trial Admin",
    "Partial player names work. If multiple players match, Watcher shows buttons.",
    "",
    "Pick a button below, or type `!help <category>`.",
    "",
    "**Player-facing panels**",
    ["register", "insurance", "mechs", "mechpacks", "lottery", "cargo"].map(label).join("  •  "),
    "",
    "**Admin tools**",
    ["server", "players", "vehicles", "bases", "jail", "logs"].map(label).join("  •  "),
    "",
    "**Server management**",
    ["core", "setup", "events", "tickets", "safety"].map(label).join("  •  "),
    "",
    "**Most used setup:** `!ticketsetup` • `!ticketlogsetup` • `!registersetup` • `!insurancesetup` • `!mechschedulesetup` • `!mechpacksetup` • `!lotterysetup` • `!cargoschedulesetup`",
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
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
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
    "",
  ];

  for (const [cmd, desc] of section.lines) {
    const isCommand = String(cmd).startsWith("!");
    lines.push(`${isCommand ? "•" : "-"} ${isCommand ? `\`${cmd}\`` : `**${cmd}**`} — ${desc}`);
  }

  lines.push("");
  lines.push("Use `!commands` to return to the full menu.");
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
      "Try: `!help insurance`, `!help mechs`, `!help mechpacks`, `!help lottery`, `!help cargo`, or `!help logs`.",
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
