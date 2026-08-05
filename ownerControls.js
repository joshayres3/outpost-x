const PERMISSIONS_TABLE = process.env.WATCHER_PORTAL_PERMISSIONS_TABLE || 'watcher_portal_permissions';

const PERMISSION_DEFS = [
  ['view_admin_tools','View Admin Tools',true,false],
  ['search_players','Search / View Players',true,false],
  ['adjust_balances','Manage Cash and Fame',true,true],
  ['jail_release','Jail / Release Players',true,true],
  ['ban_unban','Ban / Unban Players',true,true],
  ['view_transactions','View Transaction Ledger',true,false],
  ['issue_refunds','Issue Full or Partial Refunds',true,true],
  ['moderate_player_shops','Moderate Player Shops',true,false],
  ['moderate_player_lore','Moderate Player Lore',true,false],
  ['moderate_squads','Moderate Squad Listings',true,false],
  ['use_surveillance','Use Surveillance',true,true],
  ['teleport_surveillance','Teleport from Surveillance',true,true],
  ['manage_events','Manage Events',true,false],
  ['manage_server_shop','Open Server Shop Manager',false,true],
  ['edit_shop_products','Create and Edit Shop Products',false,true],
  ['edit_shop_prices','Change Shop Prices',false,true],
  ['delete_shop_products','Delete Shop Products',false,true],
];

const DEFAULT_ADMIN_PERMISSIONS = Object.fromEntries(PERMISSION_DEFS.map(([key,,enabled]) => [key, enabled]));
const DANGEROUS_KEYS = new Set(PERMISSION_DEFS.filter(([, , , dangerous]) => dangerous).map(([key]) => key));

async function getAdminPermissions(db, guildId) {
  const { data, error } = await db.from(PERMISSIONS_TABLE).select('permissions').eq('guild_id', String(guildId)).maybeSingle();
  if (error) {
    if (String(error.message || '').toLowerCase().includes('does not exist')) return { ...DEFAULT_ADMIN_PERMISSIONS };
    throw error;
  }
  return { ...DEFAULT_ADMIN_PERMISSIONS, ...(data?.permissions || {}) };
}

async function saveAdminPermissions(db, guildId, permissions, updatedBy) {
  const clean = {};
  for (const [key] of PERMISSION_DEFS) clean[key] = permissions?.[key] === true;
  const { data, error } = await db.from(PERMISSIONS_TABLE).upsert({
    guild_id: String(guildId),
    permissions: clean,
    updated_by: String(updatedBy || ''),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'guild_id' }).select('*').single();
  if (error) throw error;
  return data;
}

async function canUse(db, session, key) {
  if (session?.isOwner) return true;
  if (!session?.isAdmin) return false;
  const permissions = await getAdminPermissions(db, session.guildId);
  return permissions[key] === true;
}

function permissionCatalog() {
  return PERMISSION_DEFS.map(([key, label, defaultAdmin, dangerous]) => ({ key, label, defaultAdmin, dangerous }));
}

module.exports = {
  DEFAULT_ADMIN_PERMISSIONS,
  DANGEROUS_KEYS,
  getAdminPermissions,
  saveAdminPermissions,
  canUse,
  permissionCatalog,
};
