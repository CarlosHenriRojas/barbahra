import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, requireAuthenticatedRequest } from "@/lib/server/auth";
import { createUazapiAdapter } from "@/lib/server/uazapi";

const sendRequestSchema = z.object({
  phone: z.string().min(10),
  message: z.string().min(1),
  consentConfirmed: z.literal(true),
  referenceId: z.string().optional()
});

export async function POST(request: NextRequest) {
  try {
    await requireAuthenticatedRequest(request);
    const payload = sendRequestSchema.parse(await request.json());
    const data = await createUazapiAdapter().sendTextMessage(payload);
    return NextResponse.json({ ok: true, data });
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
