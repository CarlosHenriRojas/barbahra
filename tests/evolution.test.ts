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
    ,"EVOLUTION_CONNECTION_STATUS_PATH"
    ,"EVOLUTION_CONNECT_PATH"
  ]) {
    delete process.env[key];
  }
});

describe("Evolution adapter", () => {
  it("recognizes the opt-out reply button in MESSAGES_UPSERT", () => {
    const event = createEvolutionAdapter().handleWebhookEvent({
      event: "messages.upsert",
      instance: "barbahra",
      data: {
        key: {
          remoteJid: "5511999999999@s.whatsapp.net",
          fromMe: false,
          id: "message-id"
        },
        message: {
          buttonsResponseMessage: {
            selectedButtonId: "opt_out",
            selectedDisplayText: "Não receber mais contatos"
          }
        }
      }
    });

    expect(event).toMatchObject({
      fromPhone: "5511999999999",
      messageText: "opt_out",
      messageId: "message-id",
      isOptOut: true,
      ignored: false
    });
  });

  it("ignores outgoing messages echoed by Evolution", () => {
    const event = createEvolutionAdapter().handleWebhookEvent({
      event: "messages.upsert",
      data: {
        key: { remoteJid: "5511999999999@s.whatsapp.net", fromMe: true },
        message: { conversation: "Não receber mais contatos" }
      }
    });

    expect(event.ignored).toBe(true);
  });

  it("requests a QR code from the Evolution 2.3.7 connect endpoint", async () => {
    configureEvolution();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      response({ base64: "data:image/png;base64,abc" })
    );

    await createEvolutionAdapter().connectInstance();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://evolution.example.com/instance/connect/barbahra",
      expect.objectContaining({ method: "GET" })
    );
  });

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

  it("keeps reply buttons native and moves mixed actions into the message text", async () => {
    configureEvolution();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response({ ok: true }));

    await createEvolutionAdapter().sendButtonMessage({
      phone: "5511999999999",
      message: "Escolha",
      buttons: [
        { id: "reply", label: "Responder", type: "reply" },
        { id: "opt_out", label: "Não receber mais contatos", type: "reply", isOptOut: true },
        { id: "site", label: "Site", type: "url", value: "https://example.com" },
        { id: "call", label: "Ligar", type: "call", value: "+5511999999999" },
        { id: "copy", label: "Copiar", type: "copy", value: "ABC" }
      ]
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.buttons).toEqual([
      { type: "reply", displayText: "Responder", id: "reply" },
      { type: "reply", displayText: "Não receber mais contatos", id: "opt_out" }
    ]);
    expect(body.description).toBe(
      "Escolha\n\nLink — Site: https://example.com\nTelefone — Ligar: +5511999999999\nCódigo — Copiar: ABC"
    );
  });

  it("keeps homogeneous non-reply buttons native", async () => {
    configureEvolution();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response({ ok: true }));

    await createEvolutionAdapter().sendButtonMessage({
      phone: "5511999999999",
      message: "Acesse",
      buttons: [{ id: "site", label: "Site", type: "url", value: "https://example.com" }]
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.buttons).toEqual([
      { type: "url", displayText: "Site", url: "https://example.com" }
    ]);
    expect(body.description).toBe("Acesse");
  });
});

describe("WhatsApp provider fallback", () => {
  it("uses Evolution first when it is selected as primary", async () => {
    process.env.UAZAPI_BASE_URL = "https://uazapi.example.com";
    process.env.UAZAPI_TOKEN = "uazapi-key";
    configureEvolution();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      response({ key: { id: "evo-primary" } })
    );

    const result = await createWhatsappProvider({
      primary: "evolution",
      enabled: { evolution: true, uazapi: true }
    }).sendTextMessage({ phone: "5511999999999", message: "Olá" });

    expect(result.provider).toBe("evolution");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://evolution.example.com/message/sendText/barbahra"
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not call a disabled provider", async () => {
    process.env.UAZAPI_BASE_URL = "https://uazapi.example.com";
    process.env.UAZAPI_TOKEN = "uazapi-key";
    configureEvolution();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response({ id: "uazapi" }));

    const result = await createWhatsappProvider({
      primary: "uazapi",
      enabled: { uazapi: true, evolution: false }
    }).sendTextMessage({ phone: "5511999999999", message: "Olá" });

    expect(result.provider).toBe("uazapi");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

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
