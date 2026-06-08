import { afterEach, describe, expect, it, vi } from "vitest";
import { isOptOutMessage } from "../lib/opt-out";
import { buildUazapiMenuChoices, createUazapiAdapter } from "../lib/server/uazapi";

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.UAZAPI_BASE_URL;
  delete process.env.UAZAPI_TOKEN;
  delete process.env.UAZAPI_CHECK_NUMBER_PATH;
});

describe("buildUazapiMenuChoices", () => {
  it("formats buttons as UAZAPI menu choices", () => {
    expect(
      buildUazapiMenuChoices([
        { id: "reply", label: "Quero saber mais", type: "reply" },
        { id: "site", label: "Acessar Site", type: "url", value: "https://exemplo.com" },
        { id: "call", label: "Ligar Agora", type: "call", value: "+5511999999999" },
        { id: "copy", label: "Copiar", type: "copy", value: "ABC123" }
      ])
    ).toEqual([
      "Quero saber mais",
      "Acessar Site|https://exemplo.com",
      "Ligar Agora|call:+5511999999999",
      "Copiar|copy:ABC123"
    ]);
  });
});

describe("isOptOutMessage", () => {
  it("recognizes the required opt-out button label", () => {
    expect(isOptOutMessage("N\u00e3o receber mais contatos")).toBe(true);
  });
});

describe("checkWhatsappNumber", () => {
  it("checks Brazilian phone variants through the UAZAPI chat check endpoint", async () => {
    process.env.UAZAPI_BASE_URL = "https://instance.uazapi.com";
    process.env.UAZAPI_TOKEN = "token";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      response([
        { query: "551133334444", isInWhatsapp: false },
        { query: "5511933334444", isInWhatsapp: true }
      ])
    );

    const result = await createUazapiAdapter().checkWhatsappNumber({
      phone: "1133334444"
    });

    expect(result).toMatchObject({
      hasWhatsapp: true,
      matchedPhone: "5511933334444",
      checkedCandidates: ["551133334444", "5511933334444"]
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://instance.uazapi.com/chat/check",
      expect.objectContaining({
        body: JSON.stringify({
          numbers: ["551133334444", "5511933334444"]
        })
      })
    );
  });
});

function response(data: unknown) {
  return {
    ok: true,
    json: async () => data
  } as Response;
}
