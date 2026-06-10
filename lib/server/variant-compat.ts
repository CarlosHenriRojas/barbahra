export type MessageVariantDbRow = {
  campaign_id: string;
  label: string;
  body: string;
  message_type: "text" | "buttons";
  allocation_percent: number;
  buttons: unknown[];
};

export function isMissingAllocationPercentError(error: unknown) {
  if (!error || typeof error !== "object") return false;

  const record = error as Record<string, unknown>;
  const code = typeof record.code === "string" ? record.code : "";
  const details = [
    record.message,
    record.details,
    record.hint
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ");

  return (
    details.toLowerCase().includes("allocation_percent") &&
    ["42703", "PGRST204"].includes(code)
  );
}

export function withoutAllocationPercent(row: MessageVariantDbRow) {
  const compatibleRow: Partial<MessageVariantDbRow> = { ...row };
  delete compatibleRow.allocation_percent;
  return compatibleRow;
}
