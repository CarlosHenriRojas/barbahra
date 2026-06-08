import type { SupabaseClient } from "@supabase/supabase-js";

export async function resolveDefaultOrganizationId(supabase: SupabaseClient) {
  const configuredId = process.env.DEFAULT_ORGANIZATION_ID;
  if (configuredId) return configuredId;

  const existing = await supabase
    .from("organizations")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existing.data?.id) return existing.data.id as string;

  const created = await supabase
    .from("organizations")
    .insert({ name: "Barbahra Cliente" })
    .select("id")
    .single();

  if (created.error) throw created.error;
  return created.data.id as string;
}
