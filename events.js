const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} = require("discord.js");

const { DateTime } = require("luxon");

const ADMIN_CH = process.env.ADMIN_CHANNEL_ID || "1518059656302301245";
const EVENTS_CH = process.env.EVENTS_CHANNEL_ID || "1516324485865799690";
const EXILES_ROLE_ID = process.env.EXILES_ROLE_ID || "1516270776272031796";
const SERVER_TZ = process.env.SERVER_TIMEZONE || "America/New_York";

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

function buildEventEmbed(event, rsvpCount = 0, closed = false) {
  const statusLine = closed ? "\n\n**Status:** Closed" : "";

  return new EmbedBuilder()
    .setTitle(`${closed ? "🔒" : "📅"} Outpost X Event`)
    .setDescription(
      [
        `## ${event.title}`,
        "",
        `🕒 **Server Time:** ${formatServerTime(event.event_time)}`,
        `📍 **Location:** ${event.location}`,
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
}

async function postEvent(bot, db, event) {
  const channel = await bot.channels.fetch(EVENTS_CH);
  const rsvpCount = await getRsvpCount(db, event.id);
  const embed = buildEventEmbed(event, rsvpCount, false);

  const msg = await channel.send({
    content: `<@&${EXILES_ROLE_ID}>`,
    embeds: [embed],
    components: eventButtons(event.id, false),
    allowedMentions: {
      roles: [EXILES_ROLE_ID],
    },
  });

  await db
    .from("events")
    .update({
      channel_id: msg.channelId,
      message_id: msg.id,
    })
    .eq("id", event.id);

  return msg;
}

async function updateEventPost(bot, db, event, closed = false) {
  if (!event.channel_id || !event.message_id) return;

  try {
    const channel = await bot.channels.fetch(event.channel_id);
    const msg = await channel.messages.fetch(event.message_id);
    const count = await getRsvpCount(db, event.id);

    await msg.edit({
      embeds: [buildEventEmbed(event, count, closed || event.status !== "open")],
      components: eventButtons(event.id, closed || event.status !== "open"),
    });
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
    ephemeral: true,
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
      ephemeral: true,
    });
    return;
  }

  const lines = data.map((event, index) => {
    return `${index + 1}. **${event.title}** — ${formatServerTime(event.event_time)} — ${event.location}`;
  });

  await interaction.reply({
    content: `📅 **Upcoming Events**\n\n${lines.join("\n")}`,
    ephemeral: true,
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
      ephemeral: true,
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
    ephemeral: true,
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
      ephemeral: true,
    });
    return;
  }

  await db.from("events").update({ status: "closed" }).eq("id", eventId);

  const closedEvent = { ...event, status: "closed" };
  await updateEventPost(bot, db, closedEvent, true);

  await interaction.reply({
    content: `🔒 Closed event: **${event.title}**`,
    ephemeral: true,
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

  return buildEventEmbed(fakeEvent, 0, false).setTitle("📋 Event Preview");
}

async function showPreview(interaction, session) {
  await interaction.reply({
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
    ephemeral: true,
  });
}

async function confirmCreate(interaction, bot, db) {
  const session = createSessions[interaction.user.id];

  if (!session || !session.data.event_time || !session.data.recurrence) {
    await interaction.reply({
      content: "No event creation session found. Run `!event` again.",
      ephemeral: true,
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

  const { data: event, error } = await db
    .from("events")
    .insert(insertPayload)
    .select()
    .single();

  if (error) throw error;

  await postEvent(bot, db, event);

  await deleteTrackedMessages(interaction.client, session);

  delete createSessions[interaction.user.id];

  await interaction.reply({
    content: `✅ Event posted in <#${EVENTS_CH}>. Setup messages cleaned up.`,
    ephemeral: true,
  });
}

async function handleRsvp(interaction, bot, db, eventId) {
  const { data: event, error: eventError } = await db
    .from("events")
    .select("*")
    .eq("id", eventId)
    .single();

  if (eventError) throw eventError;

  if (!event || event.status !== "open") {
    await interaction.reply({
      content: "This event is closed.",
      ephemeral: true,
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

  await interaction.reply({
    content:
      "✅ You are RSVP’d. You’ll get private reminders 24 hours before, 1 hour before, and when the event starts.",
    ephemeral: true,
  });
}

async function handleUnrsvp(interaction, bot, db, eventId) {
  const { data: event, error: eventError } = await db
    .from("events")
    .select("*")
    .eq("id", eventId)
    .single();

  if (eventError) throw eventError;

  await db
    .from("event_rsvps")
    .delete()
    .eq("event_id", eventId)
    .eq("user_id", interaction.user.id);

  if (event) await updateEventPost(bot, db, event, event.status !== "open");

  await interaction.reply({
    content: "❌ RSVP removed.",
    ephemeral: true,
  });
}

async function handleDetails(interaction, db, eventId) {
  const { data: event, error } = await db
    .from("events")
    .select("*")
    .eq("id", eventId)
    .single();

  if (error) throw error;

  if (!event) {
    await interaction.reply({
      content: "Event not found.",
      ephemeral: true,
    });
    return;
  }

  const count = await getRsvpCount(db, eventId);

  await interaction.reply({
    embeds: [buildEventEmbed(event, count, event.status !== "open")],
    ephemeral: true,
  });
}

async function handleEventInteraction(interaction, bot, db) {
  const customId = interaction.customId || "";

  if (!customId.startsWith("event_")) return false;

  if (customId === "event_admin_action") {
    if (!isAdminChannel(interaction.channelId) || !isStaff(interaction.member)) {
      await interaction.reply({
        content: "You cannot use event admin controls here.",
        ephemeral: true,
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
        ephemeral: true,
      });
      return true;
    }

    await closeEventById(interaction, bot, db, interaction.values[0]);
    return true;
  }

  if (customId === "event_recurrence_select") {
    const session = createSessions[interaction.user.id];

    if (!session) {
      await interaction.reply({
        content: "No event creation session found. Run `!event` again.",
        ephemeral: true,
      });
      return true;
    }

    session.data.recurrence = interaction.values[0];

    await deleteTrackedMessages(interaction.client, session);

    await showPreview(interaction, session);
    return true;
  }

  if (customId === "event_confirm_create") {
    if (!isAdminChannel(interaction.channelId) || !isStaff(interaction.member)) {
      await interaction.reply({
        content: "You cannot create events here.",
        ephemeral: true,
      });
      return true;
    }

    await confirmCreate(interaction, bot, db);
    return true;
  }

  if (customId === "event_cancel_create") {
    const session = createSessions[interaction.user.id];

    if (session) {
      await deleteTrackedMessages(interaction.client, session);
    }

    delete createSessions[interaction.user.id];

    await interaction.reply({
      content: "❌ Event creation cancelled. Setup messages cleaned up.",
      ephemeral: true,
    });
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
    })
    .select()
    .single();

  if (error) {
    console.error("❌ Failed to create recurring event:", error);
    return;
  }

  await postEvent(bot, db, nextEvent);
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

module.exports = {
  handleEventCommand,
  handleEventInteraction,
  handleEventText,
  startEventScheduler,
};
