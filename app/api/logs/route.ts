import { NextRequest, NextResponse } from "next/server";
import { authErrorResponse, requireAuthenticatedRequest } from "@/lib/server/auth";
import type { SystemLogEntry } from "@/lib/types";

export async function GET(request: NextRequest) {
  try {
    const { organizationId, supabase } = await requireAuthenticatedRequest(request);
    const limit = Math.min(
      Math.max(Number(new URL(request.url).searchParams.get("limit") ?? 100), 10),
      300
    );

    const eventsResult = await supabase
      .from("system_events")
      .select("id,type,title,detail,phone,created_at,campaigns(name)")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (eventsResult.error) throw eventsResult.error;

    const logs = (eventsResult.data ?? []).map(
      (event): SystemLogEntry => ({
        id: `event-${String(event.id)}`,
        type: normalizeType(event.type),
        title: String(event.title ?? "Evento"),
        detail: event.detail ? String(event.detail) : "",
        phone: event.phone ? String(event.phone) : undefined,
        campaignName: readString(event.campaigns, "name"),
        createdAt: String(event.created_at)
      })
    );

    return NextResponse.json({ ok: true, logs });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

function normalizeType(value: unknown): SystemLogEntry["type"] {
  const type = String(value);
  return type === "sent" ||
    type === "error" ||
    type === "webhook" ||
    type === "opt_out" ||
    type === "campaign" ||
    type === "worker"
    ? type
    : "webhook";
}

function readString(value: unknown, key: string) {
  const object = Array.isArray(value) ? value[0] : value;
  const nested =
    object && typeof object === "object" ? (object as Record<string, unknown>)[key] : undefined;
  return typeof nested === "string" && nested.trim() ? nested.trim() : undefined;
}
