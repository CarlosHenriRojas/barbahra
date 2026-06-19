import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, requireAuthenticatedRequest } from "@/lib/server/auth";
import type { WhatsappProviderName } from "@/lib/server/whatsapp-provider";

const settingsSchema = z
  .object({
    primary: z.enum(["uazapi", "evolution"]),
    enabled: z.object({
      uazapi: z.boolean(),
      evolution: z.boolean()
    })
  })
  .refine((value) => value.enabled.uazapi || value.enabled.evolution, {
    message: "Ative ao menos um provedor de WhatsApp."
  })
  .refine((value) => value.enabled[value.primary], {
    message: "O provedor principal precisa estar ativo."
  });

export async function GET(request: NextRequest) {
  try {
    const { organizationId, supabase } = await requireAuthenticatedRequest(request);
    const result = await supabase
      .from("integration_settings")
      .select("provider,enabled,priority")
      .eq("organization_id", organizationId)
      .in("provider", ["uazapi", "evolution"]);

    if (result.error) throw result.error;
    return NextResponse.json({ ok: true, settings: settingsFromRows(result.data ?? []) });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    return NextResponse.json({ ok: false, error: errorMessage(error) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { organizationId, supabase } = await requireAuthenticatedRequest(request);
    const settings = settingsSchema.parse(await request.json());
    const rows = (["uazapi", "evolution"] as const).map((provider) => ({
      organization_id: organizationId,
      provider,
      enabled: settings.enabled[provider],
      priority: provider === settings.primary ? 1 : 2,
      token_secret_name: provider === "uazapi" ? "UAZAPI_TOKEN" : "EVOLUTION_API_KEY",
      webhook_secret_name:
        provider === "uazapi" ? "UAZAPI_WEBHOOK_SECRET" : "EVOLUTION_WEBHOOK_SECRET"
    }));
    const saved = await supabase
      .from("integration_settings")
      .upsert(rows, { onConflict: "organization_id,provider" });

    if (saved.error) throw saved.error;
    return NextResponse.json({ ok: true, settings });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    const status = error instanceof z.ZodError ? 422 : 500;
    return NextResponse.json({ ok: false, error: errorMessage(error) }, { status });
  }
}

function settingsFromRows(rows: Array<{ provider: string; enabled: boolean; priority: number }>) {
  const knownRows = rows.filter(
    (row): row is typeof row & { provider: WhatsappProviderName } =>
      row.provider === "uazapi" || row.provider === "evolution"
  );
  if (!knownRows.length) {
    return { primary: "uazapi" as const, enabled: { uazapi: true, evolution: true } };
  }
  const primary = [...knownRows].sort((a, b) => a.priority - b.priority)[0].provider;
  return {
    primary,
    enabled: {
      uazapi: knownRows.find((row) => row.provider === "uazapi")?.enabled ?? false,
      evolution: knownRows.find((row) => row.provider === "evolution")?.enabled ?? false
    }
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}
