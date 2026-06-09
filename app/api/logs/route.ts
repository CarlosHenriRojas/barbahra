import { NextRequest, NextResponse } from "next/server";
import { authErrorResponse, requireAuthenticatedRequest } from "@/lib/server/auth";
import type { SystemLogEntry } from "@/lib/types";

export async function GET(request: NextRequest) {
  try {
    const { organizationId, supabase } = await requireAuthenticatedRequest(request);
    const limit = Math.min(
      Math.max(Number(new URL(request.url).searchParams.get("limit") ?? 80), 10),
      200
    );

    const [jobsResult, webhooksResult, optOutsResult] = await Promise.all([
      supabase
        .from("message_jobs")
        .select(
          "id,status,error,rendered_message,sent_at,created_at,campaigns(name),campaign_contacts(contacts(name,phone))"
        )
        .in("status", ["sent", "error"])
        .order("created_at", { ascending: false })
        .limit(limit),
      supabase
        .from("webhook_events")
        .select("id,phone,event_type,external_message_id,created_at,payload")
        .order("created_at", { ascending: false })
        .limit(limit),
      supabase
        .from("opt_outs")
        .select("id,phone,reason,source,created_at")
        .or(`organization_id.eq.${organizationId},organization_id.is.null`)
        .order("created_at", { ascending: false })
        .limit(limit)
    ]);

    if (jobsResult.error) throw jobsResult.error;
    if (webhooksResult.error) throw webhooksResult.error;
    if (optOutsResult.error) throw optOutsResult.error;

    const jobLogs = (jobsResult.data ?? []).map((job): SystemLogEntry => {
      const status = String(job.status);
      const contact = readNestedObject(job.campaign_contacts, "contacts");
      const campaign = readObject(job.campaigns);
      const phone = readString(contact, "phone");
      const contactName = readString(contact, "name");
      const error = readString(job, "error");

      return {
        id: `job-${String(job.id)}`,
        type: status === "error" ? "error" : "sent",
        title: status === "error" ? "Erro no envio" : "Mensagem enviada",
        detail:
          status === "error"
            ? error || "Falha sem detalhe informado pelo provedor."
            : String(job.rendered_message ?? "").slice(0, 180),
        phone,
        campaignName: readString(campaign, "name"),
        createdAt: String(job.sent_at ?? job.created_at),
        ...(contactName ? { title: `${status === "error" ? "Erro" : "Envio"}: ${contactName}` } : {})
      };
    });

    const webhookLogs = (webhooksResult.data ?? []).map(
      (event): SystemLogEntry => ({
        id: `webhook-${String(event.id)}`,
        type: String(event.event_type) === "opt_out" ? "opt_out" : "webhook",
        title: String(event.event_type) === "opt_out" ? "Opt-out por webhook" : "Webhook recebido",
        detail: event.external_message_id
          ? `Mensagem externa ${String(event.external_message_id)}`
          : String(event.event_type),
        phone: event.phone ? String(event.phone) : undefined,
        createdAt: String(event.created_at)
      })
    );

    const optOutLogs = (optOutsResult.data ?? []).map(
      (optOut): SystemLogEntry => ({
        id: `opt-out-${String(optOut.id)}`,
        type: "opt_out",
        title: "Opt-out registrado",
        detail: `${String(optOut.reason)} via ${String(optOut.source)}`,
        phone: String(optOut.phone),
        createdAt: String(optOut.created_at)
      })
    );

    return NextResponse.json({
      ok: true,
      logs: [...jobLogs, ...webhookLogs, ...optOutLogs]
        .sort(
          (left, right) =>
            new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
        )
        .slice(0, limit)
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

function readNestedObject(value: unknown, key: string) {
  return readObject(readObject(value)?.[key]);
}

function readObject(value: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(value)) return readObject(value[0]);
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function readString(value: unknown, key: string) {
  const object = readObject(value);
  const nested = object?.[key];
  return typeof nested === "string" && nested.trim() ? nested.trim() : undefined;
}
