import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, requireAuthenticatedRequest } from "@/lib/server/auth";
import { campaignSnapshotSchema } from "@/lib/server/schemas";
import type { CampaignStatus } from "@/lib/types";

const createCampaignSchema = z.object({
  campaign: campaignSnapshotSchema.shape.campaign,
  variants: campaignSnapshotSchema.shape.variants.optional()
});

export async function POST(request: NextRequest) {
  try {
    const { organizationId, supabase, userId } = await requireAuthenticatedRequest(request);
    const payload = createCampaignSchema.parse(await request.json());

    const insertedCampaign = await supabase
      .from("campaigns")
      .insert({
        organization_id: organizationId,
        name: payload.campaign.name,
        status: "draft",
        consent_basis: payload.campaign.consentBasis,
        min_interval_seconds: payload.campaign.sendingConfig.minIntervalSeconds,
        max_interval_seconds: payload.campaign.sendingConfig.maxIntervalSeconds,
        daily_start_time: payload.campaign.sendingConfig.dailyStartTime,
        daily_end_time: payload.campaign.sendingConfig.dailyEndTime,
        created_by: userId
      })
      .select(
        "id,name,status,consent_basis,min_interval_seconds,max_interval_seconds,daily_start_time,daily_end_time,created_at"
      )
      .single();

    if (insertedCampaign.error) throw insertedCampaign.error;

    for (const variant of payload.variants ?? []) {
      const insertedVariant = await supabase.from("message_variants").insert({
        campaign_id: insertedCampaign.data.id,
        label: variant.label,
        body: variant.body,
        message_type: variant.messageType,
        allocation_percent: variant.allocationPercent,
        buttons: variant.buttons
      });
      if (insertedVariant.error) throw insertedVariant.error;
    }

    return NextResponse.json({
      ok: true,
      campaign: mapCampaign(insertedCampaign.data),
      campaignId: insertedCampaign.data.id
    });
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

export async function GET(request: NextRequest) {
  try {
    const { organizationId, supabase } = await requireAuthenticatedRequest(request);
    const campaigns = await supabase
      .from("campaigns")
      .select(
        "id,name,status,consent_basis,min_interval_seconds,max_interval_seconds,daily_start_time,daily_end_time,created_at"
      )
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false });

    if (campaigns.error) throw campaigns.error;

    return NextResponse.json({
      ok: true,
      campaigns: (campaigns.data ?? []).map(mapCampaign)
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

function normalizeDbTime(value: string) {
  return value.slice(0, 5);
}

function mapCampaign(campaign: {
  id: string;
  name: string;
  status: CampaignStatus;
  consent_basis: string;
  min_interval_seconds: number;
  max_interval_seconds: number;
  daily_start_time: string;
  daily_end_time: string;
  created_at: string;
}) {
  return {
    id: String(campaign.id),
    name: String(campaign.name),
    status: campaign.status as CampaignStatus,
    consentBasis: String(campaign.consent_basis),
    createdAt: String(campaign.created_at),
    sendingConfig: {
      minIntervalSeconds: Number(campaign.min_interval_seconds),
      maxIntervalSeconds: Number(campaign.max_interval_seconds),
      dailyStartTime: normalizeDbTime(String(campaign.daily_start_time)),
      dailyEndTime: normalizeDbTime(String(campaign.daily_end_time))
    }
  };
}
