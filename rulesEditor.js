const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  MessageFlags,
} = require("discord.js");

const RULES_CHANNEL_ID =
  process.env.RULES_CHANNEL_ID || "1516308380837220445";

const ADMIN_CHANNEL_ID =
  process.env.ADMIN_CHANNEL_ID || "1518059656302301245";

const MAIN_CHAT_CHANNEL_ID =
  process.env.MAIN_CHAT_CHANNEL_ID || "1516269437932670977";

const SESSIONS = new Map();

const RULE_SECTIONS = {
  general: {
    label: "General Rules",
    title: "📋 📋 GENERAL RULES",
    color: 0xf2c94c,
  },
  pvp: {
    label: "PvP Rules",
    title: "⚔️⚔️ PVP RULES",
    color: 0xeb5757,
  },
  base: {
    label: "Base Building Rules",
    title: "🏗️🏗️ BASE BUILDING RULES",
    color: 0xf2994a,
  },
  vehicles: {
    label: "Vehicle Rules",
    title: "🚗🚗 VEHICLE RULES",
    color: 0x9b51e0,
  },
  shops: {
    label: "Bots, Shop, Taxi, and Delivery",
    title: "🏪🏪 BOTS, SHOP, TAXI, AND DELIVERY",
    color: 0x27ae60,
  },
  map: {
    label: "Map Info",
    title: "🗺️🗺️ MAP INFO",
    color: 0x2f80ed,
  },
  server: {
    label: "Server Info",
    title: "📡 SERVER INFO",
    color: 0x56ccf2,
  },
};

function isOwner(member) {
  return member?.roles?.cache?.some((r) =>
    ["Owners", "Owner"].includes(r.name)
  );
}

function canUseRuleEditor(msgOrInteraction) {
  const member = msgOrInteraction.member;
  if (!isOwner(member)) return false;

  const channelId = msgOrInteraction.channelId;
  return channelId === ADMIN_CHANNEL_ID || channelId === MAIN_CHAT_CHANNEL_ID || channelId === RULES_CHANNEL_ID;
}

function buildRuleEmbed(section, content) {
  const config = RULE_SECTIONS[section];

  return new EmbedBuilder()
    .setTitle(config.title)
    .setDescription(content || "_No rule text set._")
    .setColor(config.color)
    .setFooter({ text: "Outpost X Rules" });
}

function buildSectionMenu() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("ruleupdate_section")
      .setPlaceholder("Choose the rule section to edit")
      .addOptions(
        Object.entries(RULE_SECTIONS).map(([value, config]) => ({
          label: config.label,
          value,
        }))
      )
  );
}

function buildConfirmButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ruleupdate_confirm")
      .setLabel("Confirm Update")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("ruleupdate_revise")
      .setLabel("Revise")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("ruleupdate_cancel")
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary)
  );
}

function getSession(userId) {
  return SESSIONS.get(userId);
}

function setSession(userId, data) {
  SESSIONS.set(userId, {
    ...data,
    updatedAt: Date.now(),
  });
}

function clearSession(userId) {
  SESSIONS.delete(userId);
}

function cleanupOldSessions() {
  const maxAge = 30 * 60 * 1000;
  const now = Date.now();

  for (const [userId, session] of SESSIONS.entries()) {
    if (now - session.updatedAt > maxAge) {
      SESSIONS.delete(userId);
    }
  }
}

async function handleRuleUpdateCommand(msg, ctx) {
  if (!msg.content) return false;
  if (msg.content.trim().toLowerCase() !== "!ruleupdate") return false;

  cleanupOldSessions();

  if (!canUseRuleEditor(msg)) {
    await msg.reply("Rule updates are restricted to Owners in admin, main chat, or the rules channel.").catch(() => {});
    return true;
  }

  setSession(msg.author.id, {
    stage: "selecting",
    channelId: msg.channelId,
  });

  await msg.reply({
    content: "Which rule section needs editing?",
    components: [buildSectionMenu()],
  }).catch(() => {});

  return true;
}

async function generateRuleDraft(genai, section, currentText, staffRequest) {
  const config = RULE_SECTIONS[section];
  const model = genai.getGenerativeModel({ model: "gemini-2.5-flash" });

  const res = await model.generateContent(
    `You are editing one section of the Outpost X SCUM server rules.

Section: ${config.label}

Current rule text:
${currentText || "(empty)"}

Owner requested change:
${staffRequest}

Rewrite the complete section text only.
Keep the existing style: short, clear, direct, Discord-friendly.
Do not include the title.
Do not use markdown tables.
Do not add extra sections.
Do not invent rules beyond the owner request.
Preserve important existing rules unless the owner request clearly removes or changes them.
Return only the final section body text.`
  );

  return (res.response.text() || "").trim();
}

async function findExistingRuleMessage(bot, section) {
  const config = RULE_SECTIONS[section];
  const channel = await bot.channels.fetch(RULES_CHANNEL_ID).catch(() => null);
  if (!channel) throw new Error("Could not access the rules channel.");

  let before;
  let scanned = 0;

  while (scanned < 200) {
    const options = { limit: 50 };
    if (before) options.before = before;

    const messages = await channel.messages.fetch(options);
    if (!messages.size) break;

    for (const msg of messages.values()) {
      scanned += 1;
      before = msg.id;

      if (msg.author.id !== bot.user.id) continue;

      const embed = msg.embeds?.[0];
      const title = embed?.title || "";

      if (
        title.toLowerCase().includes(config.label.toLowerCase().split(" ")[0]) ||
        title.toLowerCase() === config.title.toLowerCase() ||
        title.replace(/\s+/g, " ").toLowerCase().includes(config.title.replace(/\s+/g, " ").toLowerCase())
      ) {
        if (section === "base" && !title.toLowerCase().includes("base")) continue;
        if (section === "vehicles" && !title.toLowerCase().includes("vehicle")) continue;
        if (section === "shops" && !title.toLowerCase().includes("shop") && !title.toLowerCase().includes("bot")) continue;
        if (section === "map" && !title.toLowerCase().includes("map")) continue;
        if (section === "pvp" && !title.toLowerCase().includes("pvp")) continue;
        if (section === "general" && !title.toLowerCase().includes("general")) continue;
        if (section === "server" && !title.toLowerCase().includes("server")) continue;

        return msg;
      }
    }

    if (messages.size < 50) break;
  }

  return null;
}

async function updateSupabaseRule(db, section, content) {
  const { error } = await db
    .from("rules")
    .upsert({ section, content }, { onConflict: "section" });

  if (error) throw error;
}

async function handleRuleUpdateInteraction(interaction, ctx) {
  if (!interaction.isStringSelectMenu() && !interaction.isButton()) return false;
  if (!interaction.customId.startsWith("ruleupdate_")) return false;

  cleanupOldSessions();

  if (!canUseRuleEditor(interaction)) {
    await interaction.reply({
      content: "Rule updates are restricted to Owners in admin, main chat, or the rules channel.",
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return true;
  }

  const userId = interaction.user.id;
  const session = getSession(userId);

  if (!session) {
    await interaction.reply({
      content: "No active rule update session. Run `!ruleupdate` again.",
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return true;
  }

  if (interaction.customId === "ruleupdate_section") {
    const section = interaction.values[0];
    const currentText = ctx.rules[section] || "";

    setSession(userId, {
      ...session,
      stage: "waiting_for_change",
      section,
      currentText,
    });

    await interaction.update({
      content: [
        `Editing: **${RULE_SECTIONS[section].label}**`,
        "",
        "Type what you want changed.",
        "",
        "Example:",
        "`Remove across roads from base building rules and make the wording cleaner.`",
      ].join("\n"),
      components: [],
    }).catch(() => {});

    return true;
  }

  if (interaction.customId === "ruleupdate_cancel") {
    clearSession(userId);

    await interaction.update({
      content: "Rule update cancelled.",
      embeds: [],
      components: [],
    }).catch(() => {});

    return true;
  }

  if (interaction.customId === "ruleupdate_revise") {
    setSession(userId, {
      ...session,
      stage: "waiting_for_change",
    });

    await interaction.update({
      content: [
        `Revision requested for **${RULE_SECTIONS[session.section].label}**.`,
        "",
        "Type the new change instructions.",
      ].join("\n"),
      embeds: [],
      components: [],
    }).catch(() => {});

    return true;
  }

  if (interaction.customId === "ruleupdate_confirm") {
    if (!session.section || !session.draft) {
      await interaction.reply({
        content: "Missing draft data. Run `!ruleupdate` again.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return true;
    }

    await interaction.deferUpdate().catch(() => {});

    try {
      await updateSupabaseRule(ctx.db, session.section, session.draft);

      const existingMessage = await findExistingRuleMessage(ctx.bot, session.section);
      const embed = buildRuleEmbed(session.section, session.draft);

      if (existingMessage) {
        await existingMessage.edit({ embeds: [embed] });
      } else {
        const channel = await ctx.bot.channels.fetch(RULES_CHANNEL_ID);
        await channel.send({ embeds: [embed] });
      }

      if (ctx.rules) ctx.rules[session.section] = session.draft;
      if (typeof ctx.reloadData === "function") {
        await ctx.reloadData();
      }

      clearSession(userId);

      await interaction.editReply({
        content: [
          `Rule section updated: **${RULE_SECTIONS[session.section].label}**`,
          "",
          existingMessage
            ? `Edited existing rules post in <#${RULES_CHANNEL_ID}>.`
            : `No existing post was found, so a new one was posted in <#${RULES_CHANNEL_ID}>.`,
        ].join("\n"),
        embeds: [],
        components: [],
      }).catch(() => {});
    } catch (err) {
      console.error("❌ Rule update confirm failed:", err);
      await interaction.editReply({
        content: `Rule update failed: ${err.message}`,
        embeds: [],
        components: [],
      }).catch(() => {});
    }

    return true;
  }

  return false;
}

async function handleRuleUpdateText(msg, ctx) {
  if (!msg.guild) return false;
  if (msg.author.bot) return false;

  cleanupOldSessions();

  const session = getSession(msg.author.id);
  if (!session || session.stage !== "waiting_for_change") return false;
  if (!canUseRuleEditor(msg)) return true;

  const ownerRequest = msg.content.trim();
  if (!ownerRequest) return true;

  await msg.reply("Drafting updated rule section...").catch(() => {});

  try {
    const draft = await generateRuleDraft(
      ctx.genai,
      session.section,
      session.currentText || ctx.rules[session.section] || "",
      ownerRequest
    );

    setSession(msg.author.id, {
      ...session,
      stage: "preview",
      ownerRequest,
      draft,
    });

    await msg.reply({
      content: [
        `Preview for **${RULE_SECTIONS[session.section].label}**`,
        "",
        "Confirm to update Supabase and edit The Watcher's rules post.",
      ].join("\n"),
      embeds: [buildRuleEmbed(session.section, draft)],
      components: [buildConfirmButtons()],
    }).catch(() => {});
  } catch (err) {
    console.error("❌ Rule draft failed:", err);
    await msg.reply(`Could not draft rule update: ${err.message}`).catch(() => {});
  }

  return true;
}

module.exports = {
  handleRuleUpdateCommand,
  handleRuleUpdateInteraction,
  handleRuleUpdateText,
};
