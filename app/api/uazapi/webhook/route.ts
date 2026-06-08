import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { createUazapiAdapter } from "@/lib/server/uazapi";

export async function POST(request: NextRequest) {
  const configuredSecret = process.env.UAZAPI_WEBHOOK_SECRET;
  const receivedSecret = request.headers.get("x-webhook-secret");

  if (!configuredSecret && process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { ok: false, error: "UAZAPI_WEBHOOK_SECRET deve estar configurado em produção." },
      { status: 500 }
    );
  }

  if (configuredSecret && receivedSecret !== configuredSecret) {
    return NextResponse.json({ ok: false, error: "Invalid webhook secret" }, { status: 401 });
  }

  const payload = await request.json();
  const event = createUazapiAdapter().handleWebhookEvent(payload);
  const supabase = createServiceSupabaseClient();

  if (supabase) {
    await supabase.from("webhook_events").insert({
      provider: "uazapi",
      external_message_id: event.messageId,
      phone: event.fromPhone,
      event_type: event.isOptOut ? "opt_out" : "message",
      payload: event.raw
    });

    if (event.isOptOut && event.fromPhone) {
      await supabase.from("opt_outs").upsert(
        {
          phone: event.fromPhone,
          reason: "keyword",
          source: "webhook"
        },
        { onConflict: "phone" }
      );

      await supabase
        .from("contacts")
        .update({ status: "opt_out" })
        .eq("phone", event.fromPhone);
    }
  }

  return NextResponse.json({ ok: true, event });
}
