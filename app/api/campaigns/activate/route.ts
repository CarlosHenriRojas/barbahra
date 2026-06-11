import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, requireAuthenticatedRequest } from "@/lib/server/auth";
import { logSystemEvent } from "@/lib/server/events";
import { campaignSnapshotSchema } from "@/lib/server/schemas";
import {
  isMissingAllocationPercentError,
  withoutAllocationPercent,
  type MessageVariantDbRow
} from "@/lib/server/variant-compat";

const activateCampaignSchema = z.object({
  campaignId: z.string().uuid(),
  campaign: campaignSnapshotSchema.shape.campaign.optional(),
  contacts: campaignSnapshotSchema.shape.contacts,
  variants: campaignSnapshotSchema.shape.variants,
  jobs: campaignSnapshotSchema.shape.jobs
});

const noEligibleJobsError =
  "A campanha nao tem contatos elegiveis para envio. Revise contatos, WhatsApp e modelos.";

type LinkedContactRow = {
  id: string;
  contact_id: string;
  contacts?: { phone?: string } | Array<{ phone?: string }>;
};

type JobInsert = {
  campaign_id: string;
  campaign_contact_id: string;
  message_variant_id: string;
  rendered_message: string;
  message_type: "text" | "buttons";
  buttons: Array<Record<string, unknown>>;
  status: "queued";
  error: string | undefined;
  scheduled_at: string | undefined;
  delay_seconds: number | undefined;
};

type ActivationDiagnostics = {
  requestId: string;
  counts: {
    payloadContacts: number;
    payloadJobs: number;
    payloadVariants: number;
    existingLinks: number;
    linkedByContactId: number;
    linkedByPhone: number;
    queuedJobsReceived: number;
    jobsToInsert: number;
  };
  droppedJobs: Record<string, number>;
  samples: Array<Record<string, unknown>>;
};

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();

  try {
    const { organizationId, supabase } = await requireAuthenticatedRequest(request);
    const payload = activateCampaignSchema.parse(await request.json());

    const campaign = await supabase
      .from("campaigns")
      .select("id,consent_basis")
      .eq("id", payload.campaignId)
      .eq("organization_id", organizationId)
      .single();

    if (campaign.error) throw campaign.error;

    const blockedPhonesResult = await supabase
      .from("opt_outs")
      .select("phone")
      .or(`organization_id.eq.${organizationId},organization_id.is.null`);

    if (blockedPhonesResult.error) throw blockedPhonesResult.error;

    const blockedPhones = new Set(
      (blockedPhonesResult.data ?? []).map((row) => String(row.phone))
    );

    const variantMap = new Map<string, string>();
    for (const variant of payload.variants) {
      const row: MessageVariantDbRow = {
        campaign_id: payload.campaignId,
        label: variant.label,
        body: variant.body,
        message_type: variant.messageType,
        allocation_percent: variant.allocationPercent,
        buttons: variant.buttons
      };
      let savedVariant = isUuid(variant.id)
        ? await supabase
            .from("message_variants")
            .upsert({ id: variant.id, ...row }, { onConflict: "id" })
            .select("id")
            .single()
        : await supabase.from("message_variants").insert(row).select("id").single();

      if (isMissingAllocationPercentError(savedVariant.error)) {
        savedVariant = isUuid(variant.id)
          ? await supabase
              .from("message_variants")
              .upsert(
                { id: variant.id, ...withoutAllocationPercent(row) },
                { onConflict: "id" }
              )
              .select("id")
              .single()
          : await supabase
              .from("message_variants")
              .insert(withoutAllocationPercent(row))
              .select("id")
              .single();
      }

      if (savedVariant.error) throw savedVariant.error;
      variantMap.set(variant.id, String(savedVariant.data.id));
    }

    const existingLinks = await supabase
      .from("campaign_contacts")
      .select("id,contact_id,contacts(phone)")
      .eq("campaign_id", payload.campaignId);

    if (existingLinks.error) throw existingLinks.error;

    const linkedRows = (existingLinks.data ?? []) as LinkedContactRow[];
    const campaignContactByContactId = new Map(
      linkedRows.map((link) => [link.contact_id, link.id])
    );
    const campaignContactByPhone = new Map(
      linkedRows
        .map((link) => {
          const contact = Array.isArray(link.contacts) ? link.contacts[0] : link.contacts;
          return contact?.phone ? [String(contact.phone), link] : undefined;
        })
        .filter((entry): entry is [string, LinkedContactRow] => Boolean(entry))
    );
    const payloadContactById = new Map(payload.contacts.map((contact) => [contact.id, contact]));
    const blockedContactIds = new Set(
      linkedRows
        .filter((link) => {
          const contact = Array.isArray(link.contacts) ? link.contacts[0] : link.contacts;
          return contact?.phone && blockedPhones.has(String(contact.phone));
        })
        .map((link) => link.contact_id)
    );

    for (const contact of payload.contacts) {
      const linkedContact = campaignContactByContactId.has(contact.id)
        ? { id: contact.id, campaignContactId: campaignContactByContactId.get(contact.id) }
        : campaignContactByPhone.has(contact.phone)
          ? {
              id: campaignContactByPhone.get(contact.phone)?.contact_id,
              campaignContactId: campaignContactByPhone.get(contact.phone)?.id
            }
          : undefined;

      if (!linkedContact?.id || !isUuid(linkedContact.id)) continue;

      const contactStatus =
        blockedPhones.has(contact.phone) ||
        contact.duplicate ||
        contact.status === "opt_out" ||
        contact.status === "no_whatsapp" ||
        contact.errors.length > 0
          ? blockedPhones.has(contact.phone)
            ? "opt_out"
            : contact.status
          : "queued";

      const contactUpdate = await supabase
        .from("contacts")
        .update({
          phone: contact.phone,
          status: contactStatus,
          whatsapp_status: contact.whatsappStatus,
          consent_basis: campaign.data.consent_basis
        })
        .eq("id", linkedContact.id)
        .eq("organization_id", organizationId);

      if (contactUpdate.error) throw contactUpdate.error;

      const campaignContactId = linkedContact.campaignContactId;
      if (campaignContactId) {
        const linkUpdate = await supabase
          .from("campaign_contacts")
          .update({
            status: contactStatus,
            validation_errors: contact.errors
          })
          .eq("id", campaignContactId);

        if (linkUpdate.error) throw linkUpdate.error;
      }
    }

    const deletedExistingJobs = await supabase
      .from("message_jobs")
      .delete()
      .eq("campaign_id", payload.campaignId);

    if (deletedExistingJobs.error) throw deletedExistingJobs.error;

    const diagnostics: ActivationDiagnostics = {
      requestId,
      counts: {
        payloadContacts: payload.contacts.length,
        payloadJobs: payload.jobs.length,
        payloadVariants: payload.variants.length,
        existingLinks: linkedRows.length,
        linkedByContactId: campaignContactByContactId.size,
        linkedByPhone: campaignContactByPhone.size,
        queuedJobsReceived: payload.jobs.filter((job) => job.status === "queued").length,
        jobsToInsert: 0
      },
      droppedJobs: {},
      samples: []
    };
    const dropJob = (
      reason: string,
      job: (typeof payload.jobs)[number],
      contactPhone?: string
    ) => {
      diagnostics.droppedJobs[reason] = (diagnostics.droppedJobs[reason] ?? 0) + 1;
      if (diagnostics.samples.length >= 12) return;
      diagnostics.samples.push({
        reason,
        jobId: job.id,
        jobContactId: job.contactId,
        jobContactIdIsUuid: isUuid(job.contactId),
        variantId: job.variantId,
        status: job.status,
        phoneHint: contactPhone ? maskPhone(contactPhone) : null
      });
    };

    const jobsToInsert = payload.jobs.reduce<JobInsert[]>((jobs, job) => {
      if (job.status !== "queued") {
        dropJob("status_not_queued", job);
        return jobs;
      }

      const contact = payloadContactById.get(job.contactId);
      const linkedContact = campaignContactByContactId.has(job.contactId)
        ? { contactId: job.contactId, campaignContactId: campaignContactByContactId.get(job.contactId) }
        : contact
          ? {
              contactId: campaignContactByPhone.get(contact.phone)?.contact_id,
              campaignContactId: campaignContactByPhone.get(contact.phone)?.id
            }
          : undefined;
      const campaignContactId = linkedContact?.campaignContactId;
      const messageVariantId = variantMap.get(job.variantId);

      if (!contact && !campaignContactByContactId.has(job.contactId)) {
        dropJob("missing_payload_contact", job);
        return jobs;
      }

      if (!campaignContactId) {
        dropJob("missing_campaign_contact", job, contact?.phone);
        return jobs;
      }

      if (!messageVariantId) {
        dropJob("missing_message_variant", job, contact?.phone);
        return jobs;
      }

      if (linkedContact?.contactId && blockedContactIds.has(linkedContact.contactId)) {
        dropJob("blocked_contact", job, contact?.phone);
        return jobs;
      }

      if (contact?.phone && blockedPhones.has(contact.phone)) {
        dropJob("blocked_phone", job, contact.phone);
        return jobs;
      }

      jobs.push({
        campaign_id: payload.campaignId,
        campaign_contact_id: campaignContactId,
        message_variant_id: messageVariantId,
        rendered_message: job.renderedMessage,
        message_type: job.messageType,
        buttons: job.buttons,
        status: "queued",
        error: job.error,
        scheduled_at: job.scheduledAt,
        delay_seconds: job.delaySeconds
      });

      return jobs;
    }, []);
    diagnostics.counts.jobsToInsert = jobsToInsert.length;

    console.log(
      JSON.stringify({
        scope: "campaign_activate",
        phase: "diagnostics",
        campaignId: payload.campaignId,
        organizationId,
        diagnostics
      })
    );

    if (!jobsToInsert.length) {
      await logSystemEvent(supabase, {
        organizationId,
        campaignId: payload.campaignId,
        type: "error",
        title: "Ativacao sem jobs elegiveis",
        detail: noEligibleJobsError,
        metadata: diagnostics
      });

      return NextResponse.json(
        {
          ok: false,
          error: noEligibleJobsError,
          diagnostics
        },
        { status: 422 }
      );
    }

    const insertedJobs = await supabase.from("message_jobs").insert(jobsToInsert);
    if (insertedJobs.error) throw insertedJobs.error;

    const campaignUpdate = await supabase
      .from("campaigns")
      .update({
        status: "running",
        ...(payload.campaign
          ? {
              name: payload.campaign.name,
              consent_basis: payload.campaign.consentBasis,
              min_interval_seconds: payload.campaign.sendingConfig.minIntervalSeconds,
              max_interval_seconds: payload.campaign.sendingConfig.maxIntervalSeconds,
              daily_start_time: payload.campaign.sendingConfig.dailyStartTime,
              daily_end_time: payload.campaign.sendingConfig.dailyEndTime
            }
          : {})
      })
      .eq("id", payload.campaignId)
      .eq("organization_id", organizationId);

    if (campaignUpdate.error) throw campaignUpdate.error;

    await logSystemEvent(supabase, {
      organizationId,
      campaignId: payload.campaignId,
      type: "campaign",
      title: "Campanha iniciada",
      detail: `${jobsToInsert.length} mensagem(ns) entraram na fila de envio.`,
      metadata: { queuedJobs: jobsToInsert.length, activationRequestId: requestId }
    });

    return NextResponse.json({
      ok: true,
      campaignId: payload.campaignId,
      queuedJobs: jobsToInsert.length
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    const status = error instanceof z.ZodError ? 422 : 500;
    console.error(
      JSON.stringify({
        scope: "campaign_activate",
        phase: "error",
        requestId,
        status,
        error:
          error instanceof z.ZodError
            ? error.issues
            : error instanceof Error
              ? error.message
              : "Unknown error"
      })
    );
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: error instanceof Error ? error.message : "Unknown error",
        issues: error instanceof z.ZodError ? error.issues : undefined
      },
      { status }
    );
  }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function maskPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 4) return digits;
  return `***${digits.slice(-4)}`;
}
