export function extractProviderMessageId(payload: unknown) {
  if (!payload || typeof payload !== "object") return undefined;

  const paths = [
    "id",
    "messageId",
    "key.id",
    "data.id",
    "data.messageId",
    "result.id",
    "result.messageId"
  ];

  for (const path of paths) {
    const value = getPath(payload as Record<string, unknown>, path);
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return undefined;
}

function getPath(payload: Record<string, unknown>, path: string) {
  return path.split(".").reduce<unknown>((value, key) => {
    if (!value || typeof value !== "object") return undefined;
    return (value as Record<string, unknown>)[key];
  }, payload);
}
