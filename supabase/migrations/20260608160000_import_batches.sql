create table if not exists import_batches (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  file_name text not null,
  imported_count integer not null default 0,
  skipped_duplicates_count integer not null default 0,
  created_at timestamptz not null default now()
);

alter table import_batches enable row level security;

drop policy if exists "Members can manage import batches" on import_batches;

create policy "Members can manage import batches" on import_batches
for all using (
  exists (
    select 1 from campaigns
    join profiles on profiles.organization_id = campaigns.organization_id
    where campaigns.id = import_batches.campaign_id
    and profiles.id = auth.uid()
  )
);

alter table campaign_contacts
add column if not exists import_batch_id uuid references import_batches(id) on delete set null;
