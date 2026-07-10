create table if not exists public.watcher_player_links (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  discord_id text not null,
  discord_tag text,
  steam_id text,
  scum_name text,
  profile_id text,
  pending_code text,
  pending_expires_at timestamptz,
  linked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint watcher_player_links_unique_discord unique (guild_id, discord_id)
);

create index if not exists watcher_player_links_guild_steam_idx
on public.watcher_player_links (guild_id, steam_id);

create table if not exists public.watcher_vehicle_insurance (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  discord_id text not null,
  discord_tag text,
  steam_id text not null,
  player_name text,
  vehicle_id text not null,
  vehicle_type text not null,
  vehicle_class text not null,
  vehicle_name text,
  purchase_price integer not null default 0,
  status text not null default 'active',
  purchased_at timestamptz not null default now(),
  destroyed_at timestamptz,
  destroyed_location jsonb,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists watcher_vehicle_insurance_guild_steam_idx
on public.watcher_vehicle_insurance (guild_id, steam_id);

create index if not exists watcher_vehicle_insurance_vehicle_id_idx
on public.watcher_vehicle_insurance (guild_id, vehicle_id);

create unique index if not exists watcher_vehicle_insurance_one_open_type
on public.watcher_vehicle_insurance (guild_id, steam_id, vehicle_type)
where status in ('active', 'claim_available');

create table if not exists public.watcher_insurance_claims (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  policy_id uuid references public.watcher_vehicle_insurance(id) on delete cascade,
  discord_id text not null,
  steam_id text not null,
  player_name text,
  vehicle_id text not null,
  vehicle_type text not null,
  vehicle_class text not null,
  vehicle_name text,
  destruction_log_key text not null unique,
  destruction_time timestamptz,
  destruction_location jsonb,
  status text not null default 'available',
  raw_line text,
  redeemed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists watcher_insurance_claims_guild_discord_idx
on public.watcher_insurance_claims (guild_id, discord_id, status);

create index if not exists watcher_insurance_claims_policy_idx
on public.watcher_insurance_claims (policy_id);
