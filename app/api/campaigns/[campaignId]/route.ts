import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, requireAuthenticatedRequest } from "@/lib/server/auth";
import { campaignSnapshotSchema } from "@/lib/server/schemas";
import {
  isMissingAllocationPercentError,
  withoutAllocationPercent,
  type MessageVariantDbRow
} from "@/lib/server/variant-compat";
import type {
  CampaignStatus,
  ContactStatus,
  MessageButton,
  MessageJob,
  MessageType,
  MessageVariant,
  WhatsappStatus
} from "@/lib/types";

type CampaignContactRow = {
  id: string;
  contact_id: string;
  status: ContactStatus;
  validation_errors: string[] | null;
};

type ContactFieldRow = {
  field_key: string;
  field_value: string | null;
};

type ContactRow = {
  id: string;
  name: string;
  phone: string;
  company: string | null;
  status: ContactStatus;
  whatsapp_status: WhatsappStatus;
  contact_custom_fields?: ContactFieldRow[];
};

type MessageVariantRow = {
  id: unknown;
  label: unknown;
  body: unknown;
  message_type: unknown;
  buttons: unknown;
  allocation_percent?: unknown;
};

const updateCampaignSchema = z.object({
  campaign: campaignSnapshotSchema.shape.campaign,
  variants: campaignSnapshotSchema.shape.variants.optional()
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  try {
    const { organizationId, supabase } = await requireAuthenticatedRequest(request);
    const { campaignId } = await params;
    const campaignResult = await supabase
      .from("campaigns")
      .select(
        "id,name,status,consent_basis,min_interval_seconds,max_interval_seconds,daily_start_time,daily_end_time,created_at"
      )
      .eq("id", campaignId)
      .eq("organization_id", organizationId)
      .single();

    if (campaignResult.error) throw campaignResult.error;
    const campaignRow = campaignResult.data;

    const [campaignContactsResult, variantsResultWithAllocation, jobsResult] = await Promise.all([
      supabase
        .from("campaign_contacts")
        .select("id,contact_id,status,validation_errors")
        .eq("campaign_id", campaignId),
      supabase
        .from("message_variants")
        .select("id,label,body,message_type,buttons,allocation_percent")
        .eq("campaign_id", campaignId)
        .order("created_at", { ascending: true }),
      supabase
        .from("message_jobs")
        .select(
          "id,campaign_id,campaign_contact_id,message_variant_id,rendered_message,message_type,buttons,status,error,sent_at,scheduled_at,delay_seconds"
        )
        .eq("campaign_id", campaignId)
        .order("scheduled_at", { ascending: true })
    ]);

    if (campaignContactsResult.error) throw campaignContactsResult.error;
    const variantsResult = isMissingAllocationPercentError(variantsResultWithAllocation.error)
      ? await supabase
          .from("message_variants")
          .select("id,label,body,message_type,buttons")
          .eq("campaign_id", campaignId)
          .order("created_at", { ascending: true })
      : variantsResultWithAllocation;
    if (variantsResult.error) throw variantsResult.error;
    if (jobsResult.error) throw jobsResult.error;

    const campaignContacts = (campaignContactsResult.data ?? []) as CampaignContactRow[];
    const contactIds = campaignContacts.map((row) => row.contact_id);
    const contactsResult = contactIds.length
      ? await supabase
          .from("contacts")
          .select("id,name,phone,company,status,whatsapp_status,contact_custom_fields(field_key,field_value)")
          .in("id", contactIds)
      : { data: [], error: null };

    if (contactsResult.error) throw contactsResult.error;

    const contactById = new Map(
      ((contactsResult.data ?? []) as ContactRow[]).map((contact) => [contact.id, contact])
    );
    const campaignContactById = new Map(campaignContacts.map((row) => [row.id, row]));

    const contacts = campaignContacts.reduce((acc, campaignContact) => {
      const contact = contactById.get(campaignContact.contact_id);
      if (!contact) return acc;

      acc.push({
        id: contact.id,
        name: contact.name,
        phone: contact.phone,
        company: contact.company ?? undefined,
        customFields: Object.fromEntries(
          (contact.contact_custom_fields ?? []).map((field) => [
            field.field_key,
            field.field_value ?? ""
          ])
        ),
        status: campaignContact.status,
        whatsappStatus: contact.whatsapp_status,
        errors: campaignContact.validation_errors ?? [],
        duplicate: false
      });

      return acc;
    }, [] as Array<{
      id: string;
      name: string;
      phone: string;
      company?: string;
      customFields: Record<string, string>;
      status: ContactStatus;
      whatsappStatus: WhatsappStatus;
      errors: string[];
      duplicate: boolean;
    }>);

    const mappedVariants = ((variantsResult.data ?? []) as MessageVariantRow[]).map(
      (variant): MessageVariant => ({
        id: String(variant.id),
        label: String(variant.label),
        body: String(variant.body),
        messageType: variant.message_type as MessageType,
        buttons: readButtons(variant.buttons),
        allocationPercent:
          typeof variant.allocation_percent === "number"
            ? Number(variant.allocation_percent)
            : 0
      })
    );
    const variants = withDefaultAllocation(mappedVariants);

    const jobs = (jobsResult.data ?? []).map((job): MessageJob => {
      const campaignContact = campaignContactById.get(String(job.campaign_contact_id));
      return {
        id: String(job.id),
        campaignId: String(job.campaign_id),
        contactId: campaignContact?.contact_id ?? "",
        variantId: String(job.message_variant_id),
        renderedMessage: String(job.rendered_message),
        messageType: job.message_type as MessageType,
        buttons: readButtons(job.buttons),
        status: job.status as ContactStatus,
        error: job.error ? String(job.error) : undefined,
        sentAt: job.sent_at ? String(job.sent_at) : undefined,
        scheduledAt: job.scheduled_at ? String(job.scheduled_at) : undefined,
        delaySeconds:
          typeof job.delay_seconds === "number" ? Number(job.delay_seconds) : undefined
      };
    });

    return NextResponse.json({
      ok: true,
      campaign: {
        id: String(campaignRow.id),
        name: String(campaignRow.name),
        status: campaignRow.status as CampaignStatus,
        consentBasis: String(campaignRow.consent_basis),
        createdAt: String(campaignRow.created_at),
        sendingConfig: {
          minIntervalSeconds: Number(campaignRow.min_interval_seconds),
          maxIntervalSeconds: Number(campaignRow.max_interval_seconds),
          dailyStartTime: normalizeDbTime(String(campaignRow.daily_start_time)),
          dailyEndTime: normalizeDbTime(String(campaignRow.daily_end_time))
        }
      },
      contacts,
      variants,
      jobs
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  try {
    const { organizationId, supabase } = await requireAuthenticatedRequest(request);
    const { campaignId } = await params;
    const payload = updateCampaignSchema.parse(await request.json());

    const campaignUpdate = await supabase
      .from("campaigns")
      .update({
        name: payload.campaign.name,
        consent_basis: payload.campaign.consentBasis,
        min_interval_seconds: payload.campaign.sendingConfig.minIntervalSeconds,
        max_interval_seconds: payload.campaign.sendingConfig.maxIntervalSeconds,
        daily_start_time: payload.campaign.sendingConfig.dailyStartTime,
        daily_end_time: payload.campaign.sendingConfig.dailyEndTime
      })
      .eq("id", campaignId)
      .eq("organization_id", organizationId);

    if (campaignUpdate.error) throw campaignUpdate.error;

    for (const variant of payload.variants ?? []) {
      const row: MessageVariantDbRow = {
        campaign_id: campaignId,
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
        : await supabase.from("message_variants").insert(row);

      if (isMissingAllocationPercentError(savedVariant.error)) {
        savedVariant = isUuid(variant.id)
          ? await supabase
              .from("message_variants")
              .upsert(
                { id: variant.id, ...withoutAllocationPercent(row) },
                { onConflict: "id" }
              )
          : await supabase.from("message_variants").insert(withoutAllocationPercent(row));
      }

      if (savedVariant.error) throw savedVariant.error;
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    const status = error instanceof z.ZodError ? 422 : 500;
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  try {
    const { organizationId, supabase } = await requireAuthenticatedRequest(request);
    const { campaignId } = await params;
    const deleted = await supabase
      .from("campaigns")
      .delete()
      .eq("id", campaignId)
      .eq("organization_id", organizationId);

    if (deleted.error) throw deleted.error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

function readButtons(value: unknown): MessageButton[] {
  return Array.isArray(value) ? (value as MessageButton[]) : [];
}

function normalizeDbTime(value: string) {
  return value.slice(0, 5);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function withDefaultAllocation(variants: MessageVariant[]) {
  const total = variants.reduce((sum, variant) => sum + variant.allocationPercent, 0);
  if (total > 0 || !variants.length) return variants;

  const base = Math.floor(100 / variants.length);
  const remainder = 100 - base * variants.length;

  return variants.map((variant, index) => ({
    ...variant,
    allocationPercent: base + (index < remainder ? 1 : 0)
  }));
}
