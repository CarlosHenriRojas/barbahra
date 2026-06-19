import { describe, expect, it } from "vitest";
import { normalizeWhatsappConnection } from "../lib/server/whatsapp-connection";

describe("normalizeWhatsappConnection", () => {
  it("normalizes Evolution API 2.3.7 connected state", () => {
    expect(
      normalizeWhatsappConnection({ instance: { instanceName: "barbahra", state: "open" } })
    ).toEqual({ status: "connected", qrCode: undefined, pairingCode: undefined });
  });

  it("normalizes an Evolution QR code response", () => {
    const base64 = "A".repeat(120);
    expect(normalizeWhatsappConnection({ base64, pairingCode: "1234-5678" })).toEqual({
      status: "connecting",
      qrCode: `data:image/png;base64,${base64}`,
      pairingCode: "1234-5678"
    });
  });

  it("normalizes Uazapi boolean connection status", () => {
    expect(normalizeWhatsappConnection({ status: { connected: false } }).status).toBe(
      "disconnected"
    );
    expect(normalizeWhatsappConnection({ status: { connected: true } }).status).toBe("connected");
  });
});
