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

const CONFIG_TABLE = 'watcher_player_shop_config';
const SHOPS_TABLE = 'watcher_player_shops';
const SHOP_OWNER_ROLE_ID = '1531364075332964523';
const STAFF_ROLE_NAMES = new Set(['Owner', 'Owners', 'Admin', 'Trial Admin', 'Baby Admin']);
const DIRECTORY_LIMIT = 10;
const BROWSE_PAGE_SIZE = 20;
const MAX_IMAGES = 2;
const UPLOAD_WINDOW_MS = 5 * 60 * 1000;

let clientRef = null;
let dbRef = null;
const pendingUploads = new Map();

const COMMAND_CENTER_CHANNEL_ID = process.env.WATCHER_COMMAND_CENTER_CHANNEL_ID || '1531709557997306027';
const PORTAL_MEDIA_CHANNEL_ID = process.env.WATCHER_PORTAL_MEDIA_CHANNEL_ID || process.env.ADMIN_CHANNEL_ID || COMMAND_CENTER_CHANNEL_ID;

async function getPortalMediaChannel(guildId) {
  const guild = clientRef?.guilds?.cache?.get(String(guildId));
  if (!guild) throw new Error('Outpost X Discord server is unavailable.');
  const channel = guild.channels.cache.get(String(PORTAL_MEDIA_CHANNEL_ID))
    || guild.channels.cache.get(String(COMMAND_CENTER_CHANNEL_ID));
  if (!channel?.isTextBased()) throw new Error('Watcher media storage is unavailable.');
  return channel;
}

async function getStoredMessage(row) {
  if (!row?.channel_id || !row?.message_id || String(row.message_id) === 'portal') return null;
  const guild = clientRef?.guilds?.cache?.get(String(row.guild_id));
  const channel = guild?.channels?.cache?.get(String(row.channel_id));
  return channel?.messages ? channel.messages.fetch(String(row.message_id)).catch(() => null) : null;
}

function isStaff(member) {
  return !!member?.roles?.cache?.some((r) => STAFF_ROLE_NAMES.has(r.name));
}

function hasShopOwnerRole(member) {
  return !!member?.roles?.cache?.has(SHOP_OWNER_ROLE_ID);
}

function ephemeral(content, components = []) {
  return { content, components, flags: MessageFlags.Ephemeral };
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

async function getShopByOwner(guildId, ownerId) {
  const { data, error } = await dbRef.from(SHOPS_TABLE)
    .select('*')
    .eq('guild_id', String(guildId))
    .eq('owner_id', String(ownerId))
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function getShopById(guildId, shopId) {
  const { data, error } = await dbRef.from(SHOPS_TABLE)
    .select('*')
    .eq('guild_id', String(guildId))
    .eq('id', String(shopId))
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function getShops(guildId) {
  const { data, error } = await dbRef.from(SHOPS_TABLE)
    .select('*')
    .eq('guild_id', String(guildId))
    .order('is_open', { ascending: false })
    .order('shop_name', { ascending: true });
  if (error) throw error;
  return data || [];
}

function shopJumpUrl(shop) {
  if (!shop?.guild_id || !shop?.channel_id || !shop?.message_id) return null;
  return `https://discord.com/channels/${shop.guild_id}/${shop.channel_id}/${shop.message_id}`;
}

function directoryPayload(shops) {
  const openCount = shops.filter((s) => s.is_open).length;
  const lines = shops.slice(0, DIRECTORY_LIMIT).map((shop, i) => {
    const status = shop.is_open ? '🟢' : '🔴';
    const url = shopJumpUrl(shop);
    const name = url ? `[${shop.shop_name}](${url})` : `**${shop.shop_name}**`;
    const meta = [shop.location_text, shop.shop_type].filter(Boolean).join(' • ');
    return `${i + 1}. ${status} ${name}${meta ? ` — ${meta}` : ''}`;
  });
  if (!lines.length) lines.push('*No player shops have been registered yet.*');
  if (shops.length > DIRECTORY_LIMIT) lines.push(`\n*+ ${shops.length - DIRECTORY_LIMIT} more — use **Browse Shops** to see the full directory.*`);

  const embed = new EmbedBuilder()
    .setTitle('🛒 Outpost X Player Shops')
    .setDescription([
      'Player-run storefronts around the island. Discord is for shop advertising and information; trading happens in-game.',
      '',
      '**Current Shops**',
      ...lines,
      '',
      `**${shops.length} registered shop${shops.length === 1 ? '' : 's'} • ${openCount} currently open**`,
    ].join('\n'))
    .setFooter({ text: 'Shop owners can update their storefront at any time through The Watcher.' });

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('pshop:create').setLabel('Create Shop').setEmoji('🏪').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('pshop:mine').setLabel('My Shop').setEmoji('⚙️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('pshop:browse:0').setLabel('Browse Shops').setEmoji('🔎').setStyle(ButtonStyle.Primary),
    )],
  };
}

function shopEmbeds(shop) {
  const embeds = [];
  const main = new EmbedBuilder()
    .setTitle(`${shop.is_open ? '🟢' : '🔴'} ${shop.shop_name}`)
    .setDescription(shop.description || '*No shop description yet.*')
    .addFields(
      { name: 'Status', value: shop.is_open ? '🟢 Open' : '🔴 Closed', inline: true },
      { name: 'Location', value: shop.location_text || 'Not listed', inline: true },
      { name: 'Type', value: shop.shop_type || 'General', inline: true },
      { name: 'Owner', value: `<@${shop.owner_id}>`, inline: true },
    )
    .setFooter({ text: `Last updated ${new Date(shop.updated_at || Date.now()).toLocaleString('en-US')}` });
  embeds.push(main);

  const images = Array.isArray(shop.image_urls) ? shop.image_urls.filter(Boolean).slice(0, MAX_IMAGES) : [];
  for (const url of images) embeds.push(new EmbedBuilder().setImage(url));
  if (shop.storefront_text) {
    embeds.push(new EmbedBuilder().setTitle('From the Shop Owner').setDescription(shop.storefront_text));
  }
  return embeds.slice(0, 10);
}

async function updateDirectory(guildId) {
  const cfg = await getConfig(guildId);
  if (!cfg?.channel_id || !cfg?.panel_message_id) return;
  const guild = clientRef?.guilds?.cache?.get(String(guildId));
  const channel = guild?.channels?.cache?.get(String(cfg.channel_id));
  if (!channel?.isTextBased()) return;
  const panel = await channel.messages.fetch(String(cfg.panel_message_id)).catch(() => null);
  if (!panel) return;
  const shops = await getShops(guildId);
  await panel.edit(directoryPayload(shops));
}

async function updateShopMessage(shop) {
  const guild = clientRef?.guilds?.cache?.get(String(shop.guild_id));
  const channel = guild?.channels?.cache?.get(String(shop.channel_id));
  if (!channel?.isTextBased() || !shop.message_id) return null;
  const msg = await channel.messages.fetch(String(shop.message_id)).catch(() => null);
  if (!msg) return null;
  return msg.edit({ content: '', embeds: shopEmbeds(shop), allowedMentions: { users: [] } });
}

function createShopModal() {
  return new ModalBuilder().setCustomId('pshop:create:submit').setTitle('Create Player Shop').addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('Shop name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('location').setLabel('Location / sector').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100).setPlaceholder('Example: B2 Trader or B0 near the lake')),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('type').setLabel('Shop type').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(80).setPlaceholder('General Goods, Vehicles, Building, etc.')),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('description').setLabel('Shop description').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('storefront').setLabel('Extra storefront text').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000).setPlaceholder('Optional text shown below your shop images')),
  );
}

function editShopModal(shop) {
  return new ModalBuilder().setCustomId(`pshop:edit:submit:${shop.id}`).setTitle('Edit My Shop').addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('Shop name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80).setValue(String(shop.shop_name || '').slice(0, 80))),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('location').setLabel('Location / sector').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100).setValue(String(shop.location_text || '').slice(0, 100))),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('type').setLabel('Shop type').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(80).setValue(String(shop.shop_type || '').slice(0, 80))),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('description').setLabel('Shop description').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000).setValue(String(shop.description || '').slice(0, 1000))),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('storefront').setLabel('Text shown below shop images').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000).setValue(String(shop.storefront_text || '').slice(0, 1000))),
  );
}

function managePayload(shop, viewerIsStaff = false) {
  const jump = shopJumpUrl(shop);
  const rows = [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pshop:edit:${shop.id}`).setLabel('Edit Text').setEmoji('✏️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`pshop:images:${shop.id}`).setLabel('Update Images').setEmoji('🖼️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`pshop:toggle:${shop.id}`).setLabel(shop.is_open ? 'Close Shop' : 'Open Shop').setEmoji(shop.is_open ? '🔴' : '🟢').setStyle(shop.is_open ? ButtonStyle.Secondary : ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`pshop:delete:${shop.id}`).setLabel('Delete Shop').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
  )];
  if (jump) rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('View Storefront').setStyle(ButtonStyle.Link).setURL(jump)));
  return ephemeral(`**${shop.shop_name}**\nManage your storefront below.${viewerIsStaff ? '\n*Staff override active.*' : ''}`, rows);
}

function roleRequiredPayload() {
  return ephemeral(
    `You need the <@&${SHOP_OWNER_ROLE_ID}> role before creating a player shop.\n\nOpen a ticket and request **Shop Owner** access.`,
    [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket:open').setLabel('Open a Ticket').setEmoji('📨').setStyle(ButtonStyle.Danger)
    )]
  );
}

function browsePayload(shops, page = 0) {
  const pageCount = Math.max(1, Math.ceil(shops.length / BROWSE_PAGE_SIZE));
  page = Math.max(0, Math.min(pageCount - 1, Number(page) || 0));
  const slice = shops.slice(page * BROWSE_PAGE_SIZE, (page + 1) * BROWSE_PAGE_SIZE);
  const content = shops.length
    ? `**Player Shop Directory** — ${shops.length} shop${shops.length === 1 ? '' : 's'}\nChoose a shop to view it. Page ${page + 1}/${pageCount}.`
    : '**Player Shop Directory**\nNo shops have been registered yet.';
  const rows = [];
  if (slice.length) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(`pshop:viewselect:${page}`).setPlaceholder('Select a player shop').addOptions(slice.map((shop) => ({
        label: String(shop.shop_name).slice(0, 100),
        value: String(shop.id),
        description: `${shop.is_open ? 'Open' : 'Closed'}${shop.location_text ? ` • ${shop.location_text}` : ''}`.slice(0, 100),
        emoji: shop.is_open ? '🟢' : '🔴',
      })))
    ));
  }
  if (pageCount > 1) rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pshop:browse:${Math.max(0, page - 1)}`).setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
    new ButtonBuilder().setCustomId(`pshop:browse:${Math.min(pageCount - 1, page + 1)}`).setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled(page >= pageCount - 1),
  ));
  return ephemeral(content, rows);
}

async function createStorefront(interaction) {
  const cfg = await getConfig(interaction.guildId);
  if (!cfg?.channel_id) throw new Error('Player Shops has not been set up yet.');
  const channel = interaction.guild.channels.cache.get(String(cfg.channel_id));
  if (!channel?.isTextBased()) throw new Error('The configured Player Shops channel is unavailable.');

  const existing = await getShopByOwner(interaction.guildId, interaction.user.id);
  if (existing) return interaction.reply(managePayload(existing));

  const row = {
    guild_id: String(interaction.guildId),
    owner_id: String(interaction.user.id),
    shop_name: interaction.fields.getTextInputValue('name').trim(),
    location_text: interaction.fields.getTextInputValue('location').trim(),
    shop_type: interaction.fields.getTextInputValue('type').trim() || 'General',
    description: interaction.fields.getTextInputValue('description').trim(),
    storefront_text: interaction.fields.getTextInputValue('storefront').trim(),
    is_open: true,
    channel_id: String(cfg.channel_id),
    image_urls: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const tempMessage = await channel.send({ embeds: [new EmbedBuilder().setDescription('Creating shop storefront…')] });
  row.message_id = String(tempMessage.id);
  const { data, error } = await dbRef.from(SHOPS_TABLE).insert(row).select('*').single();
  if (error) {
    await tempMessage.delete().catch(() => {});
    throw error;
  }
  await tempMessage.edit({ content: '', embeds: shopEmbeds(data), allowedMentions: { users: [] } });
  await updateDirectory(interaction.guildId);
  return interaction.reply(managePayload(data));
}

async function handlePlayerShopCommand(message) {
  if (!message.guild || !message.content?.startsWith('!')) return false;
  const command = message.content.trim().split(/\s+/)[0].toLowerCase();
  if (!['!playershopsetup', '!playershopstatus'].includes(command)) return false;
  if (!isStaff(message.member)) {
    await message.reply('Player Shop setup is for staff only.').catch(() => {});
    return true;
  }
  try {
    if (command === '!playershopsetup') {
      const old = await getConfig(message.guildId);
      let panel = old?.panel_message_id ? await message.channel.messages.fetch(String(old.panel_message_id)).catch(() => null) : null;
      const shops = await getShops(message.guildId);
      if (panel && String(old.channel_id) === String(message.channelId)) await panel.edit(directoryPayload(shops));
      else panel = await message.channel.send(directoryPayload(shops));
      await saveConfig(message.guildId, { channel_id: String(message.channelId), panel_message_id: String(panel.id) });
      await message.delete().catch(() => {});
      return true;
    }
    const cfg = await getConfig(message.guildId);
    const shops = await getShops(message.guildId);
    await message.reply(`**Watcher Player Shops**\nChannel: ${cfg?.channel_id ? `<#${cfg.channel_id}>` : 'Not set'}\nRegistered shops: ${shops.length}\nShop Owner role: <@&${SHOP_OWNER_ROLE_ID}>`);
    return true;
  } catch (err) {
    await message.reply(`Player Shop error: ${err.message}`).catch(() => {});
    return true;
  }
}

async function handlePlayerShopMessage(message) {
  if (!message.guild || message.author.bot) return false;
  const key = `${message.guildId}:${message.author.id}`;
  const pending = pendingUploads.get(key);
  if (!pending) return false;
  if (pending.expiresAt <= Date.now()) {
    pendingUploads.delete(key);
    return false;
  }
  if (String(message.channelId) !== String(pending.channelId)) return false;

  pendingUploads.delete(key);
  try {
    const shop = await getShopById(message.guildId, pending.shopId);
    if (!shop) throw new Error('That shop no longer exists.');
    if (String(shop.owner_id) !== String(message.author.id) && !isStaff(message.member)) throw new Error('You do not manage that shop.');

    const imageAttachments = [...message.attachments.values()].filter((a) => String(a.contentType || '').startsWith('image/')).slice(0, MAX_IMAGES);
    if (!imageAttachments.length) {
      await message.reply('No images were attached. Click **Update Images** again and attach at least one image.').then((m) => setTimeout(() => m.delete().catch(() => {}), 10000)).catch(() => {});
      return true;
    }

    const guild = clientRef.guilds.cache.get(String(shop.guild_id));
    const channel = guild?.channels?.cache?.get(String(shop.channel_id));
    const storefront = await channel?.messages?.fetch(String(shop.message_id)).catch(() => null);
    if (!storefront) throw new Error('The shop storefront message could not be found.');

    const files = [];
    for (let i = 0; i < imageAttachments.length; i++) {
      const a = imageAttachments[i];
      const response = await fetch(a.url);
      if (!response.ok) throw new Error(`Could not copy image ${i + 1}.`);
      const buf = Buffer.from(await response.arrayBuffer());
      const ext = String(a.name || '').match(/\.[a-z0-9]{2,5}$/i)?.[0] || '.png';
      files.push({ attachment: buf, name: `shop-${shop.id}-${i + 1}${ext}` });
    }

    // Replace old storefront attachments with the owner's new image set.
    const uploaded = await storefront.edit({ content: '', embeds: shopEmbeds({ ...shop, image_urls: [] }), files, attachments: [] });
    const urls = [...uploaded.attachments.values()].map((a) => a.url).slice(0, MAX_IMAGES);
    const storefrontText = message.content?.trim() ? message.content.trim().slice(0, 1000) : shop.storefront_text;
    const { data: updated, error } = await dbRef.from(SHOPS_TABLE).update({
      image_urls: urls,
      storefront_text: storefrontText,
      updated_at: new Date().toISOString(),
    }).eq('id', shop.id).select('*').single();
    if (error) throw error;
    await storefront.edit({ content: '', embeds: shopEmbeds(updated), allowedMentions: { users: [] } });
    await updateDirectory(message.guildId);
    await message.delete().catch(() => {});
    const ack = await channel.send({ content: `<@${message.author.id}> ✅ Your shop images were updated.`, allowedMentions: { users: [message.author.id] } }).catch(() => null);
    if (ack) setTimeout(() => ack.delete().catch(() => {}), 8000);
    return true;
  } catch (err) {
    await message.reply(`Shop image update failed: ${err.message}`).catch(() => {});
    return true;
  }
}

async function handlePlayerShopInteraction(interaction) {
  const id = String(interaction.customId || '');
  if (!id.startsWith('pshop:')) return false;
  if (!interaction.guild) return true;

  try {
    if (id === 'pshop:create' && interaction.isButton()) {
      if (!hasShopOwnerRole(interaction.member)) {
        await interaction.reply(roleRequiredPayload());
        return true;
      }
      const existing = await getShopByOwner(interaction.guildId, interaction.user.id);
      if (existing) await interaction.reply(managePayload(existing));
      else await interaction.showModal(createShopModal());
      return true;
    }

    if (id === 'pshop:create:submit' && interaction.isModalSubmit()) {
      if (!hasShopOwnerRole(interaction.member)) {
        await interaction.reply(roleRequiredPayload());
        return true;
      }
      await createStorefront(interaction);
      return true;
    }

    if (id === 'pshop:mine' && interaction.isButton()) {
      const shop = await getShopByOwner(interaction.guildId, interaction.user.id);
      if (!shop) {
        await interaction.reply(ephemeral('You do not have a player shop yet. Use **Create Shop** once you have the Shop Owner role.'));
      } else await interaction.reply(managePayload(shop));
      return true;
    }

    if (id.startsWith('pshop:browse:') && interaction.isButton()) {
      const page = Number(id.split(':')[2] || 0);
      const shops = await getShops(interaction.guildId);
      const payload = browsePayload(shops, page);
      if (interaction.replied || interaction.deferred) { const { flags, ...update } = payload; await interaction.update(update); }
      else await interaction.reply(payload);
      return true;
    }

    if (id.startsWith('pshop:viewselect:') && interaction.isStringSelectMenu()) {
      const shop = await getShopById(interaction.guildId, interaction.values[0]);
      if (!shop) await interaction.reply(ephemeral('That shop no longer exists.'));
      else {
        const jump = shopJumpUrl(shop);
        const rows = jump ? [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Open Storefront').setStyle(ButtonStyle.Link).setURL(jump))] : [];
        await interaction.reply({ embeds: shopEmbeds(shop), components: rows, flags: MessageFlags.Ephemeral, allowedMentions: { users: [] } });
      }
      return true;
    }

    const parts = id.split(':');
    const action = parts[1];
    const shopId = parts.slice(2).join(':');
    const shop = await getShopById(interaction.guildId, shopId);
    if (!shop) {
      await interaction.reply(ephemeral('That shop no longer exists.'));
      return true;
    }
    const canManage = String(shop.owner_id) === String(interaction.user.id) || isStaff(interaction.member);
    if (!canManage) {
      await interaction.reply(ephemeral('Only the shop owner or staff can manage this storefront.'));
      return true;
    }

    if (action === 'edit' && interaction.isButton()) {
      await interaction.showModal(editShopModal(shop));
      return true;
    }

    if (action === 'edit' && parts[2] === 'submit' && interaction.isModalSubmit()) return true;

    if (id.startsWith('pshop:edit:submit:') && interaction.isModalSubmit()) {
      // This branch is handled before generic shop lookup in newer interaction paths.
      return true;
    }

    if (action === 'images' && interaction.isButton()) {
      pendingUploads.set(`${interaction.guildId}:${interaction.user.id}`, {
        shopId: shop.id,
        channelId: shop.channel_id,
        expiresAt: Date.now() + UPLOAD_WINDOW_MS,
      });
      await interaction.reply(ephemeral([
        '**Ready for your shop images.**',
        `Go to <#${shop.channel_id}> and send your **next message** with up to ${MAX_IMAGES} images attached.`,
        'You can also type text in that same message; if you do, Watcher will use it as the text shown **below your shop images**.',
        '',
        'Watcher will copy the images to your storefront and remove your upload message so the channel stays clean.',
        '**This upload window expires in 5 minutes.**',
      ].join('\n')));
      return true;
    }

    if (action === 'toggle' && interaction.isButton()) {
      const { data: updated, error } = await dbRef.from(SHOPS_TABLE).update({ is_open: !shop.is_open, updated_at: new Date().toISOString() }).eq('id', shop.id).select('*').single();
      if (error) throw error;
      await updateShopMessage(updated);
      await updateDirectory(interaction.guildId);
      { const { flags, ...update } = managePayload(updated, isStaff(interaction.member)); await interaction.update(update); }
      return true;
    }

    if (action === 'delete' && interaction.isButton()) {
      await interaction.reply(ephemeral(`Delete **${shop.shop_name}** permanently?`, [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`pshop:deleteconfirm:${shop.id}`).setLabel('Yes, Delete Shop').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`pshop:cancel:${shop.id}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      )]));
      return true;
    }

    if (action === 'deleteconfirm' && interaction.isButton()) {
      const guild = clientRef.guilds.cache.get(String(shop.guild_id));
      const channel = guild?.channels?.cache?.get(String(shop.channel_id));
      const msg = await channel?.messages?.fetch(String(shop.message_id)).catch(() => null);
      await msg?.delete().catch(() => {});
      const { error } = await dbRef.from(SHOPS_TABLE).delete().eq('id', shop.id);
      if (error) throw error;
      await updateDirectory(interaction.guildId);
      await interaction.update({ content: '✅ Shop deleted.', embeds: [], components: [] });
      return true;
    }

    if (action === 'cancel' && interaction.isButton()) {
      await interaction.update({ content: 'Cancelled.', embeds: [], components: [] });
      return true;
    }

    return true;
  } catch (err) {
    console.error('Player Shop interaction error:', err);
    const payload = ephemeral(`Player Shop error: ${err.message}`);
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
    return true;
  }
}

// Modal submit IDs contain an extra segment, so handle them before the normal interaction router.
async function handlePlayerShopModal(interaction) {
  const id = String(interaction.customId || '');
  if (!interaction.isModalSubmit() || !id.startsWith('pshop:edit:submit:')) return false;
  try {
    const shopId = id.slice('pshop:edit:submit:'.length);
    const shop = await getShopById(interaction.guildId, shopId);
    if (!shop) throw new Error('That shop no longer exists.');
    if (String(shop.owner_id) !== String(interaction.user.id) && !isStaff(interaction.member)) throw new Error('Only the shop owner or staff can edit this storefront.');
    const patch = {
      shop_name: interaction.fields.getTextInputValue('name').trim(),
      location_text: interaction.fields.getTextInputValue('location').trim(),
      shop_type: interaction.fields.getTextInputValue('type').trim() || 'General',
      description: interaction.fields.getTextInputValue('description').trim(),
      storefront_text: interaction.fields.getTextInputValue('storefront').trim(),
      updated_at: new Date().toISOString(),
    };
    const { data: updated, error } = await dbRef.from(SHOPS_TABLE).update(patch).eq('id', shop.id).select('*').single();
    if (error) throw error;
    await updateShopMessage(updated);
    await updateDirectory(interaction.guildId);
    await interaction.reply(managePayload(updated, isStaff(interaction.member)));
    return true;
  } catch (err) {
    const payload = ephemeral(`Player Shop error: ${err.message}`);
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
    return true;
  }
}

function startPlayerShops(client, db) {
  clientRef = client;
  dbRef = db;
  setInterval(() => {
    const now = Date.now();
    for (const [key, value] of pendingUploads) if (value.expiresAt <= now) pendingUploads.delete(key);
  }, 60_000).unref?.();
}


function decodePortalImages(images, prefix) {
  if (!Array.isArray(images)) return [];
  return images.slice(0, MAX_IMAGES).map((item, index) => {
    const raw = String(item?.data || '');
    const match = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s);
    if (!match) throw new Error(`Image ${index + 1} is invalid.`);
    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length || buffer.length > 8 * 1024 * 1024) throw new Error(`Image ${index + 1} must be smaller than 8 MB.`);
    const ext = String(item?.name || '').match(/\.[a-z0-9]{2,5}$/i)?.[0] || (match[1].includes('jpeg') ? '.jpg' : '.png');
    return { attachment: buffer, name: `${prefix}-${index + 1}${ext}` };
  });
}

async function portalMember(guildId, discordId) {
  const guild = clientRef?.guilds?.cache?.get(String(guildId));
  return guild?.members?.fetch(String(discordId)).catch(() => null);
}

async function portalCreateShop(ctx, values) {
  const member = await portalMember(ctx.guildId, ctx.discordId);
  if (!member || !hasShopOwnerRole(member)) throw new Error('You need the Shop Owner role before creating a shop. Open a ticket to request it.');
  const existing = await getShopByOwner(ctx.guildId, ctx.discordId);
  if (existing) throw new Error('You already own a player shop.');
  const name = String(values.shop_name || '').trim().slice(0, 80);
  if (!name) throw new Error('Shop name is required.');
  const now = new Date().toISOString();
  const row = { guild_id:String(ctx.guildId), owner_id:String(ctx.discordId), shop_name:name, location_text:String(values.location_text||'').trim().slice(0,100), shop_type:String(values.shop_type||'General').trim().slice(0,80)||'General', description:String(values.description||'').trim().slice(0,1000), storefront_text:String(values.storefront_text||'').trim().slice(0,1000), is_open:true, channel_id:String(PORTAL_MEDIA_CHANNEL_ID), message_id:'portal', image_urls:[], created_at:now, updated_at:now };
  const {data,error}=await dbRef.from(SHOPS_TABLE).insert(row).select('*').single();
  if(error) throw error;
  return data;
}

async function portalUpdateShop(ctx, values) {
  const shop = await getShopByOwner(ctx.guildId, ctx.discordId);
  if (!shop) throw new Error('You do not have a player shop yet.');
  const patch={shop_name:String(values.shop_name??shop.shop_name).trim().slice(0,80),location_text:String(values.location_text??shop.location_text??'').trim().slice(0,100),shop_type:String(values.shop_type??shop.shop_type??'General').trim().slice(0,80)||'General',description:String(values.description??shop.description??'').trim().slice(0,1000),storefront_text:String(values.storefront_text??shop.storefront_text??'').trim().slice(0,1000),updated_at:new Date().toISOString()};
  if(!patch.shop_name) throw new Error('Shop name is required.');
  const {data,error}=await dbRef.from(SHOPS_TABLE).update(patch).eq('id',shop.id).select('*').single(); if(error)throw error;
  const msg=await getStoredMessage(data); if(msg) await msg.edit({content:`Portal media storage • Player Shop • ${data.shop_name}`,embeds:shopEmbeds(data),allowedMentions:{users:[]}}).catch(()=>{});
  return data;
}
async function portalToggleShop(ctx){const shop=await getShopByOwner(ctx.guildId,ctx.discordId);if(!shop)throw new Error('You do not have a player shop yet.');const{data,error}=await dbRef.from(SHOPS_TABLE).update({is_open:!shop.is_open,updated_at:new Date().toISOString()}).eq('id',shop.id).select('*').single();if(error)throw error;const msg=await getStoredMessage(data);if(msg)await msg.edit({embeds:shopEmbeds(data)}).catch(()=>{});return data;}
async function portalDeleteShop(ctx){const shop=await getShopByOwner(ctx.guildId,ctx.discordId);if(!shop)throw new Error('You do not have a player shop yet.');const msg=await getStoredMessage(shop);await msg?.delete().catch(()=>{});const{error}=await dbRef.from(SHOPS_TABLE).delete().eq('id',shop.id);if(error)throw error;return{ok:true};}
async function portalSetShopImages(ctx, values){const shop=await getShopByOwner(ctx.guildId,ctx.discordId);if(!shop)throw new Error('You do not have a player shop yet.');const preserveExisting=values?.preserveExisting===true;const files=decodePortalImages(values.images,`shop-${shop.id}`);let msg=await getStoredMessage(shop);if(!msg&&files.length){const channel=await getPortalMediaChannel(ctx.guildId);msg=await channel.send({content:`Portal media storage • Player Shop • ${shop.shop_name}`,allowedMentions:{parse:[]}});}let urls=Array.isArray(shop.image_urls)?shop.image_urls.filter(Boolean).slice(0,MAX_IMAGES):[];if(msg&&files.length){const uploaded=await msg.edit({content:`Portal media storage • Player Shop • ${shop.shop_name}`,embeds:[],files,attachments:[]});urls=[...uploaded.attachments.values()].map(a=>a.url).slice(0,MAX_IMAGES);}else if(msg&&!files.length&&!preserveExisting){await msg.delete().catch(()=>{});msg=null;urls=[];}const patch={image_urls:urls,storefront_text:String(values.storefront_text??shop.storefront_text??'').trim().slice(0,1000),channel_id:msg?String(msg.channelId):String(PORTAL_MEDIA_CHANNEL_ID),message_id:msg?String(msg.id):'portal',updated_at:new Date().toISOString()};const{data,error}=await dbRef.from(SHOPS_TABLE).update(patch).eq('id',shop.id).select('*').single();if(error)throw error;return data;}
async function portalAdminShop(ctx, values){if(!ctx.isAdmin)throw new Error('Admin access required.');const shop=await getShopById(ctx.guildId,values.id);if(!shop)throw new Error('Shop not found.');if(values.action==='delete'){const msg=await getStoredMessage(shop);await msg?.delete().catch(()=>{});const{error}=await dbRef.from(SHOPS_TABLE).delete().eq('id',shop.id);if(error)throw error;return{ok:true};}if(values.action==='toggle'){const{data,error}=await dbRef.from(SHOPS_TABLE).update({is_open:!shop.is_open,updated_at:new Date().toISOString()}).eq('id',shop.id).select('*').single();if(error)throw error;return data;}throw new Error('Unknown shop moderation action.');}

module.exports = { startPlayerShops, handlePlayerShopCommand, handlePlayerShopMessage, handlePlayerShopInteraction, handlePlayerShopModal, portalCreateShop, portalUpdateShop, portalToggleShop, portalDeleteShop, portalSetShopImages, portalAdminShop };
