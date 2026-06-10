import type { SupabaseClient } from "@supabase/supabase-js";

export type SystemEventType =
  | "sent"
  | "error"
  | "webhook"
  | "opt_out"
  | "campaign"
  | "worker";

export type SystemEventInput = {
  organizationId?: string | null;
  campaignId?: string | null;
  type: SystemEventType;
  title: string;
  detail?: string | null;
  phone?: string | null;
  metadata?: Record<string, unknown>;
};

// Shared by both the service and the authenticated Supabase clients.
type InsertableClient = SupabaseClient;

function toRow(event: SystemEventInput) {
  return {
    organization_id: event.organizationId ?? null,
    campaign_id: event.campaignId ?? null,
    type: event.type,
    title: event.title,
    detail: event.detail ?? null,
    phone: event.phone ?? null,
    metadata: event.metadata ?? {}
  };
}

// Logging must never break the main flow: failures are swallowed on purpose.
export async function logSystemEvent(
  supabase: InsertableClient | null,
  event: SystemEventInput
) {
  if (!supabase) return;
  try {
    await supabase.from("system_events").insert(toRow(event));
  } catch {
    // ignore
  }
}

export async function logSystemEvents(
  supabase: InsertableClient | null,
  events: SystemEventInput[]
) {
  if (!supabase || !events.length) return;
  try {
    await supabase.from("system_events").insert(events.map(toRow));
  } catch {
    // ignore
  }
}
