const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { createClient } = require("@supabase/supabase-js");
const { getPlayerForLookup, getPlayerDisplayName, ggconPost } = require("./ggcon");

const RENTAL_TABLE = process.env.WATCHER_DIRTBIKE_RENTAL_TABLE || "watcher_dirtbike_rentals";
const PLAYER_LINKS_TABLE = process.env.WATCHER_PLAYER_LINKS_TABLE || "watcher_player_links";
const RENTAL_PRICE = Math.max(0, Number(process.env.DIRTBIKE_RENTAL_PRICE || "500"));
const RENTAL_MINUTES = Math.max(5, Number(process.env.DIRTBIKE_RENTAL_MINUTES || "30"));
const WARNING_MINUTES = Math.max(1, Math.min(RENTAL_MINUTES - 1, Number(process.env.DIRTBIKE_WARNING_MINUTES || "5")));
const VEHICLE_CLASS = process.env.DIRTBIKE_RENTAL_CLASS || "BPC_Dirtbike";
const CHECK_MS = Math.max(15000, Number(process.env.DIRTBIKE_RENTAL_CHECK_SECONDS || "30") * 1000);
const activePurchases = new Set();
let db = null;
let timer = null;
let botRef = null;

function getDb() {
  if (db) return db;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) throw new Error("Supabase is not configured.");
  db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, { auth: { persistSession: false } });
  return db;
}

function isStaff(message) {
  return !!message.member?.roles?.cache?.some((role) => ["Owner", "Owners", "Admin", "Trial Admin"].includes(role.name));
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString("en-CA");
}

function isOnline(player) {
  return !!player && (player.online === true || player.ping !== undefined || player.health !== undefined);
}

function getCash(player) {
  for (const value of [player?.accountBalance, player?.cash, player?.currency, player?.money, player?.balance, player?.account_balance]) {
    const amount = Number(value);
    if (Number.isFinite(amount)) return amount;
  }
  return null;
}

function vehicleId(vehicle) {
  const id = vehicle?.id ?? vehicle?.vehicleId ?? vehicle?.entityId ?? vehicle?.vehicle_id;
  return id === undefined || id === null ? "" : String(id);
}

function vehicleText(vehicle) {
  return [vehicle?.class, vehicle?.i, vehicle?.vehicleClass, vehicle?.name, vehicle?.type].filter(Boolean).join(" ").toLowerCase();
}

function isDirtbike(vehicle) {
  return vehicleText(vehicle).replace(/[^a-z0-9]/g, "").includes("dirtbike");
}

async function getLink(guildId, discordId) {
  const { data, error } = await getDb()
    .from(PLAYER_LINKS_TABLE)
    .select("steam_id, scum_name")
    .eq("guild_id", String(guildId))
    .eq("discord_id", String(discordId))
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function getActiveRental(guildId, steamId) {
  const { data, error } = await getDb()
    .from(RENTAL_TABLE)
    .select("*")
    .eq("guild_id", String(guildId))
    .eq("steam_id", String(steamId))
    .in("status", ["active", "removal_pending"])
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

async function fetchVehicles() {
  const base = (process.env.GGCON_BASE_URL || "https://ggcon.gghost.games/s/2788404").replace(/\/+$/, "");
  const res = await fetch(`${base}/vehicles.json`, { headers: { Accept: "application/json", "X-Password": process.env.GGCON_PASSWORD || "" } });
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.ok === false) throw new Error(data?.reason || data?.message || `Vehicle lookup failed (${res.status}).`);
  return Array.isArray(data?.vehicles) ? data.vehicles : [];
}

async function discoverSpawnedBike(steamId, beforeIds, spawnResult) {
  const directId = String(spawnResult?.vehicleId || spawnResult?.id || spawnResult?.vehicle?.id || "").trim();
  if (directId) return directId;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 1200 : 2000));
    const vehicles = await fetchVehicles().catch(() => []);
    const candidates = vehicles.filter((vehicle) => {
      const id = vehicleId(vehicle);
      if (!id || beforeIds.has(id) || !isDirtbike(vehicle)) return false;
      const owner = String(vehicle?.ownerSteamId || vehicle?.steamId || vehicle?.owner_id || "");
      return !owner || owner === String(steamId);
    });
    if (candidates.length === 1) return vehicleId(candidates[0]);
    const owned = candidates.find((vehicle) => String(vehicle?.ownerSteamId || vehicle?.steamId || vehicle?.owner_id || "") === String(steamId));
    if (owned) return vehicleId(owned);
  }
  return null;
}

async function createRental(interaction, link, player) {
  const key = `${interaction.guildId}:${link.steam_id}`;
  if (activePurchases.has(key)) throw new Error("Your rental is already being processed.");
  activePurchases.add(key);
  try {
    const existing = await getActiveRental(interaction.guildId, link.steam_id);
    if (existing) throw new Error(`You already have an active dirtbike rental until <t:${Math.floor(new Date(existing.expires_at).getTime() / 1000)}:R>.`);
    const cash = getCash(player);
    if (cash === null) throw new Error("Watcher could not verify your current in-game cash.");
    if (cash < RENTAL_PRICE) throw new Error(`You need $${formatMoney(RENTAL_PRICE)}. Your current balance is $${formatMoney(cash)}.`);

    const before = await fetchVehicles().catch(() => []);
    const beforeIds = new Set(before.map(vehicleId).filter(Boolean));
    await ggconPost(`/players/${encodeURIComponent(link.steam_id)}/currency`, { action: "change", amount: -RENTAL_PRICE });
    let spawnResult;
    try {
      spawnResult = await ggconPost("/spawn-vehicle", { steamId: String(link.steam_id), vehicle: VEHICLE_CLASS });
    } catch (err) {
      await ggconPost(`/players/${encodeURIComponent(link.steam_id)}/currency`, { action: "change", amount: RENTAL_PRICE }).catch(() => {});
      throw new Error(`The dirtbike could not be spawned. Your $${formatMoney(RENTAL_PRICE)} was refunded. ${err.message}`);
    }

    const id = await discoverSpawnedBike(link.steam_id, beforeIds, spawnResult);
    const now = new Date();
    const expires = new Date(now.getTime() + RENTAL_MINUTES * 60000);
    const warning = new Date(expires.getTime() - WARNING_MINUTES * 60000);
    const { error } = await getDb().from(RENTAL_TABLE).insert({
      guild_id: String(interaction.guildId), discord_id: String(interaction.user.id), steam_id: String(link.steam_id),
      player_name: link.scum_name || getPlayerDisplayName(player), vehicle_id: id, vehicle_class: VEHICLE_CLASS,
      price: RENTAL_PRICE, status: "active", started_at: now.toISOString(), warning_at: warning.toISOString(),
      expires_at: expires.toISOString(), warned_at: null, removal_attempts: 0, last_error: id ? null : "Vehicle ID discovery pending",
      created_at: now.toISOString(), updated_at: now.toISOString(),
    });
    if (error) {
      if (id) await ggconPost(`/vehicles/${encodeURIComponent(id)}/destroy`, {}).catch(() => {});
      await ggconPost(`/players/${encodeURIComponent(link.steam_id)}/currency`, { action: "change", amount: RENTAL_PRICE }).catch(() => {});
      throw error;
    }
    return { expires, id };
  } finally {
    activePurchases.delete(key);
  }
}

async function sendWarning(rental) {
  const name = rental.player_name || rental.steam_id;
  await ggconPost("/message", {
    type: "ServerMessage",
    text: `${name}: your rented dirtbike will be removed in ${WARNING_MINUTES} minutes. Park safely and remove your belongings.`,
  });
  await getDb().from(RENTAL_TABLE).update({ warned_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", rental.id);
}

async function resolveMissingVehicleId(rental) {
  if (rental.vehicle_id) return rental.vehicle_id;
  const vehicles = await fetchVehicles();
  const candidates = vehicles.filter((vehicle) => isDirtbike(vehicle) && String(vehicle?.ownerSteamId || vehicle?.steamId || vehicle?.owner_id || "") === String(rental.steam_id));
  if (candidates.length !== 1) return null;
  const id = vehicleId(candidates[0]);
  if (id) await getDb().from(RENTAL_TABLE).update({ vehicle_id: id, last_error: null, updated_at: new Date().toISOString() }).eq("id", rental.id);
  return id || null;
}

async function removeRental(rental) {
  const id = await resolveMissingVehicleId(rental).catch(() => rental.vehicle_id || null);
  if (!id) throw new Error("Could not uniquely identify the rented dirtbike yet.");
  try {
    await ggconPost(`/vehicles/${encodeURIComponent(id)}/destroy`, {});
  } catch (err) {
    const vehicles = await fetchVehicles().catch(() => []);
    if (vehicles.some((vehicle) => vehicleId(vehicle) === String(id))) throw err;
  }
  await getDb().from(RENTAL_TABLE).update({ status: "expired", removed_at: new Date().toISOString(), updated_at: new Date().toISOString(), last_error: null }).eq("id", rental.id);
}

async function processRentals() {
  const { data, error } = await getDb().from(RENTAL_TABLE).select("*").in("status", ["active", "removal_pending"]);
  if (error) throw error;
  const now = Date.now();
  for (const rental of data || []) {
    try {
      const expiresAt = new Date(rental.expires_at).getTime();
      const warningAt = new Date(rental.warning_at).getTime();
      if (!rental.warned_at && now >= warningAt && now < expiresAt) await sendWarning(rental);
      if (now >= expiresAt) {
        await getDb().from(RENTAL_TABLE).update({ status: "removal_pending", updated_at: new Date().toISOString() }).eq("id", rental.id);
        await removeRental(rental);
      }
    } catch (err) {
      await getDb().from(RENTAL_TABLE).update({
        status: Date.now() >= new Date(rental.expires_at).getTime() ? "removal_pending" : rental.status,
        removal_attempts: Number(rental.removal_attempts || 0) + 1, last_error: err.message, updated_at: new Date().toISOString(),
      }).eq("id", rental.id).catch(() => {});
      console.error(`❌ Dirtbike rental ${rental.id} processing failed:`, err.message);
    }
  }
}

function launcherText() {
  return [
    "# 🏍️ Outpost X Dirtbike Rental",
    "Rent a dirtbike for quick transportation.", "",
    `**Price:** $${formatMoney(RENTAL_PRICE)}`,
    `**Rental time:** ${RENTAL_MINUTES} minutes`,
    `**Warning:** ${WARNING_MINUTES} minutes before removal`,
    "**Limit:** One active rental per player", "",
    "Remove all belongings before the timer ends. Rented dirtbikes cannot be insured.",
  ].join("\n");
}

function launcherRow() {
  return new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("rental:open").setLabel("Rent Dirtbike").setEmoji("🏍️").setStyle(ButtonStyle.Primary));
}

async function handleRentalCommand(message) {
  if (!message.guild || !message.content?.startsWith("!")) return false;
  const command = message.content.trim().split(/\s+/)[0].toLowerCase();
  if (command !== "!dirtbikerentalsetup") return false;
  if (!isStaff(message)) { await message.reply("This setup command is for staff only.").catch(() => {}); return true; }
  await message.channel.send({ content: launcherText(), components: [launcherRow()] });
  await message.delete().catch(() => {});
  return true;
}

async function handleRentalInteraction(interaction) {
  if (!interaction.customId?.startsWith("rental:")) return false;
  try {
    if (interaction.customId === "rental:open") {
      const link = await getLink(interaction.guildId, interaction.user.id);
      if (!link?.steam_id) throw new Error("You need to register your SCUM character first.");
      const playerResult = await getPlayerForLookup(String(link.steam_id));
      if (playerResult.type !== "single") throw new Error("Your linked SCUM character could not be loaded.");
      if (!isOnline(playerResult.player)) throw new Error("You must be online in SCUM to rent a dirtbike.");
      const existing = await getActiveRental(interaction.guildId, link.steam_id);
      if (existing) {
        await interaction.reply({ content: `🏍️ You already have an active rental. It ends <t:${Math.floor(new Date(existing.expires_at).getTime() / 1000)}:R>.`, ephemeral: true });
        return true;
      }
      const cash = getCash(playerResult.player);
      if (cash === null || cash < RENTAL_PRICE) throw new Error(`You need $${formatMoney(RENTAL_PRICE)} to rent a dirtbike.`);
      await interaction.reply({
        content: [`🏍️ **Confirm Dirtbike Rental**`, "", `Cost: **$${formatMoney(RENTAL_PRICE)}**`, `Time: **${RENTAL_MINUTES} minutes**`, "", "The dirtbike is removed automatically when time expires. Anything left inside it will be lost."].join("\n"),
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`rental:confirm:${link.steam_id}`).setLabel(`Rent for $${formatMoney(RENTAL_PRICE)}`).setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId("rental:cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
        )], ephemeral: true,
      });
      return true;
    }
    if (interaction.customId === "rental:cancel") {
      await interaction.update({ content: "Dirtbike rental cancelled. You were not charged.", components: [] });
      return true;
    }
    if (interaction.customId.startsWith("rental:confirm:")) {
      const steamId = interaction.customId.split(":")[2];
      const link = await getLink(interaction.guildId, interaction.user.id);
      if (!link?.steam_id || String(link.steam_id) !== String(steamId)) throw new Error("This rental does not belong to your linked account.");
      const result = await getPlayerForLookup(steamId);
      if (result.type !== "single" || !isOnline(result.player)) throw new Error("You must still be online in SCUM.");
      await interaction.deferUpdate();
      const rental = await createRental(interaction, link, result.player);
      await interaction.editReply({
        content: [`✅ **Dirtbike Rental Started**`, "", `Charged: **$${formatMoney(RENTAL_PRICE)}**`, `Rental ends: <t:${Math.floor(rental.expires.getTime() / 1000)}:R>`, "", `You will receive an in-game warning ${WARNING_MINUTES} minutes before removal. Remove all belongings before the timer expires.`].join("\n"),
        components: [],
      });
      return true;
    }
  } catch (err) {
    console.error("❌ Dirtbike rental error:", err);
    const payload = { content: `Dirtbike rental error: ${err.message}`, ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
    return true;
  }
  return false;
}

function startRentalSystem(bot) {
  botRef = bot;
  if (timer) return;
  processRentals().catch((err) => console.error("❌ Dirtbike rental startup check failed:", err.message));
  timer = setInterval(() => processRentals().catch((err) => console.error("❌ Dirtbike rental check failed:", err.message)), CHECK_MS);
  timer.unref?.();
}

async function getRentalStatus(guildId, steamId) {
  const rental = await getActiveRental(guildId, steamId);
  return rental ? { active: true, ...rental } : { active: false };
}

module.exports = { handleRentalCommand, handleRentalInteraction, startRentalSystem, getRentalStatus };
