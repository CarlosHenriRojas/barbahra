import type { Contact, MessageVariant } from "./types";

const variablePattern = /{{\s*([a-zA-Z0-9_çÇáéíóúãõâêôÁÉÍÓÚÃÕÂÊÔ-]+)\s*}}/g;

export function renderMessage(template: string, contact: Contact) {
  const missing = new Set<string>();
  const normalizedCustomFields = Object.entries(contact.customFields).reduce<Record<string, string>>(
    (acc, [key, value]) => {
      acc[normalizeVariableKey(key)] = value;
      return acc;
    },
    {}
  );
  const variables = {
    nome: contact.name,
    name: contact.name,
    telefone: contact.phone,
    phone: contact.phone,
    empresa: contact.company ?? "",
    company: contact.company ?? "",
    ...contact.customFields,
    ...normalizedCustomFields
  };

  const text = template.replace(variablePattern, (_, key: string) => {
    const normalizedKey = normalizeVariableKey(key);
    const value =
      variables[key as keyof typeof variables] ??
      variables[normalizedKey as keyof typeof variables] ??
      variableAliases[normalizedKey]
        ?.map((alias) => variables[alias as keyof typeof variables])
        .find(Boolean);
    if (!value) {
      missing.add(key);
      return "";
    }
    return String(value);
  });

  return {
    text: text.replace(/[ \t]+\n/g, "\n").trim(),
    missing: Array.from(missing)
  };
}

export function selectVariantForIndex(
  variants: MessageVariant[],
  index: number
): MessageVariant | undefined {
  if (!variants.length) return undefined;
  return variants[index % variants.length];
}

export function selectVariantByAllocation(
  variants: MessageVariant[],
  random = Math.random
): MessageVariant | undefined {
  if (!variants.length) return undefined;

  const weights = variants.map((variant) => Math.max(0, variant.allocationPercent ?? 0));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  if (totalWeight <= 0) {
    return variants[Math.floor(random() * variants.length)] ?? variants[0];
  }

  const target = random() * totalWeight;
  let cursor = 0;

  for (let index = 0; index < variants.length; index += 1) {
    cursor += weights[index];
    if (target < cursor) return variants[index];
  }

  return variants[variants.length - 1];
}

export function extractTemplateVariables(template: string) {
  return Array.from(template.matchAll(variablePattern), (match) => match[1]);
}

const variableAliases: Record<string, string[]> = {
  produto_comprado: [
    "produto",
    "produtoadquirido",
    "produtocomprado",
    "produto_comprado",
    "curso",
    "ofertacomprada"
  ],
  upsell: ["upsell", "oferta", "proximaoferta", "proximo_passo", "proximopasso"]
};

function normalizeVariableKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");
}
