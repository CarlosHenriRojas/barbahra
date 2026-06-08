import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, requireAuthenticatedRequest } from "@/lib/server/auth";
import { campaignSnapshotSchema } from "@/lib/server/schemas";

const importSchema = z.object({
  fileName: z.string().min(1),
  contacts: campaignSnapshotSchema.shape.contacts
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  try {
    const { organizationId, supabase } = await requireAuthenticatedRequest(request);
    const { campaignId } = await params;
    const payload = importSchema.parse(await request.json());
    const campaign = await supabase
      .from("campaigns")
      .select("id,organization_id,consent_basis")
      .eq("id", campaignId)
      .eq("organization_id", organizationId)
      .single();

    if (campaign.error) throw campaign.error;

    const existingLinks = await supabase
      .from("campaign_contacts")
      .select("contact_id,contacts(phone)")
      .eq("campaign_id", campaignId);

    if (existingLinks.error) throw existingLinks.error;

    const existingPhones = new Set(
      (existingLinks.data ?? [])
        .map((row) => readLinkedPhone(row))
        .filter((phone): phone is string => Boolean(phone))
    );

    const validUniqueContacts = payload.contacts.filter(
      (contact) => contact.errors.length === 0 && !contact.duplicate
    );
    const contactsToImport = validUniqueContacts.filter(
      (contact) => !existingPhones.has(contact.phone)
    );
    const skippedDuplicatesCount = validUniqueContacts.length - contactsToImport.length;

    const batch = await supabase
      .from("import_batches")
      .insert({
        campaign_id: campaignId,
        file_name: payload.fileName,
        imported_count: contactsToImport.length,
        skipped_duplicates_count: skippedDuplicatesCount
      })
      .select("id")
      .single();

    if (batch.error) throw batch.error;

    for (const contact of contactsToImport) {
      const contactUpsert = await supabase
        .from("contacts")
        .upsert(
          {
            organization_id: campaign.data.organization_id,
            name: contact.name,
            phone: contact.phone,
            company: contact.company,
            status: "imported",
            whatsapp_status: contact.whatsappStatus,
            consent_basis: campaign.data.consent_basis
          },
          { onConflict: "organization_id,phone" }
        )
        .select("id")
        .single();

      if (contactUpsert.error) throw contactUpsert.error;

      const campaignContactInsert = await supabase.from("campaign_contacts").upsert(
        {
          campaign_id: campaignId,
          contact_id: contactUpsert.data.id,
          status: "imported",
          validation_errors: contact.errors,
          import_batch_id: batch.data.id
        },
        { onConflict: "campaign_id,contact_id" }
      );

      if (campaignContactInsert.error) throw campaignContactInsert.error;

      for (const [fieldKey, fieldValue] of Object.entries(contact.customFields)) {
        const fieldUpsert = await supabase.from("contact_custom_fields").upsert(
          {
            contact_id: contactUpsert.data.id,
            field_key: fieldKey,
            field_value: fieldValue
          },
          { onConflict: "contact_id,field_key" }
        );

        if (fieldUpsert.error) throw fieldUpsert.error;
      }
    }

    return NextResponse.json({
      ok: true,
      importedCount: contactsToImport.length,
      skippedDuplicatesCount,
      importBatchId: batch.data.id
    });
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

function readLinkedPhone(row: unknown) {
  if (!row || typeof row !== "object") return undefined;
  const contacts = (row as { contacts?: unknown }).contacts;
  if (Array.isArray(contacts)) {
    const first = contacts[0];
    return first && typeof first === "object"
      ? String((first as { phone?: unknown }).phone ?? "")
      : undefined;
  }
  return contacts && typeof contacts === "object"
    ? String((contacts as { phone?: unknown }).phone ?? "")
    : undefined;
}
