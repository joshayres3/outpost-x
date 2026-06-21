const WATCHER_CHAT_CHANNEL_ID =
  process.env.WATCHER_CHAT_CHANNEL_ID || "1516269437932670977";

const USER_COOLDOWN_MS = 15 * 60 * 1000;
const CHANNEL_COOLDOWN_MS = 10 * 60 * 1000;

const userCooldowns = new Map();
const channelCooldowns = new Map();

const DIRECT_WATCHER_TRIGGERS = [
  /\bthe watcher\b/i,
  /\bwatcher\b/i,
];

const CASUAL_FLAVOR_TRIGGERS = [
  /\bbot\b/i,
  /\bai\b/i,
  /\brobot\b/i,
  /\bmachine\b/i,
  /\btransmission\b/i,
  /\bobserving\b/i,
  /\bsurveillance\b/i,
];

function getChance() {
  const raw = Number(process.env.WATCHER_FLAVOR_CHANCE || "0.25");
  if (Number.isNaN(raw)) return 0.25;
  return Math.max(0, Math.min(1, raw));
}

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

function looksLikeRulesQuestion(content) {
  const text = content.toLowerCase();

  const looksLikeQuestion =
    text.includes("?") ||
    /\b(can i|am i allowed|is it allowed|are we allowed|do we allow|how do i|how does|where do i|where is|what are|what is|when is|why is|does the server|do the rules)\b/i.test(text);

  const serverRuleTopic =
    /\b(rule|rules|allowed|allow|limit|limits|base|building|build|vehicle|vehicles|car|truck|pvp|raid|raiding|steal|stealing|cheat|cheating|map|restart|wipe|shop|shops|trader|traders|parking|garage|claim|claims)\b/i.test(text);

  return looksLikeQuestion && serverRuleTopic;
}

async function handleWatcherFlavor(msg, genai) {
  if (!msg.guild) return false;
  if (msg.author.bot) return false;
  if (msg.channelId !== WATCHER_CHAT_CHANNEL_ID) return false;
  if (!msg.content || msg.content.startsWith("!")) return false;

  // Rules questions are handled by the rules assistant, not flavor mode.
  if (looksLikeRulesQuestion(msg.content)) return false;

  const directMention = DIRECT_WATCHER_TRIGGERS.some((pattern) =>
    pattern.test(msg.content)
  );

  const casualTrigger = CASUAL_FLAVOR_TRIGGERS.some((pattern) =>
    pattern.test(msg.content)
  );

  if (!directMention && !casualTrigger) return false;

  // Direct Watcher mentions can reply if cooldown allows.
  // Generic bot/AI chatter only replies occasionally.
  if (!directMention && Math.random() > getChance()) return false;

  if (isOnCooldown(msg)) return true;

  try {
    const model = genai.getGenerativeModel({ model: "gemini-2.5-flash" });

    const res = await model.generateContent(
      `You are The Watcher, the Outpost X SCUM server intelligence.

A player said:
${msg.content}

Reply with one short line in The Watcher's voice.
Tone: composed, dry, observant, slightly unsettling, loyal to Outpost X.
Do not answer rules, support, tickets, staff issues, purchases, or technical questions.
Do not invent facts.
Do not mention that you are an AI model.
Do not use hashtags.
Keep it under 25 words.`
    );

    const reply = (res.response.text() || "").trim();

    if (!reply) return true;

    await msg.reply(reply).catch(() => {});
    return true;
  } catch (err) {
    console.error("❌ Watcher flavor error:", err.message);
    return true;
  }
}

module.exports = {
  handleWatcherFlavor,
};
