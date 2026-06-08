export type PhoneNormalizationResult = {
  value: string;
  valid: boolean;
  reason?: string;
};

export function normalizeBrazilianPhone(input: string): PhoneNormalizationResult {
  const digits = String(input ?? "").replace(/\D/g, "");

  if (!digits) {
    return { value: "", valid: false, reason: "Telefone vazio" };
  }

  const withoutInternationalPrefix = digits.startsWith("00")
    ? digits.slice(2)
    : digits;

  const withCountryCode = withoutInternationalPrefix.startsWith("55")
    ? withoutInternationalPrefix
    : `55${withoutInternationalPrefix}`;

  if (withCountryCode.length < 12 || withCountryCode.length > 13) {
    return {
      value: withCountryCode,
      valid: false,
      reason: "Telefone deve ter DDI, DDD e número"
    };
  }

  return { value: withCountryCode, valid: true };
}

export function buildBrazilianWhatsappCandidates(input: string) {
  const digits = String(input ?? "").replace(/\D/g, "");
  if (!digits) return [];

  const withoutInternationalPrefix = digits.startsWith("00") ? digits.slice(2) : digits;
  const withCountryCode = withoutInternationalPrefix.startsWith("55")
    ? withoutInternationalPrefix
    : `55${withoutInternationalPrefix}`;
  const candidates = [withCountryCode];

  const nationalNumber = withCountryCode.startsWith("55") ? withCountryCode.slice(2) : "";
  const ddd = nationalNumber.slice(0, 2);
  const subscriber = nationalNumber.slice(2);

  if (ddd.length === 2 && subscriber.length === 8) {
    candidates.push(`55${ddd}9${subscriber}`);
  }

  if (ddd.length === 2 && subscriber.length === 9 && subscriber.startsWith("9")) {
    candidates.push(`55${ddd}${subscriber.slice(1)}`);
  }

  return Array.from(new Set(candidates)).filter(
    (candidate) => candidate.length >= 12 && candidate.length <= 13
  );
}
