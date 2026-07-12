const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const SftpClient = require("ssh2-sftp-client");
const initSqlJs = require("sql.js");
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

const DEFAULT_SERVER_BASE_URL = "https://ggcon.gghost.games/s/2788404";
const STAFF_ROLE_NAMES = new Set(["Owner", "Owners", "Admin", "Trial Admin"]);

// New trade pad coords from Josh. Password must stay in Railway only.
const TRADE_PAD_CENTER = {
  x: 567289.5,
  y: -227080.438,
  z: 369.694,
  pitch: 289.879639,
  yaw: 225.654404,
  roll: 0,
};

const TRADE_ITEM_CLASS = "Screwdriver_Small";
const REQUIRED_COUNT = 35;
const COUNT_RADIUS_UNITS = Number(process.env.TRADE_PAD_COUNT_RADIUS_UNITS || 500); // SCUM/Unreal units. 500 = 5m.
const DELETE_RADIUS_METERS = Number(process.env.TRADE_PAD_DELETE_RADIUS_METERS || 1);
const MAX_DB_BYTES = Number(process.env.TRADE_DB_MAX_BYTES || 700 * 1024 * 1024);

const SFTP_HOST = process.env.SCUM_SFTP_HOST || "169.150.251.137";
const SFTP_PORT = Number(process.env.SCUM_SFTP_PORT || 8822);
const SFTP_USERNAME = process.env.SCUM_SFTP_USERNAME || "Joshuaa";
const SFTP_ROOT = process.env.SCUM_SFTP_ROOT || "/169.150.251.137_7022";
const SCUM_DB_REMOTE_PATH = process.env.SCUM_DB_REMOTE_PATH || "";

let SQL_PROMISE = null;

function serverBaseUrl() {
  return String(process.env.GGCON_BASE_URL || DEFAULT_SERVER_BASE_URL).replace(/\/+$/, "");
}

function serverPassword() {
  const password = process.env.GGCON_PASSWORD;
  if (!password) throw new Error("Server tool password is not configured.");
  return password;
}

function getSftpPassword() {
  const password = process.env.SCUM_SFTP_PASSWORD;
  if (!password) throw new Error("Missing Railway variable: SCUM_SFTP_PASSWORD");
  return password;
}

function isStaffMember(member) {
  return !!member?.roles?.cache?.some((role) => STAFF_ROLE_NAMES.has(role.name));
}

function formatLocation(location) {
  if (!location) return "Unknown";
  return `X: ${Math.round(Number(location.x || 0))} | Y: ${Math.round(Number(location.y || 0))} | Z: ${Math.round(Number(location.z || 0))}`;
}

function clampDiscord(text, limit = 1900) {
  const value = String(text || "");
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 48)}\n\n...trimmed for Discord...`;
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function compact(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function distanceUnits(a, b) {
  if (!a || !b) return null;
  const ax = Number(a.x);
  const ay = Number(a.y);
  const az = Number(a.z || 0);
  const bx = Number(b.x);
  const by = Number(b.y);
  const bz = Number(b.z || 0);
  if (![ax, ay, az, bx, by, bz].every(Number.isFinite)) return null;
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2 + (az - bz) ** 2);
}

function safeString(value) {
  if (value === null || value === undefined) return "";
  if (Buffer.isBuffer(value)) return "";
  if (value instanceof Uint8Array) return "";
  return String(value);
}

function looksLikeScrewdriverSmall(rowText) {
  const hay = compact(rowText);
  return hay.includes("screwdriversmall") || (hay.includes("screwdriver") && hay.includes("small"));
}

function rowObjectFromValues(columns, values) {
  const row = {};
  for (let i = 0; i < columns.length; i += 1) row[columns[i]] = values[i];
  return row;
}

function rowText(row) {
  return Object.values(row || {}).map(safeString).filter(Boolean).join(" ");
}

function firstFinite(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function getLocationFromColumns(row) {
  const keys = Object.keys(row || {});
  const lowerToKey = new Map(keys.map((key) => [key.toLowerCase(), key]));

  const get = (...names) => {
    for (const name of names) {
      const key = lowerToKey.get(String(name).toLowerCase());
      if (key && row[key] !== null && row[key] !== undefined && row[key] !== "") return row[key];
    }
    return undefined;
  };

  const directTriples = [
    ["x", "y", "z"],
    ["pos_x", "pos_y", "pos_z"],
    ["position_x", "position_y", "position_z"],
    ["location_x", "location_y", "location_z"],
    ["loc_x", "loc_y", "loc_z"],
    ["world_x", "world_y", "world_z"],
    ["transform_x", "transform_y", "transform_z"],
    ["x_coordinate", "y_coordinate", "z_coordinate"],
    ["coordinate_x", "coordinate_y", "coordinate_z"],
  ];

  for (const [xName, yName, zName] of directTriples) {
    const x = firstFinite(get(xName));
    const y = firstFinite(get(yName));
    const z = firstFinite(get(zName));
    if (x !== null && y !== null) return { x, y, z: z ?? 0 };
  }

  const text = rowText(row);
  const transformMatch = text.match(/X\s*=\s*(-?\d+(?:\.\d+)?)\s+Y\s*=\s*(-?\d+(?:\.\d+)?)\s+Z\s*=\s*(-?\d+(?:\.\d+)?)/i);
  if (transformMatch) {
    return { x: Number(transformMatch[1]), y: Number(transformMatch[2]), z: Number(transformMatch[3]) };
  }

  const jsonLike = text.match(/"x"\s*:\s*(-?\d+(?:\.\d+)?).*?"y"\s*:\s*(-?\d+(?:\.\d+)?).*?"z"\s*:\s*(-?\d+(?:\.\d+)?)/i);
  if (jsonLike) {
    return { x: Number(jsonLike[1]), y: Number(jsonLike[2]), z: Number(jsonLike[3]) };
  }

  return null;
}

function getCountFromRow(row) {
  // Screwdrivers are usually separate items, so default to 1. Do not count durability/uses.
  const keys = Object.keys(row || {});
  const lowerToKey = new Map(keys.map((key) => [key.toLowerCase(), key]));
  const possible = [
    "count",
    "quantity",
    "qty",
    "amount",
    "stack_count",
    "stackcount",
    "stack_size",
    "stacksize",
  ];

  for (const name of possible) {
    const key = lowerToKey.get(name);
    if (!key) continue;
    const n = Number(row[key]);
    if (Number.isFinite(n) && n > 0 && n < 10000) return Math.floor(n);
  }

  return 1;
}

function summarizeRow(match, index) {
  const pieces = [`${index + 1}. ${match.table}`];
  if (match.rowid !== null && match.rowid !== undefined) pieces.push(`rowid:${match.rowid}`);
  pieces.push(`count:${match.count}`);
  if (match.distance !== null) pieces.push(`${Math.round(match.distance)}u away`);
  if (match.location) pieces.push(formatLocation(match.location));
  return pieces.join(" — ");
}

function buildSftpText() {
  return [
    "# 🔧 SFTP Ground Trade Count Test",
    "Use this hidden test panel to see whether Watcher can count Screwdriver Small items dropped on the ground at the trade pad by reading a temporary copy of SCUM.db.",
    "",
    `**Trade Pad:** ${formatLocation(TRADE_PAD_CENTER)}`,
    `**Required:** ${REQUIRED_COUNT}x \`${TRADE_ITEM_CLASS}\``,
    `**Count Radius:** ${COUNT_RADIUS_UNITS} Unreal units`,
    `**Delete Radius:** ${DELETE_RADIUS_METERS} meter`,
    "",
    "The scan button is read-only and deletes the temporary database copy after the scan.",
    "The delete button re-scans first and only sends the cleanup command if the count is exactly 35.",
  ].join("\n");
}

function buildSftpRows() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("sftpgroundtrade:scan")
        .setLabel("SFTP Scan Trade Pad")
        .setEmoji("🔎")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("sftpgroundtrade:auto_delete")
        .setLabel("SFTP Scan + Delete If Exact")
        .setEmoji("🧹")
        .setStyle(ButtonStyle.Danger)
    ),
  ];
}

async function setupSftpGroundTradePanel(message) {
  if (!isStaffMember(message.member)) return false;
  await message.channel.send({ content: buildSftpText(), components: buildSftpRows() });
  await message.react("✅").catch(() => {});
  return true;
}

async function withSftp(fn) {
  const sftp = new SftpClient();
  try {
    await sftp.connect({
      host: SFTP_HOST,
      port: SFTP_PORT,
      username: SFTP_USERNAME,
      password: getSftpPassword(),
      readyTimeout: 25000,
    });
    return await fn(sftp);
  } finally {
    await sftp.end().catch(() => {});
  }
}

async function existsRemoteFile(sftp, remotePath) {
  try {
    const stat = await sftp.stat(remotePath);
    if (stat?.isFile || stat?.type === "-") return stat;
    if (Number.isFinite(Number(stat?.size))) return stat;
    return null;
  } catch {
    return null;
  }
}

async function recursiveFindScumDb(sftp, root, maxDepth = 7, maxDirs = 450) {
  const found = [];
  const queue = [{ dir: root, depth: 0 }];
  let dirsVisited = 0;

  while (queue.length && dirsVisited < maxDirs && found.length < 5) {
    const current = queue.shift();
    dirsVisited += 1;

    let entries = [];
    try {
      entries = await sftp.list(current.dir);
    } catch {
      continue;
    }

    for (const entry of entries || []) {
      const name = entry.name || "";
      if (!name || name === "." || name === "..") continue;
      const remote = `${current.dir.replace(/\/+$/, "")}/${name}`;
      const isDir = entry.type === "d";
      const isFile = entry.type === "-" || entry.type === undefined;

      if (isFile && name.toLowerCase() === "scum.db") {
        found.push({ path: remote, size: Number(entry.size || 0) });
      }

      if (isDir && current.depth < maxDepth) {
        const lower = name.toLowerCase();
        if (["node_modules", "logs", "crashreportclient", "config"].includes(lower)) continue;
        queue.push({ dir: remote, depth: current.depth + 1 });
      }
    }
  }

  return found;
}

async function findScumDb(sftp) {
  const candidates = [];
  if (SCUM_DB_REMOTE_PATH) candidates.push(SCUM_DB_REMOTE_PATH);
  candidates.push(
    `${SFTP_ROOT}/SCUM/Saved/SaveFiles/SCUM.db`,
    `${SFTP_ROOT}/SCUM/Saved/SaveGames/SCUM.db`,
    `${SFTP_ROOT}/SCUM/Saved/SCUM.db`,
    `${SFTP_ROOT}/Saved/SaveFiles/SCUM.db`,
    `${SFTP_ROOT}/SaveFiles/SCUM.db`,
    `${SFTP_ROOT}/SCUM.db`
  );

  const checked = [];
  for (const candidate of [...new Set(candidates)]) {
    const stat = await existsRemoteFile(sftp, candidate);
    checked.push(candidate);
    if (stat) return { path: candidate, size: Number(stat.size || 0), checked, foundBy: "candidate" };
  }

  const found = await recursiveFindScumDb(sftp, SFTP_ROOT);
  if (found.length) return { ...found[0], checked, foundBy: "recursive", alternatives: found.slice(1) };

  return { path: null, size: 0, checked, foundBy: "not_found" };
}

async function getSql() {
  if (!SQL_PROMISE) {
    SQL_PROMISE = initSqlJs({
      locateFile: (file) => path.join(__dirname, "node_modules", "sql.js", "dist", file),
    });
  }
  return await SQL_PROMISE;
}

function execRows(db, sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally {
    stmt.free();
  }
}

function tableInfo(db, table) {
  return execRows(db, `PRAGMA table_info(${quoteIdent(table)})`);
}

function tableRowCount(db, table) {
  try {
    const row = execRows(db, `SELECT COUNT(*) AS c FROM ${quoteIdent(table)}`)[0];
    return Number(row?.c || 0);
  } catch {
    return null;
  }
}

function buildSearchWhere(columns) {
  // Search all columns as text. This is read-only and capped by LIMIT.
  return columns.map((column) => `CAST(${quoteIdent(column.name)} AS TEXT) LIKE ? COLLATE NOCASE`).join(" OR ");
}

function getSearchTerms() {
  return ["%Screwdriver_Small%", "%Small%Screwdriver%", "%Screwdriver%Small%"];
}

function rowCouldBeGroundItem(row) {
  const text = rowText(row).toLowerCase();
  const badContainerSignals = ["container", "inventory", "wardrobe", "chest", "storage", "vehicleinventory"];
  // Do not hard-exclude; just keep for notes. Some schemas include container info even for world items.
  return !badContainerSignals.some((signal) => text.includes(signal) && !text.includes("world"));
}

async function scanSqliteForTradeItems(localDbPath) {
  const SQL = await getSql();
  const buffer = await fs.readFile(localDbPath);
  const db = new SQL.Database(buffer);

  try {
    const tableRows = execRows(
      db,
      "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    );

    const matches = [];
    const tableSummaries = [];
    const terms = getSearchTerms();

    for (const tableRow of tableRows) {
      const table = String(tableRow.name || "");
      if (!table) continue;

      let columns = [];
      try {
        columns = tableInfo(db, table).map((c) => ({ name: String(c.name || ""), type: String(c.type || "") })).filter((c) => c.name);
      } catch {
        continue;
      }

      if (!columns.length) continue;

      const rowCount = tableRowCount(db, table);
      const where = buildSearchWhere(columns);
      if (!where) continue;

      let rows = [];
      try {
        // Use separate term runs so one broad Screwdriver search does not hide exact matches behind SQL parameter complexity.
        for (const term of terms) {
          const sql = `SELECT rowid AS __rowid, * FROM ${quoteIdent(table)} WHERE ${where} LIMIT 60`;
          const params = columns.map(() => term);
          rows.push(...execRows(db, sql, params));
          if (rows.length >= 60) break;
        }
      } catch {
        continue;
      }

      if (rows.length) {
        tableSummaries.push({ table, rowCount, hits: rows.length });
      }

      const seenRows = new Set();
      for (const row of rows) {
        const key = `${table}:${row.__rowid ?? JSON.stringify(row).slice(0, 80)}`;
        if (seenRows.has(key)) continue;
        seenRows.add(key);

        if (!looksLikeScrewdriverSmall(rowText(row))) continue;
        const location = getLocationFromColumns(row);
        const distance = location ? distanceUnits(TRADE_PAD_CENTER, location) : null;
        const nearPad = distance !== null && distance <= COUNT_RADIUS_UNITS;
        const count = getCountFromRow(row);

        matches.push({
          table,
          rowid: row.__rowid,
          count,
          location,
          distance,
          nearPad,
          possibleGroundItem: rowCouldBeGroundItem(row),
        });
      }
    }

    const nearMatches = matches.filter((m) => m.nearPad);
    const totalNear = nearMatches.reduce((sum, m) => sum + (Number(m.count) || 1), 0);

    return {
      tableCount: tableRows.length,
      tableSummaries,
      matches,
      nearMatches,
      totalNear,
      canLocate: matches.some((m) => !!m.location),
    };
  } finally {
    db.close();
  }
}

async function downloadAndScanScumDb() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "watcher-trade-scan-"));
  const localDb = path.join(tempDir, "SCUM.db");
  const downloaded = [];

  try {
    return await withSftp(async (sftp) => {
      const found = await findScumDb(sftp);
      if (!found.path) {
        return {
          ok: false,
          error: "Could not find SCUM.db through SFTP.",
          found,
          cleanupDone: false,
          tempDir,
        };
      }

      if (found.size > MAX_DB_BYTES) {
        return {
          ok: false,
          error: `SCUM.db is too large for this safety limit (${Math.round(found.size / 1024 / 1024)} MB).`,
          found,
          cleanupDone: false,
          tempDir,
        };
      }

      await sftp.fastGet(found.path, localDb);
      downloaded.push(localDb);

      const walPath = `${found.path}-wal`;
      const walStat = await existsRemoteFile(sftp, walPath);
      const walPresent = !!(walStat && Number(walStat.size || 0) > 0);

      const scan = await scanSqliteForTradeItems(localDb);

      return {
        ok: true,
        found,
        walPresent,
        walSize: walStat ? Number(walStat.size || 0) : 0,
        scan,
        cleanupDone: false,
        tempDir,
      };
    });
  } finally {
    for (const file of downloaded) await fs.rm(file, { force: true }).catch(() => {});
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

function verdictForSftpCount(result) {
  if (!result?.ok) return `❌ **Verdict:** ${result?.error || "SFTP scan failed."}`;

  const count = Number(result.scan?.totalNear || 0);
  if (!result.scan?.nearMatches?.length) {
    if (result.scan?.matches?.length && !result.scan?.canLocate) {
      return [
        "⚠️ **Verdict:** Screwdriver Small exists in SCUM.db, but Watcher could not find location columns to prove they are on the trade pad.",
        "No cleanup command should be sent yet.",
      ].join("\n");
    }
    return "❌ **Verdict:** No Screwdriver Small found near the trade pad in the database copy.";
  }

  if (count < REQUIRED_COUNT) {
    return `⚠️ **Verdict:** Not enough. Detected **${count}/${REQUIRED_COUNT}** Screwdriver Small. Player needs to add **${REQUIRED_COUNT - count}** more.`;
  }
  if (count > REQUIRED_COUNT) {
    return `⚠️ **Verdict:** Too many. Detected **${count}/${REQUIRED_COUNT}** Screwdriver Small. Player needs to remove **${count - REQUIRED_COUNT}**.`;
  }
  return `✅ **Verdict:** Exact amount detected: **${count}/${REQUIRED_COUNT}** Screwdriver Small.`;
}

async function serverPostRaw(pathName, body = {}) {
  try {
    const res = await fetch(`${serverBaseUrl()}${pathName}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Password": serverPassword(),
      },
      body: JSON.stringify(body || {}),
    });

    const text = await res.text().catch(() => "");
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    return {
      path: pathName,
      httpOk: res.ok,
      ok: res.ok && data?.ok !== false,
      status: res.status,
      data,
      text: text.slice(0, 1200),
      error: data?.reason || data?.message || data?.error || (!res.ok ? `HTTP ${res.status}` : null),
    };
  } catch (err) {
    return { path: pathName, httpOk: false, ok: false, status: 0, data: null, text: "", error: err?.message || String(err) };
  }
}

function buildDestroyCommand() {
  const t = `{X=${TRADE_PAD_CENTER.x} Y=${TRADE_PAD_CENTER.y} Z=${TRADE_PAD_CENTER.z}|P=${TRADE_PAD_CENTER.pitch} Y=${TRADE_PAD_CENTER.yaw} R=${TRADE_PAD_CENTER.roll}}`;
  return `#DestroyAllItemsWithinRadius ${TRADE_ITEM_CLASS} ${DELETE_RADIUS_METERS} ${t}`;
}

function summarizeCommandResult(result) {
  if (!result) return "No command result.";
  const parts = [];
  parts.push(result.ok ? "✅ Cleanup command accepted by server API." : `❌ Cleanup command failed: ${result.error || `HTTP ${result.status}`}`);
  const dataText = result.data ? JSON.stringify(result.data).slice(0, 600) : "";
  if (dataText) parts.push(`Raw response: \`${dataText.replace(/`/g, "'")}\``);
  else if (result.text) parts.push(`Raw response: \`${String(result.text).replace(/`/g, "'")}\``);
  return parts.join("\n");
}

function buildScanReport(result, shouldDeleteIfExact, command, commandResult) {
  const scan = result?.scan;
  const near = scan?.nearMatches || [];
  const allMatches = scan?.matches || [];
  const tableLines = (scan?.tableSummaries || [])
    .slice(0, 8)
    .map((t) => `• ${t.table} — hits:${t.hits}${t.rowCount !== null ? ` — rows:${t.rowCount}` : ""}`);
  const nearLines = near.slice(0, 12).map(summarizeRow);
  const otherLines = allMatches.filter((m) => !m.nearPad).slice(0, 8).map(summarizeRow);

  const lines = [
    shouldDeleteIfExact ? "🧹 **SFTP Ground Trade Scan + Delete If Exact**" : "🔎 **SFTP Ground Trade Pad Scan**",
    "",
    `**Trade Pad:** ${formatLocation(TRADE_PAD_CENTER)}`,
    `**Required:** ${REQUIRED_COUNT}x \`${TRADE_ITEM_CLASS}\``,
    `**Detected Near Pad:** ${result?.ok ? `${scan?.totalNear || 0}x Screwdriver Small` : "Scan failed"}`,
    "",
    "**SFTP / DB:**",
  ];

  if (result?.ok) {
    lines.push(`✅ SCUM.db found: \`${result.found.path}\``);
    lines.push(`Temporary DB copy: deleted after scan`);
    if (result.walPresent) {
      lines.push(`⚠️ WAL file exists (${Math.round((result.walSize || 0) / 1024)} KB). Very recent item changes may not appear until the DB checkpoints.`);
    }
  } else {
    lines.push(`❌ ${result?.error || "SFTP scan failed."}`);
    if (result?.found?.checked?.length) {
      lines.push("Checked common paths first; recursive scan did not find a usable SCUM.db.");
    }
  }

  if (result?.ok) {
    lines.push("");
    lines.push("**Tables With Screwdriver Hits:**");
    lines.push(tableLines.length ? tableLines.join("\n") : "None.");
    lines.push("");
    lines.push("**Matches Near Trade Pad:**");
    lines.push(nearLines.length ? nearLines.join("\n") : "None found near pad.");
    lines.push("");
    lines.push("**Other Screwdriver Matches Not Counted:**");
    lines.push(otherLines.length ? otherLines.join("\n") : "None / not shown.");
  }

  lines.push("");
  lines.push(verdictForSftpCount(result));

  if (shouldDeleteIfExact) {
    const count = Number(scan?.totalNear || 0);
    lines.push("");
    if (!result?.ok) {
      lines.push("🛑 **Delete skipped:** SFTP count failed.");
    } else if (count !== REQUIRED_COUNT) {
      lines.push(`🛑 **Delete skipped:** count must be exactly ${REQUIRED_COUNT}.`);
    } else {
      lines.push("**Cleanup Command Sent:**");
      lines.push(`\`${command}\``);
      lines.push(summarizeCommandResult(commandResult));
      lines.push("");
      lines.push("Next safe trade step: spawn/give the yellow screwdriver only after cleanup succeeds.");
    }
  }

  return clampDiscord(lines.join("\n"));
}

async function runSftpGroundTradeScan(interaction, shouldDeleteIfExact = false) {
  await interaction.deferReply({ ephemeral: true }).catch(() => {});

  let result = null;
  let command = null;
  let commandResult = null;

  try {
    result = await downloadAndScanScumDb();

    if (shouldDeleteIfExact && result?.ok && Number(result.scan?.totalNear || 0) === REQUIRED_COUNT) {
      command = buildDestroyCommand();
      commandResult = await serverPostRaw("/command", { command });
    }
  } catch (err) {
    result = { ok: false, error: err?.message || String(err) };
  }

  await interaction.editReply(buildScanReport(result, shouldDeleteIfExact, command, commandResult)).catch(() => {});
}

async function handleSftpGroundTradeTestCommand(message) {
  const content = String(message.content || "").trim().toLowerCase();
  if (!["!sftpgroundtradetestsetup", "!sftpgroundtradeprobe", "!tradepadtestsetup"].includes(content)) return false;

  if (!isStaffMember(message.member)) {
    await message.reply("Only staff can post the SFTP ground trade test panel.").catch(() => {});
    return true;
  }

  await setupSftpGroundTradePanel(message);
  return true;
}

async function handleSftpGroundTradeTestInteraction(interaction) {
  if (!interaction.isButton?.()) return false;
  if (!String(interaction.customId || "").startsWith("sftpgroundtrade:")) return false;

  if (!isStaffMember(interaction.member)) {
    await interaction.reply({ content: "Only staff can run this hidden SFTP trade test.", ephemeral: true }).catch(() => {});
    return true;
  }

  if (interaction.customId === "sftpgroundtrade:scan") {
    await runSftpGroundTradeScan(interaction, false);
    return true;
  }

  if (interaction.customId === "sftpgroundtrade:auto_delete") {
    await runSftpGroundTradeScan(interaction, true);
    return true;
  }

  return false;
}

module.exports = {
  handleSftpGroundTradeTestCommand,
  handleSftpGroundTradeTestInteraction,
};
