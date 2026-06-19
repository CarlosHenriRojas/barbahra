export type WhatsappConnectionStatus = "connected" | "connecting" | "disconnected" | "unknown";

export type WhatsappConnection = {
  status: WhatsappConnectionStatus;
  qrCode?: string;
  pairingCode?: string;
};

export function mergeWhatsappConnection(
  current: WhatsappConnection | undefined,
  incoming: WhatsappConnection
): WhatsappConnection {
  if (!current || incoming.status === "connected" || incoming.status === "disconnected") {
    return incoming;
  }

  if (incoming.qrCode) return incoming;

  if (incoming.status === "connecting" || incoming.status === "unknown") {
    return {
      ...incoming,
      qrCode: current.qrCode,
      pairingCode: incoming.pairingCode ?? current.pairingCode
    };
  }

  return incoming;
}
