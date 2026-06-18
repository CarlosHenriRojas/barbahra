import { describe, expect, it } from "vitest";
import { isRetryableWhatsappDisconnectError } from "../lib/retryable-errors";

describe("isRetryableWhatsappDisconnectError", () => {
  it("accepts the UAZAPI 503 disconnected-session error", () => {
    expect(
      isRetryableWhatsappDisconnectError(
        'UAZAPI 503: {"error":true,"message":"WhatsApp disconnected: session is not reconnectable"}'
      )
    ).toBe(true);
  });

  it("does not retry unrelated or permanent failures", () => {
    expect(isRetryableWhatsappDisconnectError("UAZAPI 400: invalid number")).toBe(false);
    expect(isRetryableWhatsappDisconnectError("UAZAPI 503: timeout")).toBe(false);
    expect(isRetryableWhatsappDisconnectError("WhatsApp disconnected")).toBe(false);
  });
});
