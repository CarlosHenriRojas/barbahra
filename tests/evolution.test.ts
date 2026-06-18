import { afterEach, describe, expect, it, vi } from "vitest";
import { createEvolutionAdapter } from "../lib/server/evolution";
import { createWhatsappProvider } from "../lib/server/whatsapp-provider";

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of [
    "UAZAPI_BASE_URL",
    "UAZAPI_TOKEN",
    "EVOLUTION_API_URL",
    "EVOLUTION_API_KEY",
    "EVOLUTION_INSTANCE_NAME",
    "EVOLUTION_SEND_TEXT_PATH",
    "EVOLUTION_SEND_BUTTONS_PATH",
    "EVOLUTION_CHECK_NUMBER_PATH"
  ]) {
    delete process.env[key];
  }
});

describe("Evolution adapter", () => {
  it("sends text using the configured instance and API key", async () => {
    configureEvolution();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      response({ key: { id: "evo-message" } })
    );

    await createEvolutionAdapter().sendTextMessage({
      phone: "5511999999999",
      message: "Olá"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://evolution.example.com/message/sendText/barbahra",
      expect.objectContaining({
        headers: expect.objectContaining({ apikey: "evo-key" }),
        body: expect.stringContaining('"number":"5511999999999"')
      })
    );
  });

  it("maps all supported button types to Evolution fields", async () => {
    configureEvolution();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response({ ok: true }));

    await createEvolutionAdapter().sendButtonMessage({
      phone: "5511999999999",
      message: "Escolha",
      buttons: [
        { id: "reply", label: "Responder", type: "reply" },
        { id: "site", label: "Site", type: "url", value: "https://example.com" },
        { id: "call", label: "Ligar", type: "call", value: "+5511999999999" },
        { id: "copy", label: "Copiar", type: "copy", value: "ABC" }
      ]
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.buttons).toEqual([
      { type: "reply", displayText: "Responder", id: "reply" },
      { type: "url", displayText: "Site", url: "https://example.com" },
      { type: "call", displayText: "Ligar", phoneNumber: "+5511999999999" },
      { type: "copy", displayText: "Copiar", copyCode: "ABC" }
    ]);
  });
});

describe("WhatsApp provider fallback", () => {
  it("uses Evolution when Uazapi returns an explicit failure", async () => {
    process.env.UAZAPI_BASE_URL = "https://uazapi.example.com";
    process.env.UAZAPI_TOKEN = "uazapi-key";
    configureEvolution();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(response({ error: "WhatsApp disconnected" }, false, 503))
      .mockResolvedValueOnce(response({ key: { id: "evo-message" } }));

    const result = await createWhatsappProvider().sendTextMessage({
      phone: "5511999999999",
      message: "Olá"
    });

    expect(result).toMatchObject({
      provider: "evolution",
      data: { key: { id: "evo-message" } }
    });
    expect(result.fallbackReason).toContain("UAZAPI 503");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses Evolution when the Uazapi number check fails", async () => {
    process.env.UAZAPI_BASE_URL = "https://uazapi.example.com";
    process.env.UAZAPI_TOKEN = "uazapi-key";
    configureEvolution();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(response({ error: "WhatsApp disconnected" }, false, 503))
      .mockResolvedValueOnce(response([{ exists: true, number: "5511999999999" }]));

    const result = await createWhatsappProvider().checkWhatsappNumber({
      phone: "11999999999"
    });

    expect(result.provider).toBe("evolution");
    expect(result.data).toMatchObject({ hasWhatsapp: true, matchedPhone: "5511999999999" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

function configureEvolution() {
  process.env.EVOLUTION_API_URL = "https://evolution.example.com";
  process.env.EVOLUTION_API_KEY = "evo-key";
  process.env.EVOLUTION_INSTANCE_NAME = "barbahra";
}

function response(data: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => data
  } as Response;
}
