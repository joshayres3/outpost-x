const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const CONFIG_TABLE = 'watcher_ticket_config';
const TICKETS_TABLE = 'watcher_tickets';
const RETENTION_DAYS = 30;
const STAFF_ROLE_NAMES = new Set(['Owner', 'Owners', 'Admin', 'Trial Admin']);

let clientRef = null;
let dbRef = null;
let cleanupTimer = null;

function isStaff(member) {
  return !!member?.roles?.cache?.some((r) => STAFF_ROLE_NAMES.has(r.name));
}

function safeName(input) {
  return String(input || 'player')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70) || 'player';
}

async function getConfig(guildId) {
  const { data, error } = await dbRef.from(CONFIG_TABLE).select('*').eq('guild_id', guildId).maybeSingle();
  if (error) throw error;
  return data;
}

async function saveConfig(guildId, patch) {
  const { error } = await dbRef.from(CONFIG_TABLE).upsert({ guild_id: guildId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'guild_id' });
  if (error) throw error;
}

function ticketPanelPayload(imageUrl) {
  const embed = new EmbedBuilder()
    .setTitle('🎟️ Open a Ticket')
    .setDescription('Need help? Open a private ticket and an admin will assist you.')
    .setFooter({ text: 'Outpost X Support • One open ticket per player' });
  if (imageUrl) embed.setImage(imageUrl);
  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket:open').setLabel('Open a Ticket').setEmoji('📨').setStyle(ButtonStyle.Danger)
    )],
  };
}

async function handleTicketCommand(message) {
  if (!message.guild || !message.content?.startsWith('!')) return false;
  const command = message.content.trim().split(/\s+/)[0].toLowerCase();
  if (!['!ticketsetup', '!ticketlogsetup', '!ticketstatus'].includes(command)) return false;
  if (!isStaff(message.member)) {
    await message.reply('This ticket setup command is for staff only.').catch(() => {});
    return true;
  }

  try {
    if (command === '!ticketsetup') {
      const imageUrl = message.attachments.first()?.url || null;
      const panel = await message.channel.send(ticketPanelPayload(imageUrl));
      await saveConfig(message.guildId, {
        panel_channel_id: message.channelId,
        panel_message_id: panel.id,
        category_id: message.channel.parentId || null,
        panel_image_url: imageUrl,
      });
      await message.delete().catch(() => {});
      return true;
    }

    if (command === '!ticketlogsetup') {
      await saveConfig(message.guildId, { log_channel_id: message.channelId });
      await message.reply('✅ Ticket transcripts will be saved in this channel and removed after 30 days.').catch(() => {});
      return true;
    }

    const cfg = await getConfig(message.guildId);
    await message.reply([
      '**Watcher Ticket System**',
      `Panel: ${cfg?.panel_channel_id ? `<#${cfg.panel_channel_id}>` : 'Not set'}`,
      `Logs: ${cfg?.log_channel_id ? `<#${cfg.log_channel_id}>` : 'Not set'}`,
      `Retention: ${RETENTION_DAYS} days`,
    ].join('\n'));
    return true;
  } catch (err) {
    await message.reply(`Ticket setup error: ${err.message}`).catch(() => {});
    return true;
  }
}

async function getOpenTicket(guildId, userId) {
  const { data, error } = await dbRef.from(TICKETS_TABLE).select('*').eq('guild_id', guildId).eq('opener_id', userId).eq('status', 'open').maybeSingle();
  if (error) throw error;
  return data;
}

async function linkedPlayer(guildId, userId) {
  const { data } = await dbRef.from(process.env.WATCHER_PLAYER_LINKS_TABLE || 'watcher_player_links')
    .select('*').eq('guild_id', guildId).eq('discord_user_id', userId).maybeSingle();
  return data || null;
}

async function createTicket(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const cfg = await getConfig(interaction.guildId);
  if (!cfg?.panel_channel_id || !cfg?.log_channel_id) {
    await interaction.editReply('The ticket system is not fully configured yet.');
    return;
  }
  const existing = await getOpenTicket(interaction.guildId, interaction.user.id);
  if (existing) {
    const ch = interaction.guild.channels.cache.get(existing.channel_id);
    await interaction.editReply(ch ? `You already have an open ticket: ${ch}` : 'You already have an open ticket.');
    return;
  }

  const adminRole = interaction.guild.roles.cache.find((r) => r.name === 'Admin');
  const botMember = interaction.guild.members.me;
  const channel = await interaction.guild.channels.create({
    name: `ticket-${safeName(interaction.user.displayName || interaction.user.username)}`,
    type: ChannelType.GuildText,
    parent: cfg.category_id || interaction.channel.parentId || null,
    topic: `Outpost X ticket opened by ${interaction.user.tag} (${interaction.user.id})`,
    permissionOverwrites: [
      { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
      ...(adminRole ? [{ id: adminRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] }] : []),
      ...(botMember ? [{ id: botMember.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages] }] : []),
    ],
  });

  const panelChannel = interaction.guild.channels.cache.get(cfg.panel_channel_id);
  if (panelChannel && channel.parentId === panelChannel.parentId) {
    await channel.setPosition(panelChannel.position + 1).catch(() => {});
  }

  const link = await linkedPlayer(interaction.guildId, interaction.user.id);
  const { data, error } = await dbRef.from(TICKETS_TABLE).insert({
    guild_id: interaction.guildId,
    channel_id: channel.id,
    opener_id: interaction.user.id,
    opener_tag: interaction.user.tag,
    steam_id: link?.steam_id || null,
    scum_name: link?.player_name || link?.scum_name || null,
    status: 'open',
    opened_at: new Date().toISOString(),
  }).select('*').single();
  if (error) throw error;

  const details = link
    ? `**Linked SCUM:** ${link.player_name || link.scum_name || 'Unknown'}\n**Steam ID:** \`${link.steam_id}\``
    : '**Linked SCUM:** Not registered';

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ticket:claim:${data.id}`).setLabel('Claim').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`ticket:refresh:${data.id}`).setLabel('Refresh Player Data').setStyle(ButtonStyle.Secondary),
    ...(link?.steam_id ? [new ButtonBuilder().setCustomId(`ticket:panel:${link.steam_id}`).setLabel('Open Player Panel').setStyle(ButtonStyle.Secondary)] : []),
    new ButtonBuilder().setCustomId(`ticket:close:${data.id}`).setLabel('Close Ticket').setStyle(ButtonStyle.Danger),
  );

  await channel.send({
    content: `${adminRole ? adminRole.toString() : '@Admin'} ${interaction.user}`,
    embeds: [new EmbedBuilder()
      .setTitle('Outpost X Support Ticket')
      .setDescription(`Thanks for opening a ticket. Please explain what you need help with.\n\n${details}`)
      .setFooter({ text: `Ticket ID ${data.id}` })],
    components: [row],
    allowedMentions: { roles: adminRole ? [adminRole.id] : [], users: [interaction.user.id] },
  });

  await interaction.editReply(`Your private ticket is ready: ${channel}`);
}

async function fetchTicket(ticketId) {
  const { data, error } = await dbRef.from(TICKETS_TABLE).select('*').eq('id', ticketId).maybeSingle();
  if (error) throw error;
  return data;
}

async function buildTranscript(channel) {
  const collected = [];
  let before;
  while (collected.length < 2000) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (!batch.size) break;
    collected.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  collected.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  return collected.map((m) => {
    const attachments = [...m.attachments.values()].map((a) => a.url).join(' ');
    const body = [m.cleanContent || '', attachments].filter(Boolean).join(' ');
    return `[${new Date(m.createdTimestamp).toISOString()}] ${m.author.tag}: ${body}`;
  }).join('\n') || '(No messages)';
}

function closeModal(ticketId) {
  return new ModalBuilder().setCustomId(`ticket:closemodal:${ticketId}`).setTitle('Close Ticket').addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('reason').setLabel('Reason for closing').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500)
    )
  );
}

async function closeTicket(interaction, ticketId) {
  if (!isStaff(interaction.member)) return interaction.reply({ content: 'Staff only.', ephemeral: true });
  const ticket = await fetchTicket(ticketId);
  if (!ticket || ticket.status !== 'open') return interaction.reply({ content: 'This ticket is already closed.', ephemeral: true });
  await interaction.deferReply({ ephemeral: true });
  const reason = interaction.fields.getTextInputValue('reason').trim();
  const transcript = await buildTranscript(interaction.channel);
  const cfg = await getConfig(interaction.guildId);
  const logChannel = interaction.guild.channels.cache.get(cfg?.log_channel_id);
  if (!logChannel?.isTextBased()) throw new Error('Ticket log channel is not available.');

  const closedAt = new Date();
  const attachment = new AttachmentBuilder(Buffer.from(transcript, 'utf8'), { name: `ticket-${ticket.id}-transcript.txt` });
  const log = await logChannel.send({
    embeds: [new EmbedBuilder()
      .setTitle(`Ticket Closed — ${interaction.channel.name}`)
      .addFields(
        { name: 'Opened by', value: `<@${ticket.opener_id}>`, inline: true },
        { name: 'Closed by', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'Reason', value: reason },
        { name: 'Opened', value: `<t:${Math.floor(new Date(ticket.opened_at).getTime()/1000)}:f>`, inline: true },
        { name: 'Closed', value: `<t:${Math.floor(closedAt.getTime()/1000)}:f>`, inline: true },
      )
      .setFooter({ text: `Automatically removed after ${RETENTION_DAYS} days` })],
    files: [attachment],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`ticket:transcript:${ticket.id}`).setLabel('Show Transcript').setEmoji('📄').setStyle(ButtonStyle.Secondary)
    )],
    allowedMentions: { parse: [] },
  });

  const transcriptUrl = log.attachments.first()?.url || null;
  await dbRef.from(TICKETS_TABLE).update({
    status: 'closed', closed_by_id: interaction.user.id, close_reason: reason,
    closed_at: closedAt.toISOString(), log_message_id: log.id, transcript_url: transcriptUrl,
    delete_after: new Date(closedAt.getTime() + RETENTION_DAYS * 86400000).toISOString(),
  }).eq('id', ticket.id);

  const opener = await interaction.guild.members.fetch(ticket.opener_id).catch(() => null);
  await opener?.send(`Your Outpost X ticket was closed by ${interaction.user.tag}.\nReason: ${reason}`).catch(() => {});
  await interaction.editReply('Ticket closed. Transcript saved to the log channel.');
  setTimeout(() => interaction.channel.delete(`Ticket closed by ${interaction.user.tag}: ${reason}`).catch(() => {}), 5000);
}

async function handleTicketInteraction(interaction, openAdminPanelForSteamId) {
  const id = String(interaction.customId || '');
  if (!id.startsWith('ticket:')) return false;
  try {
    if (id === 'ticket:open' && interaction.isButton()) await createTicket(interaction);
    else if (id.startsWith('ticket:close:') && interaction.isButton()) {
      if (!isStaff(interaction.member)) await interaction.reply({ content: 'Staff only.', ephemeral: true });
      else await interaction.showModal(closeModal(id.split(':')[2]));
    } else if (id.startsWith('ticket:closemodal:') && interaction.isModalSubmit()) {
      await closeTicket(interaction, id.split(':')[2]);
    } else if (id.startsWith('ticket:claim:') && interaction.isButton()) {
      if (!isStaff(interaction.member)) await interaction.reply({ content: 'Staff only.', ephemeral: true });
      else {
        const ticketId = id.split(':')[2];
        await dbRef.from(TICKETS_TABLE).update({ claimed_by_id: interaction.user.id }).eq('id', ticketId);
        await interaction.reply({ content: `Ticket claimed by ${interaction.user}.` });
      }
    } else if (id.startsWith('ticket:refresh:') && interaction.isButton()) {
      if (!isStaff(interaction.member)) await interaction.reply({ content: 'Staff only.', ephemeral: true });
      else {
        const ticket = await fetchTicket(id.split(':')[2]);
        const link = await linkedPlayer(interaction.guildId, ticket.opener_id);
        await interaction.reply({ content: link ? `SCUM: **${link.player_name || link.scum_name || 'Unknown'}**\nSteam ID: \`${link.steam_id}\`` : 'Player is not linked to a SCUM account.', ephemeral: true });
      }
    } else if (id.startsWith('ticket:panel:') && interaction.isButton()) {
      if (!isStaff(interaction.member)) await interaction.reply({ content: 'Staff only.', ephemeral: true });
      else await openAdminPanelForSteamId(interaction, id.split(':')[2]);
    } else if (id.startsWith('ticket:transcript:') && interaction.isButton()) {
      if (!isStaff(interaction.member)) await interaction.reply({ content: 'Staff only.', ephemeral: true });
      else {
        const ticket = await fetchTicket(id.split(':')[2]);
        if (!ticket?.transcript_url) await interaction.reply({ content: 'Transcript is unavailable.', ephemeral: true });
        else await interaction.reply({ content: `Transcript: ${ticket.transcript_url}`, ephemeral: true });
      }
    }
    return true;
  } catch (err) {
    console.error('Ticket interaction error:', err);
    const payload = { content: `Ticket error: ${err.message}`, ephemeral: true };
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
    return true;
  }
}

async function cleanupTicketLogs() {
  const now = new Date().toISOString();
  const { data, error } = await dbRef.from(TICKETS_TABLE).select('*').eq('status', 'closed').lte('delete_after', now);
  if (error) throw error;
  for (const ticket of data || []) {
    const cfg = await getConfig(ticket.guild_id).catch(() => null);
    const guild = clientRef.guilds.cache.get(ticket.guild_id);
    const channel = guild?.channels.cache.get(cfg?.log_channel_id);
    if (channel?.isTextBased() && ticket.log_message_id) {
      const msg = await channel.messages.fetch(ticket.log_message_id).catch(() => null);
      await msg?.delete().catch(() => {});
    }
    await dbRef.from(TICKETS_TABLE).delete().eq('id', ticket.id);
  }
}

function startTicketSystem(client, db) {
  clientRef = client;
  dbRef = db;
  cleanupTicketLogs().catch((e) => console.error('Ticket cleanup failed:', e.message));
  if (cleanupTimer) clearInterval(cleanupTimer);
  cleanupTimer = setInterval(() => cleanupTicketLogs().catch((e) => console.error('Ticket cleanup failed:', e.message)), 6 * 60 * 60 * 1000);
}

module.exports = { startTicketSystem, handleTicketCommand, handleTicketInteraction };
