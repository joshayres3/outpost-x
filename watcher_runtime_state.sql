create table if not exists public.watcher_runtime_state (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists watcher_runtime_state_updated_at_idx
on public.watcher_runtime_state (updated_at);
