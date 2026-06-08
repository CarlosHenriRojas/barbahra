import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, requireAuthenticatedRequest } from "@/lib/server/auth";

const statusSchema = z.object({
  status: z.enum(["running", "paused", "cancelled"])
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  try {
    const { organizationId, supabase } = await requireAuthenticatedRequest(request);
    const { campaignId } = await params;
    const payload = statusSchema.parse(await request.json());
    const update = await supabase
      .from("campaigns")
      .update({ status: payload.status })
      .eq("id", campaignId)
      .eq("organization_id", organizationId);

    if (update.error) throw update.error;
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
