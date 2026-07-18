const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require("discord.js");
const { createClient } = require("@supabase/supabase-js");
const { getPlayerForLookup, getPlayerDisplayName, ggconPost } = require("./ggcon");

const AIRLIFT_PRICE = Math.max(0, Number(process.env.AIRLIFT_PRICE || "1000"));
const AIRLIFT_COOLDOWN_MS = Math.max(60000, Number(process.env.AIRLIFT_COOLDOWN_MINUTES || "60") * 60000);
// Absolute SCUM Z coordinate. Keep this configurable while the safe parachute height is tested.
const AIRLIFT_ALTITUDE_Z = Number(process.env.AIRLIFT_ALTITUDE_Z || "150000");
const AIRLIFT_TABLE = process.env.WATCHER_AIRLIFT_TABLE || "watcher_airlift_rides";
const PARACHUTE_ITEM = process.env.AIRLIFT_PARACHUTE_ITEM || "BeginPlay_Parachute";
const PENDING_TTL_MS = 10 * 60 * 1000;

const ROW_Y = {
  D: 467258.00052,
  C: 162454.54996,
  B: -142348.9006,
  A: -447664.53521,
  Z: -752467.94021,
};
const COLUMN_X = {
  4: 467245.13202,
  3: 162441.68146,
  2: -142861.08465,
  1: -447664.53521,
  0: -752467.98577,
};

const SECTORS = [];
for (const row of ["Z", "A", "B", "C", "D"]) {
  for (const column of ["0", "1", "2", "3", "4"]) {
    const name = `${row}${column}`;
    if (name === "C0") continue;
    SECTORS.push({ name, x: COLUMN_X[column], y: ROW_Y[row] });
  }
}

let db = null;
const pending = new Map();
const activeLaunches = new Set();

function getDb() {
  if (db) return db;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) throw new Error("Supabase is not configured.");
  db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, { auth: { persistSession: false } });
  return db;
}

function pendingKey(guildId, discordId) {
  return `${guildId}:${discordId}`;
}

function setPending(guildId, discordId, data) {
  pending.set(pendingKey(guildId, discordId), { ...data, expiresAt: Date.now() + PENDING_TTL_MS });
}

function getPending(guildId, discordId) {
  const key = pendingKey(guildId, discordId);
  const value = pending.get(key);
  if (!value) return null;
  if (value.expiresAt <= Date.now()) {
    pending.delete(key);
    return null;
  }
  return value;
}

function clearPending(guildId, discordId) {
  pending.delete(pendingKey(guildId, discordId));
}

function formatMoney(value) {
  return Number(value).toLocaleString("en-CA");
}

function formatCooldown(date) {
  return `<t:${Math.floor(date.getTime() / 1000)}:R>`;
}

function isOnline(player) {
  return !!player && (player.online === true || player.ping !== undefined || player.health !== undefined);
}

function getCash(player) {
  const candidates = [player?.accountBalance, player?.cash, player?.currency, player?.money, player?.balance, player?.account_balance];
  for (const candidate of candidates) {
    const amount = Number(candidate);
    if (Number.isFinite(amount)) return amount;
  }
  return null;
}

async function getLastRide(guildId, steamId) {
  const { data, error } = await getDb()
    .from(AIRLIFT_TABLE)
    .select("completed_at")
    .eq("guild_id", String(guildId))
    .eq("steam_id", String(steamId))
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) && data[0]?.completed_at ? new Date(data[0].completed_at) : null;
}

async function checkCooldown(guildId, steamId) {
  const lastRide = await getLastRide(guildId, steamId);
  if (!lastRide || Number.isNaN(lastRide.getTime())) return { ready: true, lastRide: null, nextRide: null };
  const nextRide = new Date(lastRide.getTime() + AIRLIFT_COOLDOWN_MS);
  return { ready: nextRide.getTime() <= Date.now(), lastRide, nextRide };
}

async function recordRide({ guildId, discordId, steamId, playerName, sector, x, y, z, price }) {
  const { error } = await getDb().from(AIRLIFT_TABLE).insert({
    guild_id: String(guildId),
    discord_id: String(discordId),
    steam_id: String(steamId),
    player_name: playerName || null,
    sector,
    destination_x: x,
    destination_y: y,
    destination_z: z,
    price,
    status: "completed",
    completed_at: new Date().toISOString(),
  });
  if (error) throw error;
}

function sectorMenu(steamId) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`airlift:sector:${steamId}`)
      .setPlaceholder("Choose your destination sector")
      .addOptions(SECTORS.map((sector) => ({ label: `Sector ${sector.name}`, value: sector.name })))
  );
}

function openAirliftButton(steamId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`airlift:open:${steamId}`)
      .setLabel("Airlift Taxi")
      .setStyle(ButtonStyle.Primary)
  );
}

function prepareButtons(steamId, sector) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`airlift:prepare:${steamId}:${sector}`)
      .setLabel("Prepare Airlift")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`airlift:cancel:${steamId}`)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary)
  );
}

function launchButtons(steamId, sector) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`airlift:send:${steamId}:${sector}`)
      .setLabel("Send Airlift")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`airlift:cancel:${steamId}`)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Danger)
  );
}

async function verifyOwner(interaction, steamId) {
  const linkQuery = await getDb()
    .from(process.env.WATCHER_PLAYER_LINKS_TABLE || "watcher_player_links")
    .select("steam_id")
    .eq("guild_id", String(interaction.guildId))
    .eq("discord_id", String(interaction.user.id))
    .maybeSingle();
  if (linkQuery.error) throw linkQuery.error;
  return String(linkQuery.data?.steam_id || "") === String(steamId || "");
}

async function loadEligiblePlayer(interaction, steamId) {
  if (!(await verifyOwner(interaction, steamId))) {
    throw new Error("This Airlift Taxi does not belong to your linked SCUM account.");
  }
  const result = await getPlayerForLookup(steamId);
  if (result.type !== "single") throw new Error("Your linked SCUM character could not be loaded.");
  if (!isOnline(result.player)) throw new Error("You must be online in SCUM to use the Airlift Taxi.");
  return result.player;
}

async function handleAirliftInteraction(interaction) {
  if (!interaction.customId?.startsWith("airlift:")) return false;
  const parts = interaction.customId.split(":");
  const action = parts[1];
  const steamId = parts[2];

  try {
    if (action === "open" && interaction.isButton()) {
      const player = await loadEligiblePlayer(interaction, steamId);
      const cooldown = await checkCooldown(interaction.guildId, steamId);
      if (!cooldown.ready) {
        await interaction.reply({
          content: `🚁 Your Airlift Taxi is on cooldown. You can purchase another ride ${formatCooldown(cooldown.nextRide)}.`,
          ephemeral: true,
        });
        return true;
      }
      const cash = getCash(player);
      if (cash === null) throw new Error("Watcher could not verify your current in-game cash balance.");
      if (cash < AIRLIFT_PRICE) {
        await interaction.reply({ content: `You need **$${formatMoney(AIRLIFT_PRICE)}** for an Airlift Taxi. Your current balance is **$${formatMoney(cash)}**.`, ephemeral: true });
        return true;
      }
      await interaction.reply({
        content: [
          "🚁 **Airlift Taxi**",
          "",
          `Price: **$${formatMoney(AIRLIFT_PRICE)}**`,
          "Limit: **one completed airlift per hour**",
          "",
          "Choose the sector where you want to be dropped. Sector **C0 is unavailable**.",
        ].join("\n"),
        components: [sectorMenu(steamId)],
        ephemeral: true,
      });
      return true;
    }

    if (action === "sector" && interaction.isStringSelectMenu()) {
      await loadEligiblePlayer(interaction, steamId);
      const sectorName = interaction.values[0];
      const sector = SECTORS.find((entry) => entry.name === sectorName);
      if (!sector) throw new Error("That sector is unavailable.");
      setPending(interaction.guildId, interaction.user.id, { steamId, sector: sectorName, stage: "selected" });
      await interaction.update({
        content: [
          "🚁 **Airlift Taxi Destination Selected**",
          "",
          `Destination: **Sector ${sectorName}**`,
          `Price: **$${formatMoney(AIRLIFT_PRICE)}**`,
          "",
          "Press **Prepare Airlift** to receive your parachute. You will not be charged yet.",
        ].join("\n"),
        components: [prepareButtons(steamId, sectorName)],
      });
      return true;
    }

    if (action === "prepare" && interaction.isButton()) {
      const sectorName = parts[3];
      const player = await loadEligiblePlayer(interaction, steamId);
      const pendingRide = getPending(interaction.guildId, interaction.user.id);
      if (!pendingRide || pendingRide.steamId !== steamId || pendingRide.sector !== sectorName) throw new Error("This Airlift Taxi request expired. Open the dashboard and start again.");
      const cooldown = await checkCooldown(interaction.guildId, steamId);
      if (!cooldown.ready) throw new Error(`Your Airlift Taxi is still on cooldown. Try again ${formatCooldown(cooldown.nextRide)}.`);
      const cash = getCash(player);
      if (cash === null || cash < AIRLIFT_PRICE) throw new Error(`You need $${formatMoney(AIRLIFT_PRICE)} available before preparing the airlift.`);

      const command = `#SpawnItem ${PARACHUTE_ITEM} 1 Location ${steamId}`;
      await ggconPost("/command", { command });
      setPending(interaction.guildId, interaction.user.id, { steamId, sector: sectorName, stage: "prepared" });
      await interaction.update({
        content: [
          "🪂 **Parachute Delivered**",
          "",
          `A parachute was spawned for **${getPlayerDisplayName(player)}**.`,
          "",
          "**Put on the parachute now. Do not jump or move.**",
          "When you are ready, press **Send Airlift**. The $1,000 charge and one-hour cooldown begin only after a successful launch.",
        ].join("\n"),
        components: [launchButtons(steamId, sectorName)],
      });
      return true;
    }

    if (action === "cancel" && interaction.isButton()) {
      if (!(await verifyOwner(interaction, steamId))) throw new Error("This Airlift Taxi does not belong to you.");
      clearPending(interaction.guildId, interaction.user.id);
      await interaction.update({ content: "Airlift Taxi cancelled. You were not charged and no cooldown was started.", components: [] });
      return true;
    }

    if (action === "send" && interaction.isButton()) {
      const sectorName = parts[3];
      const launchKey = pendingKey(interaction.guildId, interaction.user.id);
      if (activeLaunches.has(launchKey)) {
        await interaction.reply({ content: "Your airlift is already being processed.", ephemeral: true });
        return true;
      }
      activeLaunches.add(launchKey);
      await interaction.deferUpdate();
      try {
        const pendingRide = getPending(interaction.guildId, interaction.user.id);
        if (!pendingRide || pendingRide.stage !== "prepared" || pendingRide.steamId !== steamId || pendingRide.sector !== sectorName) {
          throw new Error("This prepared Airlift Taxi expired. Start a new ride from your dashboard.");
        }
        const sector = SECTORS.find((entry) => entry.name === sectorName);
        if (!sector) throw new Error("That sector is unavailable.");
        const player = await loadEligiblePlayer(interaction, steamId);
        const cooldown = await checkCooldown(interaction.guildId, steamId);
        if (!cooldown.ready) throw new Error(`Your Airlift Taxi is on cooldown until ${formatCooldown(cooldown.nextRide)}.`);
        const cash = getCash(player);
        if (cash === null) throw new Error("Watcher could not verify your current cash balance.");
        if (cash < AIRLIFT_PRICE) throw new Error(`You need **$${formatMoney(AIRLIFT_PRICE)}** to launch.`);

        await ggconPost(`/players/${encodeURIComponent(steamId)}/currency`, { action: "change", amount: -AIRLIFT_PRICE });
        try {
          await ggconPost(`/players/${encodeURIComponent(steamId)}/teleport`, {
            x: sector.x,
            y: sector.y,
            z: AIRLIFT_ALTITUDE_Z,
          });
        } catch (teleportError) {
          await ggconPost(`/players/${encodeURIComponent(steamId)}/currency`, { action: "change", amount: AIRLIFT_PRICE }).catch(() => {});
          throw new Error(`The teleport failed. Your $${formatMoney(AIRLIFT_PRICE)} was refunded. ${teleportError.message}`);
        }

        await recordRide({
          guildId: interaction.guildId,
          discordId: interaction.user.id,
          steamId,
          playerName: getPlayerDisplayName(player),
          sector: sectorName,
          x: sector.x,
          y: sector.y,
          z: AIRLIFT_ALTITUDE_Z,
          price: AIRLIFT_PRICE,
        });
        clearPending(interaction.guildId, interaction.user.id);
        const nextRide = new Date(Date.now() + AIRLIFT_COOLDOWN_MS);
        await interaction.editReply({
          content: [
            `🚁 **Airlift sent to Sector ${sectorName}.**`,
            "",
            `Charged: **$${formatMoney(AIRLIFT_PRICE)}**`,
            `Next Airlift Taxi available: ${formatCooldown(nextRide)}`,
            "",
            "Deploy your parachute and land safely.",
          ].join("\n"),
          components: [],
        });
      } finally {
        activeLaunches.delete(launchKey);
      }
      return true;
    }
  } catch (err) {
    console.error("❌ Airlift Taxi error:", err);
    const payload = { content: `Airlift Taxi error: ${err.message}`, ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
    return true;
  }

  return false;
}

async function getAirliftCooldownStatus(guildId, steamId) {
  const cooldown = await checkCooldown(guildId, steamId);
  return {
    ready: cooldown.ready,
    lastRide: cooldown.lastRide,
    nextRide: cooldown.nextRide,
    price: AIRLIFT_PRICE,
    cooldownMinutes: Math.round(AIRLIFT_COOLDOWN_MS / 60000),
  };
}

module.exports = {
  handleAirliftInteraction,
  openAirliftButton,
  getAirliftCooldownStatus,
};
