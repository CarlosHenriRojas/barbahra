import { NextRequest, NextResponse } from "next/server";
import { createAnonSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";

export type AuthenticatedRequestContext = {
  organizationId: string;
  supabase: NonNullable<ReturnType<typeof createAnonSupabaseClient>>;
  userId: string;
};

export class ApiAuthError extends Error {
  status: number;

  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

export async function requireAuthenticatedRequest(
  request: NextRequest
): Promise<AuthenticatedRequestContext> {
  const token = readBearerToken(request);
  if (!token) {
    throw new ApiAuthError("Faca login para continuar.", 401);
  }

  const supabase = createAnonSupabaseClient(token);
  if (!supabase) {
    throw new ApiAuthError("Supabase nao esta configurado no servidor.", 501);
  }

  const userResult = await supabase.auth.getUser(token);
  if (userResult.error || !userResult.data.user) {
    throw new ApiAuthError("Sessao invalida ou expirada. Entre novamente.", 401);
  }

  const userId = userResult.data.user.id;
  const profile = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", userId)
    .maybeSingle();

  if (profile.error) {
    throw new ApiAuthError(profile.error.message, 500);
  }

  if (profile.data?.organization_id) {
    return {
      organizationId: String(profile.data.organization_id),
      supabase,
      userId
    };
  }

  if (process.env.NODE_ENV !== "production" && process.env.DEFAULT_ORGANIZATION_ID) {
    const serviceSupabase = createServiceSupabaseClient();
    if (serviceSupabase) {
      return {
        organizationId: process.env.DEFAULT_ORGANIZATION_ID,
        supabase: serviceSupabase,
        userId
      };
    }
  }

  throw new ApiAuthError(
    "Usuario sem organizacao configurada. Vincule este usuario a uma organizacao no Supabase.",
    403
  );
}

export function authErrorResponse(error: unknown) {
  if (error instanceof ApiAuthError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  }
  return undefined;
}

function readBearerToken(request: NextRequest) {
  return request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
}
