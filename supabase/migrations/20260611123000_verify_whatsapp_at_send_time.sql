drop function if exists claim_due_message_jobs(text, integer);

create or replace function claim_due_message_jobs(worker_id text, batch_size integer default 10)
returns table (
  job_id uuid,
  campaign_id uuid,
  campaign_contact_id uuid,
  contact_id uuid,
  phone text,
  whatsapp_status whatsapp_status,
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
      and contacts.status not in ('opt_out', 'no_whatsapp')
      and campaign_contacts.status not in ('opt_out', 'no_whatsapp')
      and contacts.whatsapp_status <> 'invalid'
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
    contacts.id,
    contacts.phone,
    contacts.whatsapp_status,
    claimed.rendered_message,
    claimed.message_type,
    claimed.buttons
  from claimed
  join campaign_contacts on campaign_contacts.id = claimed.campaign_contact_id
  join contacts on contacts.id = campaign_contacts.contact_id;
$$;
