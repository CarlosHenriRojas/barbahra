import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, requireAuthenticatedRequest } from "@/lib/server/auth";
import {
  createWhatsappProvider,
  defaultWhatsappProviderConfig,
  type WhatsappProviderName
} from "@/lib/server/whatsapp-provider";

const sendRequestSchema = z.object({
  phone: z.string().min(10),
  message: z.string().min(1),
  consentConfirmed: z.literal(true),
  referenceId: z.string().optional()
});

export async function POST(request: NextRequest) {
  try {
    const { organizationId, supabase } = await requireAuthenticatedRequest(request);
    const payload = sendRequestSchema.parse(await request.json());
    const savedSettings = await supabase
      .from("integration_settings")
      .select("provider,enabled,priority")
      .eq("organization_id", organizationId)
      .in("provider", ["uazapi", "evolution"]);
    if (savedSettings.error) throw savedSettings.error;

    const rows = (savedSettings.data ?? []).filter(
      (row): row is typeof row & { provider: WhatsappProviderName } =>
        row.provider === "uazapi" || row.provider === "evolution"
    );
    const config = rows.length
      ? {
          primary: [...rows].sort((a, b) => a.priority - b.priority)[0].provider,
          enabled: {
            uazapi: rows.find((row) => row.provider === "uazapi")?.enabled ?? false,
            evolution: rows.find((row) => row.provider === "evolution")?.enabled ?? false
          }
        }
      : defaultWhatsappProviderConfig;
    const result = await createWhatsappProvider(config).sendTextMessage(payload);
    return NextResponse.json({ ok: true, ...result });
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
