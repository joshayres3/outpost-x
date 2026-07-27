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

const CONFIG_TABLE = 'watcher_player_lore_config';
const LORE_TABLE = 'watcher_player_lore';
const STAFF_ROLE_NAMES = new Set(['Owner', 'Owners', 'Admin', 'Trial Admin', 'Baby Admin']);
const DIRECTORY_LIMIT = 10;
const BROWSE_PAGE_SIZE = 20;
const MAX_IMAGES = 5;
const IMAGE_WINDOW_MS = 5 * 60_000;

let clientRef = null;
let dbRef = null;
const pendingImages = new Map();

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
  const { error } = await dbRef.from(CONFIG_TABLE).upsert({ guild_id: String(guildId), ...patch, updated_at: new Date().toISOString() }, { onConflict: 'guild_id' });
  if (error) throw error;
}
async function getLoreByOwner(guildId, ownerId) {
  const { data, error } = await dbRef.from(LORE_TABLE).select('*').eq('guild_id', String(guildId)).eq('owner_id', String(ownerId)).maybeSingle();
  if (error) throw error;
  return data || null;
}
async function getLoreById(guildId, id) {
  const { data, error } = await dbRef.from(LORE_TABLE).select('*').eq('guild_id', String(guildId)).eq('id', String(id)).maybeSingle();
  if (error) throw error;
  return data || null;
}
async function getLoreEntries(guildId, includeHidden = false) {
  let q = dbRef.from(LORE_TABLE).select('*').eq('guild_id', String(guildId));
  if (!includeHidden) q = q.eq('is_published', true);
  const { data, error } = await q.order('character_name', { ascending: true });
  if (error) throw error;
  return data || [];
}
function jumpUrl(entry) {
  if (!entry?.guild_id || !entry?.channel_id || !entry?.message_id) return null;
  return `https://discord.com/channels/${entry.guild_id}/${entry.channel_id}/${entry.message_id}`;
}
function directoryPayload(entries) {
  const lines = entries.slice(0, DIRECTORY_LIMIT).map((e, i) => {
    const url = jumpUrl(e);
    const name = url ? `[${e.character_name}](${url})` : `**${e.character_name}**`;
    const meta = [e.title_nickname, e.faction_squad].filter(Boolean).join(' • ');
    return `${i + 1}. 📖 ${name}${meta ? ` — ${meta}` : ''}`;
  });
  if (!lines.length) lines.push('*No player lore has been posted yet.*');
  if (entries.length > DIRECTORY_LIMIT) lines.push(`\n*+ ${entries.length - DIRECTORY_LIMIT} more — use **Browse Lore** to see everyone.*`);
  return {
    embeds: [new EmbedBuilder()
      .setTitle('📖 Outpost X Player Lore')
      .setDescription([
        'Share your character story and browse the people making their mark on Outpost X.',
        '',
        '**Current Characters**',
        ...lines,
        '',
        `**${entries.length} published lore profile${entries.length === 1 ? '' : 's'}**`,
      ].join('\n'))
      .setFooter({ text: 'Player lore is character RP. Server-wide canon still requires staff approval.' })],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('lore:create').setLabel('Create Lore').setEmoji('➕').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('lore:mine').setLabel('My Lore').setEmoji('⚙️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('lore:browse:0').setLabel('Browse Lore').setEmoji('🔎').setStyle(ButtonStyle.Primary),
    )],
  };
}
function loreEmbeds(entry) {
  const fields = [];
  if (entry.title_nickname) fields.push({ name: 'Title / Nickname', value: entry.title_nickname, inline: true });
  if (entry.faction_squad) fields.push({ name: 'Faction / Squad', value: entry.faction_squad, inline: true });
  if (entry.rp_status) fields.push({ name: 'RP Status', value: entry.rp_status, inline: true });
  if (entry.origin) fields.push({ name: 'Origin', value: entry.origin, inline: false });
  if (entry.personality) fields.push({ name: 'Personality', value: entry.personality, inline: false });
  if (entry.goals) fields.push({ name: 'Goals / Motives', value: entry.goals, inline: false });
  const main = new EmbedBuilder()
    .setTitle(`📖 ${entry.character_name}`)
    .setDescription(entry.backstory || '*No backstory provided.*')
    .addFields(fields)
    .setFooter({ text: `Lore by ${entry.owner_display || 'player'} • Last updated ${new Date(entry.updated_at || Date.now()).toLocaleString('en-US')}` });
  if (entry.extra_lore) main.addFields({ name: 'Additional Lore', value: entry.extra_lore });
  const embeds = [main];
  for (const url of (Array.isArray(entry.image_urls) ? entry.image_urls : []).filter(Boolean).slice(0, MAX_IMAGES)) embeds.push(new EmbedBuilder().setImage(url));
  if (entry.image_caption) embeds.push(new EmbedBuilder().setDescription(entry.image_caption));
  return embeds.slice(0, 10);
}
function createModal() {
  return new ModalBuilder().setCustomId('lore:create:submit').setTitle('Create Player Lore').addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('Character name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title').setLabel('Title / nickname').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('faction').setLabel('Faction / squad').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('origin').setLabel('Origin').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(200)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('backstory').setLabel('Backstory').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(3500)),
  );
}
function editModal(entry) {
  return new ModalBuilder().setCustomId(`lore:edit:submit:${entry.id}`).setTitle('Edit Core Lore').addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('Character name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80).setValue(String(entry.character_name || '').slice(0,80))),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title').setLabel('Title / nickname').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100).setValue(String(entry.title_nickname || '').slice(0,100))),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('faction').setLabel('Faction / squad').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100).setValue(String(entry.faction_squad || '').slice(0,100))),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('origin').setLabel('Origin').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(200).setValue(String(entry.origin || '').slice(0,200))),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('backstory').setLabel('Backstory').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(3500).setValue(String(entry.backstory || '').slice(0,3500))),
  );
}
function detailsModal(entry) {
  return new ModalBuilder().setCustomId(`lore:details:submit:${entry.id}`).setTitle('Edit RP Details').addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('personality').setLabel('Personality').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000).setValue(String(entry.personality || '').slice(0,1000))),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('goals').setLabel('Goals / motives').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000).setValue(String(entry.goals || '').slice(0,1000))),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('extra').setLabel('Additional lore').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000).setValue(String(entry.extra_lore || '').slice(0,1000))),
  );
}
function managePayload(entry, staff = false) {
  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`lore:edit:${entry.id}`).setLabel('Edit Lore').setEmoji('✏️').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`lore:details:${entry.id}`).setLabel('RP Details').setEmoji('📝').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`lore:images:${entry.id}`).setLabel('Update Images').setEmoji('🖼️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`lore:status:${entry.id}`).setLabel('RP Status').setEmoji('🎭').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`lore:publish:${entry.id}`).setLabel(entry.is_published ? 'Hide Lore' : 'Publish Lore').setEmoji(entry.is_published ? '🙈' : '📖').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`lore:delete:${entry.id}`).setLabel('Delete My Lore').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
      ...(jumpUrl(entry) ? [new ButtonBuilder().setLabel('View Lore').setStyle(ButtonStyle.Link).setURL(jumpUrl(entry))] : []),
    ),
  ];
  return ephemeral(`**${entry.character_name}**\nManage your lore profile below.${entry.is_published ? '' : '\n⚠️ This lore is currently hidden from Browse Lore.'}${staff ? '\n*Staff override active.*' : ''}`, rows);
}
function statusPayload(entry) {
  return ephemeral('Choose your RP status.', [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`lore:statusvalue:${entry.id}:Open to RP`).setLabel('Open to RP').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`lore:statusvalue:${entry.id}:Casual RP`).setLabel('Casual RP').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`lore:statusvalue:${entry.id}:Not Seeking RP`).setLabel('Not Seeking RP').setStyle(ButtonStyle.Secondary),
  )]);
}
function browsePayload(entries, page = 0) {
  const pageCount = Math.max(1, Math.ceil(entries.length / BROWSE_PAGE_SIZE));
  page = Math.max(0, Math.min(pageCount - 1, Number(page) || 0));
  const slice = entries.slice(page * BROWSE_PAGE_SIZE, (page + 1) * BROWSE_PAGE_SIZE);
  const rows = [];
  if (slice.length) rows.push(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId(`lore:viewselect:${page}`).setPlaceholder('Select a character').addOptions(slice.map((e) => ({
      label: String(e.character_name).slice(0,100), value: String(e.id), description: String([e.title_nickname,e.faction_squad,e.rp_status].filter(Boolean).join(' • ') || 'Player lore').slice(0,100), emoji: '📖'
    })))
  ));
  if (pageCount > 1) rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`lore:browse:${Math.max(0,page-1)}`).setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(page===0),
    new ButtonBuilder().setCustomId(`lore:browse:${Math.min(pageCount-1,page+1)}`).setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled(page>=pageCount-1),
  ));
  return ephemeral(entries.length ? `**Player Lore Directory** — ${entries.length} character${entries.length===1?'':'s'}\nSelect a character to read their lore. Page ${page+1}/${pageCount}.` : '**Player Lore Directory**\nNo published lore yet.', rows);
}
async function updateDirectory(guildId) {
  const cfg = await getConfig(guildId); if (!cfg?.channel_id || !cfg?.panel_message_id) return;
  const channel = clientRef?.guilds?.cache?.get(String(guildId))?.channels?.cache?.get(String(cfg.channel_id)); if (!channel?.isTextBased()) return;
  const panel = await channel.messages.fetch(String(cfg.panel_message_id)).catch(()=>null); if (!panel) return;
  await panel.edit(directoryPayload(await getLoreEntries(guildId)));
}
async function updateLoreMessage(entry) {
  const channel = clientRef?.guilds?.cache?.get(String(entry.guild_id))?.channels?.cache?.get(String(entry.channel_id)); if (!channel?.isTextBased() || !entry.message_id) return;
  const msg = await channel.messages.fetch(String(entry.message_id)).catch(()=>null); if (!msg) return;
  await msg.edit({ embeds: loreEmbeds(entry), allowedMentions: { users: [] } });
}
async function createLore(interaction) {
  const cfg = await getConfig(interaction.guildId); if (!cfg?.channel_id) throw new Error('Player Lore has not been set up yet.');
  const existing = await getLoreByOwner(interaction.guildId, interaction.user.id); if (existing) return interaction.reply(managePayload(existing));
  const channel = interaction.guild.channels.cache.get(String(cfg.channel_id)); if (!channel?.isTextBased()) throw new Error('The configured Player Lore channel is unavailable.');
  const now = new Date().toISOString();
  const temp = await channel.send({ embeds: [new EmbedBuilder().setDescription('Creating lore profile…')] });
  const row = {
    guild_id:String(interaction.guildId), owner_id:String(interaction.user.id), owner_display:interaction.member?.displayName || interaction.user.username,
    character_name:interaction.fields.getTextInputValue('name').trim(), title_nickname:interaction.fields.getTextInputValue('title').trim(), faction_squad:interaction.fields.getTextInputValue('faction').trim(),
    origin:interaction.fields.getTextInputValue('origin').trim(), backstory:interaction.fields.getTextInputValue('backstory').trim(), personality:'', goals:'', extra_lore:'', rp_status:'Casual RP', image_urls:[], image_caption:'',
    is_published:true, channel_id:String(cfg.channel_id), message_id:String(temp.id), created_at:now, updated_at:now,
  };
  const { data, error } = await dbRef.from(LORE_TABLE).insert(row).select('*').single();
  if (error) { await temp.delete().catch(()=>{}); throw error; }
  await temp.edit({ embeds:loreEmbeds(data), allowedMentions:{users:[]} });
  await updateDirectory(interaction.guildId);
  await interaction.reply(managePayload(data));
}
async function handlePlayerLoreCommand(message) {
  if (!message.guild || message.content?.trim().toLowerCase() !== '!playerloresetup') return false;
  if (!isStaff(message.member)) { await message.reply('Player Lore setup is for staff only.').catch(()=>{}); return true; }
  try {
    const old = await getConfig(message.guildId); const entries = await getLoreEntries(message.guildId);
    let panel = old?.panel_message_id && String(old.channel_id)===String(message.channelId) ? await message.channel.messages.fetch(String(old.panel_message_id)).catch(()=>null) : null;
    if (panel) await panel.edit(directoryPayload(entries)); else panel = await message.channel.send(directoryPayload(entries));
    await saveConfig(message.guildId,{channel_id:String(message.channelId),panel_message_id:String(panel.id)}); await message.delete().catch(()=>{}); return true;
  } catch(err) { await message.reply(`Player Lore error: ${err.message}`).catch(()=>{}); return true; }
}
async function handlePlayerLoreMessage(message) {
  if (!message.guild || message.author?.bot) return false;
  const key = `${message.guildId}:${message.author.id}`; const pending = pendingImages.get(key); if (!pending) return false;
  if (pending.expiresAt < Date.now()) { pendingImages.delete(key); return false; }
  if (String(message.channelId)!==String(pending.channelId)) return false;
  const entry = await getLoreById(message.guildId,pending.loreId).catch(()=>null); if (!entry || String(entry.owner_id)!==String(message.author.id)) { pendingImages.delete(key); return false; }
  const imgs=[...message.attachments.values()].filter(a=>String(a.contentType||'').startsWith('image/')).slice(0,MAX_IMAGES);
  if(!imgs.length){ await message.reply('No images were attached. Click **Update Images** again and attach at least one image.').catch(()=>{}); return true; }
  try {
    const channel=message.channel; const loreMsg=await channel.messages.fetch(String(entry.message_id)); const files=[];
    for(let i=0;i<imgs.length;i++){ const a=imgs[i]; const response=await fetch(a.url); if(!response.ok) throw new Error(`Could not copy image ${i+1}.`); const buf=Buffer.from(await response.arrayBuffer()); const ext=(String(a.name||'').match(/\.[A-Za-z0-9]+$/)?.[0]||'.png'); files.push({attachment:buf,name:`lore-${entry.id}-${i+1}${ext}`}); }
    const caption=String(message.content||'').trim().slice(0,1500);
    const uploaded=await loreMsg.edit({embeds:loreEmbeds({...entry,image_urls:[],image_caption:caption}),files,attachments:[]});
    const urls=[...uploaded.attachments.values()].map(a=>a.url).slice(0,MAX_IMAGES);
    const {data:updated,error}=await dbRef.from(LORE_TABLE).update({image_urls:urls,image_caption:caption,updated_at:new Date().toISOString()}).eq('id',entry.id).select('*').single(); if(error) throw error;
    await updateLoreMessage(updated); pendingImages.delete(key); await message.delete().catch(()=>{});
    const ack=await channel.send({content:`<@${message.author.id}> ✅ Your lore images were updated.`,allowedMentions:{users:[message.author.id]}}).catch(()=>null); if(ack)setTimeout(()=>ack.delete().catch(()=>{}),7000); return true;
  } catch(err){ pendingImages.delete(key); await message.reply(`Lore image update failed: ${err.message}`).catch(()=>{}); return true; }
}
async function handlePlayerLoreModal(interaction) {
  if(!interaction.isModalSubmit() || !String(interaction.customId||'').startsWith('lore:')) return false;
  try {
    const id=String(interaction.customId);
    if(id==='lore:create:submit'){ await createLore(interaction); return true; }
    const parts=id.split(':'); const action=parts[1]; const loreId=parts[3]; const entry=await getLoreById(interaction.guildId,loreId); if(!entry) throw new Error('That lore profile no longer exists.');
    if(String(entry.owner_id)!==String(interaction.user.id)&&!isStaff(interaction.member)) throw new Error('Only the lore owner or staff can edit this profile.');
    let patch={updated_at:new Date().toISOString()};
    if(action==='edit') patch={...patch,character_name:interaction.fields.getTextInputValue('name').trim(),title_nickname:interaction.fields.getTextInputValue('title').trim(),faction_squad:interaction.fields.getTextInputValue('faction').trim(),origin:interaction.fields.getTextInputValue('origin').trim(),backstory:interaction.fields.getTextInputValue('backstory').trim()};
    else if(action==='details') patch={...patch,personality:interaction.fields.getTextInputValue('personality').trim(),goals:interaction.fields.getTextInputValue('goals').trim(),extra_lore:interaction.fields.getTextInputValue('extra').trim()};
    else return false;
    const {data:updated,error}=await dbRef.from(LORE_TABLE).update(patch).eq('id',entry.id).select('*').single(); if(error) throw error;
    await updateLoreMessage(updated); await updateDirectory(interaction.guildId); await interaction.reply(managePayload(updated,isStaff(interaction.member))); return true;
  } catch(err){ const p=ephemeral(`Player Lore error: ${err.message}`); if(interaction.replied||interaction.deferred)await interaction.followUp(p).catch(()=>{});else await interaction.reply(p).catch(()=>{}); return true; }
}
async function handlePlayerLoreInteraction(interaction) {
  const id=String(interaction.customId||''); if(!id.startsWith('lore:')||interaction.isModalSubmit()||!interaction.guild) return false;
  try {
    if(id==='lore:create'&&interaction.isButton()){ const e=await getLoreByOwner(interaction.guildId,interaction.user.id); if(e)await interaction.reply(managePayload(e));else await interaction.showModal(createModal()); return true; }
    if(id==='lore:mine'&&interaction.isButton()){ const e=await getLoreByOwner(interaction.guildId,interaction.user.id); if(!e)await interaction.reply(ephemeral('You do not have a lore profile yet. Use **Create Lore** to make one.'));else await interaction.reply(managePayload(e)); return true; }
    if(id.startsWith('lore:browse:')&&interaction.isButton()){ const payload=browsePayload(await getLoreEntries(interaction.guildId),Number(id.split(':')[2]||0)); if(interaction.replied||interaction.deferred){const{flags,...u}=payload;await interaction.update(u)}else await interaction.reply(payload); return true; }
    if(id.startsWith('lore:viewselect:')&&interaction.isStringSelectMenu()){ const e=await getLoreById(interaction.guildId,interaction.values[0]); if(!e||!e.is_published)await interaction.reply(ephemeral('That lore profile is no longer available.'));else await interaction.reply({embeds:loreEmbeds(e),components:jumpUrl(e)?[new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Open Lore Post').setStyle(ButtonStyle.Link).setURL(jumpUrl(e)))]:[],flags:MessageFlags.Ephemeral,allowedMentions:{users:[]}}); return true; }
    const parts=id.split(':'); const action=parts[1]; const loreId=parts[2]; const e=await getLoreById(interaction.guildId,loreId); if(!e){await interaction.reply(ephemeral('That lore profile no longer exists.'));return true;}
    if(String(e.owner_id)!==String(interaction.user.id)&&!isStaff(interaction.member)){await interaction.reply(ephemeral('Only the player who created this lore or staff can manage it.'));return true;}
    if(action==='edit'&&interaction.isButton()){await interaction.showModal(editModal(e));return true;}
    if(action==='details'&&interaction.isButton()){await interaction.showModal(detailsModal(e));return true;}
    if(action==='images'&&interaction.isButton()){pendingImages.set(`${interaction.guildId}:${interaction.user.id}`,{loreId:e.id,channelId:e.channel_id,expiresAt:Date.now()+IMAGE_WINDOW_MS});await interaction.reply(ephemeral(`**Ready for your lore images.**\nGo to <#${e.channel_id}> and send your **next message** with up to ${MAX_IMAGES} images attached.\nYou can type a caption in that same message and Watcher will place it beneath the images.\nWatcher will copy the images to your lore post and remove the upload message.\n**This upload window expires in 5 minutes.**`));return true;}
    if(action==='status'&&interaction.isButton()){await interaction.reply(statusPayload(e));return true;}
    if(action==='statusvalue'&&interaction.isButton()){const value=parts.slice(3).join(':');if(!['Open to RP','Casual RP','Not Seeking RP'].includes(value))throw new Error('Invalid RP status.');const{data:updated,error}=await dbRef.from(LORE_TABLE).update({rp_status:value,updated_at:new Date().toISOString()}).eq('id',e.id).select('*').single();if(error)throw error;await updateLoreMessage(updated);await interaction.update({content:`✅ RP status set to **${value}**.`,components:[],embeds:[]});return true;}
    if(action==='publish'&&interaction.isButton()){const{data:updated,error}=await dbRef.from(LORE_TABLE).update({is_published:!e.is_published,updated_at:new Date().toISOString()}).eq('id',e.id).select('*').single();if(error)throw error;await updateLoreMessage(updated);await updateDirectory(interaction.guildId);const{flags,...u}=managePayload(updated,isStaff(interaction.member));await interaction.update(u);return true;}
    if(action==='delete'&&interaction.isButton()){await interaction.reply(ephemeral(`Delete the lore profile for **${e.character_name}**?`,[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`lore:deleteconfirm:${e.id}`).setLabel('Yes, Delete My Lore').setStyle(ButtonStyle.Danger),new ButtonBuilder().setCustomId(`lore:cancel:${e.id}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary))]));return true;}
    if(action==='deleteconfirm'&&interaction.isButton()){const channel=clientRef.guilds.cache.get(String(e.guild_id))?.channels?.cache?.get(String(e.channel_id));const msg=await channel?.messages?.fetch(String(e.message_id)).catch(()=>null);await msg?.delete().catch(()=>{});const{error}=await dbRef.from(LORE_TABLE).delete().eq('id',e.id);if(error)throw error;await updateDirectory(interaction.guildId);await interaction.update({content:'✅ Your lore profile was deleted.',embeds:[],components:[]});return true;}
    if(action==='cancel'&&interaction.isButton()){await interaction.update({content:'Cancelled.',embeds:[],components:[]});return true;}
    return true;
  } catch(err){console.error('Player Lore interaction error:',err);const p=ephemeral(`Player Lore error: ${err.message}`);if(interaction.replied||interaction.deferred)await interaction.followUp(p).catch(()=>{});else await interaction.reply(p).catch(()=>{});return true;}
}
function startPlayerLore(client,db){clientRef=client;dbRef=db;}
module.exports={startPlayerLore,handlePlayerLoreCommand,handlePlayerLoreMessage,handlePlayerLoreInteraction,handlePlayerLoreModal};
