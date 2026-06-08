create extension if not exists "pgcrypto";

create type campaign_status as enum ('draft', 'ready', 'running', 'paused', 'completed', 'cancelled');
create type contact_status as enum ('imported', 'queued', 'sent', 'error', 'replied', 'opt_out', 'no_whatsapp');
create type whatsapp_status as enum ('unchecked', 'checking', 'valid', 'invalid');
create type message_type as enum ('text', 'buttons');

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  full_name text,
  role text not null default 'admin',
  created_at timestamptz not null default now()
);

create table contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  phone text not null,
  company text,
  status contact_status not null default 'imported',
  whatsapp_status whatsapp_status not null default 'unchecked',
  consent_basis text not null,
  source_file_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, phone)
);

create table contact_custom_fields (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references contacts(id) on delete cascade,
  field_key text not null,
  field_value text,
  unique (contact_id, field_key)
);

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  status campaign_status not null default 'draft',
  consent_basis text not null,
  min_interval_seconds integer not null default 45,
  max_interval_seconds integer not null default 120,
  daily_start_time time not null default '09:00',
  daily_end_time time not null default '18:00',
  source_file_path text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table campaign_contacts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  status contact_status not null default 'imported',
  validation_errors text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (campaign_id, contact_id)
);

create table message_variants (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  label text not null,
  body text not null,
  message_type message_type not null default 'buttons',
  buttons jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table message_jobs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  campaign_contact_id uuid not null references campaign_contacts(id) on delete cascade,
  message_variant_id uuid not null references message_variants(id),
  rendered_message text not null,
  message_type message_type not null default 'buttons',
  buttons jsonb not null default '[]',
  status contact_status not null default 'queued',
  provider_message_id text,
  error text,
  scheduled_at timestamptz,
  delay_seconds integer,
  sent_at timestamptz,
  locked_at timestamptz,
  locked_by text,
  attempt_count integer not null default 0,
  last_attempt_at timestamptz,
  created_at timestamptz not null default now()
);

create table opt_outs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  phone text not null unique,
  reason text not null,
  source text not null,
  created_at timestamptz not null default now()
);

create table integration_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  provider text not null default 'uazapi',
  base_url text,
  token_secret_name text not null default 'UAZAPI_TOKEN',
  webhook_secret_name text not null default 'UAZAPI_WEBHOOK_SECRET',
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider)
);

create table webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  external_message_id text,
  phone text,
  event_type text not null,
  payload jsonb not null,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger contacts_set_updated_at
before update on contacts
for each row execute procedure set_updated_at();

create trigger campaigns_set_updated_at
before update on campaigns
for each row execute procedure set_updated_at();

create trigger integration_settings_set_updated_at
before update on integration_settings
for each row execute procedure set_updated_at();

alter table organizations enable row level security;
alter table profiles enable row level security;
alter table contacts enable row level security;
alter table contact_custom_fields enable row level security;
alter table campaigns enable row level security;
alter table campaign_contacts enable row level security;
alter table message_variants enable row level security;
alter table message_jobs enable row level security;
alter table opt_outs enable row level security;
alter table integration_settings enable row level security;
alter table webhook_events enable row level security;

create policy "Profiles can read own profile" on profiles
for select using (id = auth.uid());

create policy "Organization members can read organization" on organizations
for select using (
  exists (
    select 1 from profiles
    where profiles.organization_id = organizations.id
    and profiles.id = auth.uid()
  )
);

create policy "Members can manage contacts" on contacts
for all using (
  exists (
    select 1 from profiles
    where profiles.organization_id = contacts.organization_id
    and profiles.id = auth.uid()
  )
);

create policy "Members can manage campaigns" on campaigns
for all using (
  exists (
    select 1 from profiles
    where profiles.organization_id = campaigns.organization_id
    and profiles.id = auth.uid()
  )
);

create policy "Members can manage contact fields" on contact_custom_fields
for all using (
  exists (
    select 1 from contacts
    join profiles on profiles.organization_id = contacts.organization_id
    where contacts.id = contact_custom_fields.contact_id
    and profiles.id = auth.uid()
  )
);

create policy "Members can manage campaign contacts" on campaign_contacts
for all using (
  exists (
    select 1 from campaigns
    join profiles on profiles.organization_id = campaigns.organization_id
    where campaigns.id = campaign_contacts.campaign_id
    and profiles.id = auth.uid()
  )
);

create policy "Members can manage variants" on message_variants
for all using (
  exists (
    select 1 from campaigns
    join profiles on profiles.organization_id = campaigns.organization_id
    where campaigns.id = message_variants.campaign_id
    and profiles.id = auth.uid()
  )
);

create policy "Members can manage jobs" on message_jobs
for all using (
  exists (
    select 1 from campaigns
    join profiles on profiles.organization_id = campaigns.organization_id
    where campaigns.id = message_jobs.campaign_id
    and profiles.id = auth.uid()
  )
);

create policy "Members can read integration metadata" on integration_settings
for select using (
  exists (
    select 1 from profiles
    where profiles.organization_id = integration_settings.organization_id
    and profiles.id = auth.uid()
  )
);

create or replace function claim_due_message_jobs(worker_id text, batch_size integer default 10)
returns table (
  job_id uuid,
  campaign_id uuid,
  campaign_contact_id uuid,
  phone text,
  rendered_message text,
  message_type message_type,
  buttons jsonb
)
language sql
security definer
as $$
  with candidates as (
    select message_jobs.id
    from message_jobs
    join campaigns on campaigns.id = message_jobs.campaign_id
    join campaign_contacts on campaign_contacts.id = message_jobs.campaign_contact_id
    join contacts on contacts.id = campaign_contacts.contact_id
    where message_jobs.status = 'queued'
      and campaigns.status = 'running'
      and contacts.status <> 'opt_out'
      and contacts.whatsapp_status = 'valid'
      and (message_jobs.scheduled_at is null or message_jobs.scheduled_at <= now())
      and (
        message_jobs.locked_at is null
        or message_jobs.locked_at < now() - interval '5 minutes'
      )
    order by message_jobs.scheduled_at nulls first, message_jobs.created_at
    limit batch_size
    for update skip locked
  ),
  claimed as (
    update message_jobs
    set locked_at = now(),
        locked_by = worker_id,
        attempt_count = attempt_count + 1,
        last_attempt_at = now()
    from candidates
    where message_jobs.id = candidates.id
    returning message_jobs.id,
      message_jobs.campaign_id,
      message_jobs.campaign_contact_id,
      message_jobs.rendered_message,
      message_jobs.message_type,
      message_jobs.buttons
  )
  select claimed.id,
    claimed.campaign_id,
    claimed.campaign_contact_id,
    contacts.phone,
    claimed.rendered_message,
    claimed.message_type,
    claimed.buttons
  from claimed
  join campaign_contacts on campaign_contacts.id = claimed.campaign_contact_id
  join contacts on contacts.id = campaign_contacts.contact_id;
$$;
