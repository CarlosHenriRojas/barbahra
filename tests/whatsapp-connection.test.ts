import { describe, expect, it } from "vitest";
import { normalizeWhatsappConnection } from "../lib/server/whatsapp-connection";
import { mergeWhatsappConnection } from "../lib/whatsapp-connection";

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

describe("mergeWhatsappConnection", () => {
  it("keeps the Evolution QR code when status polling omits base64", () => {
    const current = {
      status: "connecting" as const,
      qrCode: "data:image/png;base64,current",
      pairingCode: "1234-5678"
    };

    expect(mergeWhatsappConnection(current, { status: "connecting" })).toEqual(current);
  });

  it("clears the QR code after connecting", () => {
    expect(
      mergeWhatsappConnection(
        { status: "connecting", qrCode: "data:image/png;base64,current" },
        { status: "connected" }
      )
    ).toEqual({ status: "connected" });
  });

  it("replaces the previous QR code when the provider returns a new one", () => {
    expect(
      mergeWhatsappConnection(
        { status: "connecting", qrCode: "data:image/png;base64,old" },
        { status: "connecting", qrCode: "data:image/png;base64,new" }
      )
    ).toEqual({ status: "connecting", qrCode: "data:image/png;base64,new" });
  });
});
