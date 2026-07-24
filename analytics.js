const { EmbedBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const { DateTime } = require('luxon');
const { getOnlinePlayers, getServerSummary } = require('./ggcon');

const TZ = process.env.WATCHER_TIMEZONE || 'America/Toronto';
const MAIN_CHAT_ID = process.env.MAIN_CHAT_CHANNEL_ID || '1516269437932670977';
const CONFIG_TABLE = 'watcher_analytics_config';
const DAILY_TABLE = 'watcher_daily_activity';
const RUNTIME_TABLE = process.env.WATCHER_RUNTIME_STATE_TABLE || 'watcher_runtime_state';
let db;
let timer;
let pulseBusy = false;

function getDb() {
  if (!db) db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, { auth: { persistSession: false } });
  return db;
}
function isStaff(member) { return !!member?.roles?.cache?.some(r => ['Owner','Owners','Admin','Trial Admin'].includes(r.name)); }
function money(n) { return Number(n || 0).toLocaleString('en-CA'); }
function nowEt() { return DateTime.now().setZone(TZ); }
function dailyCutoffHour() { return Number(process.env.DAILY_STORY_HOUR || 19); }
function reportingDateForNow(dt = nowEt()) {
  const cutoff = dt.startOf('day').set({ hour: dailyCutoffHour(), minute: 0, second: 0, millisecond: 0 });
  return dt < cutoff ? dt.startOf('day') : dt.plus({ days: 1 }).startOf('day');
}
function rangeForReportingDate(dt) {
  const endLocal = dt.startOf('day').set({ hour: dailyCutoffHour(), minute: 0, second: 0, millisecond: 0 });
  const startLocal = endLocal.minus({ days: 1 });
  return { start: startLocal.toUTC().toISO(), end: endLocal.toUTC().toISO() };
}
function rangeForWeek(dt) { return { start: dt.startOf('week').toUTC().toISO(), end: dt.endOf('week').toUTC().toISO() }; }
async function safeRows(table, select, filters = []) {
  try {
    let q = getDb().from(table).select(select);
    for (const [op, col, val] of filters) q = q[op](col, val);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  } catch (e) {
    console.warn(`⚠️ Analytics skipped ${table}: ${e.message}`);
    return [];
  }
}
async function stateGet(key) {
  const { data } = await getDb().from(RUNTIME_TABLE).select('value').eq('key', key).maybeSingle();
  return data?.value || null;
}
async function stateSet(key, value) {
  await getDb().from(RUNTIME_TABLE).upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
}
async function getConfig(guildId) {
  const { data } = await getDb().from(CONFIG_TABLE).select('*').eq('guild_id', String(guildId)).maybeSingle();
  return data || null;
}
async function saveConfig(guildId, patch) {
  const { error } = await getDb().from(CONFIG_TABLE).upsert({ guild_id: String(guildId), ...patch, updated_at: new Date().toISOString() }, { onConflict: 'guild_id' });
  if (error) throw error;
}
function playerId(p) { return String(p?.userId || p?.steamId || p?.steamID || p?.steam_id || p?.playerId || p?.id || '').trim(); }
async function observeOnline(guild) {
  const [players, server] = await Promise.all([
    getOnlinePlayers().catch(() => []),
    getServerSummary().catch(() => null),
  ]);
  const ids = [...new Set((players || []).map(playerId).filter(Boolean))];
  const reportedOnline = Number(server?.onlinePlayers);
  const count = Number.isFinite(reportedOnline) && reportedOnline >= 0 ? reportedOnline : ids.length;
  const day = reportingDateForNow().toISODate();
  const { data } = await getDb().from(DAILY_TABLE).select('*').eq('guild_id', guild.id).eq('activity_date', day).maybeSingle();
  const previous = Array.isArray(data?.observed_player_ids) ? data.observed_player_ids : [];
  await getDb().from(DAILY_TABLE).upsert({
    guild_id: guild.id,
    activity_date: day,
    observed_player_ids: [...new Set([...previous, ...ids])],
    peak_online: Math.max(Number(data?.peak_online || 0), count),
    last_online: count,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'guild_id,activity_date' });
  return { players, count };
}
async function countRows(table, timeCol, start, end, extra = []) {
  const filters = [['gte', timeCol, start], ['lte', timeCol, end], ...extra];
  return (await safeRows(table, '*', filters)).length;
}
async function buildDailyStory(guild, date = nowEt()) {
  const { start, end } = rangeForReportingDate(date);
  const day = date.toISODate();
  const { data: activity } = await getDb().from(DAILY_TABLE).select('*').eq('guild_id', guild.id).eq('activity_date', day).maybeSingle();
  const [registrations, airlifts, rentals, purchases, ticketsOpened, ticketsClosed, lottery] = await Promise.all([
    countRows(process.env.WATCHER_PLAYER_LINKS_TABLE || 'watcher_player_links', 'created_at', start, end, [['eq','guild_id',guild.id]]),
    countRows(process.env.WATCHER_AIRLIFT_TABLE || 'watcher_airlift_rides', 'completed_at', start, end, [['eq','guild_id',guild.id],['eq','status','completed']]),
    countRows(process.env.WATCHER_DIRTBIKE_RENTAL_TABLE || 'watcher_dirtbike_rentals', 'started_at', start, end, [['eq','guild_id',guild.id]]),
    safeRows(process.env.WATCHER_SHOP_PURCHASES_TABLE || 'watcher_shop_purchases', '*', [['gte','created_at',start],['lte','created_at',end],['eq','guild_id',guild.id],['eq','status','delivered']]),
    countRows('watcher_tickets', 'opened_at', start, end, [['eq','guild_id',guild.id]]),
    countRows('watcher_tickets', 'closed_at', start, end, [['eq','guild_id',guild.id],['eq','status','closed']]),
    safeRows(process.env.WATCHER_LOTTERY_DRAWS_TABLE || 'watcher_lottery_draws', '*', [['gte','actual_run_at',start],['lte','actual_run_at',end],['eq','guild_id',guild.id],['eq','status','completed']]),
  ]);
  const unique = activity?.observed_player_ids?.length || 0;
  const peak = Number(activity?.peak_online || 0);
  const spent = purchases.reduce((s, r) => s + Number(r.price || 0), 0);
  const lines = [];
  if (unique || peak) lines.push(`**${unique}** Exile${unique === 1 ? '' : 's'} checked in, with a peak of **${peak}** online.`);
  if (registrations) lines.push(`**${registrations}** new player${registrations === 1 ? '' : 's'} completed registration.`);
  const services = [];
  if (airlifts) services.push(`${airlifts} airlift${airlifts === 1 ? '' : 's'}`);
  if (rentals) services.push(`${rentals} dirtbike rental${rentals === 1 ? '' : 's'}`);
  if (purchases.length) services.push(`${purchases.length} shop purchase${purchases.length === 1 ? '' : 's'} worth **$${money(spent)}**`);
  if (services.length) lines.push(`${services.join(', ')} were processed by The Watcher.`);
  if (lottery.length) lines.push(`The lottery selected **${lottery.length}** winner${lottery.length === 1 ? '' : 's'}.`);
  if (ticketsOpened || ticketsClosed) lines.push(`Support handled **${ticketsOpened}** new ticket${ticketsOpened === 1 ? '' : 's'} and closed **${ticketsClosed}**.`);
  if (!lines.length) lines.push('The island was unusually quiet. The Watcher remains suspicious.');
  const closers = ['Another day survived. Questionable decisions were recorded.', 'Outpost X remains standing. Somehow.', 'The Watcher observed everything and judged most of it.', 'The island tried. The Exiles tried harder.'];
  lines.push(closers[Math.floor(Math.random() * closers.length)]);
  return new EmbedBuilder()
    .setTitle('👁️ Today at Outpost X')
    .setDescription(lines.join('\n\n'))
    .setFooter({ text: `${date.minus({ days: 1 }).toFormat('LLL d, h:mm a')}–${date.toFormat('LLL d, h:mm a')} ET` });
}
function rowDisplayName(row) {
  return row?.player_name
    || row?.selected_scum_name
    || row?.scum_name
    || row?.opener_tag
    || row?.discord_tag
    || null;
}

function topBy(rows, key, value = () => 1) {
  const map = new Map();
  for (const r of rows) {
    const id = String(r?.[key] || '').trim();
    if (!id) continue;
    const item = map.get(id) || { id, name: rowDisplayName(r), total: 0 };
    if (!item.name) item.name = rowDisplayName(r);
    item.total += Number(value(r) || 0);
    map.set(id, item);
  }
  return [...map.values()].sort((a, b) => b.total - a.total)[0] || null;
}

function pickLine(lines) {
  return lines[Math.floor(Math.random() * lines.length)];
}

async function awardName(guild, award) {
  if (!award) return 'Unknown Exile';
  if (award.name) return award.name;
  const member = await guild.members.fetch(award.id).catch(() => null);
  return member?.displayName || member?.user?.username || 'Unknown Exile';
}

async function addAward(awards, guild, award, icon, title, statText, jokes) {
  if (!award || Number(award.total || 0) <= 0) return;
  const name = await awardName(guild, award);
  awards.push(`${icon} **${title} — ${name}**\n${statText(award.total)} ${pickLine(jokes)}`);
}

async function buildWeeklyAwards(guild, date = nowEt()) {
  const { start, end } = rangeForWeek(date);
  const insuranceTable = process.env.WATCHER_VEHICLE_INSURANCE_TABLE || 'watcher_vehicle_insurance';
  const claimsTable = process.env.WATCHER_INSURANCE_CLAIMS_TABLE || 'watcher_insurance_claims';
  const shopTable = process.env.WATCHER_SHOP_PURCHASES_TABLE || 'watcher_shop_purchases';

  const [airlifts, rentals, purchases, lottery, policies, claims, ticketsOpened, ticketsClosed] = await Promise.all([
    safeRows(process.env.WATCHER_AIRLIFT_TABLE || 'watcher_airlift_rides', '*', [['gte','completed_at',start],['lte','completed_at',end],['eq','guild_id',guild.id],['eq','status','completed']]),
    safeRows(process.env.WATCHER_DIRTBIKE_RENTAL_TABLE || 'watcher_dirtbike_rentals', '*', [['gte','started_at',start],['lte','started_at',end],['eq','guild_id',guild.id]]),
    safeRows(shopTable, '*', [['gte','created_at',start],['lte','created_at',end],['eq','guild_id',guild.id],['eq','status','delivered']]),
    safeRows(process.env.WATCHER_LOTTERY_DRAWS_TABLE || 'watcher_lottery_draws', '*', [['gte','actual_run_at',start],['lte','actual_run_at',end],['eq','guild_id',guild.id],['eq','status','completed']]),
    safeRows(insuranceTable, '*', [['gte','purchased_at',start],['lte','purchased_at',end],['eq','guild_id',guild.id]]),
    safeRows(claimsTable, '*', [['gte','created_at',start],['lte','created_at',end],['eq','guild_id',guild.id]]),
    safeRows('watcher_tickets', '*', [['gte','opened_at',start],['lte','opened_at',end],['eq','guild_id',guild.id]]),
    safeRows('watcher_tickets', '*', [['gte','closed_at',start],['lte','closed_at',end],['eq','guild_id',guild.id],['eq','status','closed']]),
  ]);

  const awards = [];
  const delivered = purchases.filter(row => row.status === 'delivered');
  const mechPurchases = delivered.filter(row => ['rpg7','rockets10'].includes(String(row.package_id || '').toLowerCase()));
  const medicalPurchases = delivered.filter(row => String(row.package_id || '').toLowerCase() === 'medical');
  const gasPurchases = delivered.filter(row => String(row.package_id || '').toLowerCase() === 'gas');

  await addAward(awards, guild, topBy(airlifts, 'steam_id'), '✈️', 'Frequent Flyer',
    total => `Completed **${total}** airlift${total === 1 ? '' : 's'}.`,
    ['Apparently roads are beneath them.', 'Has developed a complicated relationship with parachutes.', 'The ground remains optional.']);

  await addAward(awards, guild, topBy(rentals, 'steam_id'), '🏍️', 'Rental Regular',
    total => `Rented **${total}** dirtbike${total === 1 ? '' : 's'}.`,
    ['Ownership was considered and immediately rejected.', 'The rental counter knows them by name.', 'Thirty minutes at a time is apparently a lifestyle.']);

  await addAward(awards, guild, topBy(delivered, 'steam_id', row => row.price), '💸', 'Big Spender',
    total => `Spent **$${money(total)}** in the Watcher Shop.`,
    ['The economy thanks them. Their wallet does not.', 'Clicked Buy with remarkable confidence.', 'Financial restraint was not detected.']);

  await addAward(awards, guild, topBy(lottery, 'selected_steam_id'), '🍀', 'Lucky Exile',
    total => `Won **${total}** lotter${total === 1 ? 'y' : 'ies'}.`,
    ['Probability has filed a complaint.', 'The random number generator seems suspiciously friendly.', 'Luck continues to carry the operation.']);

  await addAward(awards, guild, topBy(policies, 'steam_id'), '🛡️', 'Insurance Addict',
    total => `Purchased **${total}** insurance polic${total === 1 ? 'y' : 'ies'}.`,
    ['Trusts their driving exactly as much as The Watcher does.', 'Prepared for consequences before creating them.', 'Reads “covered” as a personal challenge.']);

  await addAward(awards, guild, topBy(claims, 'steam_id'), '💥', 'Claim Magnet',
    total => `Generated **${total}** insurance claim${total === 1 ? '' : 's'}.`,
    ['The vehicles remain unavailable for comment.', 'Insurance paperwork has become a hobby.', 'Somewhere, a mechanic just sighed.']);

  await addAward(awards, guild, topBy(ticketsOpened, 'opener_id'), '🎟️', 'Ticket Enthusiast',
    total => `Opened **${total}** support ticket${total === 1 ? '' : 's'}.`,
    ['Customer support has added them to Favorites.', 'The ticket button is now visibly worn.', 'Had questions. Then found more questions.']);

  await addAward(awards, guild, topBy(ticketsClosed, 'closed_by_id'), '🧰', 'Professional Problem Solver',
    total => `Closed **${total}** ticket${total === 1 ? '' : 's'}.`,
    ['Kept the chaos moving in an orderly direction.', 'Resolved problems faster than players could invent them.', 'The close-reason box knows their typing style.']);

  await addAward(awards, guild, topBy(mechPurchases, 'steam_id', row => row.price), '🤖', 'Mech Night Investor',
    total => `Spent **$${money(total)}** on RPGs and rockets.`,
    ['Peace was never part of the budget.', 'Invested heavily in loud problem-solving.', 'The mechs have been advised to review their insurance.']);

  await addAward(awards, guild, topBy(medicalPurchases, 'steam_id'), '🩺', 'Medical Emergency',
    total => `Bought **${total}** Medical Kit${total === 1 ? '' : 's'}.`,
    ['Survival appears to require a subscription plan.', 'Bandages were purchased in a tone of urgency.', 'The pharmacy aisle has been personally audited.']);

  await addAward(awards, guild, topBy(gasPurchases, 'steam_id'), '⛽', 'Running on Fumes',
    total => `Bought **${total}** Emergency Gas can${total === 1 ? '' : 's'}.`,
    ['Fuel planning remains an emerging skill.', 'The red warning light is apparently decorative.', 'Once again rescued by a canister and poor foresight.']);

  if (!awards.length) {
    awards.push('No awards qualified this week. The Watcher expects more questionable ambition next week.');
  }

  return new EmbedBuilder()
    .setTitle('🏆 Outpost X Weekly Awards')
    .setDescription(awards.join('\n\n'))
    .setFooter({ text: `Week ending ${date.toFormat('LLLL d')} • Verified Watcher activity only` });
}

async function nextRestartText() {
  const hours = String(process.env.SERVER_RESTART_HOURS || '0,4,8,12,16,20')
    .split(',')
    .map(Number)
    .filter(h => Number.isInteger(h) && h >= 0 && h <= 23)
    .sort((a, b) => a - b);
  const restartHours = hours.length ? hours : [0, 4, 8, 12, 16, 20];
  const now = nowEt();
  let next = null;
  for (const hour of restartHours) {
    const candidate = now.startOf('day').set({ hour, minute: 0, second: 0, millisecond: 0 });
    if (candidate > now) { next = candidate; break; }
  }
  if (!next) next = now.plus({ days: 1 }).startOf('day').set({ hour: restartHours[0], minute: 0, second: 0, millisecond: 0 });

  const totalMinutes = Math.max(0, Math.ceil(next.diff(now, 'minutes').minutes));
  const hoursLeft = Math.floor(totalMinutes / 60);
  const minutesLeft = totalMinutes % 60;
  const countdown = hoursLeft > 0
    ? `${hoursLeft}h ${minutesLeft}m`
    : `${minutesLeft}m`;
  return `**${next.toFormat('h:mm a')} ET** — in **${countdown}**`;
}

async function getTodayPulseStats(guild) {
  const now = nowEt();
  const reportingDate = reportingDateForNow(now);
  const day = reportingDate.toISODate();
  const { start, end } = rangeForReportingDate(reportingDate);
  const [{ data: activity }, registrations, lotteryConfig] = await Promise.all([
    getDb().from(DAILY_TABLE).select('*').eq('guild_id', guild.id).eq('activity_date', day).maybeSingle(),
    countRows(process.env.WATCHER_PLAYER_LINKS_TABLE || 'watcher_player_links', 'created_at', start, end, [['eq','guild_id',guild.id]]),
    stateGet('lottery_config').catch(() => null),
  ]);

  let lotteryStatus = 'Disabled';
  if (lotteryConfig?.enabled) {
    let nextDraw = now.set({ minute: 45, second: 0, millisecond: 0 });
    if (now > nextDraw) nextDraw = nextDraw.plus({ hours: 1 });
    lotteryStatus = `Enabled • next ${nextDraw.toFormat('h:mm a')}`;
  }

  return {
    peakToday: Number(activity?.peak_online || 0),
    totalPlayersToday: Array.isArray(activity?.observed_player_ids) ? activity.observed_player_ids.length : 0,
    registeredToday: Number(registrations || 0),
    lotteryStatus,
  };
}

function stripLiveStatusFields(fields = []) {
  const liveNames = new Set([
    '👁️ Live Server Status',
    'Players Online', 'Peak Today', 'Total Players Today', 'Registered Today',
    'Peak This Cycle', 'Players This Cycle', 'Registered This Cycle',
    'Lottery Status', 'Open Tickets', 'Active Rentals',
    'Next Restart', 'Watcher Services', 'Last Updated',
  ]);
  return fields.filter(field => !liveNames.has(field?.name));
}

async function findServerInfoMessage(channel, botUserId) {
  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (!messages) return null;
  return messages.find(message => {
    if (message.author?.id !== botUserId || !message.embeds?.length) return false;
    const embed = message.embeds[0];
    const footer = embed.footer?.text || '';
    const title = embed.title || '';
    const description = embed.description || '';
    return footer.includes('Outpost X Rules') && (
      /server info/i.test(title) ||
      /direct connect/i.test(description) ||
      /server restarts/i.test(description)
    );
  }) || null;
}

async function updatePulse(guild) {
  if (pulseBusy) return; pulseBusy = true;
  try {
    const cfg = await getConfig(guild.id); if (!cfg?.pulse_channel_id || !cfg?.pulse_message_id) return;
    const channel = await guild.channels.fetch(cfg.pulse_channel_id).catch(()=>null); if (!channel?.isTextBased()) return;
    const message = await channel.messages.fetch(cfg.pulse_message_id).catch(()=>null); if (!message) return;
    const [online, openTickets, activeRentals, todayStats] = await Promise.all([
      observeOnline(guild).catch(()=>({count:0})),
      safeRows('watcher_tickets','id',[['eq','guild_id',guild.id],['eq','status','open']]),
      safeRows(process.env.WATCHER_DIRTBIKE_RENTAL_TABLE || 'watcher_dirtbike_rentals','id',[['eq','guild_id',guild.id],['in','status',['active','removal_pending']]]),
      getTodayPulseStats(guild).catch(() => ({ peakToday: 0, totalPlayersToday: 0, registeredToday: 0, lotteryStatus: 'Unavailable' })),
    ]);

    const base = message.embeds?.[0]?.toJSON?.() || {};
    const isLegacyPulse = /Watcher Activity Pulse/i.test(base.title || '');
    const embed = isLegacyPulse
      ? new EmbedBuilder().setTitle('👁️ Watcher Activity Pulse').setDescription('Live Outpost X service status.')
      : EmbedBuilder.from(base);

    embed.setFields(...stripLiveStatusFields(base.fields || []));
    embed.addFields(
      { name:'👁️ Live Server Status', value:'Updated automatically by The Watcher.', inline:false },
      { name:'Players Online', value:`**${online.count}**`, inline:true },
      { name:'Peak This Cycle', value:`**${todayStats.peakToday}**`, inline:true },
      { name:'Players This Cycle', value:`**${todayStats.totalPlayersToday}**`, inline:true },
      { name:'Registered This Cycle', value:`**${todayStats.registeredToday}**`, inline:true },
      { name:'Lottery Status', value:todayStats.lotteryStatus, inline:true },
      { name:'Open Tickets', value:`**${openTickets.length}**`, inline:true },
      { name:'Active Rentals', value:`**${activeRentals.length}**`, inline:true },
      { name:'Next Restart', value:await nextRestartText(), inline:true },
      { name:'Watcher Services', value:'🟢 Online', inline:true },
      { name:'Last Updated', value:`<t:${Math.floor(Date.now()/1000)}:R>`, inline:true },
    );
    if (isLegacyPulse) embed.setFooter({ text:'Updates approximately every 5 minutes' });
    await message.edit({ embeds:[embed] });
  } finally { pulseBusy = false; }
}

async function postDaily(bot, guild, force=false) {
  const storyDate = nowEt();
  const key = `analytics:daily:${guild.id}:${storyDate.toISODate()}`;
  if (!force && await stateGet(key)) return;
  const ch = await guild.channels.fetch(MAIN_CHAT_ID).catch(()=>null); if (!ch?.isTextBased()) return;
  await ch.send({ embeds:[await buildDailyStory(guild, storyDate)] }); await stateSet(key,{posted_at:new Date().toISOString()});
}
async function postAwards(bot, guild, force=false) {
  const week = nowEt().toFormat("kkkk-'W'WW"); const key=`analytics:awards:${guild.id}:${week}`;
  if (!force && await stateGet(key)) return;
  const ch = await guild.channels.fetch(MAIN_CHAT_ID).catch(()=>null); if (!ch?.isTextBased()) return;
  await ch.send({ embeds:[await buildWeeklyAwards(guild)] }); await stateSet(key,{posted_at:new Date().toISOString()});
}
async function tick(bot) {
  const now = nowEt();
  const dailyHour = Number(process.env.DAILY_STORY_HOUR || 19);
  const awardsHour = Number(process.env.WEEKLY_AWARDS_HOUR || 18);
  const dailyDue = now >= now.startOf('day').set({ hour: dailyHour, minute: 0, second: 0, millisecond: 0 });
  const awardsDue = now.weekday === 5 && now >= now.startOf('day').set({ hour: awardsHour, minute: 0, second: 0, millisecond: 0 });

  for (const guild of bot.guilds.cache.values()) {
    await observeOnline(guild).catch(()=>{});
    await updatePulse(guild).catch(e=>console.error('❌ Pulse update failed:',e.message));

    // Do not depend on the five-minute timer landing inside an exact 00-04 minute window.
    // Once the scheduled time has passed, the Supabase state key prevents duplicate posts.
    if (dailyDue) {
      await postDaily(bot,guild).catch(e=>console.error('❌ Daily story failed:',e.message));
    }
    if (awardsDue) {
      await postAwards(bot,guild).catch(e=>console.error('❌ Weekly awards failed:',e.message));
    }
  }
}
function startAnalyticsOnBoot(bot) {
  clearInterval(timer); tick(bot).catch(()=>{}); timer=setInterval(()=>tick(bot).catch(()=>{}),5*60*1000);
}
async function handleAnalyticsCommand(message) {
  if (!message.guild || !message.content?.startsWith('!')) return false;
  const cmd=message.content.trim().split(/\s+/)[0].toLowerCase();
  if (!['!pulsesetup','!pulsestatus','!storynow','!awardsnow'].includes(cmd)) return false;
  if (!isStaff(message.member)) { await message.reply('Only Watcher staff can use that command.'); return true; }
  if (cmd === '!pulsesetup') {
    const existing = await getConfig(message.guild.id);
    const serverInfo = await findServerInfoMessage(message.channel, message.client.user.id);
    if (!serverInfo) {
      await message.reply('I could not find the Watcher Server Info post in this channel. Run `!pulsesetup` in the channel containing that post.');
      return true;
    }

    if (existing?.pulse_channel_id && existing?.pulse_message_id && existing.pulse_message_id !== serverInfo.id) {
      const oldChannel = await message.guild.channels.fetch(existing.pulse_channel_id).catch(() => null);
      const oldMessage = oldChannel?.isTextBased()
        ? await oldChannel.messages.fetch(existing.pulse_message_id).catch(() => null)
        : null;
      if (oldMessage?.embeds?.[0] && /Watcher Activity Pulse/i.test(oldMessage.embeds[0].title || '')) {
        await oldMessage.delete().catch(() => {});
      }
    }

    await saveConfig(message.guild.id,{pulse_channel_id:message.channel.id,pulse_message_id:serverInfo.id});
    await message.delete().catch(()=>{});
    await updatePulse(message.guild);
    return true;
  }
  if (cmd === '!pulsestatus') { const c=await getConfig(message.guild.id); await message.reply(c?.pulse_channel_id?`Pulse is posted in <#${c.pulse_channel_id}>.`:'The Activity Pulse has not been set up yet.'); return true; }
  if (cmd === '!storynow') { await postDaily(message.client,message.guild,true); await message.reply('Daily Server Story posted in Main Chat.'); return true; }
  if (cmd === '!awardsnow') { await postAwards(message.client,message.guild,true); await message.reply('Weekly Awards posted in Main Chat.'); return true; }
  return false;
}
module.exports={startAnalyticsOnBoot,handleAnalyticsCommand};
