import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { createUazapiAdapter } from "@/lib/server/uazapi";
import { logSystemEvent } from "@/lib/server/events";
import { buildBrazilianWhatsappCandidates } from "@/lib/phone";

type MatchedContact = { id: string; organization_id: string | null; phone: string };

export async function POST(request: NextRequest) {
  const configuredSecret = process.env.UAZAPI_WEBHOOK_SECRET;
  const receivedHeader = request.headers.get("x-webhook-secret");
  const receivedQuery = new URL(request.url).searchParams.get("secret");
  const receivedSecret = receivedHeader ?? receivedQuery;

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

    // Match the incoming number against stored contacts, tolerating the Brazilian
    // 9th-digit variation so opt-outs land on the right contact/org.
    const phoneCandidates = event.fromPhone
      ? Array.from(new Set([event.fromPhone, ...buildBrazilianWhatsappCandidates(event.fromPhone)]))
      : [];

    let matchedContacts: MatchedContact[] = [];
    if (phoneCandidates.length) {
      const contactsResult = await supabase
        .from("contacts")
        .select("id,organization_id,phone")
        .in("phone", phoneCandidates);
      matchedContacts = (contactsResult.data ?? []) as MatchedContact[];
    }

    const organizationId = matchedContacts[0]?.organization_id ?? null;
    // Prefer the canonical stored phone so future imports match the blocklist.
    const optOutPhone = matchedContacts[0]?.phone ?? event.fromPhone;

    await logSystemEvent(supabase, {
      organizationId,
      type: "webhook",
      title: event.isOptOut ? "Resposta de opt-out recebida" : "Resposta recebida",
      detail: event.messageText ?? "(sem texto identificado)",
      phone: event.fromPhone,
      metadata: {
        messageId: event.messageId,
        isOptOut: event.isOptOut,
        matchedContacts: matchedContacts.length
      }
    });

    if (event.isOptOut && optOutPhone) {
      await supabase.from("opt_outs").upsert(
        {
          organization_id: organizationId,
          phone: optOutPhone,
          reason: "keyword",
          source: "webhook"
        },
        { onConflict: "phone" }
      );

      const contactIds = matchedContacts.map((contact) => contact.id);

      if (contactIds.length) {
        await supabase.from("contacts").update({ status: "opt_out" }).in("id", contactIds);

        await supabase
          .from("campaign_contacts")
          .update({ status: "opt_out", validation_errors: ["Opt-out por resposta"] })
          .in("contact_id", contactIds);

        const campaignContacts = await supabase
          .from("campaign_contacts")
          .select("id")
          .in("contact_id", contactIds);

        const campaignContactIds = (campaignContacts.data ?? []).map((row) => String(row.id));
        if (campaignContactIds.length) {
          await supabase
            .from("message_jobs")
            .update({ status: "opt_out", error: "Opt-out registrado" })
            .in("campaign_contact_id", campaignContactIds)
            .eq("status", "queued");
        }
      }

      await logSystemEvent(supabase, {
        organizationId,
        type: "opt_out",
        title: "Opt-out registrado",
        detail: "A pessoa respondeu pedindo para não receber mais contatos.",
        phone: optOutPhone,
        metadata: { source: "webhook", matchedContacts: contactIds.length }
      });
    }
  }

  return NextResponse.json({ ok: true, event });
}
