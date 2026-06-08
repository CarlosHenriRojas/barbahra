import { NextRequest, NextResponse } from "next/server";
import { authErrorResponse, requireAuthenticatedRequest } from "@/lib/server/auth";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string; contactId: string }> }
) {
  try {
    const { organizationId, supabase } = await requireAuthenticatedRequest(request);
    const { campaignId, contactId } = await params;
    const campaign = await supabase
      .from("campaigns")
      .select("id")
      .eq("id", campaignId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (campaign.error) throw campaign.error;
    if (!campaign.data) {
      return NextResponse.json({ ok: false, error: "Campanha não encontrada." }, { status: 404 });
    }

    const campaignContact = await supabase
      .from("campaign_contacts")
      .select("id")
      .eq("campaign_id", campaignId)
      .eq("contact_id", contactId)
      .maybeSingle();

    if (campaignContact.error) throw campaignContact.error;

    if (campaignContact.data?.id) {
      const jobDelete = await supabase
        .from("message_jobs")
        .delete()
        .eq("campaign_contact_id", campaignContact.data.id);
      if (jobDelete.error) throw jobDelete.error;

      const campaignContactDelete = await supabase
        .from("campaign_contacts")
        .delete()
        .eq("id", campaignContact.data.id);
      if (campaignContactDelete.error) throw campaignContactDelete.error;
    }

    const remainingLinks = await supabase
      .from("campaign_contacts")
      .select("id", { count: "exact", head: true })
      .eq("contact_id", contactId);

    if (remainingLinks.error) throw remainingLinks.error;

    if ((remainingLinks.count ?? 0) === 0) {
      const contactDelete = await supabase.from("contacts").delete().eq("id", contactId);
      if (contactDelete.error) throw contactDelete.error;
    }

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
