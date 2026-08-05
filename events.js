const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  MessageFlags,
} = require("discord.js");

const { DateTime } = require("luxon");
const { mapPointData } = require("./mapCalibration");

const ADMIN_CH = process.env.ADMIN_CHANNEL_ID || "1518059656302301245";
const EVENTS_CH = process.env.EVENTS_CHANNEL_ID || "1516324485865799690";
const COMMAND_CENTER_CHANNEL_ID = process.env.WATCHER_COMMAND_CENTER_CHANNEL_ID || '1531709557997306027';
const PORTAL_MEDIA_CHANNEL_ID = process.env.WATCHER_PORTAL_MEDIA_CHANNEL_ID || process.env.ADMIN_CHANNEL_ID || COMMAND_CENTER_CHANNEL_ID;
const EXILES_ROLE_ID = process.env.EXILES_ROLE_ID || "1516270776272031796";
const SERVER_TZ = process.env.SERVER_TIMEZONE || "America/New_York";
const MAX_EVENT_IMAGES = 5;
const createSessions = {};
let schedulerStarted = false;

function isStaff(member) {
  if (!member) return false;
  const own = member.roles.cache.some((r) => r.name === "Owners");
  const adm = member.roles.cache.some((r) => r.name === "Admin");
  return own || adm;
}

function isAdminChannel(channelId) {
  return channelId === ADMIN_CH;
}

function cleanText(text, max) {
  return String(text || "").trim().slice(0, max);
}

function formatServerTime(isoTime) {
  return DateTime.fromISO(isoTime, { zone: "utc" })
    .setZone(SERVER_TZ)
    .toFormat("ccc, LLL d • h:mm a ZZZZ");
}

function recurrenceLabel(recurrence) {
  const labels = {
    none: "One-time",
    daily: "Daily",
    weekly: "Weekly",
    biweekly: "Biweekly",
    monthly: "Monthly",
  };

  return labels[recurrence] || "One-time";
}

function nextOccurrence(isoTime, recurrence) {
  const current = DateTime.fromISO(isoTime, { zone: "utc" }).setZone(SERVER_TZ);

  if (recurrence === "daily") return current.plus({ days: 1 }).toUTC().toISO();
  if (recurrence === "weekly") return current.plus({ weeks: 1 }).toUTC().toISO();
  if (recurrence === "biweekly") return current.plus({ weeks: 2 }).toUTC().toISO();
  if (recurrence === "monthly") return current.plus({ months: 1 }).toUTC().toISO();

  return null;
}

function trackMessage(session, msg) {
  if (!session || !msg) return;

  if (!session.cleanupMessages) session.cleanupMessages = [];

  session.cleanupMessages.push({
    channelId: msg.channelId,
    messageId: msg.id,
  });
}

async function deleteTrackedMessages(client, session) {
  if (!session || !session.cleanupMessages) return;

  for (const item of session.cleanupMessages) {
    try {
      const channel = await client.channels.fetch(item.channelId).catch(() => null);
      if (!channel || !channel.messages) continue;

      const message = await channel.messages.fetch(item.messageId).catch(() => null);
      if (message && message.deletable) {
        await message.delete().catch(() => {});
      }
    } catch {
      // Ignore cleanup failures.
    }
  }

  session.cleanupMessages = [];
}

async function deleteInteractionMessage(interaction) {
  try {
    if (interaction.message && interaction.message.deletable) {
      await interaction.message.delete().catch(() => {});
    }
  } catch {
    // Ignore cleanup failures.
  }
}

async function deferEphemeral(interaction) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
  }
}

async function replyOrEdit(interaction, payload) {
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(payload).catch(async () => {
      return interaction.followUp(payload).catch(() => {});
    });
  }

  return interaction.reply(payload).catch(() => {});
}

async function safeDeferUpdate(interaction) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferUpdate().catch(() => {});
  }
}

async function safeFollowUp(interaction, payload) {
  if (interaction.deferred || interaction.replied) {
    return interaction.followUp(payload).catch(() => {});
  }

  return interaction.reply(payload).catch(() => {});
}

async function safeEditSourceMessage(interaction, payload) {
  if (interaction.message) {
    return interaction.message.edit(payload).catch(async () => {
      return safeFollowUp(interaction, {
        ...payload,
        flags: MessageFlags.Ephemeral,
      });
    });
  }

  return safeFollowUp(interaction, {
    ...payload,
    flags: MessageFlags.Ephemeral,
  });
}

async function getRsvpCount(db, eventId) {
  const { count, error } = await db
    .from("event_rsvps")
    .select("*", { count: "exact", head: true })
    .eq("event_id", eventId);

  if (error) {
    console.error("❌ RSVP count error:", error);
    return 0;
  }

  return count || 0;
}

function eventButtons(eventId, disabled = false) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`event_rsvp:${eventId}`)
        .setLabel("RSVP")
        .setEmoji("✅")
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(`event_unrsvp:${eventId}`)
        .setLabel("Cancel RSVP")
        .setEmoji("❌")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(`event_details:${eventId}`)
        .setLabel("Details")
        .setEmoji("📋")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(false)
    ),
  ];
}

function parseEventCoordinates(value) {
  const raw = String(value || '').trim();
  if (!raw) return { raw: null, x: null, y: null, z: null };
  const position = raw.split('|')[0];
  const match = position.match(/\{?\s*X=([-+]?\d+(?:\.\d+)?)\s+Y=([-+]?\d+(?:\.\d+)?)\s+Z=([-+]?\d+(?:\.\d+)?)/i);
  if (!match) throw new Error('Coordinates must use the SCUM format: {X=221249.375 Y=-291857.969 Z=17184.834|P=348.760956 Y=160.196045 R=0.000000}');
  const x = Number(match[1]);
  const y = Number(match[2]);
  const z = Number(match[3]);
  if (![x, y, z].every(Number.isFinite)) throw new Error('The event coordinates are invalid.');
  return { raw: raw.slice(0, 500), x, y, z };
}

function eventMapData(event) {
  const x = Number(event?.coordinate_x);
  const y = Number(event?.coordinate_y);
  const z = Number(event?.coordinate_z);
  if (![x, y, z].every(Number.isFinite)) return null;
  return mapPointData(x, y);
}

function buildEventEmbeds(event, rsvpCount = 0, closed = false) {
  const statusLine = closed ? "\n\n**Status:** Closed" : "";
  const map = eventMapData(event);
  const locationLines = [`📍 **Location:** ${event.location}`];
  if (map) {
    locationLines.push(`🗺️ **Sector:** ${map.sector}`);
    locationLines.push(`🎯 **Coordinates:** X ${Number(event.coordinate_x).toFixed(3)} • Y ${Number(event.coordinate_y).toFixed(3)} • Z ${Number(event.coordinate_z).toFixed(3)}`);
  }
  const main = new EmbedBuilder()
    .setTitle(`${closed ? "🔒" : "📅"} Outpost X Event`)
    .setDescription(
      [
        `## ${event.title}`,
        "",
        `🕒 **Server Time:** ${formatServerTime(event.event_time)}`,
        ...locationLines,
        `🔁 **Type:** ${recurrenceLabel(event.recurrence)}`,
        `👥 **RSVPs:** ${rsvpCount}`,
        "",
        "**Description:**",
        event.description,
        statusLine,
      ].join("\n")
    )
    .setColor(closed ? 0x6b7280 : 0x3b82f6)
    .setFooter({ text: "Outpost X Events" });
  const images = Array.isArray(event.image_urls) ? event.image_urls.filter(Boolean).slice(0, MAX_EVENT_IMAGES) : [];
  if (images[0]) main.setImage(images[0]);
  return [main];
}

function decodePortalEventImages(images, prefix) {
  if (!Array.isArray(images)) return [];
  return images.slice(0, MAX_EVENT_IMAGES).map((item, index) => {
    const raw = String(item?.data || '');
    const match = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s);
    if (!match) throw new Error(`Image ${index + 1} is invalid.`);
    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length || buffer.length > 8 * 1024 * 1024) throw new Error(`Image ${index + 1} must be smaller than 8 MB.`);
    const ext = String(item?.name || '').match(/\.[a-z0-9]{2,5}$/i)?.[0] || (match[1].includes('jpeg') ? '.jpg' : '.png');
    return { attachment: buffer, name: `${prefix}-${index + 1}${ext}` };
  });
}

async function postEvent(bot, db, event) {
  const channel = await bot.channels.fetch(EVENTS_CH);
  const rsvpCount = await getRsvpCount(db, event.id);
  const embeds = buildEventEmbeds(event, rsvpCount, false);

  const msg = await channel.send({
    content: `<@&${EXILES_ROLE_ID}>`,
    embeds,
    components: eventButtons(event.id, false),
    allowedMentions: {
      roles: [EXILES_ROLE_ID],
    },
  });

  const { error } = await db
    .from("events")
    .update({
      channel_id: msg.channelId,
      message_id: msg.id,
    })
    .eq("id", event.id);

  if (error) {
    throw new Error(`Event posted to Discord, but failed to save event message ID: ${error.message}`);
  }

  return msg;
}

function isPublicEventMessage(message, eventId) {
  if (!message) return false;
  const expectedIds = new Set([
    `event_rsvp:${eventId}`,
    `event_unrsvp:${eventId}`,
    `event_details:${eventId}`,
  ]);
  return (message.components || []).some((row) =>
    (row.components || []).some((component) => expectedIds.has(String(component.customId || component.custom_id || '')))
  );
}

async function fetchPublicEventMessage(bot, event) {
  if (!event?.channel_id || !event?.message_id || String(event.message_id) === 'portal') return null;
  if (String(event.channel_id) !== String(EVENTS_CH)) return null;
  const channel = await bot.channels.fetch(String(event.channel_id)).catch(() => null);
  if (!channel?.messages) return null;
  const message = await channel.messages.fetch(String(event.message_id)).catch(() => null);
  return isPublicEventMessage(message, event.id) ? message : null;
}

async function editPublicEventMessage(db, event, message, closed = false) {
  const count = await getRsvpCount(db, event.id);
  await message.edit({
    content: `<@&${EXILES_ROLE_ID}>`,
    embeds: buildEventEmbeds(event, count, closed || event.status !== "open"),
    components: eventButtons(event.id, closed || event.status !== "open"),
    allowedMentions: { roles: [EXILES_ROLE_ID] },
  });
  return message;
}

async function ensurePublicEventPost(bot, db, event, closed = false) {
  const existingMessage = await fetchPublicEventMessage(bot, event);
  if (existingMessage) return editPublicEventMessage(db, event, existingMessage, closed);

  // Older Command Center events sometimes stored an image-upload message ID in
  // channel_id/message_id. Never treat that storage message as the public event post.
  return postEvent(bot, db, event);
}

async function updateEventPost(bot, db, event, closed = false) {
  if (!event.channel_id || !event.message_id) return;

  try {
    const message = await fetchPublicEventMessage(bot, event);
    if (!message) throw new Error('The saved Discord message is not a public event post.');
    await editPublicEventMessage(db, event, message, closed);
  } catch (err) {
    console.error("❌ Failed to update event post:", err.message);
  }
}

function buildAdminMenu() {
  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("event_admin_action")
        .setPlaceholder("Choose event action")
        .addOptions([
          {
            label: "Create Event",
            value: "create",
            emoji: "📅",
          },
          {
            label: "View Upcoming Events",
            value: "upcoming",
            emoji: "🔎",
          },
          {
            label: "Close Event",
            value: "close",
            emoji: "🔒",
          },
        ])
    ),
  ];
}

async function handleEventCommand(msg) {
  if (msg.content.toLowerCase() !== "!event") return false;

  if (!msg.guild) return true;

  if (!isAdminChannel(msg.channelId)) {
    await msg.reply(`Use \`!event\` in the admin channel only: <#${ADMIN_CH}>.`).catch(() => {});
    return true;
  }

  if (!isStaff(msg.member)) return true;

  const menuMsg = await msg.reply({
    content: "What do you want to do with events?",
    components: buildAdminMenu(),
  });

  msg.delete().catch(() => {});

  // This menu cleans itself once an option is chosen.
  return true;
}

async function beginCreate(interaction) {
  const session = {
    step: "title",
    createdAt: Date.now(),
    channelId: interaction.channelId,
    data: {},
    cleanupMessages: [],
  };

  createSessions[interaction.user.id] = session;

  await deleteInteractionMessage(interaction);

  await interaction.reply({
    content:
      "📅 **Create Event**\n\nSend the event **title** now.\n\nLimit: 100 characters.",
    flags: MessageFlags.Ephemeral,
  });
}

async function showUpcoming(interaction, db) {
  await deleteInteractionMessage(interaction);

  const { data, error } = await db
    .from("events")
    .select("*")
    .eq("status", "open")
    .order("event_time", { ascending: true })
    .limit(10);

  if (error) throw error;

  if (!data || !data.length) {
    await interaction.reply({
      content: "No upcoming open events found.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const lines = data.map((event, index) => {
    return `${index + 1}. **${event.title}** — ${formatServerTime(event.event_time)} — ${event.location}`;
  });

  await interaction.reply({
    content: `📅 **Upcoming Events**\n\n${lines.join("\n")}`,
    flags: MessageFlags.Ephemeral,
  });
}

async function showCloseMenu(interaction, db) {
  await deleteInteractionMessage(interaction);

  const { data, error } = await db
    .from("events")
    .select("*")
    .eq("status", "open")
    .order("event_time", { ascending: true })
    .limit(25);

  if (error) throw error;

  if (!data || !data.length) {
    await interaction.reply({
      content: "No open events to close.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    content: "Choose an event to close.",
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("event_close_select")
          .setPlaceholder("Choose event")
          .addOptions(
            data.map((event) => ({
              label: cleanText(event.title, 80),
              description: cleanText(formatServerTime(event.event_time), 100),
              value: event.id,
            }))
          )
      ),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

async function closeEventById(interaction, bot, db, eventId) {
  const { data: event, error } = await db
    .from("events")
    .select("*")
    .eq("id", eventId)
    .single();

  if (error) throw error;
  if (!event) {
    await interaction.reply({
      content: "Event not found.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await db.from("events").update({ status: "closed" }).eq("id", eventId);

  const closedEvent = { ...event, status: "closed" };
  await updateEventPost(bot, db, closedEvent, true);

  await interaction.reply({
    content: `🔒 Closed event: **${event.title}**`,
    flags: MessageFlags.Ephemeral,
  });
}

function buildRecurrenceMenu() {
  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("event_recurrence_select")
        .setPlaceholder("Choose recurrence")
        .addOptions([
          { label: "One-time", value: "none", emoji: "1️⃣" },
          { label: "Daily", value: "daily", emoji: "📆" },
          { label: "Weekly", value: "weekly", emoji: "🗓️" },
          { label: "Biweekly", value: "biweekly", emoji: "🔁" },
          { label: "Monthly", value: "monthly", emoji: "🌙" },
        ])
    ),
  ];
}

function buildPreviewEmbed(session) {
  const fakeEvent = {
    title: session.data.title,
    description: session.data.description,
    location: session.data.location,
    event_time: session.data.event_time,
    recurrence: session.data.recurrence,
  };

  return buildEventEmbeds(fakeEvent, 0, false)[0].setTitle("📋 Event Preview");
}

async function showPreview(interaction, session) {
  await safeEditSourceMessage(interaction, {
    content: "Review the event preview. Post it?",
    embeds: [buildPreviewEmbed(session)],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("event_confirm_create")
          .setLabel("Post Event")
          .setEmoji("✅")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId("event_cancel_create")
          .setLabel("Cancel")
          .setEmoji("❌")
          .setStyle(ButtonStyle.Danger)
      ),
    ],
  });
}

async function confirmCreate(interaction, bot, db) {
  await safeDeferUpdate(interaction);

  const session = createSessions[interaction.user.id];

  if (!session || !session.data.event_time || !session.data.recurrence) {
    await safeFollowUp(interaction, {
      content: "No event creation session found. Run `!event` again.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const insertPayload = {
    title: session.data.title,
    description: session.data.description,
    location: session.data.location,
    event_time: session.data.event_time,
    timezone: SERVER_TZ,
    recurrence: session.data.recurrence,
    status: "open",
    created_by: interaction.user.id,
  };

  try {
    const { data: event, error } = await db
      .from("events")
      .insert(insertPayload)
      .select()
      .single();

    if (error) throw error;

    const postedMessage = await postEvent(bot, db, event);

    await safeEditSourceMessage(interaction, {
      content: [
        `✅ Event posted to <#${EVENTS_CH}>.`,
        "",
        postedMessage.url,
        "",
        "Cleaning up setup messages now.",
      ].join("\n"),
      embeds: [],
      components: [],
    });

    await deleteTrackedMessages(interaction.client, session);

    delete createSessions[interaction.user.id];
  } catch (err) {
    console.error("❌ Event create failed:", err);

    await safeFollowUp(interaction, {
      content: [
        "❌ Event was not posted.",
        "",
        `Error: ${err.message}`,
        "",
        "The setup session was kept so you can try **Post Event** again or cancel.",
      ].join("\n"),
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function handleRsvp(interaction, bot, db, eventId) {
  await deferEphemeral(interaction);

  try {
    const { data: event, error: eventError } = await db
      .from("events")
      .select("*")
      .eq("id", eventId)
      .single();

    if (eventError) throw eventError;

    if (!event || event.status !== "open") {
      await replyOrEdit(interaction, {
        content: "This event is closed.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const { error } = await db.from("event_rsvps").upsert(
      {
        event_id: eventId,
        user_id: interaction.user.id,
        username: interaction.user.tag,
      },
      { onConflict: "event_id,user_id" }
    );

    if (error) throw error;

    await updateEventPost(bot, db, event, false);

    await replyOrEdit(interaction, {
      content:
        "✅ You are RSVP’d. You’ll get private reminders 24 hours before, 1 hour before, and when the event starts.",
      flags: MessageFlags.Ephemeral,
    });
  } catch (err) {
    console.error("❌ RSVP failed:", err);

    await replyOrEdit(interaction, {
      content: [
        "❌ RSVP failed.",
        "",
        "The Watcher could not save your RSVP right now.",
        `Error: ${err.message}`,
      ].join("\n"),
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function handleUnrsvp(interaction, bot, db, eventId) {
  await deferEphemeral(interaction);

  try {
    const { data: event, error: eventError } = await db
      .from("events")
      .select("*")
      .eq("id", eventId)
      .single();

    if (eventError) throw eventError;

    const { error } = await db
      .from("event_rsvps")
      .delete()
      .eq("event_id", eventId)
      .eq("user_id", interaction.user.id);

    if (error) throw error;

    if (event) await updateEventPost(bot, db, event, event.status !== "open");

    await replyOrEdit(interaction, {
      content: "❌ RSVP removed.",
      flags: MessageFlags.Ephemeral,
    });
  } catch (err) {
    console.error("❌ Cancel RSVP failed:", err);

    await replyOrEdit(interaction, {
      content: [
        "❌ Cancel RSVP failed.",
        "",
        "The Watcher could not remove your RSVP right now.",
        `Error: ${err.message}`,
      ].join("\n"),
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function handleDetails(interaction, db, eventId) {
  await deferEphemeral(interaction);

  try {
    const { data: event, error } = await db
      .from("events")
      .select("*")
      .eq("id", eventId)
      .single();

    if (error) throw error;

    if (!event) {
      await replyOrEdit(interaction, {
        content: "Event not found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const count = await getRsvpCount(db, eventId);

    await replyOrEdit(interaction, {
      embeds: buildEventEmbeds(event, count, event.status !== "open"),
      flags: MessageFlags.Ephemeral,
    });
  } catch (err) {
    console.error("❌ Event details failed:", err);

    await replyOrEdit(interaction, {
      content: [
        "❌ Could not load event details.",
        "",
        `Error: ${err.message}`,
      ].join("\n"),
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function handleEventInteraction(interaction, bot, db) {
  const customId = interaction.customId || "";

  if (!customId.startsWith("event_")) return false;

  if (customId === "event_admin_action") {
    if (!isAdminChannel(interaction.channelId) || !isStaff(interaction.member)) {
      await interaction.reply({
        content: "You cannot use event admin controls here.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const action = interaction.values[0];

    if (action === "create") await beginCreate(interaction);
    if (action === "upcoming") await showUpcoming(interaction, db);
    if (action === "close") await showCloseMenu(interaction, db);

    return true;
  }

  if (customId === "event_close_select") {
    if (!isAdminChannel(interaction.channelId) || !isStaff(interaction.member)) {
      await interaction.reply({
        content: "You cannot close events here.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    await closeEventById(interaction, bot, db, interaction.values[0]);
    return true;
  }

  if (customId === "event_recurrence_select") {
    await safeDeferUpdate(interaction);

    const session = createSessions[interaction.user.id];

    if (!session) {
      await safeFollowUp(interaction, {
        content: "No event creation session found. Run `!event` again.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    session.data.recurrence = interaction.values[0];

    await showPreview(interaction, session);
    return true;
  }

  if (customId === "event_confirm_create") {
    if (!isAdminChannel(interaction.channelId) || !isStaff(interaction.member)) {
      await interaction.reply({
        content: "You cannot create events here.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    await confirmCreate(interaction, bot, db);
    return true;
  }

  if (customId === "event_cancel_create") {
    await safeDeferUpdate(interaction);

    const session = createSessions[interaction.user.id];

    await safeEditSourceMessage(interaction, {
      content: "❌ Event creation cancelled. Setup messages cleaned up.",
      embeds: [],
      components: [],
    });

    if (session) {
      await deleteTrackedMessages(interaction.client, session);
    }

    delete createSessions[interaction.user.id];

    return true;
  }

  const [action, eventId] = customId.split(":");

  if (action === "event_rsvp") {
    await handleRsvp(interaction, bot, db, eventId);
    return true;
  }

  if (action === "event_unrsvp") {
    await handleUnrsvp(interaction, bot, db, eventId);
    return true;
  }

  if (action === "event_details") {
    await handleDetails(interaction, db, eventId);
    return true;
  }

  return false;
}

function parseEventDateTime(dateText, timeText) {
  const raw = `${dateText.trim()} ${timeText.trim()}`;
  const formats = [
    "yyyy-MM-dd h:mm a",
    "yyyy-MM-dd H:mm",
    "M/d/yyyy h:mm a",
    "M/d/yyyy H:mm",
    "M/d/yy h:mm a",
    "M/d/yy H:mm",
  ];

  for (const format of formats) {
    const dt = DateTime.fromFormat(raw, format, { zone: SERVER_TZ });

    if (dt.isValid) {
      return dt;
    }
  }

  return null;
}

async function replyAndTrack(msg, session, payload) {
  const reply = await msg.reply(payload).catch(() => null);
  trackMessage(session, reply);
  return reply;
}

async function handleEventText(msg) {
  const session = createSessions[msg.author.id];

  if (!session) return false;

  if (msg.channelId !== session.channelId) return false;

  trackMessage(session, msg);

  const age = Date.now() - session.createdAt;
  if (age > 15 * 60 * 1000) {
    await deleteTrackedMessages(msg.client, session);
    delete createSessions[msg.author.id];
    await msg.reply("Event creation expired. Run `!event` again.").catch(() => {});
    return true;
  }

  const text = msg.content.trim();

  if (session.step === "title") {
    if (!text || text.length > 100) {
      await replyAndTrack(msg, session, "Title is required and must be 100 characters or less. Send the title again.");
      return true;
    }

    session.data.title = cleanText(text, 100);
    session.step = "description";

    await replyAndTrack(msg, session, "Now send the event **description**.\n\nRequired. Limit: 900 characters.");
    return true;
  }

  if (session.step === "description") {
    if (!text || text.length > 900) {
      await replyAndTrack(msg, session, "Description is required and must be 900 characters or less. Send it again.");
      return true;
    }

    session.data.description = cleanText(text, 900);
    session.step = "location";

    await replyAndTrack(msg, session, "Now send the event **location**.\n\nRequired. Limit: 200 characters.");
    return true;
  }

  if (session.step === "location") {
    if (!text || text.length > 200) {
      await replyAndTrack(msg, session, "Location is required and must be 200 characters or less. Send it again.");
      return true;
    }

    session.data.location = cleanText(text, 200);
    session.step = "date";

    await replyAndTrack(
      msg,
      session,
      [
        "Now send the event **date** using server time.",
        "",
        "Examples:",
        "`2026-06-22`",
        "`6/22/2026`",
      ].join("\n")
    );
    return true;
  }

  if (session.step === "date") {
    session.data.date = text;
    session.step = "time";

    await replyAndTrack(
      msg,
      session,
      [
        "Now send the event **time** using server time.",
        "",
        "Examples:",
        "`8:00 PM`",
        "`20:00`",
      ].join("\n")
    );
    return true;
  }

  if (session.step === "time") {
    const dt = parseEventDateTime(session.data.date, text);

    if (!dt || !dt.isValid) {
      session.step = "date";
      await replyAndTrack(
        msg,
        session,
        [
          "I could not read that date/time.",
          "",
          "Send the date again first.",
          "Examples: `2026-06-22` or `6/22/2026`",
        ].join("\n")
      );
      return true;
    }

    if (dt <= DateTime.now().setZone(SERVER_TZ)) {
      session.step = "date";
      await replyAndTrack(msg, session, "That event time is in the past. Send the date again.");
      return true;
    }

    session.data.event_time = dt.toUTC().toISO();
    session.step = "recurrence";

    await replyAndTrack(msg, session, {
      content: "Choose whether this event repeats.",
      components: buildRecurrenceMenu(),
    });

    return true;
  }

  return false;
}

async function sendReminder(bot, db, event, label) {
  const { data: rsvps, error } = await db
    .from("event_rsvps")
    .select("user_id")
    .eq("event_id", event.id);

  if (error) {
    console.error("❌ Reminder RSVP load failed:", error);
    return;
  }

  if (!rsvps || !rsvps.length) return;

  const title =
    label === "start"
      ? "🚨 Event Starting Now"
      : "📅 Outpost X Event Reminder";

  const lead =
    label === "24h"
      ? `${event.title} starts in 24 hours.`
      : label === "1h"
        ? `${event.title} starts in 1 hour.`
        : `${event.title} is starting now.`;

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(
      [
        lead,
        "",
        `🕒 **Server Time:** ${formatServerTime(event.event_time)}`,
        `📍 **Location:** ${event.location}`,
      ].join("\n")
    )
    .setColor(label === "start" ? 0xef4444 : 0x3b82f6)
    .setFooter({ text: "Outpost X Events" });

  for (const rsvp of rsvps) {
    try {
      const user = await bot.users.fetch(rsvp.user_id);
      await user.send({ embeds: [embed] });
    } catch {
      // Silently ignore blocked/failed DMs.
    }
  }
}

async function closeAndRepostIfNeeded(bot, db, event) {
  await db.from("events").update({ status: "closed" }).eq("id", event.id);

  await updateEventPost(bot, db, { ...event, status: "closed" }, true);

  if (!event.recurrence || event.recurrence === "none") return;

  const nextTime = nextOccurrence(event.event_time, event.recurrence);
  if (!nextTime) return;

  const { data: nextEvent, error } = await db
    .from("events")
    .insert({
      title: event.title,
      description: event.description,
      location: event.location,
      event_time: nextTime,
      timezone: SERVER_TZ,
      recurrence: event.recurrence,
      status: "open",
      created_by: event.created_by,
      image_urls: Array.isArray(event.image_urls) ? event.image_urls : [],
      coordinate_raw: event.coordinate_raw || null,
      coordinate_x: event.coordinate_x ?? null,
      coordinate_y: event.coordinate_y ?? null,
      coordinate_z: event.coordinate_z ?? null,
    })
    .select()
    .single();

  if (error) {
    console.error("❌ Failed to create recurring event:", error);
    return;
  }

  await postEvent(bot, db, nextEvent);
}


async function deleteExpiredOneTimeEventPosts(bot, db, now = DateTime.utc()) {
  const cutoff = now.minus({ minutes: 30 }).toISO();

  const { data: events, error } = await db
    .from("events")
    .select("id,channel_id,message_id,event_time,recurrence,status")
    .eq("status", "closed")
    .eq("recurrence", "none")
    .not("channel_id", "is", null)
    .not("message_id", "is", null)
    .lte("event_time", cutoff)
    .limit(100);

  if (error) {
    console.error("❌ One-time event cleanup query failed:", error);
    return;
  }

  for (const event of events || []) {
    try {
      const channel = await bot.channels.fetch(String(event.channel_id)).catch(() => null);
      const message = channel?.messages
        ? await channel.messages.fetch(String(event.message_id)).catch(() => null)
        : null;

      if (message?.deletable) {
        await message.delete();
      }

      const { error: updateError } = await db
        .from("events")
        .update({ channel_id: null, message_id: null })
        .eq("id", event.id);

      if (updateError) throw updateError;
    } catch (err) {
      console.error(`❌ Failed to delete completed one-time event ${event.id}:`, err.message);
    }
  }
}

async function checkEventReminders(bot, db) {
  const now = DateTime.utc();
  const soon = now.plus({ hours: 25 }).toISO();

  const { data: events, error } = await db
    .from("events")
    .select("*")
    .eq("status", "open")
    .lte("event_time", soon)
    .order("event_time", { ascending: true });

  if (error) {
    console.error("❌ Event reminder query failed:", error);
    return;
  }

  for (const event of events || []) {
    const eventTime = DateTime.fromISO(event.event_time, { zone: "utc" });
    const diffMinutes = eventTime.diff(now, "minutes").minutes;

    try {
      if (diffMinutes <= 1440 && diffMinutes > 60 && !event.reminder_24h_sent) {
        await sendReminder(bot, db, event, "24h");
        await db.from("events").update({ reminder_24h_sent: true }).eq("id", event.id);
      }

      if (diffMinutes <= 60 && diffMinutes > 0 && !event.reminder_1h_sent) {
        await sendReminder(bot, db, event, "1h");
        await db.from("events").update({ reminder_1h_sent: true }).eq("id", event.id);
      }

      if (diffMinutes <= 0 && !event.reminder_start_sent) {
        await sendReminder(bot, db, event, "start");
        await db.from("events").update({ reminder_start_sent: true }).eq("id", event.id);
        await closeAndRepostIfNeeded(bot, db, event);
      }
    } catch (err) {
      console.error("❌ Event reminder processing failed:", err);
    }
  }

  await deleteExpiredOneTimeEventPosts(bot, db, now);
}

function startEventScheduler(bot, db) {
  if (schedulerStarted) return;

  schedulerStarted = true;

  setInterval(() => {
    checkEventReminders(bot, db).catch((err) => {
      console.error("❌ Event scheduler error:", err);
    });
  }, 60 * 1000);

  setTimeout(() => {
    checkEventReminders(bot, db).catch((err) => {
      console.error("❌ Event scheduler startup error:", err);
    });
  }, 10 * 1000);

  console.log("📅 Event scheduler started");
}


function portalEventText(value, max, field) {
  const text = cleanText(value, max);
  if (!text) throw new Error(`${field} is required.`);
  return text;
}

function portalEventIso(value) {
  const dt = DateTime.fromISO(String(value || ''), { setZone: true });
  if (!dt.isValid) throw new Error('Choose a valid event date and time.');
  return dt.toUTC().toISO();
}

function portalEventRecurrence(value) {
  const recurrence = String(value || 'none').toLowerCase();
  if (!['none', 'daily', 'weekly', 'biweekly', 'monthly'].includes(recurrence)) {
    throw new Error('Invalid recurrence option.');
  }
  return recurrence;
}

async function portalListEvents(ctx) {
  const now = DateTime.utc().minus({ hours: 12 }).toISO();
  let query = ctx.db.from('events').select('*').gte('event_time', now).order('event_time', { ascending: true }).limit(250);
  if (!ctx.isAdmin) query = query.eq('status', 'open');
  const { data: events, error } = await query;
  if (error) throw error;
  const ids = (events || []).map((event) => event.id);
  let rsvps = [];
  if (ids.length) {
    const result = await ctx.db.from('event_rsvps').select('event_id,user_id,username').in('event_id', ids);
    if (result.error) throw result.error;
    rsvps = result.data || [];
  }
  const counts = new Map();
  const mine = new Set();
  for (const row of rsvps) {
    counts.set(String(row.event_id), (counts.get(String(row.event_id)) || 0) + 1);
    if (String(row.user_id) === String(ctx.discordId)) mine.add(String(row.event_id));
  }
  return (events || []).map((event) => ({
    ...event,
    rsvp_count: counts.get(String(event.id)) || 0,
    my_rsvp: mine.has(String(event.id)),
    formatted_time: formatServerTime(event.event_time),
    recurrence_label: recurrenceLabel(event.recurrence),
    map: eventMapData(event),
  }));
}

async function getPortalEventMediaChannel(ctx) {
  const guild = ctx.bot?.guilds?.cache?.get(String(ctx.guildId));
  const channel = guild?.channels?.cache?.get(String(PORTAL_MEDIA_CHANNEL_ID))
    || guild?.channels?.cache?.get(String(COMMAND_CENTER_CHANNEL_ID));
  if (!channel?.isTextBased()) throw new Error('Watcher event media storage is unavailable.');
  return channel;
}

async function getPortalEventMediaMessage(ctx, event) {
  if (!event?.channel_id || !event?.message_id || String(event.message_id) === 'portal') return null;
  const channel = await ctx.bot.channels.fetch(String(event.channel_id)).catch(() => null);
  return channel?.messages ? channel.messages.fetch(String(event.message_id)).catch(() => null) : null;
}

async function portalRsvpEvent(ctx, eventId, attending) {
  const { data: event, error } = await ctx.db.from('events').select('*').eq('id', String(eventId)).single();
  if (error) throw error;
  if (!event || event.status !== 'open') throw new Error('This event is closed.');
  if (attending) {
    const user = await ctx.bot.users.fetch(String(ctx.discordId)).catch(() => null);
    const { error: saveError } = await ctx.db.from('event_rsvps').upsert({
      event_id: event.id,
      user_id: String(ctx.discordId),
      username: user?.tag || user?.username || String(ctx.discordId),
    }, { onConflict: 'event_id,user_id' });
    if (saveError) throw saveError;
  } else {
    const { error: deleteError } = await ctx.db.from('event_rsvps').delete().eq('event_id', event.id).eq('user_id', String(ctx.discordId));
    if (deleteError) throw deleteError;
  }
  if (event.channel_id && event.message_id && String(event.message_id) !== 'portal') await updateEventPost(ctx.bot, ctx.db, event, false).catch(() => {});
  return { ok: true, attending: !!attending };
}

async function portalCreateEvent(ctx, body) {
  if (!ctx.isAdmin) throw new Error('Admin access required.');
  const coordinates = parseEventCoordinates(body.coordinates);
  const payload = {
    title: portalEventText(body.title, 100, 'Event title'),
    description: portalEventText(body.description, 2000, 'Description'),
    location: portalEventText(body.location, 200, 'Location'),
    event_time: portalEventIso(body.eventTime), timezone: SERVER_TZ,
    recurrence: portalEventRecurrence(body.recurrence), status: 'open',
    created_by: String(ctx.discordId), image_urls: [],
    coordinate_raw: coordinates.raw, coordinate_x: coordinates.x, coordinate_y: coordinates.y, coordinate_z: coordinates.z,
    reminder_24h_sent: false, reminder_1h_sent: false, reminder_start_sent: false,
    channel_id: String(PORTAL_MEDIA_CHANNEL_ID), message_id: 'portal',
  };
  const { data: event, error } = await ctx.db.from('events').insert(payload).select().single();
  if (error) throw error;

  let finalEvent = event;
  if (Array.isArray(body.images) && body.images.length) {
    finalEvent = await portalSetEventImages(ctx, event, body.images);
  }

  await postEvent(ctx.bot, ctx.db, finalEvent);
  const { data: postedEvent, error: reloadError } = await ctx.db.from('events').select('*').eq('id', finalEvent.id).single();
  if (reloadError) throw reloadError;
  return { ok: true, event: postedEvent, discordPost:{ok:!!postedEvent.channel_id&&!!postedEvent.message_id&&String(postedEvent.message_id)!=='portal',channelId:postedEvent.channel_id||null,messageId:postedEvent.message_id||null} };
}

async function portalUpdateEvent(ctx, body) {
  if (!ctx.isAdmin) throw new Error('Admin access required.');
  const id = String(body.id || ''); if (!id) throw new Error('Event ID is required.');
  const { data: existing, error: loadError } = await ctx.db.from('events').select('*').eq('id', id).single(); if (loadError) throw loadError;
  const coordinates = parseEventCoordinates(body.coordinates);
  const payload = {title:portalEventText(body.title,100,'Event title'),description:portalEventText(body.description,2000,'Description'),location:portalEventText(body.location,200,'Location'),event_time:portalEventIso(body.eventTime),recurrence:portalEventRecurrence(body.recurrence),coordinate_raw:coordinates.raw,coordinate_x:coordinates.x,coordinate_y:coordinates.y,coordinate_z:coordinates.z,reminder_24h_sent:false,reminder_1h_sent:false,reminder_start_sent:false};
  const { data: event, error } = await ctx.db.from('events').update(payload).eq('id', id).select().single(); if (error) throw error;
  let finalEvent={...existing,...event};
  if(body.replaceImages===true) finalEvent=await portalSetEventImages(ctx,finalEvent,Array.isArray(body.images)?body.images:[]);

  await ensurePublicEventPost(ctx.bot,ctx.db,finalEvent,finalEvent.status!=='open');

  const {data:reloaded,error:reloadError}=await ctx.db.from('events').select('*').eq('id',id).single();
  if(reloadError)throw reloadError;
  return {ok:true,event:reloaded,discordPost:{ok:!!reloaded.channel_id&&!!reloaded.message_id&&String(reloaded.message_id)!=='portal',channelId:reloaded.channel_id||null,messageId:reloaded.message_id||null}};
}

async function uploadPortalEventImagesToStorage(ctx, event, files) {
  const bucket=String(process.env.PORTAL_EVENT_IMAGE_BUCKET||process.env.PORTAL_MAP_STORAGE_BUCKET||'outpost-x-static').trim();
  if(!bucket||!ctx.db?.storage||!files.length)return [];
  const urls=[];
  for(let i=0;i<files.length;i++){
    const file=files[i];
    const ext=(String(file.name||'image.png').split('.').pop()||'png').replace(/[^a-z0-9]/gi,'').toLowerCase()||'png';
    const objectPath=`event-images/${event.id}/${Date.now()}-${i}.${ext}`;
    const {error}=await ctx.db.storage.from(bucket).upload(objectPath,file.attachment,{contentType:file.contentType||'image/png',cacheControl:'31536000',upsert:true});
    if(error)throw error;
    const {data}=ctx.db.storage.from(bucket).getPublicUrl(objectPath);
    if(data?.publicUrl)urls.push(data.publicUrl);
  }
  return urls;
}

async function portalSetEventImages(ctx, event, images) {
  if (!ctx.isAdmin) throw new Error('Admin access required.');
  const files=decodePortalEventImages(images,`event-${event.id}`);
  let urls=[];

  if(files.length){
    try{
      urls=(await uploadPortalEventImagesToStorage(ctx,event,files)).slice(0,MAX_EVENT_IMAGES);
    }catch(storageError){
      console.warn(`⚠️ Event image Supabase mirror failed; using Discord storage: ${storageError.message}`);
      const channel=await getPortalEventMediaChannel(ctx);
      const storageMessage=await channel.send({content:`Portal media storage • Event • ${event.title}`,files,allowedMentions:{parse:[]}});
      urls=[...storageMessage.attachments.values()].map(a=>a.url).slice(0,MAX_EVENT_IMAGES);
    }
  }

  const patch={image_urls:urls};
  const {data:updated,error}=await ctx.db.from('events').update(patch).eq('id',event.id).select('*').single();
  if(error)throw error;
  return updated;
}

async function portalSetEventStatus(ctx, body) {
  if (!ctx.isAdmin) throw new Error('Admin access required.');
  const id=String(body.id||''); const status=body.status==='open'?'open':'closed';
  const {data:event,error}=await ctx.db.from('events').update({status}).eq('id',id).select().single();if(error)throw error;
  await ensurePublicEventPost(ctx.bot,ctx.db,event,status!=='open');
  const {data:reloaded,error:reloadError}=await ctx.db.from('events').select('*').eq('id',id).single();
  if(reloadError)throw reloadError;
  return {ok:true,event:reloaded};
}


async function portalRetryEventPost(ctx, eventId) {
  if (!ctx.isAdmin) throw new Error('Admin access required.');
  const id=String(eventId||'');
  const {data:event,error}=await ctx.db.from('events').select('*').eq('id',id).single();
  if(error)throw error;
  const message=await ensurePublicEventPost(ctx.bot,ctx.db,event,event.status!=='open');
  const {data:reloaded,error:reloadError}=await ctx.db.from('events').select('*').eq('id',id).single();
  if(reloadError)throw reloadError;
  return {ok:true,event:reloaded,discordPost:{ok:true,channelId:reloaded.channel_id,messageId:reloaded.message_id,url:message?.url||null}};
}

async function portalDeleteEvent(ctx, eventId) {
  if (!ctx.isAdmin) throw new Error('Admin access required.');
  const id=String(eventId||'');
  const {data:event,error:loadError}=await ctx.db.from('events').select('*').eq('id',id).single();if(loadError)throw loadError;
  const message=await getPortalEventMediaMessage(ctx,event);await message?.delete().catch(()=>{});
  const rsvpDelete=await ctx.db.from('event_rsvps').delete().eq('event_id',id);if(rsvpDelete.error)throw rsvpDelete.error;
  const deleted=await ctx.db.from('events').delete().eq('id',id);if(deleted.error)throw deleted.error;
  return {ok:true};
}

module.exports = {
  handleEventCommand,
  handleEventInteraction,
  handleEventText,
  startEventScheduler,
  portalListEvents,
  portalRsvpEvent,
  portalCreateEvent,
  portalUpdateEvent,
  portalSetEventStatus,
  portalDeleteEvent,
  portalRetryEventPost,
};