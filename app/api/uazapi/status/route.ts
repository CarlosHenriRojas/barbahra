import { NextRequest, NextResponse } from "next/server";
import { authErrorResponse, requireAuthenticatedRequest } from "@/lib/server/auth";
import { createUazapiAdapter } from "@/lib/server/uazapi";

export async function GET(request: NextRequest) {
  try {
    await requireAuthenticatedRequest(request);
    const data = await createUazapiAdapter().checkInstanceStatus();
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
