const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { createClient } = require("@supabase/supabase-js");

const DEFAULT_SERVER_BASE_URL = "https://ggcon.gghost.games/s/2788404";
const RUNTIME_STATE_TABLE = process.env.WATCHER_RUNTIME_STATE_TABLE || "watcher_runtime_state";
const PLAYER_LINKS_TABLE = process.env.WATCHER_PLAYER_LINKS_TABLE || "watcher_player_links";
const INSURANCE_TABLE = process.env.WATCHER_VEHICLE_INSURANCE_TABLE || "watcher_vehicle_insurance";
const INSURANCE_CLAIMS_TABLE = process.env.WATCHER_INSURANCE_CLAIMS_TABLE || "watcher_insurance_claims";
const STAFF_ROLE_NAMES = new Set(["Owner", "Owners", "Admin", "Trial Admin"]);

const INSURANCE_SCAN_SECONDS = Math.max(30, Number(process.env.WATCHER_INSURANCE_SCAN_SECONDS || "30"));
const LINK_CODE_TTL_MINUTES = Math.max(5, Number(process.env.WATCHER_INSURANCE_LINK_CODE_TTL_MINUTES || "15"));

const INSURABLE_VEHICLES = [
  { type: "duster", label: "Kinglet Duster", price: 50000, aliases: ["duster", "kinglet_duster", "bpc_kinglet_duster", "kinglet duster"] },
  { type: "mariner", label: "Kinglet Mariner", price: 50000, aliases: ["mariner", "kinglet_mariner", "bpc_kinglet_mariner", "kinglet mariner"] },
  { type: "cruiser", label: "Cruiser", price: 25000, aliases: ["cruiser", "bpc_cruiser"] },
  { type: "dirtbike", label: "Dirt Bike", price: 20000, aliases: ["dirtbike", "dirt_bike", "dirt bike", "bpc_dirtbike", "bpc_dirt_bike"] },
  { type: "sidecarbike", label: "Sidecar Bike", price: 35000, aliases: ["sidecarbike", "sidecar_bike", "sidecar bike", "bpc_sidecarbike", "bpc_sidecar_bike"] },
  { type: "laika", label: "Laika", price: 45000, aliases: ["laika", "bpc_laika"] },
  { type: "wolfswagen", label: "WolfsWagen", price: 45000, aliases: ["wolfswagen", "wolfswagon", "wolfs wagen", "bpc_wolfswagen", "bpc_wolfswagon"] },
  { type: "rager", label: "Rager", price: 65000, aliases: ["rager", "bpc_rager"] },
  { type: "ris", label: "RIS", price: 30000, aliases: ["ris", "ris_es", "bpc_ris"] },
  { type: "tractor", label: "Tractor", price: 30000, aliases: ["tractor", "bpc_tractor"] },
];

const BLOCKED_VEHICLE_TERMS = ["boat", "sup", "paddle", "raft", "kayak"];
let supabaseClient = null;
let insuranceTimer = null;

function getSupabase() {
  if (supabaseClient) return supabaseClient;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!url || !key) throw new Error("Missing Supabase Railway variables.");
  supabaseClient = createClient(url, key, { auth: { persistSession: false } });
  return supabaseClient;
}

function getBaseUrl() {
  return (process.env.GGCON_BASE_URL || DEFAULT_SERVER_BASE_URL).replace(/\/+$/, "");
}

function getPassword() {
  const password = process.env.GGCON_PASSWORD;
  if (!password) throw new Error("Missing server API password Railway variable.");
  return password;
}

async function serverGet(endpoint) {
  const res = await fetch(`${getBaseUrl()}${endpoint}`, {
    method: "GET",
    headers: { Accept: "application/json", "X-Password": getPassword() },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.reason || data?.message || data?.error || `HTTP ${res.status}`);
  }
  return data;
}

async function serverPost(endpoint, body = {}) {
  const res = await fetch(`${getBaseUrl()}${endpoint}`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "X-Password": getPassword() },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.reason || data?.message || data?.error || `HTTP ${res.status}`);
  }
  return data || { ok: true };
}

function runtimeKey(name) {
  return String(name || "").trim();
}

async function loadRuntimeValue(key) {
  const db = getSupabase();
  const { data, error } = await db.from(RUNTIME_STATE_TABLE).select("value").eq("key", runtimeKey(key)).maybeSingle();
  if (error) return null;
  return data?.value ?? null;
}

async function saveRuntimeValue(key, value) {
  const db = getSupabase();
  const { error } = await db.from(RUNTIME_STATE_TABLE).upsert(
    { key: runtimeKey(key), value: value || {}, updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );
  if (error) throw error;
}

function hasStaffRole(member) {
  return member?.roles?.cache?.some((role) => STAFF_ROLE_NAMES.has(role.name)) || false;
}

function isStaff(messageOrInteraction) {
  return !!messageOrInteraction?.guild && hasStaffRole(messageOrInteraction.member);
}

function isOwner(messageOrInteraction) {
  const roles = messageOrInteraction?.member?.roles?.cache;
  return roles?.some((role) => role.name === "Owner" || role.name === "Owners") || false;
}

function formatMoney(value) {
  return `$${Number(value || 0).toLocaleString("en-CA")}`;
}

function formatDate(value) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-CA", { timeZone: "America/Toronto", dateStyle: "medium", timeStyle: "short" });
}

function formatLocation(location) {
  if (!location) return "Unknown";
  const x = location.x ?? location.X;
  const y = location.y ?? location.Y;
  const z = location.z ?? location.Z;
  if (![x, y, z].every((v) => Number.isFinite(Number(v)))) return "Unknown";
  return `X: ${Math.round(Number(x))} | Y: ${Math.round(Number(y))} | Z: ${Math.round(Number(z))}`;
}

function clampDiscord(text, max = 1950) {
  const value = String(text || "");
  return value.length <= max ? value : `${value.slice(0, max - 40)}\n\nOutput trimmed to fit Discord.`;
}

function normalizeVehicleText(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function getVehicleIdentityText(vehicle) {
  return [vehicle?.name, vehicle?.class, vehicle?.vehicle, vehicle?.type, vehicle?.i].filter(Boolean).join(" ");
}

function getInsuranceVehicleType(vehicleOrText) {
  const raw = typeof vehicleOrText === "string" ? vehicleOrText : getVehicleIdentityText(vehicleOrText);
  const normalized = normalizeVehicleText(raw);
  if (!normalized) return null;
  if (BLOCKED_VEHICLE_TERMS.some((term) => normalized.includes(term))) return null;

  for (const config of INSURABLE_VEHICLES) {
    if (config.aliases.some((alias) => normalized.includes(normalizeVehicleText(alias)))) return config;
  }
  return null;
}

function getVehicleId(vehicle) {
  const id = vehicle?.id ?? vehicle?.vehicleId ?? vehicle?.entityId ?? vehicle?.vehicle_id;
  return id === null || id === undefined ? "" : String(id);
}

function getVehicleClass(vehicle) {
  return String(vehicle?.class || vehicle?.i || vehicle?.vehicleClass || vehicle?.name || "Vehicle");
}

function getVehicleName(vehicle) {
  return String(vehicle?.name || vehicle?.class || "Vehicle");
}

function getPlayerDisplayName(player, fallback = "Unknown") {
  return String(player?.characterName || player?.steamName || player?.realName || player?.fakeName || player?.name || fallback || "Unknown").trim();
}

function getPlayerSteamId(player) {
  return String(player?.userId || player?.steamId || player?.steamID || "").trim();
}

function getPlayerProfileId(player) {
  const value = player?.profileId ?? player?.userProfileId ?? player?.profile_id ?? player?.id ?? null;
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function getPlayerCash(player) {
  const candidates = [player?.accountBalance, player?.cash, player?.currency, player?.money, player?.balance, player?.account_balance];
  for (const value of candidates) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

async function getPlayerBySteamId(steamId) {
  const data = await serverGet(`/players/${encodeURIComponent(steamId)}.json`);
  const player = data?.player || data;
  return { ...player, userId: steamId };
}

async function fetchRawServerLogs(range, sources) {
  const params = new URLSearchParams();
  params.set("since", String(range?.since ?? 0));
  if (sources) params.set("sources", sources);
  return serverGet(`/logs?${params.toString()}`);
}

function buildMainRows() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("insurance:register").setLabel("Register Steam").setEmoji("🔗").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("insurance:verify").setLabel("Verify Code").setEmoji("✅").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("insurance:rates").setLabel("Rates").setEmoji("💵").setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("insurance:buy").setLabel("Buy Insurance").setEmoji("🛡️").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("insurance:mine").setLabel("My Insurance").setEmoji("📋").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("insurance:claim").setLabel("Claim Insurance").setEmoji("🚗").setStyle(ButtonStyle.Success)
    ),
  ];
}

function buildInsuranceMenuText() {
  return [
    "# 🛡️ Outpost X Vehicle Insurance",
    "Protect one vehicle of each type from confirmed destruction.",
    "",
    "**Covers:** confirmed destroyed insured vehicles only.",
    "**Does not cover:** stolen, lost, unlocked, missing, owner changed, or abandoned vehicles.",
    "**Limit:** 1 active insurance per vehicle type per player.",
    "**Expiration:** none.",
    "",
    "Use the buttons below to register, buy, view, or claim insurance.",
  ].join("\n");
}

function buildRatesText() {
  return [
    "💵 **Vehicle Insurance Rates**",
    "",
    "✈️ **Kinglet Duster** — `$50,000`",
    "✈️ **Kinglet Mariner** — `$50,000`",
    "🚙 **Cruiser** — `$25,000`",
    "🏍️ **Dirt Bike** — `$20,000`",
    "🏍️ **Sidecar Bike** — `$35,000`",
    "🚗 **Laika** — `$45,000`",
    "🚗 **WolfsWagen** — `$45,000`",
    "🚚 **Rager** — `$65,000`",
    "🏎️ **RIS** — `$30,000`",
    "🚜 **Tractor** — `$30,000`",
    "",
    "❌ Boats, SUPs, rafts, and water-only vehicles are not insurable.",
  ].join("\n");
}

async function getLink(guildId, discordId) {
  const db = getSupabase();
  const { data, error } = await db
    .from(PLAYER_LINKS_TABLE)
    .select("*")
    .eq("guild_id", String(guildId))
    .eq("discord_id", String(discordId))
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function savePendingLink(interaction, code) {
  const db = getSupabase();
  const expires = new Date(Date.now() + LINK_CODE_TTL_MINUTES * 60 * 1000).toISOString();
  const { error } = await db.from(PLAYER_LINKS_TABLE).upsert(
    {
      guild_id: String(interaction.guildId),
      discord_id: String(interaction.user.id),
      discord_tag: interaction.user.tag || interaction.user.username || null,
      pending_code: code,
      pending_expires_at: expires,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "guild_id,discord_id" }
  );
  if (error) throw error;
  return expires;
}

async function saveVerifiedLink(interaction, parsed) {
  const db = getSupabase();
  const { error } = await db.from(PLAYER_LINKS_TABLE).upsert(
    {
      guild_id: String(interaction.guildId),
      discord_id: String(interaction.user.id),
      discord_tag: interaction.user.tag || interaction.user.username || null,
      steam_id: parsed.steamId,
      scum_name: parsed.name || null,
      profile_id: parsed.profileId || null,
      pending_code: null,
      pending_expires_at: null,
      linked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "guild_id,discord_id" }
  );
  if (error) throw error;
}

function generateCode() {
  return `OX-${Math.floor(100000 + Math.random() * 900000)}`;
}

function parsePlayerIdentityFromLine(line) {
  const text = String(line || "");
  const match = text.match(/(\d{17,20})\s*:\s*([^()\n\r']+?)\((\d+)\)/);
  if (match) return { steamId: match[1], name: match[2].trim(), profileId: match[3] };

  const steamOnly = text.match(/\b(\d{17,20})\b/);
  if (steamOnly) return { steamId: steamOnly[1], name: null, profileId: null };
  return null;
}

async function verifyPendingLink(interaction) {
  const link = await getLink(interaction.guildId, interaction.user.id);
  if (!link?.pending_code) {
    return { ok: false, message: "No pending registration code found. Click **Register Steam** first." };
  }
  if (link.pending_expires_at && new Date(link.pending_expires_at).getTime() < Date.now()) {
    return { ok: false, message: "That registration code expired. Click **Register Steam** to get a new code." };
  }

  const since = Date.now() - LINK_CODE_TTL_MINUTES * 60 * 1000;
  const data = await fetchRawServerLogs({ since, label: `${LINK_CODE_TTL_MINUTES}m` }, "chat,SCUM");
  const lines = Array.isArray(data.lines) ? data.lines : [];
  const match = lines
    .slice()
    .reverse()
    .find((entry) => String(entry?.line || "").toLowerCase().includes(String(link.pending_code).toLowerCase()));

  if (!match) {
    return { ok: false, message: `I did not find code \`${link.pending_code}\` in recent game chat yet. Type it in SCUM chat, then click **Verify Code** again.` };
  }

  const parsed = parsePlayerIdentityFromLine(match.line);
  if (!parsed?.steamId) {
    return { ok: false, message: "I found the code, but could not read the Steam ID from that chat line. Paste the raw log dump to Josh/dev chat." };
  }

  await saveVerifiedLink(interaction, parsed);
  return { ok: true, parsed };
}

async function getActivePolicies(guildId, steamId) {
  const db = getSupabase();
  const { data, error } = await db
    .from(INSURANCE_TABLE)
    .select("*")
    .eq("guild_id", String(guildId))
    .eq("steam_id", String(steamId))
    .in("status", ["active", "claim_available"]);
  if (error) throw error;
  return data || [];
}

async function getAvailableClaims(guildId, discordId) {
  const db = getSupabase();
  const { data, error } = await db
    .from(INSURANCE_CLAIMS_TABLE)
    .select("*, policy:policy_id(*)")
    .eq("guild_id", String(guildId))
    .eq("discord_id", String(discordId))
    .eq("status", "available")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

async function getVehicleById(vehicleId) {
  const data = await serverGet("/vehicles.json");
  const vehicles = Array.isArray(data.vehicles) ? data.vehicles : [];
  return vehicles.find((vehicle) => getVehicleId(vehicle) === String(vehicleId)) || null;
}

function buildVehicleBuyRows(vehicles) {
  const rows = [];
  for (let i = 0; i < vehicles.length; i += 5) {
    const row = new ActionRowBuilder();
    vehicles.slice(i, i + 5).forEach((entry) => {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`insurance:buyveh:${entry.vehicleId}`)
          .setLabel(`${entry.config.label} #${entry.vehicleId}`.slice(0, 80))
          .setStyle(ButtonStyle.Primary)
      );
    });
    rows.push(row);
  }
  return rows;
}

async function buildBuyMenu(interaction) {
  const link = await getLink(interaction.guildId, interaction.user.id);
  if (!link?.steam_id) {
    await interaction.reply({ content: "You need to register your SCUM account first. Click **Register Steam** in the insurance menu.", ephemeral: true }).catch(() => {});
    return;
  }

  const [vehicleData, policies] = await Promise.all([
    serverGet("/vehicles.json"),
    getActivePolicies(interaction.guildId, link.steam_id),
  ]);
  const activeTypes = new Set(policies.map((policy) => policy.vehicle_type));
  const vehicles = Array.isArray(vehicleData.vehicles) ? vehicleData.vehicles : [];
  const ownedInsurable = vehicles
    .filter((vehicle) => String(vehicle.ownerSteamId || "") === String(link.steam_id))
    .map((vehicle) => ({ vehicle, vehicleId: getVehicleId(vehicle), config: getInsuranceVehicleType(vehicle) }))
    .filter((entry) => entry.vehicleId && entry.config)
    .filter((entry) => !activeTypes.has(entry.config.type));

  if (!ownedInsurable.length) {
    await interaction.reply({
      content: [
        "No eligible uninsured vehicles found for your linked SCUM account.",
        "You can only insure 1 of each vehicle type at a time.",
        "Boats, SUPs, rafts, and water-only vehicles are not insurable.",
      ].join("\n"),
      ephemeral: true,
    }).catch(() => {});
    return;
  }

  const shown = ownedInsurable.slice(0, 10);
  const list = shown.map((entry, index) => {
    return `**${index + 1}. ${entry.config.label}** — ${formatMoney(entry.config.price)}\nVehicle ID: \`${entry.vehicleId}\` | Class: ${getVehicleClass(entry.vehicle)}\nLocation: ${formatLocation(entry.vehicle.location)}`;
  }).join("\n\n");

  await interaction.reply({
    content: clampDiscord(["🛡️ **Choose a Vehicle to Insure**", "", list, ownedInsurable.length > shown.length ? "\nShowing 10 vehicles only." : null].filter(Boolean).join("\n")),
    components: buildVehicleBuyRows(shown),
    ephemeral: true,
  }).catch(() => {});
}

async function showBuyConfirm(interaction, vehicleId) {
  const link = await getLink(interaction.guildId, interaction.user.id);
  if (!link?.steam_id) {
    await interaction.reply({ content: "Register your SCUM account first.", ephemeral: true }).catch(() => {});
    return;
  }

  const vehicle = await getVehicleById(vehicleId);
  if (!vehicle) {
    await interaction.reply({ content: "That vehicle is not currently visible in the live vehicle list. Try again when it is visible.", ephemeral: true }).catch(() => {});
    return;
  }
  if (String(vehicle.ownerSteamId || "") !== String(link.steam_id)) {
    await interaction.reply({ content: "That vehicle is not owned by your linked SCUM account.", ephemeral: true }).catch(() => {});
    return;
  }

  const config = getInsuranceVehicleType(vehicle);
  if (!config) {
    await interaction.reply({ content: "That vehicle type is not insurable.", ephemeral: true }).catch(() => {});
    return;
  }

  const policies = await getActivePolicies(interaction.guildId, link.steam_id);
  if (policies.some((policy) => policy.vehicle_type === config.type)) {
    await interaction.reply({ content: `You already have active insurance for **${config.label}**. Redeem or cancel it before buying another of that type.`, ephemeral: true }).catch(() => {});
    return;
  }

  const player = await getPlayerBySteamId(link.steam_id);
  const cash = getPlayerCash(player);
  const cashText = cash === null ? "Unknown" : formatMoney(cash);
  const canAfford = cash !== null && cash >= config.price;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`insurance:confirmbuy:${vehicleId}`).setLabel(`Buy for ${formatMoney(config.price)}`).setEmoji("🛡️").setStyle(ButtonStyle.Success).setDisabled(!canAfford),
    new ButtonBuilder().setCustomId("insurance:cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary)
  );

  await interaction.reply({
    content: [
      `🛡️ **Buy Insurance: ${config.label}**`,
      `Vehicle ID: \`${vehicleId}\``,
      `Class: ${getVehicleClass(vehicle)}`,
      `Price: **${formatMoney(config.price)}**`,
      `Your Cash: **${cashText}**`,
      "",
      "Coverage never expires and only pays out on confirmed server destruction.",
      canAfford ? "Click Buy to charge your in-game cash and activate the policy." : "You do not have enough cash for this policy.",
    ].join("\n"),
    components: [row],
    ephemeral: true,
  }).catch(() => {});
}

async function confirmBuy(interaction, vehicleId) {
  const link = await getLink(interaction.guildId, interaction.user.id);
  if (!link?.steam_id) {
    await interaction.reply({ content: "Register your SCUM account first.", ephemeral: true }).catch(() => {});
    return;
  }

  const vehicle = await getVehicleById(vehicleId);
  if (!vehicle || String(vehicle.ownerSteamId || "") !== String(link.steam_id)) {
    await interaction.update({ content: "That vehicle is no longer eligible for insurance.", components: [] }).catch(() => {});
    return;
  }

  const config = getInsuranceVehicleType(vehicle);
  if (!config) {
    await interaction.update({ content: "That vehicle type is not insurable.", components: [] }).catch(() => {});
    return;
  }

  const policies = await getActivePolicies(interaction.guildId, link.steam_id);
  if (policies.some((policy) => policy.vehicle_type === config.type)) {
    await interaction.update({ content: `You already have active insurance for **${config.label}**.`, components: [] }).catch(() => {});
    return;
  }

  const beforePlayer = await getPlayerBySteamId(link.steam_id);
  const beforeCash = getPlayerCash(beforePlayer);
  if (beforeCash === null || beforeCash < config.price) {
    await interaction.update({ content: `Not enough in-game cash. Needed ${formatMoney(config.price)}.`, components: [] }).catch(() => {});
    return;
  }

  await serverPost(`/players/${encodeURIComponent(link.steam_id)}/currency`, { action: "remove", amount: config.price });
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const afterPlayer = await getPlayerBySteamId(link.steam_id);
  const afterCash = getPlayerCash(afterPlayer);

  if (afterCash === null || afterCash > beforeCash - config.price + 1) {
    await interaction.update({ content: "Payment could not be confirmed. Insurance was not saved. Ask staff to check your cash before trying again.", components: [] }).catch(() => {});
    return;
  }

  const db = getSupabase();
  const { error } = await db.from(INSURANCE_TABLE).insert({
    guild_id: String(interaction.guildId),
    discord_id: String(interaction.user.id),
    discord_tag: interaction.user.tag || interaction.user.username || null,
    steam_id: String(link.steam_id),
    player_name: link.scum_name || getPlayerDisplayName(afterPlayer),
    vehicle_id: String(vehicleId),
    vehicle_type: config.type,
    vehicle_class: getVehicleClass(vehicle),
    vehicle_name: getVehicleName(vehicle),
    purchase_price: config.price,
    status: "active",
    purchased_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;

  await interaction.update({
    content: [
      "✅ **Insurance Activated**",
      `Player: **${link.scum_name || getPlayerDisplayName(afterPlayer)}**`,
      `Vehicle: **${config.label}**`,
      `Vehicle ID: \`${vehicleId}\``,
      `Price Paid: **${formatMoney(config.price)}**`,
      `New Cash Balance: **${formatMoney(afterCash)}**`,
      "",
      "Coverage is active until this exact vehicle is confirmed destroyed and redeemed.",
    ].join("\n"),
    components: [],
  }).catch(() => {});
}

async function showMyInsurance(interaction) {
  const link = await getLink(interaction.guildId, interaction.user.id);
  if (!link?.steam_id) {
    await interaction.reply({ content: "You need to register first.", ephemeral: true }).catch(() => {});
    return;
  }
  const policies = await getActivePolicies(interaction.guildId, link.steam_id);
  if (!policies.length) {
    await interaction.reply({ content: "You do not have active vehicle insurance right now.", ephemeral: true }).catch(() => {});
    return;
  }
  const lines = policies.map((policy, index) => {
    const config = INSURABLE_VEHICLES.find((item) => item.type === policy.vehicle_type);
    return `**${index + 1}. ${config?.label || policy.vehicle_name || policy.vehicle_type}**\nVehicle ID: \`${policy.vehicle_id}\` | Status: **${policy.status}**\nBought: ${formatDate(policy.purchased_at)} | Price: ${formatMoney(policy.purchase_price)}`;
  }).join("\n\n");
  await interaction.reply({ content: clampDiscord(`📋 **My Vehicle Insurance**\n\n${lines}`), ephemeral: true }).catch(() => {});
}

function parseVehicleDestructionLog(entry) {
  const line = String(entry?.line || "");
  if (!line.includes("[Destroyed]")) return null;
  const vehicleMatch = line.match(/\[Destroyed\]\s+([^\.]+)\./);
  const vehicleIdMatch = line.match(/VehicleId:\s*(\d+)/i);
  const ownerMatch = line.match(/Owner:\s*(\d{17,20})\s*\((\d+),\s*([^\)]+)\)/i);
  const locMatch = line.match(/Location:\s*X=([-\d.]+)\s+Y=([-\d.]+)\s+Z=([-\d.]+)/i);
  if (!vehicleIdMatch) return null;
  const t = Number(entry?.t || Date.now());
  return {
    key: `${entry?.src || "vehicle_destruction"}:${t}:${vehicleIdMatch[1]}:${line.slice(0, 160)}`,
    t,
    vehicleId: vehicleIdMatch[1],
    vehicleClass: vehicleMatch ? vehicleMatch[1].trim() : "Vehicle",
    ownerSteamId: ownerMatch ? ownerMatch[1] : null,
    ownerProfileId: ownerMatch ? ownerMatch[2] : null,
    ownerName: ownerMatch ? ownerMatch[3].trim() : null,
    location: locMatch ? { x: Number(locMatch[1]), y: Number(locMatch[2]), z: Number(locMatch[3]) } : null,
    rawLine: line,
  };
}

async function processInsuranceDestructionEvent(bot, guildId, channelId, event) {
  const db = getSupabase();
  const { data: policies, error } = await db
    .from(INSURANCE_TABLE)
    .select("*")
    .eq("guild_id", String(guildId))
    .eq("vehicle_id", String(event.vehicleId))
    .eq("status", "active");
  if (error) throw error;
  if (!policies?.length) return 0;

  let created = 0;
  for (const policy of policies) {
    const logKey = `${policy.id}:${event.key}`;
    const { data: existing, error: existingError } = await db
      .from(INSURANCE_CLAIMS_TABLE)
      .select("id")
      .eq("destruction_log_key", logKey)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) continue;

    const { data: claim, error: claimError } = await db.from(INSURANCE_CLAIMS_TABLE).insert({
      guild_id: String(guildId),
      policy_id: policy.id,
      discord_id: policy.discord_id,
      steam_id: policy.steam_id,
      player_name: policy.player_name || event.ownerName || null,
      vehicle_id: policy.vehicle_id,
      vehicle_type: policy.vehicle_type,
      vehicle_class: policy.vehicle_class || event.vehicleClass,
      vehicle_name: policy.vehicle_name || event.vehicleClass,
      destruction_log_key: logKey,
      destruction_time: new Date(event.t).toISOString(),
      destruction_location: event.location || null,
      status: "available",
      raw_line: event.rawLine || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).select("id").single();
    if (claimError) throw claimError;

    const { error: updateError } = await db.from(INSURANCE_TABLE).update({
      status: "claim_available",
      destroyed_at: new Date(event.t).toISOString(),
      destroyed_location: event.location || null,
      updated_at: new Date().toISOString(),
    }).eq("id", policy.id);
    if (updateError) throw updateError;

    created += 1;
    if (channelId) {
      const channel = await bot.channels.fetch(channelId).catch(() => null);
      if (channel?.send) {
        await channel.send(clampDiscord([
          "🛡️ **Insurance Claim Available**",
          "",
          `Player: **${policy.player_name || event.ownerName || "Unknown"}**`,
          `Vehicle: **${policy.vehicle_name || event.vehicleClass || "Vehicle"}**`,
          `Vehicle ID: \`${policy.vehicle_id}\``,
          `Destroyed At: ${formatDate(event.t)}`,
          `Location: ${formatLocation(event.location)}`,
          "",
          "The owner can use **Claim Insurance** in the insurance menu to redeem a replacement.",
        ].join("\n"))).catch(() => {});
      }
    }
  }
  return created;
}

async function scanInsuranceDestructions(bot, { baselineOnly = false } = {}) {
  const config = await loadRuntimeValue("insurance_config");
  if (!config?.guildId || !config?.channelId) return { scanned: false, reason: "Insurance is not set up." };
  const state = await loadRuntimeValue("insurance_state") || {};
  const since = state.destructionCursor || Math.max(0, Date.now() - 5 * 60 * 1000);
  const data = await fetchRawServerLogs({ since, label: "insurance" }, "vehicle_destruction");
  const lines = Array.isArray(data.lines) ? data.lines : [];
  const seen = new Set(state.seen || []);
  let claims = 0;
  let events = 0;

  for (const entry of lines) {
    const event = parseVehicleDestructionLog(entry);
    if (!event || seen.has(event.key)) continue;
    seen.add(event.key);
    events += 1;
    if (!baselineOnly) claims += await processInsuranceDestructionEvent(bot, config.guildId, config.channelId, event);
  }

  await saveRuntimeValue("insurance_state", {
    destructionCursor: data?.next || Date.now(),
    seen: Array.from(seen).slice(-1000),
    updatedAt: Date.now(),
  });

  return { scanned: true, events, claims };
}

function ensureInsuranceLoop(bot) {
  if (insuranceTimer) return;
  insuranceTimer = setInterval(() => {
    scanInsuranceDestructions(bot).catch((err) => console.error("❌ Insurance scan failed:", err.message));
  }, INSURANCE_SCAN_SECONDS * 1000);
}

async function startInsuranceOnBoot(bot) {
  try {
    const config = await loadRuntimeValue("insurance_config");
    if (!config?.channelId) return;
    ensureInsuranceLoop(bot);
    const state = await loadRuntimeValue("insurance_state");
    await scanInsuranceDestructions(bot, { baselineOnly: !state });
  } catch (err) {
    console.error("❌ Insurance startup failed:", err.message);
  }
}

async function showClaims(interaction) {
  const link = await getLink(interaction.guildId, interaction.user.id);
  if (!link?.steam_id) {
    await interaction.reply({ content: "You need to register first.", ephemeral: true }).catch(() => {});
    return;
  }
  const claims = await getAvailableClaims(interaction.guildId, interaction.user.id);
  if (!claims.length) {
    await interaction.reply({ content: "No insurance claims are available for your account right now. Claims only unlock after confirmed vehicle destruction.", ephemeral: true }).catch(() => {});
    return;
  }

  const rows = [];
  const shown = claims.slice(0, 5);
  for (let i = 0; i < shown.length; i += 5) {
    const row = new ActionRowBuilder();
    shown.slice(i, i + 5).forEach((claim, offset) => {
      row.addComponents(new ButtonBuilder().setCustomId(`insurance:redeem:${claim.id}`).setLabel(`Redeem #${i + offset + 1}`).setStyle(ButtonStyle.Success));
    });
    rows.push(row);
  }

  const content = shown.map((claim, index) => {
    const policy = claim.policy || {};
    return `**${index + 1}. ${policy.vehicle_name || claim.vehicle_name || claim.vehicle_class}**\nVehicle ID: \`${claim.vehicle_id}\` | Destroyed: ${formatDate(claim.destruction_time)}\nLocation: ${formatLocation(claim.destruction_location)}`;
  }).join("\n\n");

  await interaction.reply({ content: clampDiscord(`🚗 **Available Insurance Claims**\n\n${content}`), components: rows, ephemeral: true }).catch(() => {});
}

async function redeemClaim(interaction, claimId) {
  const db = getSupabase();
  const { data: claim, error } = await db
    .from(INSURANCE_CLAIMS_TABLE)
    .select("*, policy:policy_id(*)")
    .eq("id", String(claimId))
    .maybeSingle();
  if (error) throw error;
  if (!claim || claim.status !== "available") {
    await interaction.reply({ content: "That insurance claim is not available anymore.", ephemeral: true }).catch(() => {});
    return;
  }
  if (String(claim.discord_id) !== String(interaction.user.id)) {
    await interaction.reply({ content: "That claim does not belong to your Discord account.", ephemeral: true }).catch(() => {});
    return;
  }

  const policy = claim.policy || {};
  const vehicleClass = policy.vehicle_class || claim.vehicle_class;
  const steamId = policy.steam_id || claim.steam_id;
  await serverPost("/spawn-vehicle", { steamId, vehicle: vehicleClass });

  const now = new Date().toISOString();
  await db.from(INSURANCE_CLAIMS_TABLE).update({ status: "redeemed", redeemed_at: now, updated_at: now }).eq("id", claim.id);
  await db.from(INSURANCE_TABLE).update({ status: "redeemed", claimed_at: now, updated_at: now }).eq("id", policy.id || claim.policy_id);

  await interaction.reply({
    content: [
      "✅ **Insurance Redeemed**",
      `Vehicle: **${policy.vehicle_name || claim.vehicle_name || vehicleClass}**`,
      `Old Vehicle ID: \`${claim.vehicle_id}\``,
      "A replacement was spawned near your linked SCUM character.",
      "The old insurance policy is now closed. You may buy a new policy for that vehicle type.",
    ].join("\n"),
    ephemeral: true,
  }).catch(() => {});
}

async function wipeInsuranceData() {
  const db = getSupabase();
  await db.from(INSURANCE_CLAIMS_TABLE).delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await db.from(INSURANCE_TABLE).delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await db.from(PLAYER_LINKS_TABLE).delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await saveRuntimeValue("insurance_state", { destructionCursor: Date.now(), seen: [], wipedAt: Date.now() });
}

async function handleInsuranceCommand(message, bot) {
  if (!message.guild || !message.content?.startsWith("!")) return false;
  const parts = message.content.trim().split(/\s+/);
  const command = parts.shift().toLowerCase();

  if (!["!insurancesetup", "!insurance", "!insurancescan", "!insurancestatus", "!wipeinsurance"].includes(command)) return false;

  if (command === "!insurance") {
    await message.reply({ content: buildInsuranceMenuText(), components: buildMainRows() }).catch(() => {});
    return true;
  }

  if (!isStaff(message)) {
    await message.reply("The Watcher sees the request. This command is for staff only.").catch(() => {});
    return true;
  }

  if (command === "!insurancesetup") {
    const sent = await message.channel.send({ content: buildInsuranceMenuText(), components: buildMainRows() });
    await saveRuntimeValue("insurance_config", {
      guildId: message.guild.id,
      channelId: message.channel.id,
      messageId: sent.id,
      setBy: message.author.id,
      setAt: Date.now(),
    });
    await scanInsuranceDestructions(bot, { baselineOnly: true });
    ensureInsuranceLoop(bot);
    await message.reply("🛡️ Vehicle insurance menu is now active in this channel. Rerun `!insurancesetup` in a different channel to move it.").catch(() => {});
    return true;
  }

  if (command === "!insurancescan") {
    const result = await scanInsuranceDestructions(bot);
    await message.reply([
      "🛡️ **Insurance Scan Complete**",
      `Destroyed vehicle events found: ${result.events ?? 0}`,
      `Claims created: ${result.claims ?? 0}`,
    ].join("\n")).catch(() => {});
    return true;
  }

  if (command === "!insurancestatus") {
    const config = await loadRuntimeValue("insurance_config");
    const state = await loadRuntimeValue("insurance_state");
    await message.reply([
      "🛡️ **Insurance Status**",
      `Menu Channel: ${config?.channelId ? `<#${config.channelId}>` : "Not set"}`,
      `Scan Interval: ${INSURANCE_SCAN_SECONDS} seconds`,
      `Loop Active: ${insuranceTimer ? "Yes" : "No"}`,
      `Last Cursor: ${state?.destructionCursor || "Not saved yet"}`,
      `Last Scan: ${state?.updatedAt ? formatDate(state.updatedAt) : "Never"}`,
      "Claims trigger only from confirmed vehicle destruction logs.",
    ].join("\n")).catch(() => {});
    return true;
  }

  if (command === "!wipeinsurance") {
    if (!isOwner(message)) {
      await message.reply("Only Owners can wipe insurance data.").catch(() => {});
      return true;
    }
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("insurance:wipeconfirm").setLabel("Confirm Wipe Insurance").setEmoji("⚠️").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("insurance:wipecancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary)
    );
    await message.reply({ content: "⚠️ This will clear all player links, active insurance, and claims. Use this after a server wipe. Continue?", components: [row] }).catch(() => {});
    return true;
  }

  return false;
}

async function handleInsuranceInteraction(interaction) {
  if (!interaction.isButton?.()) return false;
  if (!String(interaction.customId || "").startsWith("insurance:")) return false;

  const parts = interaction.customId.split(":");
  const action = parts[1];
  const value = parts.slice(2).join(":");

  try {
    if (action === "cancel") {
      await interaction.update({ content: "Cancelled.", components: [] }).catch(() => {});
      return true;
    }

    if (action === "rates") {
      await interaction.reply({ content: buildRatesText(), ephemeral: true }).catch(() => {});
      return true;
    }

    if (action === "register") {
      const code = generateCode();
      const expires = await savePendingLink(interaction, code);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("insurance:verify").setLabel("Verify Code").setEmoji("✅").setStyle(ButtonStyle.Success)
      );
      await interaction.reply({
        content: [
          "🔗 **Register SCUM Account**",
          "Type this exact code in SCUM chat:",
          `\`${code}\``,
          "",
          "After typing it in-game, click **Verify Code**.",
          `Expires: ${formatDate(expires)}`,
        ].join("\n"),
        components: [row],
        ephemeral: true,
      }).catch(() => {});
      return true;
    }

    if (action === "verify") {
      await interaction.deferReply({ ephemeral: true }).catch(() => {});
      const result = await verifyPendingLink(interaction);
      if (!result.ok) {
        await interaction.editReply(result.message).catch(() => {});
      } else {
        await interaction.editReply([
          "✅ **SCUM Account Linked**",
          `Discord: **${interaction.user.tag || interaction.user.username}**`,
          `SCUM Player: **${result.parsed.name || "Unknown"}**`,
          `Steam ID: \`${result.parsed.steamId}\``,
        ].join("\n")).catch(() => {});
      }
      return true;
    }

    if (action === "buy") {
      await buildBuyMenu(interaction);
      return true;
    }

    if (action === "buyveh") {
      await showBuyConfirm(interaction, value);
      return true;
    }

    if (action === "confirmbuy") {
      await confirmBuy(interaction, value);
      return true;
    }

    if (action === "mine") {
      await showMyInsurance(interaction);
      return true;
    }

    if (action === "claim") {
      await showClaims(interaction);
      return true;
    }

    if (action === "redeem") {
      await redeemClaim(interaction, value);
      return true;
    }

    if (action === "wipeconfirm") {
      if (!isOwner(interaction)) {
        await interaction.reply({ content: "Only Owners can wipe insurance data.", ephemeral: true }).catch(() => {});
        return true;
      }
      await wipeInsuranceData();
      await interaction.update({ content: "✅ Insurance wipe complete.", components: [] }).catch(() => {});
      return true;
    }

    if (action === "wipecancel") {
      await interaction.update({ content: "Insurance wipe cancelled.", components: [] }).catch(() => {});
      return true;
    }
  } catch (err) {
    console.error("❌ Insurance interaction failed:", err);
    const content = `Insurance error: ${err.message}`;
    if (interaction.deferred || interaction.replied) await interaction.followUp({ content, ephemeral: true }).catch(() => {});
    else await interaction.reply({ content, ephemeral: true }).catch(() => {});
    return true;
  }

  return true;
}

module.exports = {
  handleInsuranceCommand,
  handleInsuranceInteraction,
  startInsuranceOnBoot,
};
