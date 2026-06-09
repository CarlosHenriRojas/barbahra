import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, requireAuthenticatedRequest } from "@/lib/server/auth";

const createOptOutSchema = z.object({
  phone: z.string().min(10),
  reason: z.string().min(1).default("manual"),
  source: z.string().min(1).default("dashboard")
});

export async function GET(request: NextRequest) {
  try {
    const { organizationId, supabase } = await requireAuthenticatedRequest(request);
    const optOuts = await supabase
      .from("opt_outs")
      .select("id,phone,reason,source,created_at")
      .or(`organization_id.eq.${organizationId},organization_id.is.null`)
      .order("created_at", { ascending: false });

    if (optOuts.error) throw optOuts.error;

    return NextResponse.json({
      ok: true,
      optOuts: optOuts.data ?? []
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

export async function POST(request: NextRequest) {
  try {
    const { organizationId, supabase } = await requireAuthenticatedRequest(request);
    const payload = createOptOutSchema.parse(await request.json());
    const phone = payload.phone.replace(/\D/g, "");

    const existing = await supabase
      .from("opt_outs")
      .select("id")
      .eq("phone", phone)
      .maybeSingle();

    if (existing.error) throw existing.error;

    if (!existing.data) {
      const saved = await supabase.from("opt_outs").insert({
        organization_id: organizationId,
        phone,
        reason: payload.reason,
        source: payload.source
      });

      if (saved.error) throw saved.error;
    }

    const contacts = await supabase
      .from("contacts")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("phone", phone);

    if (contacts.error) throw contacts.error;

    const contactIds = (contacts.data ?? []).map((contact) => String(contact.id));

    if (contactIds.length) {
      const campaignContacts = await supabase
        .from("campaign_contacts")
        .select("id")
        .in("contact_id", contactIds);

      if (campaignContacts.error) throw campaignContacts.error;

      const campaignContactIds = (campaignContacts.data ?? []).map((row) => String(row.id));

      const contactUpdate = await supabase
        .from("contacts")
        .update({ status: "opt_out" })
        .in("id", contactIds);

      if (contactUpdate.error) throw contactUpdate.error;

      const campaignContactUpdate = await supabase
        .from("campaign_contacts")
        .update({
          status: "opt_out",
          validation_errors: ["Opt-out global"]
        })
        .in("contact_id", contactIds);

      if (campaignContactUpdate.error) throw campaignContactUpdate.error;

      if (campaignContactIds.length) {
        const jobsUpdate = await supabase
          .from("message_jobs")
          .update({ status: "opt_out", error: "Opt-out registrado" })
          .in("campaign_contact_id", campaignContactIds)
          .eq("status", "queued");

        if (jobsUpdate.error) throw jobsUpdate.error;
      }
    }

    return NextResponse.json({ ok: true, phone });
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
