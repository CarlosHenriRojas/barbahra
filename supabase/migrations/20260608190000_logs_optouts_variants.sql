alter table message_variants
add column if not exists allocation_percent integer not null default 0;

drop policy if exists "Members can read opt outs" on opt_outs;
drop policy if exists "Members can manage organization opt outs" on opt_outs;
drop policy if exists "Members can read webhook events" on webhook_events;

create policy "Members can read opt outs" on opt_outs
for select using (
  exists (
    select 1 from profiles
    where profiles.id = auth.uid()
  )
);

create policy "Members can manage organization opt outs" on opt_outs
for all using (
  organization_id is not null
  and exists (
    select 1 from profiles
    where profiles.organization_id = opt_outs.organization_id
    and profiles.id = auth.uid()
  )
)
with check (
  organization_id is not null
  and exists (
    select 1 from profiles
    where profiles.organization_id = opt_outs.organization_id
    and profiles.id = auth.uid()
  )
);

create policy "Members can read webhook events" on webhook_events
for select using (
  exists (
    select 1 from profiles
    where profiles.id = auth.uid()
  )
);
