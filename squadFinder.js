const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require('discord.js');

const CONFIG_TABLE = 'watcher_squad_finder_config';
const LISTINGS_TABLE = 'watcher_squad_listings';
const STAFF_ROLE_NAMES = new Set(['Owner', 'Owners', 'Admin', 'Trial Admin', 'Baby Admin']);
const DIRECTORY_LIMIT = 10;
const BROWSE_PAGE_SIZE = 20;
const COMMAND_CENTER_CHANNEL_ID = process.env.WATCHER_COMMAND_CENTER_CHANNEL_ID || '1531709557997306027';

let clientRef = null;
let dbRef = null;

function isStaff(member) {
  return !!member?.roles?.cache?.some((r) => STAFF_ROLE_NAMES.has(r.name));
}

function ephemeral(content, components = [], embeds = []) {
  return { content, components, embeds, flags: MessageFlags.Ephemeral };
}

async function getConfig(guildId) {
  const { data, error } = await dbRef.from(CONFIG_TABLE).select('*').eq('guild_id', String(guildId)).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function saveConfig(guildId, patch) {
  const { error } = await dbRef.from(CONFIG_TABLE).upsert({
    guild_id: String(guildId),
    ...patch,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'guild_id' });
  if (error) throw error;
}

async function getListingByOwner(guildId, ownerId) {
  const { data, error } = await dbRef.from(LISTINGS_TABLE)
    .select('*')
    .eq('guild_id', String(guildId))
    .eq('owner_id', String(ownerId))
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function getListingById(guildId, listingId) {
  const { data, error } = await dbRef.from(LISTINGS_TABLE)
    .select('*')
    .eq('guild_id', String(guildId))
    .eq('id', String(listingId))
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function getListings(guildId) {
  const { data, error } = await dbRef.from(LISTINGS_TABLE)
    .select('*')
    .eq('guild_id', String(guildId))
    .order('is_recruiting', { ascending: false })
    .order('squad_name', { ascending: true });
  if (error) throw error;
  return data || [];
}

function listingJumpUrl(listing) {
  if (!listing?.guild_id || !listing?.channel_id || !listing?.message_id) return null;
  return `https://discord.com/channels/${listing.guild_id}/${listing.channel_id}/${listing.message_id}`;
}

function directoryPayload(listings) {
  const recruiting = listings.filter((l) => l.is_recruiting).length;
  const lines = listings.slice(0, DIRECTORY_LIMIT).map((listing, i) => {
    const status = listing.is_recruiting ? '🟢' : '🔴';
    const url = listingJumpUrl(listing);
    const name = url ? `[${listing.squad_name}](${url})` : `**${listing.squad_name}**`;
    const meta = [listing.play_style, listing.active_times].filter(Boolean).join(' • ');
    return `${i + 1}. ${status} ${name}${meta ? ` — ${meta}` : ''}`;
  });
  if (!lines.length) lines.push('*No squads have posted a listing yet.*');
  if (listings.length > DIRECTORY_LIMIT) lines.push(`\n*+ ${listings.length - DIRECTORY_LIMIT} more — use **Browse Squads** to see the full list.*`);

  const embed = new EmbedBuilder()
    .setTitle('👥 Outpost X Squad Finder')
    .setDescription([
      'Find a squad to survive with, or post your own squad if you are recruiting.',
      '',
      '**Current Squad Listings**',
      ...lines,
      '',
      `**${listings.length} squad listing${listings.length === 1 ? '' : 's'} • ${recruiting} recruiting**`,
    ].join('\n'))
    .setFooter({ text: 'Listings are managed by the player who created them. Staff can remove listings when needed.' });

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('squad:create').setLabel('Post My Squad').setEmoji('➕').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('squad:mine').setLabel('My Listing').setEmoji('⚙️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('squad:browse:0').setLabel('Browse Squads').setEmoji('🔎').setStyle(ButtonStyle.Primary),
    )],
  };
}

function listingEmbed(listing) {
  return new EmbedBuilder()
    .setTitle(`${listing.is_recruiting ? '🟢' : '🔴'} ${listing.squad_name}`)
    .setDescription(listing.description || '*No description provided.*')
    .addFields(
      { name: 'Recruiting', value: listing.is_recruiting ? '🟢 Yes' : '🔴 Not right now', inline: true },
      { name: 'Members', value: listing.member_count || 'Not listed', inline: true },
      { name: 'Voice Chat', value: listing.voice_chat || 'Not listed', inline: true },
      { name: 'Play Style', value: listing.play_style || 'Not listed', inline: true },
      { name: 'Usually Active', value: listing.active_times || 'Not listed', inline: true },
      { name: 'Contact', value: `<@${listing.owner_id}>`, inline: true },
    )
    .setFooter({ text: `Last updated ${new Date(listing.updated_at || Date.now()).toLocaleString('en-US')}` });
}

function createModal() {
  return new ModalBuilder().setCustomId('squad:create:submit').setTitle('Post Your Squad').addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('Squad name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('members').setLabel('Current member count').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(30).setPlaceholder('Example: 4')),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('style').setLabel('Play style').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100).setPlaceholder('PvE, building, looting, casual, etc.')),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('times').setLabel('Usually active').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100).setPlaceholder('Example: Evenings EST')),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('description').setLabel('What should players know?').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000).setPlaceholder('Describe your squad and the kind of players you are looking for.')),
  );
}

function editModal(listing) {
  return new ModalBuilder().setCustomId(`squad:edit:submit:${listing.id}`).setTitle('Edit Squad Listing').addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('Squad name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80).setValue(String(listing.squad_name || '').slice(0, 80))),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('members').setLabel('Current member count').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(30).setValue(String(listing.member_count || '').slice(0, 30))),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('style').setLabel('Play style').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100).setValue(String(listing.play_style || '').slice(0, 100))),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('times').setLabel('Usually active').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100).setValue(String(listing.active_times || '').slice(0, 100))),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('description').setLabel('What should players know?').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000).setValue(String(listing.description || '').slice(0, 1000))),
  );
}

function managePayload(listing, staff = false) {
  const jump = listingJumpUrl(listing);
  const rows = [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`squad:edit:${listing.id}`).setLabel('Edit Listing').setEmoji('✏️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`squad:toggle:${listing.id}`).setLabel(listing.is_recruiting ? 'Stop Recruiting' : 'Start Recruiting').setEmoji(listing.is_recruiting ? '🔴' : '🟢').setStyle(listing.is_recruiting ? ButtonStyle.Secondary : ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`squad:voice:${listing.id}`).setLabel('Voice Chat').setEmoji('🎙️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`squad:delete:${listing.id}`).setLabel('Delete My Post').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
  )];
  if (jump) rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('View My Post').setStyle(ButtonStyle.Link).setURL(jump)
  ));
  return ephemeral(`**${listing.squad_name}**\nManage your squad finder post below.${staff ? '\n*Staff override active.*' : ''}`, rows);
}

function voicePayload(listing) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`squad:voicevalue:${listing.id}:Yes`).setLabel('Voice Chat: Yes').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`squad:voicevalue:${listing.id}:Optional`).setLabel('Optional').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`squad:voicevalue:${listing.id}:No`).setLabel('No Voice Chat').setStyle(ButtonStyle.Secondary),
  );
  return ephemeral('Choose how your squad uses voice chat.', [row]);
}

function browsePayload(listings, page = 0) {
  const pageCount = Math.max(1, Math.ceil(listings.length / BROWSE_PAGE_SIZE));
  page = Math.max(0, Math.min(pageCount - 1, Number(page) || 0));
  const slice = listings.slice(page * BROWSE_PAGE_SIZE, (page + 1) * BROWSE_PAGE_SIZE);
  const rows = [];
  if (slice.length) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(`squad:viewselect:${page}`).setPlaceholder('Select a squad').addOptions(slice.map((listing) => ({
        label: String(listing.squad_name).slice(0, 100),
        value: String(listing.id),
        description: `${listing.is_recruiting ? 'Recruiting' : 'Not recruiting'}${listing.play_style ? ` • ${listing.play_style}` : ''}`.slice(0, 100),
        emoji: listing.is_recruiting ? '🟢' : '🔴',
      })))
    ));
  }
  if (pageCount > 1) rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`squad:browse:${Math.max(0, page - 1)}`).setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
    new ButtonBuilder().setCustomId(`squad:browse:${Math.min(pageCount - 1, page + 1)}`).setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled(page >= pageCount - 1),
  ));
  return ephemeral(
    listings.length
      ? `**Squad Directory** — ${listings.length} listing${listings.length === 1 ? '' : 's'}\nSelect a squad to view its full post. Page ${page + 1}/${pageCount}.`
      : '**Squad Directory**\nNo squads have posted a listing yet.',
    rows
  );
}

async function updateDirectory(guildId) {
  const cfg = await getConfig(guildId);
  if (!cfg?.channel_id || !cfg?.panel_message_id) return;
  const guild = clientRef?.guilds?.cache?.get(String(guildId));
  const channel = guild?.channels?.cache?.get(String(cfg.channel_id));
  if (!channel?.isTextBased()) return;
  const panel = await channel.messages.fetch(String(cfg.panel_message_id)).catch(() => null);
  if (!panel) return;
  await panel.edit(directoryPayload(await getListings(guildId)));
}

async function updateListingMessage(listing) {
  const guild = clientRef?.guilds?.cache?.get(String(listing.guild_id));
  const channel = guild?.channels?.cache?.get(String(listing.channel_id));
  if (!channel?.isTextBased() || !listing.message_id) return;
  const msg = await channel.messages.fetch(String(listing.message_id)).catch(() => null);
  if (!msg) return;
  await msg.edit({ embeds: [listingEmbed(listing)], allowedMentions: { users: [] } });
}

async function createListing(interaction) {
  const cfg = await getConfig(interaction.guildId);
  if (!cfg?.channel_id) throw new Error('Squad Finder has not been set up yet.');
  const channel = interaction.guild.channels.cache.get(String(cfg.channel_id));
  if (!channel?.isTextBased()) throw new Error('The configured Squad Finder channel is unavailable.');

  const existing = await getListingByOwner(interaction.guildId, interaction.user.id);
  if (existing) return interaction.reply(managePayload(existing));

  const now = new Date().toISOString();
  const temp = await channel.send({ embeds: [new EmbedBuilder().setDescription('Creating squad listing…')] });
  const row = {
    guild_id: String(interaction.guildId),
    owner_id: String(interaction.user.id),
    squad_name: interaction.fields.getTextInputValue('name').trim(),
    member_count: interaction.fields.getTextInputValue('members').trim(),
    play_style: interaction.fields.getTextInputValue('style').trim(),
    active_times: interaction.fields.getTextInputValue('times').trim(),
    description: interaction.fields.getTextInputValue('description').trim(),
    voice_chat: 'Optional',
    is_recruiting: true,
    channel_id: String(cfg.channel_id),
    message_id: String(temp.id),
    created_at: now,
    updated_at: now,
  };
  const { data, error } = await dbRef.from(LISTINGS_TABLE).insert(row).select('*').single();
  if (error) {
    await temp.delete().catch(() => {});
    throw error;
  }
  await temp.edit({ embeds: [listingEmbed(data)], allowedMentions: { users: [] } });
  await updateDirectory(interaction.guildId);
  await interaction.reply(managePayload(data));
}

async function handleSquadFinderCommand(message) {
  if (!message.guild || !message.content?.startsWith('!')) return false;
  const command = message.content.trim().split(/\s+/)[0].toLowerCase();
  if (command !== '!squadfindersetup') return false;
  if (!isStaff(message.member)) {
    await message.reply('Squad Finder setup is for staff only.').catch(() => {});
    return true;
  }
  try {
    const old = await getConfig(message.guildId);
    let panel = old?.panel_message_id ? await message.channel.messages.fetch(String(old.panel_message_id)).catch(() => null) : null;
    const listings = await getListings(message.guildId);
    if (panel && String(old.channel_id) === String(message.channelId)) await panel.edit(directoryPayload(listings));
    else panel = await message.channel.send(directoryPayload(listings));
    await saveConfig(message.guildId, { channel_id: String(message.channelId), panel_message_id: String(panel.id) });
    await message.delete().catch(() => {});
    return true;
  } catch (err) {
    await message.reply(`Squad Finder error: ${err.message}`).catch(() => {});
    return true;
  }
}

async function handleSquadFinderModal(interaction) {
  const id = String(interaction.customId || '');
  if (!interaction.isModalSubmit()) return false;
  try {
    if (id === 'squad:create:submit') {
      await createListing(interaction);
      return true;
    }
    if (!id.startsWith('squad:edit:submit:')) return false;
    const listingId = id.slice('squad:edit:submit:'.length);
    const listing = await getListingById(interaction.guildId, listingId);
    if (!listing) throw new Error('That squad listing no longer exists.');
    if (String(listing.owner_id) !== String(interaction.user.id) && !isStaff(interaction.member)) throw new Error('Only the listing owner or staff can edit this post.');
    const patch = {
      squad_name: interaction.fields.getTextInputValue('name').trim(),
      member_count: interaction.fields.getTextInputValue('members').trim(),
      play_style: interaction.fields.getTextInputValue('style').trim(),
      active_times: interaction.fields.getTextInputValue('times').trim(),
      description: interaction.fields.getTextInputValue('description').trim(),
      updated_at: new Date().toISOString(),
    };
    const { data: updated, error } = await dbRef.from(LISTINGS_TABLE).update(patch).eq('id', listing.id).select('*').single();
    if (error) throw error;
    await updateListingMessage(updated);
    await updateDirectory(interaction.guildId);
    await interaction.reply(managePayload(updated, isStaff(interaction.member)));
    return true;
  } catch (err) {
    const payload = ephemeral(`Squad Finder error: ${err.message}`);
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
    return true;
  }
}

async function handleSquadFinderInteraction(interaction) {
  const id = String(interaction.customId || '');
  if (!id.startsWith('squad:') || interaction.isModalSubmit()) return false;
  if (!interaction.guild) return true;
  try {
    if (id === 'squad:create' && interaction.isButton()) {
      const existing = await getListingByOwner(interaction.guildId, interaction.user.id);
      if (existing) await interaction.reply(managePayload(existing));
      else await interaction.showModal(createModal());
      return true;
    }
    if (id === 'squad:mine' && interaction.isButton()) {
      const listing = await getListingByOwner(interaction.guildId, interaction.user.id);
      if (!listing) await interaction.reply(ephemeral('You do not have a Squad Finder post yet. Use **Post My Squad** to create one.'));
      else await interaction.reply(managePayload(listing));
      return true;
    }
    if (id.startsWith('squad:browse:') && interaction.isButton()) {
      const listings = await getListings(interaction.guildId);
      const payload = browsePayload(listings, Number(id.split(':')[2] || 0));
      if (interaction.replied || interaction.deferred) { const { flags, ...update } = payload; await interaction.update(update); }
      else await interaction.reply(payload);
      return true;
    }
    if (id.startsWith('squad:viewselect:') && interaction.isStringSelectMenu()) {
      const listing = await getListingById(interaction.guildId, interaction.values[0]);
      if (!listing) await interaction.reply(ephemeral('That squad listing no longer exists.'));
      else {
        const jump = listingJumpUrl(listing);
        const rows = jump ? [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Open Squad Post').setStyle(ButtonStyle.Link).setURL(jump))] : [];
        await interaction.reply({ embeds: [listingEmbed(listing)], components: rows, flags: MessageFlags.Ephemeral, allowedMentions: { users: [] } });
      }
      return true;
    }

    const parts = id.split(':');
    const action = parts[1];
    const listingId = parts[2];
    const listing = await getListingById(interaction.guildId, listingId);
    if (!listing) {
      await interaction.reply(ephemeral('That squad listing no longer exists.'));
      return true;
    }
    const canManage = String(listing.owner_id) === String(interaction.user.id) || isStaff(interaction.member);
    if (!canManage) {
      await interaction.reply(ephemeral('Only the player who created this post or staff can manage it.'));
      return true;
    }

    if (action === 'edit' && interaction.isButton()) {
      await interaction.showModal(editModal(listing));
      return true;
    }
    if (action === 'toggle' && interaction.isButton()) {
      const { data: updated, error } = await dbRef.from(LISTINGS_TABLE).update({ is_recruiting: !listing.is_recruiting, updated_at: new Date().toISOString() }).eq('id', listing.id).select('*').single();
      if (error) throw error;
      await updateListingMessage(updated);
      await updateDirectory(interaction.guildId);
      { const { flags, ...update } = managePayload(updated, isStaff(interaction.member)); await interaction.update(update); }
      return true;
    }
    if (action === 'voice' && interaction.isButton()) {
      await interaction.reply(voicePayload(listing));
      return true;
    }
    if (action === 'voicevalue' && interaction.isButton()) {
      const value = parts.slice(3).join(':');
      if (!['Yes', 'Optional', 'No'].includes(value)) throw new Error('Invalid voice chat setting.');
      const { data: updated, error } = await dbRef.from(LISTINGS_TABLE).update({ voice_chat: value, updated_at: new Date().toISOString() }).eq('id', listing.id).select('*').single();
      if (error) throw error;
      await updateListingMessage(updated);
      await updateDirectory(interaction.guildId);
      await interaction.update({ content: `✅ Voice chat set to **${value}**.`, components: [], embeds: [] });
      return true;
    }
    if (action === 'delete' && interaction.isButton()) {
      await interaction.reply(ephemeral(`Delete your Squad Finder post for **${listing.squad_name}**?`, [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`squad:deleteconfirm:${listing.id}`).setLabel('Yes, Delete My Post').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`squad:cancel:${listing.id}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      )]));
      return true;
    }
    if (action === 'deleteconfirm' && interaction.isButton()) {
      const guild = clientRef.guilds.cache.get(String(listing.guild_id));
      const channel = guild?.channels?.cache?.get(String(listing.channel_id));
      const msg = await channel?.messages?.fetch(String(listing.message_id)).catch(() => null);
      await msg?.delete().catch(() => {});
      const { error } = await dbRef.from(LISTINGS_TABLE).delete().eq('id', listing.id);
      if (error) throw error;
      await updateDirectory(interaction.guildId);
      await interaction.update({ content: '✅ Your Squad Finder post was deleted.', embeds: [], components: [] });
      return true;
    }
    if (action === 'cancel' && interaction.isButton()) {
      await interaction.update({ content: 'Cancelled.', embeds: [], components: [] });
      return true;
    }
    return true;
  } catch (err) {
    console.error('Squad Finder interaction error:', err);
    const payload = ephemeral(`Squad Finder error: ${err.message}`);
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
    return true;
  }
}

function startSquadFinder(client, db) {
  clientRef = client;
  dbRef = db;
}


async function portalCreateSquad(ctx, values){
  const existing=await getListingByOwner(ctx.guildId,ctx.discordId); if(existing) throw new Error('You already have a Squad Finder listing.');
  const name=String(values.squad_name||'').trim().slice(0,80); if(!name) throw new Error('Squad name is required.');
  const now=new Date().toISOString();
  const row={guild_id:String(ctx.guildId),owner_id:String(ctx.discordId),squad_name:name,member_count:String(values.member_count||'').trim().slice(0,30),play_style:String(values.play_style||'').trim().slice(0,100),active_times:String(values.active_times||'').trim().slice(0,100),description:String(values.description||'').trim().slice(0,1000),voice_chat:String(values.voice_chat||'Optional').trim().slice(0,40)||'Optional',is_recruiting:true,channel_id:String(COMMAND_CENTER_CHANNEL_ID),message_id:'portal',created_at:now,updated_at:now};
  const{data,error}=await dbRef.from(LISTINGS_TABLE).insert(row).select('*').single();if(error)throw error;return data;
}
async function portalUpdateSquad(ctx,values){const listing=await getListingByOwner(ctx.guildId,ctx.discordId);if(!listing)throw new Error('You do not have a Squad Finder listing.');const patch={squad_name:String(values.squad_name??listing.squad_name).trim().slice(0,80),member_count:String(values.member_count??listing.member_count??'').trim().slice(0,30),play_style:String(values.play_style??listing.play_style??'').trim().slice(0,100),active_times:String(values.active_times??listing.active_times??'').trim().slice(0,100),description:String(values.description??listing.description??'').trim().slice(0,1000),voice_chat:String(values.voice_chat??listing.voice_chat??'Optional').trim().slice(0,40)||'Optional',updated_at:new Date().toISOString()};if(!patch.squad_name)throw new Error('Squad name is required.');const{data,error}=await dbRef.from(LISTINGS_TABLE).update(patch).eq('id',listing.id).select('*').single();if(error)throw error;return data;}
async function portalToggleSquad(ctx){const listing=await getListingByOwner(ctx.guildId,ctx.discordId);if(!listing)throw new Error('You do not have a Squad Finder listing.');const{data,error}=await dbRef.from(LISTINGS_TABLE).update({is_recruiting:!listing.is_recruiting,updated_at:new Date().toISOString()}).eq('id',listing.id).select('*').single();if(error)throw error;return data;}
async function portalDeleteSquad(ctx){const listing=await getListingByOwner(ctx.guildId,ctx.discordId);if(!listing)throw new Error('You do not have a Squad Finder listing.');const{error}=await dbRef.from(LISTINGS_TABLE).delete().eq('id',listing.id);if(error)throw error;return{ok:true};}
async function portalAdminSquad(ctx,values){if(!ctx.isAdmin)throw new Error('Admin access required.');const listing=await getListingById(ctx.guildId,values.id);if(!listing)throw new Error('Squad listing not found.');if(values.action==='delete'){const{error}=await dbRef.from(LISTINGS_TABLE).delete().eq('id',listing.id);if(error)throw error;return{ok:true};}if(values.action==='toggle'){const{data,error}=await dbRef.from(LISTINGS_TABLE).update({is_recruiting:!listing.is_recruiting,updated_at:new Date().toISOString()}).eq('id',listing.id).select('*').single();if(error)throw error;return data;}throw new Error('Unknown squad moderation action.');}

module.exports = { startSquadFinder, handleSquadFinderCommand, handleSquadFinderInteraction, handleSquadFinderModal, portalCreateSquad, portalUpdateSquad, portalToggleSquad, portalDeleteSquad, portalAdminSquad }; 
