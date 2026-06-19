import type { WhatsappConnection, WhatsappConnectionStatus } from "../whatsapp-connection";

export function normalizeWhatsappConnection(payload: unknown): WhatsappConnection {
  const statusValue = readString(payload, [
    "instance.state",
    "instance.status",
    "state",
    "status",
    "connection",
    "data.instance.state",
    "data.state",
    "data.status"
  ]);
  const qrValue = readString(payload, [
    "base64",
    "qrcode.base64",
    "qrcode",
    "qrCode",
    "qr",
    "instance.qrcode",
    "instance.qrCode",
    "data.base64",
    "data.qrcode.base64",
    "data.qrcode",
    "data.qrCode"
  ]);
  const pairingCode = readString(payload, [
    "pairingCode",
    "pairing_code",
    "code",
    "data.pairingCode",
    "data.pairing_code",
    "data.code"
  ]);
  const connected = readBoolean(payload, [
    "connected",
    "status.connected",
    "instance.connected",
    "data.connected",
    "data.status.connected"
  ]);

  return {
    status: connected === true
      ? "connected"
      : normalizeStatus(statusValue, Boolean(qrValue), connected === false),
    qrCode: normalizeQrCode(qrValue),
    pairingCode
  };
}

function normalizeStatus(
  value: string | undefined,
  hasQrCode: boolean,
  explicitlyDisconnected: boolean
): WhatsappConnectionStatus {
  const status = value?.toLowerCase().replace(/[\s_-]/g, "");
  if (["open", "connected", "online", "authenticated", "ready"].includes(status ?? "")) {
    return "connected";
  }
  if (["connecting", "qr", "qrcode", "pairing", "loading"].includes(status ?? "") || hasQrCode) {
    return "connecting";
  }
  if (["close", "closed", "disconnected", "offline", "notconnected"].includes(status ?? "")) {
    return "disconnected";
  }
  if (explicitlyDisconnected) return "disconnected";
  return "unknown";
}

function readBoolean(payload: unknown, paths: string[]) {
  if (!payload || typeof payload !== "object") return undefined;
  for (const path of paths) {
    const value = path.split(".").reduce<unknown>((current, key) => {
      if (!current || typeof current !== "object") return undefined;
      return (current as Record<string, unknown>)[key];
    }, payload);
    if (typeof value === "boolean") return value;
  }
  return undefined;
}

function normalizeQrCode(value: string | undefined) {
  if (!value) return undefined;
  if (value.startsWith("data:image/")) return value;
  if (/^[A-Za-z0-9+/=\s]+$/.test(value) && value.length > 100) {
    return `data:image/png;base64,${value.replace(/\s/g, "")}`;
  }
  return undefined;
}

function readString(payload: unknown, paths: string[]) {
  if (!payload || typeof payload !== "object") return undefined;
  for (const path of paths) {
    const value = path.split(".").reduce<unknown>((current, key) => {
      if (!current || typeof current !== "object") return undefined;
      return (current as Record<string, unknown>)[key];
    }, payload);
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}
