const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require("discord.js");
const { DateTime } = require("luxon");

const STAFF_ISSUES_CHANNEL_ID =
  process.env.STAFF_ISSUES_CHANNEL_ID || "1516326083614605342";

const ADMIN_ROLE_ID =
  process.env.ADMIN_ROLE_ID || "1516272506804371646";

const OWNERS_ROLE_ID =
  process.env.OWNERS_ROLE_ID || "1516273523046355094";

const ADMIN_CHANNEL_ID =
  process.env.ADMIN_CHANNEL_ID || "1518059656302301245";

const MAIN_CHAT_CHANNEL_ID =
  process.env.MAIN_CHAT_CHANNEL_ID || "1516269437932670977";

const SERVER_TIMEZONE =
  process.env.SERVER_TIMEZONE || "America/New_York";

const ISSUE_LAUNCHERS = new Map();

function isOwner(member) {
  return member?.roles?.cache?.has(OWNERS_ROLE_ID) ||
    member?.roles?.cache?.some((r) => ["Owner", "Owners"].includes(r.name));
}

function isStaff(member) {
  return member?.roles?.cache?.has(ADMIN_ROLE_ID) ||
    member?.roles?.cache?.has(OWNERS_ROLE_ID) ||
    member?.roles?.cache?.some((r) => ["Admin", "Owner", "Owners"].includes(r.name));
}

function canUseIssueSystem(obj) {
  if (!isStaff(obj.member)) return false;

  return [
    ADMIN_CHANNEL_ID,
    MAIN_CHAT_CHANNEL_ID,
    STAFF_ISSUES_CHANNEL_ID,
  ].includes(obj.channelId);
}

function serverTime() {
  return DateTime.now()
    .setZone(SERVER_TIMEZONE)
    .toFormat("ccc, LLL d • h:mm a ZZZZ");
}

function trimField(text, max = 1000) {
  if (!text) return "None";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 20)}\n...continued`;
}

function getEmbedField(embed, name) {
  const field = embed.fields?.find((f) => f.name === name);
  return field?.value || "";
}

async function autoDeleteMessage(message, delayMs = 15000) {
  if (!message) return;
  setTimeout(() => {
    message.delete().catch(() => {});
  }, delayMs);
}

async function cleanupLauncher(client, userId) {
  const launcher = ISSUE_LAUNCHERS.get(userId);
  if (!launcher) return;

  for (const item of [launcher.command, launcher.prompt]) {
    if (!item?.channelId || !item?.messageId) continue;

    const channel = await client.channels.fetch(item.channelId).catch(() => null);
    if (!channel) continue;

    const message = await channel.messages.fetch(item.messageId).catch(() => null);
    if (!message) continue;

    await message.delete().catch(() => {});
  }

  ISSUE_LAUNCHERS.delete(userId);
}

function parseIssueEmbed(message) {
  const embed = message.embeds?.[0];
  if (!embed) return null;

  const title = embed.title || "Watcher Issue Log";
  const isClosed = title.includes("CLOSED");
  const isProgress = title.includes("IN PROGRESS");

  return {
    title: getEmbedField(embed, "Issue Title") || "Untitled Issue",
    priority: getEmbedField(embed, "Priority") || "Medium",
    reportedBy: getEmbedField(embed, "Reported By") || "Unknown",
    created: getEmbedField(embed, "Created") || "Unknown",
    status: isClosed ? "Closed" : isProgress ? "In Progress" : "Open",
    assignedTo: getEmbedField(embed, "Assigned To") || "Unassigned",
    claimedBy: getEmbedField(embed, "Claimed By") || "Unclaimed",
    closedBy: getEmbedField(embed, "Closed By") || "",
    closed: getEmbedField(embed, "Closed") || "",
    details: getEmbedField(embed, "Issue Details") || "None",
    context: getEmbedField(embed, "Location / Player / Context") || "None",
    notes: getEmbedField(embed, "Notes") || "No notes yet.",
    notifications: getEmbedField(embed, "Notifications") || "None",
    resolution: getEmbedField(embed, "Resolution") || "",
  };
}

function buildIssueEmbed(data) {
  const closed = data.status === "Closed";
  const inProgress = data.status === "In Progress";

  const title = closed
    ? "✅ Watcher Issue Log — CLOSED"
    : inProgress
      ? "🟡 Watcher Issue Log — IN PROGRESS"
      : "⚠️ Watcher Issue Log — OPEN";

  const color = closed ? 0x2ecc71 : inProgress ? 0xf2c94c : 0xeb5757;

  const fields = [
    { name: "Issue Title", value: trimField(data.title, 250), inline: false },
    { name: "Priority", value: data.priority || "Medium", inline: true },
    { name: "Status", value: data.status || "Open", inline: true },
    { name: "Reported By", value: data.reportedBy || "Unknown", inline: true },
    { name: "Assigned To", value: data.assignedTo || "Unassigned", inline: true },
    { name: "Claimed By", value: data.claimedBy || "Unclaimed", inline: true },
    { name: "Created", value: data.created || serverTime(), inline: true },
    { name: "Notifications", value: trimField(data.notifications || "None", 500), inline: false },
    { name: "Issue Details", value: trimField(data.details, 1000), inline: false },
    { name: "Location / Player / Context", value: trimField(data.context || "None", 700), inline: false },
    { name: "Notes", value: trimField(data.notes || "No notes yet.", 1000), inline: false },
  ];

  if (closed) {
    fields.splice(6, 0, { name: "Closed By", value: data.closedBy || "Unknown", inline: true });
    fields.splice(7, 0, { name: "Closed", value: data.closed || serverTime(), inline: true });

    if (data.resolution) {
      fields.push({
        name: "Resolution",
        value: trimField(data.resolution, 1000),
        inline: false,
      });
    }
  }

  return new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .addFields(fields)
    .setFooter({ text: "Outpost X Staff Issue Tracker" })
    .setTimestamp();
}

function buildCreateButton() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("issue_create")
      .setLabel("Create Staff Issue")
      .setStyle(ButtonStyle.Danger)
  );
}

function buildIssueButtons(status = "Open") {
  if (status === "Closed") {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("issue_reopen")
          .setLabel("Reopen")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("issue_add_note")
          .setLabel("Add Note")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("issue_assign")
          .setLabel("Assign")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("issue_notify_owners")
          .setLabel("Notify Owners")
          .setStyle(ButtonStyle.Danger)
      ),
    ];
  }

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("issue_notify_admins")
        .setLabel("Notify Admins")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("issue_notify_owners")
        .setLabel("Notify Owners")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId("issue_assign")
        .setLabel("Assign")
        .setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("issue_claim")
        .setLabel("Claim / In Progress")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("issue_add_note")
        .setLabel("Add Note")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("issue_complete")
        .setLabel("Complete")
        .setStyle(ButtonStyle.Success)
    ),
  ];
}

function buildIssueCreateModal() {
  return new ModalBuilder()
    .setCustomId("issue_modal_create")
    .setTitle("Create Staff Issue")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("title")
          .setLabel("Issue Title")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100)
          .setPlaceholder("Example: Vehicle blocking trader access")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("details")
          .setLabel("Issue Details")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(900)
          .setPlaceholder("What happened? What needs staff attention?")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("context")
          .setLabel("Location / Player / Context")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(500)
          .setPlaceholder("Player name, grid, trader, screenshot note, etc.")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("priority")
          .setLabel("Priority: Low, Medium, High, or Owner Review")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(30)
          .setValue("Medium")
      )
    );
}

function buildAssignModal(messageId) {
  return new ModalBuilder()
    .setCustomId(`issue_modal_assign:${messageId}`)
    .setTitle("Assign Issue")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("assigned_to")
          .setLabel("Assign to name")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100)
          .setPlaceholder("Example: Nivy, Cat, Sowl, Josh, Admin team")
      )
    );
}

function buildNoteModal(messageId) {
  return new ModalBuilder()
    .setCustomId(`issue_modal_note:${messageId}`)
    .setTitle("Add Staff Note")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("note")
          .setLabel("Note")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(700)
          .setPlaceholder("Add what staff need to know.")
      )
    );
}

function buildCompleteModal(messageId) {
  return new ModalBuilder()
    .setCustomId(`issue_modal_complete:${messageId}`)
    .setTitle("Complete Issue")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("resolution")
          .setLabel("Resolution / Completion Note")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(800)
          .setPlaceholder("What was done? How was this resolved?")
      )
    );
}

function buildReopenModal(messageId) {
  return new ModalBuilder()
    .setCustomId(`issue_modal_reopen:${messageId}`)
    .setTitle("Reopen Issue")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("reason")
          .setLabel("Reason for reopening")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(700)
          .setPlaceholder("Why is this issue active again?")
      )
    );
}

function normalizePriority(input) {
  const text = (input || "Medium").trim().toLowerCase();

  if (text.includes("owner")) return "Owner Review";
  if (text.includes("high")) return "High";
  if (text.includes("low")) return "Low";
  return "Medium";
}

async function updateIssueMessage(message, data) {
  await message.edit({
    embeds: [buildIssueEmbed(data)],
    components: buildIssueButtons(data.status),
  });
}

async function handleIssueCommand(msg) {
  if (!msg.content || msg.content.trim().toLowerCase() !== "!issue") return false;

  if (!canUseIssueSystem(msg)) {
    await msg.reply("Staff issue tracking is restricted to staff in admin, main chat, or the staff issues channel.").catch(() => {});
    return true;
  }

  const prompt = await msg.reply({
    content: [
      "Create a new Watcher Issue Log entry.",
      "",
      `It will be posted in <#${STAFF_ISSUES_CHANNEL_ID}>.`,
    ].join("\n"),
    components: [buildCreateButton()],
  }).catch(() => null);

  ISSUE_LAUNCHERS.set(msg.author.id, {
    command: { channelId: msg.channelId, messageId: msg.id },
    prompt: prompt ? { channelId: prompt.channelId, messageId: prompt.id } : null,
    createdAt: Date.now(),
  });

  // Delete the raw !issue command after the button appears.
  await msg.delete().catch(() => {});

  return true;
}

async function sendTemporaryPing(interaction, payload) {
  await interaction.reply(payload).catch(() => {});
  const reply = await interaction.fetchReply().catch(() => null);
  await autoDeleteMessage(reply, 20000);
}

async function handleIssueInteraction(interaction) {
  const isIssueInteraction =
    interaction.isButton() && interaction.customId.startsWith("issue_") ||
    interaction.isModalSubmit() && interaction.customId.startsWith("issue_modal_");

  if (!isIssueInteraction) return false;

  if (!canUseIssueSystem(interaction)) {
    const payload = {
      content: "Staff issue tracking is restricted to staff in admin, main chat, or the staff issues channel.",
      flags: MessageFlags.Ephemeral,
    };

    await interaction.reply(payload).catch(() => {});
    return true;
  }

  if (interaction.isButton()) {
    if (interaction.customId === "issue_create") {
      ISSUE_LAUNCHERS.set(interaction.user.id, {
        command: ISSUE_LAUNCHERS.get(interaction.user.id)?.command || null,
        prompt: { channelId: interaction.channelId, messageId: interaction.message.id },
        createdAt: Date.now(),
      });

      await interaction.showModal(buildIssueCreateModal());
      return true;
    }

    const message = interaction.message;
    const data = parseIssueEmbed(message);

    if (!data) {
      await interaction.reply({
        content: "Could not read this issue card.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return true;
    }

    if (interaction.customId === "issue_notify_admins") {
      const entry = `Admins notified by ${interaction.user} at ${serverTime()}`;
      data.notifications = data.notifications === "None"
        ? entry
        : `${data.notifications}\n${entry}`;

      await updateIssueMessage(message, data);
      await sendTemporaryPing(interaction, {
        content: `<@&${ADMIN_ROLE_ID}> Staff issue needs review: ${message.url}`,
        allowedMentions: { roles: [ADMIN_ROLE_ID] },
      });
      return true;
    }

    if (interaction.customId === "issue_notify_owners") {
      const entry = `Owners notified by ${interaction.user} at ${serverTime()}`;
      data.notifications = data.notifications === "None"
        ? entry
        : `${data.notifications}\n${entry}`;

      await updateIssueMessage(message, data);
      await sendTemporaryPing(interaction, {
        content: `<@&${OWNERS_ROLE_ID}> Owner review requested: ${message.url}`,
        allowedMentions: { roles: [OWNERS_ROLE_ID] },
      });
      return true;
    }

    if (interaction.customId === "issue_assign") {
      if (!isOwner(interaction.member)) {
        await interaction.reply({
          content: "Only Owners can assign staff issues.",
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
        return true;
      }

      await interaction.showModal(buildAssignModal(message.id));
      return true;
    }

    if (interaction.customId === "issue_claim") {
      data.status = "In Progress";
      data.claimedBy = `${interaction.user}`;

      const note = `Claimed by ${interaction.user} at ${serverTime()}`;
      data.notes = data.notes === "No notes yet." ? note : `${data.notes}\n${note}`;

      await updateIssueMessage(message, data);
      await interaction.reply({
        content: `Issue claimed by ${interaction.user}.`,
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return true;
    }

    if (interaction.customId === "issue_add_note") {
      await interaction.showModal(buildNoteModal(message.id));
      return true;
    }

    if (interaction.customId === "issue_complete") {
      await interaction.showModal(buildCompleteModal(message.id));
      return true;
    }

    if (interaction.customId === "issue_reopen") {
      await interaction.showModal(buildReopenModal(message.id));
      return true;
    }
  }

  if (interaction.isModalSubmit()) {
    if (interaction.customId === "issue_modal_create") {
      const title = interaction.fields.getTextInputValue("title");
      const details = interaction.fields.getTextInputValue("details");
      const context = interaction.fields.getTextInputValue("context") || "None";
      const priority = normalizePriority(interaction.fields.getTextInputValue("priority"));

      const issueChannel = await interaction.client.channels.fetch(STAFF_ISSUES_CHANNEL_ID);

      const data = {
        title,
        priority,
        reportedBy: `${interaction.user}`,
        created: serverTime(),
        status: "Open",
        assignedTo: "Unassigned",
        claimedBy: "Unclaimed",
        notifications: "None",
        details,
        context,
        notes: "No notes yet.",
      };

      const issueMessage = await issueChannel.send({
        embeds: [buildIssueEmbed(data)],
        components: buildIssueButtons("Open"),
      });

      await cleanupLauncher(interaction.client, interaction.user.id);

      await interaction.reply({
        content: `Issue logged in <#${STAFF_ISSUES_CHANNEL_ID}>: ${issueMessage.url}`,
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});

      return true;
    }

    const [kind, messageId] = interaction.customId.split(":");
    const issueChannel = await interaction.client.channels.fetch(STAFF_ISSUES_CHANNEL_ID);
    const message = await issueChannel.messages.fetch(messageId).catch(() => null);

    if (!message) {
      await interaction.reply({
        content: "Could not find that issue card.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return true;
    }

    const data = parseIssueEmbed(message);
    if (!data) {
      await interaction.reply({
        content: "Could not read that issue card.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return true;
    }

    if (kind === "issue_modal_assign") {
      if (!isOwner(interaction.member)) {
        await interaction.reply({
          content: "Only Owners can assign staff issues.",
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
        return true;
      }

      const assignedTo = interaction.fields.getTextInputValue("assigned_to").trim();

      data.assignedTo = assignedTo;

      const entry = `Assigned to **${assignedTo}** by ${interaction.user} at ${serverTime()}`;
      data.notes = data.notes === "No notes yet." ? entry : `${data.notes}\n\n${entry}`;

      await updateIssueMessage(message, data);

      await interaction.reply({
        content: `Issue assigned to **${assignedTo}**.`,
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});

      return true;
    }

    if (kind === "issue_modal_note") {
      const note = interaction.fields.getTextInputValue("note");
      const entry = `${interaction.user} — ${serverTime()}:\n${note}`;
      data.notes = data.notes === "No notes yet." ? entry : `${data.notes}\n\n${entry}`;

      await updateIssueMessage(message, data);

      await interaction.reply({
        content: "Note added.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});

      return true;
    }

    if (kind === "issue_modal_complete") {
      const resolution = interaction.fields.getTextInputValue("resolution");

      data.status = "Closed";
      data.closedBy = `${interaction.user}`;
      data.closed = serverTime();
      data.resolution = resolution;

      const entry = `Closed by ${interaction.user} at ${serverTime()}`;
      data.notes = data.notes === "No notes yet." ? entry : `${data.notes}\n\n${entry}`;

      await updateIssueMessage(message, data);

      await interaction.reply({
        content: "Issue marked closed.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});

      return true;
    }

    if (kind === "issue_modal_reopen") {
      const reason = interaction.fields.getTextInputValue("reason");

      data.status = "Open";
      data.closedBy = "";
      data.closed = "";
      data.resolution = "";

      const entry = `Reopened by ${interaction.user} at ${serverTime()}:\n${reason}`;
      data.notes = data.notes === "No notes yet." ? entry : `${data.notes}\n\n${entry}`;

      await updateIssueMessage(message, data);

      await interaction.reply({
        content: "Issue reopened.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});

      return true;
    }
  }

  return false;
}

module.exports = {
  handleIssueCommand,
  handleIssueInteraction,
};
