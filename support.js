const SUPPORT_CHANNEL_ID =
  process.env.SUPPORT_CHANNEL_ID || "1516269437932670977";

const TICKET_CHANNEL_ID =
  process.env.TICKET_CHANNEL_ID || "1516323094548185139";

const USER_COOLDOWN_MS = 10 * 60 * 1000;
const CHANNEL_COOLDOWN_MS = 2 * 60 * 1000;

const userCooldowns = new Map();
const channelCooldowns = new Map();

const SUPPORT_TRIGGERS = [
  /\bopen (a )?ticket\b/i,
  /\bmake (a )?ticket\b/i,
  /\bcreate (a )?ticket\b/i,
  /\bsubmit (a )?ticket\b/i,
  /\bticket please\b/i,
  /\bneed (a )?ticket\b/i,
  /\bhow do i open (a )?ticket\b/i,
  /\bwhere do i open (a )?ticket\b/i,

  /\bneed staff\b/i,
  /\bneed an admin\b/i,
  /\bneed admin help\b/i,
  /\bneed staff help\b/i,
  /\bcan staff help\b/i,
  /\bcan an admin help\b/i,
  /\badmin please\b/i,
  /\bstaff please\b/i,

  /\bmy vehicle is gone\b/i,
  /\bmy car is gone\b/i,
  /\bmy truck is gone\b/i,
  /\bvehicle disappeared\b/i,
  /\bcar disappeared\b/i,
  /\btruck disappeared\b/i,
  /\blost my vehicle\b/i,
  /\blost my car\b/i,
  /\blost my truck\b/i,

  /\breport a player\b/i,
  /\bplayer report\b/i,
  /\bneed to report someone\b/i,
];

function isOnCooldown(msg) {
  const now = Date.now();

  const userLast = userCooldowns.get(msg.author.id) || 0;
  if (now - userLast < USER_COOLDOWN_MS) return true;

  const channelLast = channelCooldowns.get(msg.channelId) || 0;
  if (now - channelLast < CHANNEL_COOLDOWN_MS) return true;

  userCooldowns.set(msg.author.id, now);
  channelCooldowns.set(msg.channelId, now);

  return false;
}

async function handleSupportRedirect(msg) {
  if (!msg.guild) return false;
  if (msg.author.bot) return false;
  if (msg.channelId !== SUPPORT_CHANNEL_ID) return false;
  if (!msg.content || msg.content.startsWith("!")) return false;

  const matched = SUPPORT_TRIGGERS.some((pattern) => pattern.test(msg.content));
  if (!matched) return false;

  if (isOnCooldown(msg)) return true;

  await msg.reply(
    [
      "Need staff help?",
      "",
      `Open a ticket here: <#${TICKET_CHANNEL_ID}>`,
      "",
      "The Watcher sees many things. Resolving server issues still requires a ticket.",
    ].join("\n")
  ).catch(() => {});

  return true;
}

module.exports = {
  handleSupportRedirect,
};
