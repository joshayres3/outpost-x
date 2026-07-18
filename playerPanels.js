const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const { createClient } = require("@supabase/supabase-js");
const { openAirliftButton } = require("./airlift");
const {
  buildPlayerDetailsBySteamId,
  buildVehiclesBySteamId,
  buildSquadBySteamId,
  buildNearVehiclesBySteamId,
  getPlayerForLookup,
  getPlayerDisplayName,
  ggconPost,
  jailPlayerBySteamId,
  unjailPlayerBySteamId,
} = require("./ggcon");

const PLAYER_LINKS_TABLE = process.env.WATCHER_PLAYER_LINKS_TABLE || "watcher_player_links";
const PLAYER_SNAPSHOTS_TABLE = process.env.WATCHER_PLAYER_SNAPSHOTS_TABLE || "watcher_player_snapshots";
const VEHICLE_INSURANCE_TABLE = process.env.WATCHER_VEHICLE_INSURANCE_TABLE || "watcher_vehicle_insurance";
const INSURANCE_CLAIMS_TABLE = process.env.WATCHER_INSURANCE_CLAIMS_TABLE || "watcher_insurance_claims";
const LOTTERY_CODES_TABLE = process.env.WATCHER_LOTTERY_CODES_TABLE || "watcher_lottery_codes";
const STAFF_ROLE_NAMES = new Set(["Owner", "Owners", "Admin", "Trial Admin"]);

let supabase = null;
function getDb() {
  if (supabase) return supabase;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) throw new Error("Supabase is not configured.");
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, { auth: { persistSession: false } });
  return supabase;
}

function isStaff(subject) {
  const roles = subject?.member?.roles?.cache || subject?.roles?.cache;
  return !!roles?.some((role) => STAFF_ROLE_NAMES.has(role.name));
}

function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("en-CA") : "Unknown";
}

function formatDate(value) {
  if (!value) return "Unknown";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : `<t:${Math.floor(date.getTime() / 1000)}:R>`;
}

async function getLinkByDiscord(guildId, discordId) {
  const { data, error } = await getDb()
    .from(PLAYER_LINKS_TABLE)
    .select("*")
    .eq("guild_id", String(guildId))
    .eq("discord_id", String(discordId))
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function getLinkBySteam(guildId, steamId) {
  const { data, error } = await getDb()
    .from(PLAYER_LINKS_TABLE)
    .select("*")
    .eq("guild_id", String(guildId))
    .eq("steam_id", String(steamId))
    .order("linked_at", { ascending: false, nullsFirst: false })
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) ? data[0] || null : null;
}

async function resolveAdminTarget(guildId, query) {
  const mentionId = String(query || "").match(/^<@!?(\d+)>$/)?.[1];
  if (mentionId) {
    const link = await getLinkByDiscord(guildId, mentionId);
    if (!link?.steam_id) return { type: "none", reason: "That Discord member is not linked to a SCUM account." };
    return getPlayerForLookup(link.steam_id);
  }
  return getPlayerForLookup(query);
}

function adminPanelRows(steamId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`pp:admin:details:${steamId}`).setLabel("Player Details").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`pp:admin:vehicles:${steamId}`).setLabel("Vehicles").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`pp:admin:squad:${steamId}`).setLabel("Squad").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`pp:admin:nearby:${steamId}`).setLabel("Nearby Vehicles").setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`pp:admin:cashadd:${steamId}`).setLabel("Add Cash").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`pp:admin:cashremove:${steamId}`).setLabel("Remove Cash").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`pp:admin:fameadd:${steamId}`).setLabel("Add Fame").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`pp:admin:fameremove:${steamId}`).setLabel("Remove Fame").setStyle(ButtonStyle.Danger)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`pp:admin:jail:${steamId}`).setLabel("Jail").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`pp:admin:unjail:${steamId}`).setLabel("Unjail").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`pp:admin:ban:${steamId}`).setLabel("Ban Player").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`pp:admin:refresh:${steamId}`).setLabel("Refresh Panel").setStyle(ButtonStyle.Secondary)
    ),
  ];
}

async function buildAdminPanel(guildId, player) {
  const steamId = String(player?.userId || "").trim();
  const link = await getLinkBySteam(guildId, steamId).catch(() => null);
  const name = getPlayerDisplayName(player);
  return {
    content: [
      "🛡️ **Watcher Admin Player Control Panel**",
      "",
      `**Player:** ${name}`,
      `**Steam ID:** \`${steamId}\``,
      `**Discord:** ${link?.discord_id ? `<@${link.discord_id}>` : "Not linked"}`,
      `**Status:** ${player?.online === true || player?.ping !== undefined ? "Online" : "Last known/offline"}`,
      "",
      "Choose an action below. The Ban Player action requires a typed confirmation and attempts to ban the linked account from both SCUM and Discord.",
    ].join("\n"),
    components: adminPanelRows(steamId),
    allowedMentions: { parse: [] },
  };
}

function selfLauncherRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("pp:self:open").setLabel("Open My Dashboard").setStyle(ButtonStyle.Primary)
  );
}

function selfPanelRows(steamId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`pp:self:profile:${steamId}`).setLabel("My Profile").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`pp:self:vehicles:${steamId}`).setLabel("My Vehicles").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`pp:self:locations:${steamId}`).setLabel("Vehicle Locations").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`pp:self:squad:${steamId}`).setLabel("My Squad").setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`pp:self:insurance:${steamId}`).setLabel("Insurance").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`pp:self:lottery:${steamId}`).setLabel("Lottery").setStyle(ButtonStyle.Secondary),
      openAirliftButton(steamId).components[0],
      new ButtonBuilder().setCustomId(`pp:self:refresh:${steamId}`).setLabel("Refresh").setStyle(ButtonStyle.Secondary)
    ),
  ];
}

async function getSafeSelfSummary(guildId, discordId) {
  const link = await getLinkByDiscord(guildId, discordId);
  if (!link?.steam_id) return { linked: false };

  const result = await getPlayerForLookup(link.steam_id).catch(() => ({ type: "none" }));
  const player = result.type === "single" ? result.player : null;
  const { data: snapshot } = await getDb()
    .from(PLAYER_SNAPSHOTS_TABLE)
    .select("*")
    .eq("steam_id", String(link.steam_id))
    .maybeSingle();

  return { linked: true, link, player, snapshot: snapshot || null };
}

function renderSelfPanel(summary) {
  const { link, player, snapshot } = summary;
  const online = !!player && (player.online === true || player.ping !== undefined || player.health !== undefined);
  const name = player ? getPlayerDisplayName(player) : (link.scum_name || snapshot?.character_name || "Unknown");
  const cash = player?.accountBalance ?? snapshot?.cash;
  const fame = player?.fame ?? snapshot?.fame;
  const gold = player?.goldBalance ?? snapshot?.gold;
  const squad = player?.squad?.name || snapshot?.squad?.name || snapshot?.squad || "None / Unknown";

  return {
    content: [
      "👁️ **My Watcher Dashboard**",
      "",
      `**SCUM Name:** ${name}`,
      `**Steam ID:** \`${link.steam_id}\``,
      `**Status:** ${online ? "Online" : "Offline / last known data"}`,
      `**Cash:** $${formatNumber(cash)}`,
      `**Fame:** ${formatNumber(fame)}`,
      `**Gold:** ${formatNumber(gold)}`,
      `**Squad:** ${typeof squad === "string" ? squad : JSON.stringify(squad).slice(0, 100)}`,
      `**Last Seen:** ${online ? "Now" : formatDate(snapshot?.last_seen_online_at)}`,
      "",
      "Only you can see this dashboard. Sensitive staff-only information such as IP addresses is never shown here.",
    ].join("\n"),
    components: selfPanelRows(link.steam_id),
    ephemeral: true,
    allowedMentions: { parse: [] },
  };
}

async function buildInsuranceSummary(guildId, discordId, steamId) {
  const db = getDb();
  const [policiesResult, claimsResult] = await Promise.all([
    db.from(VEHICLE_INSURANCE_TABLE).select("*").eq("guild_id", String(guildId)).eq("steam_id", String(steamId)).order("purchased_at", { ascending: false }).limit(10),
    db.from(INSURANCE_CLAIMS_TABLE).select("*").eq("guild_id", String(guildId)).eq("discord_id", String(discordId)).order("created_at", { ascending: false }).limit(10),
  ]);
  if (policiesResult.error) throw policiesResult.error;
  if (claimsResult.error) throw claimsResult.error;
  const policies = policiesResult.data || [];
  const claims = claimsResult.data || [];
  const policyLines = policies.length ? policies.map((p) => `• **${p.vehicle_name || p.vehicle_type || "Vehicle"}** — ${p.status || "unknown"} — \`${p.vehicle_id || "unknown"}\``).join("\n") : "No insurance policies found.";
  const claimLines = claims.length ? claims.map((c) => `• **${c.vehicle_name || c.vehicle_type || "Vehicle"}** — ${c.status || "unknown"} — created ${formatDate(c.created_at)}`).join("\n") : "No insurance claims found.";
  return `🛡️ **My Vehicle Insurance**\n\n**Policies**\n${policyLines}\n\n**Claims**\n${claimLines}`;
}

async function buildLotterySummary(guildId, discordId) {
  const { data, error } = await getDb()
    .from(LOTTERY_CODES_TABLE)
    .select("*")
    .eq("guild_id", String(guildId))
    .eq("discord_id", String(discordId))
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw error;
  const rows = data || [];
  if (!rows.length) return "🎟️ **My Lottery**\n\nNo lottery codes or wins were found for your account.";
  const lines = rows.map((row) => {
    const pack = row.pack_name || row.prize_name || row.pack_id || "Lottery Pack";
    const status = row.status || (row.redeemed_at ? "redeemed" : "available");
    const expiry = row.expires_at ? ` — expires ${formatDate(row.expires_at)}` : "";
    return `• **${pack}** — ${status}${expiry}`;
  });
  return `🎟️ **My Lottery**\n\n${lines.join("\n")}`;
}

function buildAmountModal(kind, operation, steamId) {
  const label = kind === "cash" ? "Cash" : "Fame";
  const verb = operation === "add" ? "Add" : "Remove";
  return new ModalBuilder()
    .setCustomId(`pp:modal:${kind}:${operation}:${steamId}`)
    .setTitle(`${verb} ${label}`)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("amount").setLabel(`${label} amount`).setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("Example: 5000")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("reason").setLabel("Reason / staff note").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500)
      )
    );
}

function buildBanModal(steamId) {
  return new ModalBuilder()
    .setCustomId(`pp:banmodal:${steamId}`)
    .setTitle("Ban Player from SCUM and Discord")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("reason")
          .setLabel("Ban reason")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMinLength(3)
          .setMaxLength(500)
          .setPlaceholder("Explain why this player is being banned")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("confirmation")
          .setLabel("Type BAN to confirm")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(10)
          .setPlaceholder("BAN")
      )
    );
}

async function handleBanModal(interaction, steamId) {
  if (!isStaff(interaction)) {
    await interaction.reply({ content: "This action is for staff only.", ephemeral: true });
    return;
  }

  const confirmation = interaction.fields.getTextInputValue("confirmation")?.trim().toUpperCase();
  const reason = interaction.fields.getTextInputValue("reason")?.trim();
  if (confirmation !== "BAN") {
    await interaction.reply({ content: "Ban cancelled. You must type `BAN` exactly to confirm.", ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const playerResult = await getPlayerForLookup(steamId);
  if (playerResult.type !== "single") {
    await interaction.editReply("The player could not be loaded, so no ban was applied.");
    return;
  }

  const player = playerResult.player;
  const realSteamId = String(player?.userId || steamId || "").trim();
  const displayName = getPlayerDisplayName(player);
  const link = await getLinkBySteam(interaction.guildId, realSteamId).catch(() => null);
  const discordId = String(link?.discord_id || "").trim();

  // Never allow this panel to ban the Discord server owner or a staff account.
  if (discordId) {
    const targetMember = await interaction.guild.members.fetch(discordId).catch(() => null);
    if (discordId === interaction.guild.ownerId) {
      await interaction.editReply("Ban blocked: the linked Discord account owns this server. No SCUM or Discord ban was applied.");
      return;
    }
    if (targetMember?.roles?.cache?.some((role) => STAFF_ROLE_NAMES.has(role.name))) {
      await interaction.editReply("Ban blocked: the linked Discord account has a Watcher staff role. No SCUM or Discord ban was applied.");
      return;
    }
  }

  await ggconPost(`/players/${encodeURIComponent(realSteamId)}/ban`, {});

  let discordResult;
  if (!discordId) {
    discordResult = "⚠️ No linked Discord account was found. Manually remove/ban this player from Discord if they are present.";
  } else {
    try {
      await interaction.guild.members.ban(discordId, {
        reason: `Outpost X ban by ${interaction.user.tag || interaction.user.username}: ${reason}`,
      });
      discordResult = `✅ Discord account <@${discordId}> was banned.`;
    } catch (err) {
      console.error("❌ Discord ban failed after SCUM ban:", err);
      discordResult = `⚠️ SCUM ban succeeded, but Discord could not ban <@${discordId}>. Manually remove/ban them in Discord. Error: ${err.message}`;
    }
  }

  await interaction.editReply({
    content: [
      "⛔ **Player Banned**",
      "",
      `**Player:** ${displayName}`,
      `**Steam ID:** \`${realSteamId}\``,
      `**Reason:** ${reason}`,
      "✅ The player was banned from the SCUM server through ggCON.",
      discordResult,
    ].join("\n"),
    allowedMentions: { parse: [] },
  });
}

async function handlePlayerPanelCommand(message) {
  if (!message.guild || !message.content?.startsWith("!")) return false;
  const [rawCommand, ...args] = message.content.trim().split(/\s+/);
  const command = rawCommand.toLowerCase();

  if (command === "!dashboard") {
    await message.reply({
      content: "👁️ **Watcher Player Dashboard**\nUse the button below to privately open your linked SCUM profile.",
      components: [selfLauncherRow()],
    }).catch(() => {});
    return true;
  }

  if (command !== "!manage") return false;
  if (!isStaff(message)) {
    await message.reply("This control panel is for staff only.").catch(() => {});
    return true;
  }

  const query = args.join(" ").trim();
  if (!query) {
    await message.reply("Use: `!manage <player name, Steam ID, or @Discord member>`").catch(() => {});
    return true;
  }

  const result = await resolveAdminTarget(message.guildId, query);
  if (result.type === "none") {
    await message.reply(result.reason || `No player found for **${query}**.`).catch(() => {});
    return true;
  }
  if (result.type === "multiple") {
    const rows = result.matches.slice(0, 10).map((p, i) => `${i + 1}. **${getPlayerDisplayName(p)}** — \`${p.userId || "Unknown"}\``);
    await message.reply(`Multiple players matched **${query}**. Use the Steam ID with \`!manage\`:\n${rows.join("\n")}`).catch(() => {});
    return true;
  }

  // Prefix commands cannot reply ephemerally by themselves, so post a harmless
  // one-use launcher. The actual panel opens privately after the requesting
  // staff member clicks it. No player details are shown in public chat.
  const steamId = String(result.player?.userId || "").trim();
  await message.delete().catch(() => {});
  const launcher = await message.channel.send({
    content: `${message.author}, open your private Watcher admin panel.`,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`pp:adminopen:${message.author.id}:${steamId}`)
          .setLabel("Open Admin Panel")
          .setStyle(ButtonStyle.Primary)
      ),
    ],
    allowedMentions: { users: [message.author.id] },
  }).catch(() => null);

  // Remove an unused launcher after two minutes. A used launcher deletes itself.
  if (launcher) setTimeout(() => launcher.delete().catch(() => {}), 120000);
  return true;
}

async function registerPlayerPanelCommands(client) {
  // Watcher panels intentionally use prefix-command launchers instead of slash commands.
  // Remove older Watcher slash commands left over from previous deployments.
  for (const guild of client.guilds.cache.values()) {
    const existing = await guild.commands.fetch().catch(() => null);
    if (!existing) continue;
    for (const name of ["manage", "dashboard"]) {
      const current = existing.find((item) => item.name === name);
      if (current) await guild.commands.delete(current.id).catch(() => {});
    }
  }
}

async function handlePlayerPanelInteraction(interaction) {

  if (!interaction.customId?.startsWith("pp:")) return false;
  const parts = interaction.customId.split(":");

  try {
    if (interaction.isModalSubmit() && parts[1] === "banmodal") {
      await handleBanModal(interaction, parts[2]);
      return true;
    }

    if (interaction.isModalSubmit() && parts[1] === "modal") {
      if (!isStaff(interaction)) {
        await interaction.reply({ content: "This action is for staff only.", ephemeral: true });
        return true;
      }
      const [, , kind, operation, steamId] = parts;
      const amount = Math.floor(Number(interaction.fields.getTextInputValue("amount")));
      const reason = interaction.fields.getTextInputValue("reason")?.trim() || "No reason supplied";
      if (!Number.isFinite(amount) || amount <= 0) {
        await interaction.reply({ content: "Enter a whole number greater than zero.", ephemeral: true });
        return true;
      }
      const endpoint = kind === "cash" ? "currency" : "fame";
      await ggconPost(`/players/${encodeURIComponent(steamId)}/${endpoint}`, { action: "change", amount: operation === "add" ? amount : -amount });
      await interaction.reply({
        content: `✅ ${operation === "add" ? "Added" : "Removed"} **${formatNumber(amount)} ${kind === "cash" ? "cash" : "fame"}** ${operation === "add" ? "to" : "from"} \`${steamId}\`.\n**Reason:** ${reason}`,
        ephemeral: true,
      });
      return true;
    }

    if (!interaction.isButton()) return false;

    if (parts[1] === "adminopen") {
      const requestingUserId = parts[2];
      const steamId = parts[3];
      if (interaction.user.id !== requestingUserId) {
        await interaction.reply({ content: "This private admin-panel launcher belongs to another staff member.", ephemeral: true });
        return true;
      }
      if (!isStaff(interaction)) {
        await interaction.reply({ content: "This control panel is for staff only.", ephemeral: true });
        return true;
      }

      const result = await getPlayerForLookup(steamId);
      if (result.type !== "single") {
        await interaction.reply({ content: "That player could not be loaded. Run `!manage` again.", ephemeral: true });
        return true;
      }

      await interaction.reply({ ...(await buildAdminPanel(interaction.guildId, result.player)), ephemeral: true });
      await interaction.message.delete().catch(() => {});
      return true;
    }

    if (parts[1] === "self") {
      const action = parts[2];
      const summary = await getSafeSelfSummary(interaction.guildId, interaction.user.id);
      if (!summary.linked) {
        await interaction.reply({ content: "Your Discord account is not linked to a SCUM character yet. Use the existing Watcher registration flow first.", ephemeral: true });
        return true;
      }
      const steamId = summary.link.steam_id;
      if (parts[3] && parts[3] !== steamId) {
        await interaction.reply({ content: "That dashboard does not belong to your linked account.", ephemeral: true });
        return true;
      }
      if (action === "open") {
        await interaction.reply(renderSelfPanel(summary));
      } else if (action === "refresh") {
        await interaction.update(renderSelfPanel(summary));
      } else if (action === "profile") {
        await interaction.reply({ content: renderSelfPanel(summary).content, ephemeral: true, allowedMentions: { parse: [] } });
      } else if (action === "vehicles" || action === "locations") {
        await interaction.reply({ content: await buildVehiclesBySteamId(steamId), ephemeral: true, allowedMentions: { parse: [] } });
      } else if (action === "squad") {
        await interaction.reply({ content: await buildSquadBySteamId(steamId), ephemeral: true, allowedMentions: { parse: [] } });
      } else if (action === "insurance") {
        await interaction.reply({ content: await buildInsuranceSummary(interaction.guildId, interaction.user.id, steamId), ephemeral: true, allowedMentions: { parse: [] } });
      } else if (action === "lottery") {
        await interaction.reply({ content: await buildLotterySummary(interaction.guildId, interaction.user.id), ephemeral: true, allowedMentions: { parse: [] } });
      }
      return true;
    }

    if (parts[1] === "admin") {
      if (!isStaff(interaction)) {
        await interaction.reply({ content: "This control panel is for staff only.", ephemeral: true });
        return true;
      }
      const action = parts[2];
      const steamId = parts[3];
      if (action === "ban") {
        await interaction.showModal(buildBanModal(steamId));
        return true;
      }
      if (["cashadd", "cashremove", "fameadd", "fameremove"].includes(action)) {
        const kind = action.startsWith("cash") ? "cash" : "fame";
        const operation = action.endsWith("add") ? "add" : "remove";
        await interaction.showModal(buildAmountModal(kind, operation, steamId));
        return true;
      }
      if (action === "details") await interaction.reply({ content: await buildPlayerDetailsBySteamId(steamId, interaction.guildId), ephemeral: true, allowedMentions: { parse: [] } });
      else if (action === "vehicles") await interaction.reply({ content: await buildVehiclesBySteamId(steamId), ephemeral: true, allowedMentions: { parse: [] } });
      else if (action === "squad") await interaction.reply({ content: await buildSquadBySteamId(steamId), ephemeral: true, allowedMentions: { parse: [] } });
      else if (action === "nearby") await interaction.reply({ content: await buildNearVehiclesBySteamId(steamId), ephemeral: true, allowedMentions: { parse: [] } });
      else if (action === "jail") await jailPlayerBySteamId(interaction, steamId);
      else if (action === "unjail") await unjailPlayerBySteamId(interaction, steamId);
      else if (action === "refresh") {
        const result = await getPlayerForLookup(steamId);
        if (result.type !== "single") await interaction.reply({ content: "Player could not be refreshed.", ephemeral: true });
        else await interaction.update(await buildAdminPanel(interaction.guildId, result.player));
      }
      return true;
    }
  } catch (err) {
    console.error("❌ Player panel error:", err);
    const payload = { content: `Player panel error: ${err.message}`, ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
    return true;
  }

  return false;
}

async function openAdminPanelForSteamId(interaction, steamId) {
  if (!isStaff(interaction)) {
    await interaction.reply({ content: "This control panel is for staff only.", ephemeral: true });
    return;
  }
  const result = await getPlayerForLookup(steamId);
  if (result.type !== "single") {
    await interaction.reply({ content: "Player could not be found in GGCON.", ephemeral: true });
    return;
  }
  await interaction.reply({ ...(await buildAdminPanel(interaction.guildId, result.player)), ephemeral: true });
}

module.exports = { registerPlayerPanelCommands, handlePlayerPanelCommand, handlePlayerPanelInteraction, openAdminPanelForSteamId };
