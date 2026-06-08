import { NextRequest, NextResponse } from "next/server";
import { extractProviderMessageId } from "@/lib/server/provider-result";
import { createUazapiAdapter } from "@/lib/server/uazapi";
import { createServiceSupabaseClient } from "@/lib/supabase/server";

type ClaimedJob = {
  job_id: string;
  campaign_id: string;
  campaign_contact_id: string;
  phone: string;
  rendered_message: string;
  message_type: "text" | "buttons";
  buttons: Array<{
    id: string;
    label: string;
    type: "reply" | "url" | "call" | "copy";
    value?: string;
    isOptOut?: boolean;
  }>;
};

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceSupabaseClient();
  if (!supabase) {
    return NextResponse.json(
      { ok: false, mode: "demo", error: "Supabase is not configured." },
      { status: 501 }
    );
  }

  const workerId = crypto.randomUUID();
  const batchSize = Number(process.env.QUEUE_WORKER_BATCH_SIZE ?? 5);
  const adapter = createUazapiAdapter();

  const claimed = await supabase.rpc("claim_due_message_jobs", {
    worker_id: workerId,
    batch_size: batchSize
  });

  if (claimed.error) {
    return NextResponse.json({ ok: false, error: claimed.error.message }, { status: 500 });
  }

  const results = [];

  for (const job of (claimed.data ?? []) as ClaimedJob[]) {
    try {
      const providerResult =
        job.message_type === "buttons"
          ? await adapter.sendButtonMessage({
              phone: job.phone,
              message: job.rendered_message,
              buttons: job.buttons,
              referenceId: job.job_id
            })
          : await adapter.sendTextMessage({
              phone: job.phone,
              message: job.rendered_message,
              referenceId: job.job_id
            });

      const providerMessageId = extractProviderMessageId(providerResult);

      await supabase
        .from("message_jobs")
        .update({
          status: "sent",
          provider_message_id: providerMessageId,
          sent_at: new Date().toISOString(),
          locked_at: null,
          locked_by: null,
          error: null
        })
        .eq("id", job.job_id);

      await supabase
        .from("campaign_contacts")
        .update({ status: "sent" })
        .eq("id", job.campaign_contact_id);

      results.push({ jobId: job.job_id, status: "sent" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown send error";

      await supabase
        .from("message_jobs")
        .update({
          status: "error",
          error: message,
          locked_at: null,
          locked_by: null
        })
        .eq("id", job.job_id);

      await supabase
        .from("campaign_contacts")
        .update({ status: "error", validation_errors: [message] })
        .eq("id", job.campaign_contact_id);

      results.push({ jobId: job.job_id, status: "error", error: message });
    }
  }

  await completeCampaignsWithoutQueuedJobs(supabase);

  return NextResponse.json({
    ok: true,
    workerId,
    claimed: claimed.data?.length ?? 0,
    results
  });
}

export async function GET(request: NextRequest) {
  return POST(request);
}

function isAuthorized(request: NextRequest) {
  const secret = process.env.QUEUE_WORKER_SECRET ?? process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";

  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const explicit = request.headers.get("x-worker-secret");
  return bearer === secret || explicit === secret;
}

async function completeCampaignsWithoutQueuedJobs(supabase: ReturnType<typeof createServiceSupabaseClient>) {
  if (!supabase) return;

  const runningCampaigns = await supabase
    .from("campaigns")
    .select("id")
    .eq("status", "running");

  if (runningCampaigns.error) return;

  for (const campaign of runningCampaigns.data ?? []) {
    const remaining = await supabase
      .from("message_jobs")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaign.id)
      .eq("status", "queued");

    if (!remaining.error && remaining.count === 0) {
      await supabase
        .from("campaigns")
        .update({ status: "completed" })
        .eq("id", campaign.id);
    }
  }
}
