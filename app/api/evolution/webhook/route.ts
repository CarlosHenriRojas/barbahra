import { NextRequest, NextResponse } from "next/server";
import { buildBrazilianWhatsappCandidates } from "@/lib/phone";
import { createEvolutionAdapter } from "@/lib/server/evolution";
import { logSystemEvent } from "@/lib/server/events";
import { createServiceSupabaseClient } from "@/lib/supabase/server";

type MatchedContact = { id: string; organization_id: string | null; phone: string };

export async function POST(request: NextRequest) {
  const configuredSecret = process.env.EVOLUTION_WEBHOOK_SECRET;
  const receivedSecret =
    request.headers.get("x-webhook-secret") ?? new URL(request.url).searchParams.get("secret");

  if (!configuredSecret && process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { ok: false, error: "EVOLUTION_WEBHOOK_SECRET deve estar configurado em produção." },
      { status: 500 }
    );
  }
  if (configuredSecret && receivedSecret !== configuredSecret) {
    return NextResponse.json({ ok: false, error: "Invalid webhook secret" }, { status: 401 });
  }

  const event = createEvolutionAdapter().handleWebhookEvent(await request.json());
  if (event.ignored) return NextResponse.json({ ok: true, ignored: true });

  const supabase = createServiceSupabaseClient();
  if (!supabase) return NextResponse.json({ ok: true, persisted: false });

  await supabase.from("webhook_events").insert({
    provider: "evolution",
    external_message_id: event.messageId,
    phone: event.fromPhone,
    event_type: event.isOptOut ? "opt_out" : "message",
    payload: event.raw
  });

  const phoneCandidates = event.fromPhone
    ? Array.from(new Set([event.fromPhone, ...buildBrazilianWhatsappCandidates(event.fromPhone)]))
    : [];
  let matchedContacts: MatchedContact[] = [];
  if (phoneCandidates.length) {
    const contactsResult = await supabase
      .from("contacts")
      .select("id,organization_id,phone")
      .in("phone", phoneCandidates);
    if (contactsResult.error) throw contactsResult.error;
    matchedContacts = (contactsResult.data ?? []) as MatchedContact[];
  }

  const organizationId = matchedContacts[0]?.organization_id ?? null;
  const optOutPhone = matchedContacts[0]?.phone ?? event.fromPhone;
  await logSystemEvent(supabase, {
    organizationId,
    type: "webhook",
    title: event.isOptOut ? "Resposta de opt-out recebida" : "Resposta recebida",
    detail: event.messageText ?? "(sem texto identificado)",
    phone: event.fromPhone,
    metadata: {
      provider: "evolution",
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
        source: "evolution_webhook"
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
      const links = await supabase.from("campaign_contacts").select("id").in("contact_id", contactIds);
      const linkIds = (links.data ?? []).map((row) => String(row.id));
      if (linkIds.length) {
        await supabase
          .from("message_jobs")
          .update({ status: "opt_out", error: "Opt-out registrado" })
          .in("campaign_contact_id", linkIds)
          .eq("status", "queued");
      }
    }
    await logSystemEvent(supabase, {
      organizationId,
      type: "opt_out",
      title: "Opt-out registrado",
      detail: "A pessoa respondeu pedindo para não receber mais contatos.",
      phone: optOutPhone,
      metadata: { source: "evolution_webhook", matchedContacts: contactIds.length }
    });
  }

  return NextResponse.json({ ok: true, isOptOut: event.isOptOut });
}
