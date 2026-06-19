import { NextRequest, NextResponse } from "next/server";
import { authErrorResponse, requireAuthenticatedRequest } from "@/lib/server/auth";
import { createEvolutionAdapter } from "@/lib/server/evolution";
import { createUazapiAdapter } from "@/lib/server/uazapi";
import { normalizeWhatsappConnection } from "@/lib/server/whatsapp-connection";
import type { WhatsappProviderName } from "@/lib/server/whatsapp-provider";

type RouteContext = { params: Promise<{ provider: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  return connectionResponse(request, context, false);
}

export async function POST(request: NextRequest, context: RouteContext) {
  return connectionResponse(request, context, true);
}

async function connectionResponse(request: NextRequest, context: RouteContext, connect: boolean) {
  try {
    await requireAuthenticatedRequest(request);
    const { provider: rawProvider } = await context.params;
    if (!isProvider(rawProvider)) {
      return NextResponse.json({ ok: false, error: "Provedor inválido." }, { status: 404 });
    }

    const adapter = rawProvider === "evolution" ? createEvolutionAdapter() : createUazapiAdapter();
    if (!adapter.isConfigured()) {
      return NextResponse.json(
        { ok: false, configured: false, error: `${providerLabel(rawProvider)} não está configurado no servidor.` },
        { status: 409 }
      );
    }

    const data = connect
      ? await adapter.connectInstance()
      : await adapter.checkInstanceStatus();
    return NextResponse.json({
      ok: true,
      configured: true,
      provider: rawProvider,
      connection: normalizeWhatsappConnection(data)
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Falha ao consultar conexão." },
      { status: 500 }
    );
  }
}

function isProvider(value: string): value is WhatsappProviderName {
  return value === "uazapi" || value === "evolution";
}

function providerLabel(provider: WhatsappProviderName) {
  return provider === "uazapi" ? "Uazapi" : "Evolution API";
}
