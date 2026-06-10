create table if not exists system_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  campaign_id uuid references campaigns(id) on delete set null,
  type text not null,
  title text not null,
  detail text,
  phone text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists system_events_org_created_idx
  on system_events (organization_id, created_at desc);

alter table system_events enable row level security;

drop policy if exists "Members can read system events" on system_events;
create policy "Members can read system events" on system_events
for select using (
  organization_id is not null
  and exists (
    select 1 from profiles
    where profiles.organization_id = system_events.organization_id
    and profiles.id = auth.uid()
  )
);

drop policy if exists "Members can write system events" on system_events;
create policy "Members can write system events" on system_events
for insert with check (
  organization_id is not null
  and exists (
    select 1 from profiles
    where profiles.organization_id = system_events.organization_id
    and profiles.id = auth.uid()
  )
);
