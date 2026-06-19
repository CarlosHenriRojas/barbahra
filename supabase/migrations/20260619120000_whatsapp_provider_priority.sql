alter table integration_settings
  add column if not exists priority smallint not null default 1;

drop policy if exists "Members can manage integration metadata" on integration_settings;
create policy "Members can manage integration metadata" on integration_settings
for all using (
  exists (
    select 1 from profiles
    where profiles.organization_id = integration_settings.organization_id
      and profiles.id = auth.uid()
  )
)
with check (
  exists (
    select 1 from profiles
    where profiles.organization_id = integration_settings.organization_id
      and profiles.id = auth.uid()
  )
);
