import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { buildQueueSchedule } from "@/lib/queue";
import { isRetryableWhatsappDisconnectError } from "@/lib/retryable-errors";
import { authErrorResponse, requireAuthenticatedRequest } from "@/lib/server/auth";
import { logSystemEvent } from "@/lib/server/events";

const retrySchema = z.object({
  jobIds: z.array(z.string().uuid()).min(1).max(300).optional()
});

type CampaignContactRow = {
  id: string;
  contact_id: string;
  status: string;
};

type ContactRow = {
  id: string;
  phone: string;
  status: string;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  try {
    const { organizationId, supabase } = await requireAuthenticatedRequest(request);
    const { campaignId } = await params;
    const body = await request.json().catch(() => ({}));
    const payload = retrySchema.parse(body);

    const campaign = await supabase
      .from("campaigns")
      .select(
        "id,name,min_interval_seconds,max_interval_seconds,daily_start_time,daily_end_time"
      )
      .eq("id", campaignId)
      .eq("organization_id", organizationId)
      .single();

    if (campaign.error) throw campaign.error;

    let jobsQuery = supabase
      .from("message_jobs")
      .select("id,campaign_contact_id,error")
      .eq("campaign_id", campaignId)
      .eq("status", "error");

    if (payload.jobIds) jobsQuery = jobsQuery.in("id", payload.jobIds);

    const jobsResult = await jobsQuery;
    if (jobsResult.error) throw jobsResult.error;

    const retryableJobs = (jobsResult.data ?? []).filter((job) =>
      isRetryableWhatsappDisconnectError(job.error ? String(job.error) : undefined)
    );

    if (!retryableJobs.length) {
      return NextResponse.json({ ok: true, retried: 0, skipped: 0 });
    }

    const campaignContactIds = retryableJobs.map((job) => String(job.campaign_contact_id));
    const linksResult = await supabase
      .from("campaign_contacts")
      .select("id,contact_id,status")
      .in("id", campaignContactIds);

    if (linksResult.error) throw linksResult.error;

    const links = (linksResult.data ?? []) as CampaignContactRow[];
    const contactIds = links.map((link) => link.contact_id);
    const contactsResult = await supabase
      .from("contacts")
      .select("id,phone,status")
      .eq("organization_id", organizationId)
      .in("id", contactIds);

    if (contactsResult.error) throw contactsResult.error;

    const contacts = (contactsResult.data ?? []) as ContactRow[];
    const optOutsResult = await supabase
      .from("opt_outs")
      .select("phone")
      .or(`organization_id.eq.${organizationId},organization_id.is.null`);

    if (optOutsResult.error) throw optOutsResult.error;

    const blockedPhones = new Set(
      (optOutsResult.data ?? []).map((row) => String(row.phone))
    );
    const contactById = new Map(contacts.map((contact) => [contact.id, contact]));
    const eligibleLinkIds = new Set(
      links
        .filter((link) => {
          const contact = contactById.get(link.contact_id);
          return (
            contact &&
            link.status !== "opt_out" &&
            link.status !== "no_whatsapp" &&
            contact.status !== "opt_out" &&
            contact.status !== "no_whatsapp" &&
            !blockedPhones.has(contact.phone)
          );
        })
        .map((link) => link.id)
    );
    const eligibleJobs = retryableJobs.filter((job) =>
      eligibleLinkIds.has(String(job.campaign_contact_id))
    );

    const schedule = buildQueueSchedule(eligibleJobs.length, {
      config: {
        minIntervalSeconds: Number(campaign.data.min_interval_seconds),
        maxIntervalSeconds: Number(campaign.data.max_interval_seconds),
        dailyStartTime: String(campaign.data.daily_start_time).slice(0, 5),
        dailyEndTime: String(campaign.data.daily_end_time).slice(0, 5)
      },
      startAt: new Date()
    });

    for (const [index, job] of eligibleJobs.entries()) {
      const updated = await supabase
        .from("message_jobs")
        .update({
          status: "queued",
          error: null,
          scheduled_at: schedule[index]?.scheduledAt.toISOString(),
          delay_seconds: schedule[index]?.delaySeconds,
          locked_at: null,
          locked_by: null
        })
        .eq("id", job.id)
        .eq("campaign_id", campaignId)
        .eq("status", "error");

      if (updated.error) throw updated.error;
    }

    const retriedLinkIds = Array.from(
      new Set(eligibleJobs.map((job) => String(job.campaign_contact_id)))
    );
    if (retriedLinkIds.length) {
      const linksUpdate = await supabase
        .from("campaign_contacts")
        .update({ status: "queued", validation_errors: [] })
        .in("id", retriedLinkIds);

      if (linksUpdate.error) throw linksUpdate.error;

      const campaignUpdate = await supabase
        .from("campaigns")
        .update({ status: "running" })
        .eq("id", campaignId)
        .eq("organization_id", organizationId);

      if (campaignUpdate.error) throw campaignUpdate.error;

      await logSystemEvent(supabase, {
        organizationId,
        campaignId,
        type: "campaign",
        title: "Erros 503 reenfileirados",
        detail: `${eligibleJobs.length} mensagem(ns) voltaram para a fila após a reconexão do WhatsApp.`,
        metadata: { retriedJobs: eligibleJobs.map((job) => String(job.id)) }
      });
    }

    return NextResponse.json({
      ok: true,
      retried: eligibleJobs.length,
      skipped: retryableJobs.length - eligibleJobs.length
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: error instanceof z.ZodError ? 422 : 500 }
    );
  }
}
