import { NextRequest, NextResponse } from "next/server";
import { extractProviderMessageId } from "@/lib/server/provider-result";
import { createUazapiAdapter } from "@/lib/server/uazapi";
import { logSystemEvent } from "@/lib/server/events";
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

  const claimedJobs = (claimed.data ?? []) as ClaimedJob[];

  // Resolve the org/name for each claimed campaign so events stay org-scoped.
  const campaignMeta = await resolveCampaignMeta(supabase, claimedJobs);
  const runStats = new Map<string, { sent: number; error: number }>();
  const bumpRunStat = (orgId: string | null, key: "sent" | "error") => {
    if (!orgId) return;
    const current = runStats.get(orgId) ?? { sent: 0, error: 0 };
    current[key] += 1;
    runStats.set(orgId, current);
  };

  const results = [];

  for (const job of claimedJobs) {
    const meta = campaignMeta.get(job.campaign_id);
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

      bumpRunStat(meta?.organizationId ?? null, "sent");
      await logSystemEvent(supabase, {
        organizationId: meta?.organizationId ?? null,
        campaignId: job.campaign_id,
        type: "sent",
        title: "Mensagem enviada",
        detail: job.rendered_message.slice(0, 200),
        phone: job.phone,
        metadata: {
          jobId: job.job_id,
          providerMessageId,
          messageType: job.message_type
        }
      });

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

      bumpRunStat(meta?.organizationId ?? null, "error");
      await logSystemEvent(supabase, {
        organizationId: meta?.organizationId ?? null,
        campaignId: job.campaign_id,
        type: "error",
        title: "Erro no envio",
        detail: message,
        phone: job.phone,
        metadata: { jobId: job.job_id, messageType: job.message_type }
      });

      results.push({ jobId: job.job_id, status: "error", error: message });
    }
  }

  // One summary event per org that had activity in this run (avoids spamming the
  // log every minute when the queue is idle).
  for (const [orgId, stats] of runStats) {
    await logSystemEvent(supabase, {
      organizationId: orgId,
      type: "worker",
      title: "Rodada do worker",
      detail: `${stats.sent} enviada(s), ${stats.error} erro(s).`,
      metadata: { workerId, ...stats }
    });
  }

  await completeCampaignsWithoutQueuedJobs(supabase);

  return NextResponse.json({
    ok: true,
    workerId,
    claimed: claimedJobs.length,
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

async function resolveCampaignMeta(
  supabase: NonNullable<ReturnType<typeof createServiceSupabaseClient>>,
  jobs: ClaimedJob[]
) {
  const meta = new Map<string, { organizationId: string | null; name: string | null }>();
  const campaignIds = Array.from(new Set(jobs.map((job) => job.campaign_id)));
  if (!campaignIds.length) return meta;

  const campaigns = await supabase
    .from("campaigns")
    .select("id,organization_id,name")
    .in("id", campaignIds);

  for (const campaign of campaigns.data ?? []) {
    meta.set(String(campaign.id), {
      organizationId: campaign.organization_id ? String(campaign.organization_id) : null,
      name: campaign.name ? String(campaign.name) : null
    });
  }

  return meta;
}

async function completeCampaignsWithoutQueuedJobs(supabase: ReturnType<typeof createServiceSupabaseClient>) {
  if (!supabase) return;

  const runningCampaigns = await supabase
    .from("campaigns")
    .select("id,organization_id")
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

      await logSystemEvent(supabase, {
        organizationId: campaign.organization_id ? String(campaign.organization_id) : null,
        campaignId: String(campaign.id),
        type: "campaign",
        title: "Campanha concluída",
        detail: "Todos os envios da fila foram processados."
      });
    }
  }
}
