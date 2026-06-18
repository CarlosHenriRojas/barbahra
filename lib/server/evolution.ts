import { z } from "zod";
import { buildBrazilianWhatsappCandidates } from "../phone";

const TYPING_DELAY_MS = 6000;

const sendTextSchema = z.object({
  phone: z.string().min(10),
  message: z.string().min(1),
  referenceId: z.string().optional()
});

const buttonSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(["reply", "url", "call", "copy"]),
  value: z.string().optional(),
  isOptOut: z.boolean().optional()
});

const sendButtonsSchema = sendTextSchema.extend({
  buttons: z.array(buttonSchema).min(1)
});

const checkNumberSchema = z.object({ phone: z.string().min(10) });

export function createEvolutionAdapter() {
  const baseUrl = process.env.EVOLUTION_API_URL;
  const apiKey = process.env.EVOLUTION_API_KEY;
  const instance = process.env.EVOLUTION_INSTANCE_NAME;
  const sendTextPath = process.env.EVOLUTION_SEND_TEXT_PATH ?? "/message/sendText/{instance}";
  const sendButtonsPath =
    process.env.EVOLUTION_SEND_BUTTONS_PATH ?? "/message/sendButtons/{instance}";
  const checkNumberPath =
    process.env.EVOLUTION_CHECK_NUMBER_PATH ?? "/chat/whatsappNumbers/{instance}";

  function isConfigured() {
    return Boolean(baseUrl && apiKey && instance);
  }

  function resolvePath(path: string) {
    return path.replace("{instance}", encodeURIComponent(instance as string));
  }

  async function request(path: string, body: unknown) {
    if (!isConfigured()) {
      throw new Error(
        "EVOLUTION_API_URL, EVOLUTION_API_KEY and EVOLUTION_INSTANCE_NAME must be configured on the server."
      );
    }

    const response = await fetch(new URL(resolvePath(path), baseUrl).toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: apiKey as string
      },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(`Evolution ${response.status}: ${JSON.stringify(data)}`);
    }

    return data;
  }

  return {
    isConfigured,

    async sendTextMessage(input: z.infer<typeof sendTextSchema>) {
      const payload = sendTextSchema.parse(input);
      return request(sendTextPath, {
        number: payload.phone,
        text: payload.message,
        delay: TYPING_DELAY_MS,
        presence: "composing",
        referenceId: payload.referenceId
      });
    },

    async sendButtonMessage(input: z.infer<typeof sendButtonsSchema>) {
      const payload = sendButtonsSchema.parse(input);
      return request(sendButtonsPath, {
        number: payload.phone,
        title: "",
        description: payload.message,
        footer: "",
        buttons: payload.buttons.map(toEvolutionButton),
        delay: TYPING_DELAY_MS,
        referenceId: payload.referenceId
      });
    },

    async checkWhatsappNumber(input: z.infer<typeof checkNumberSchema>) {
      const payload = checkNumberSchema.parse(input);
      const candidates = buildBrazilianWhatsappCandidates(payload.phone);
      const checkedCandidates = candidates.length ? candidates : [payload.phone.replace(/\D/g, "")];
      const data = await request(checkNumberPath, { numbers: checkedCandidates });
      const results = Array.isArray(data) ? data : [data];
      const match = results.find((result) => readExists(result) === true);
      const matchedPhone = match && typeof match === "object"
        ? readString(match as Record<string, unknown>, ["number", "query", "jid"])
            ?.replace(/@.*$/, "")
            .replace(/\D/g, "")
        : undefined;
      const hasUnknown = results.some((result) => readExists(result) === undefined);

      return {
        raw: data,
        hasWhatsapp: match ? true : hasUnknown ? undefined : false,
        matchedPhone: match ? matchedPhone || checkedCandidates[0] : undefined,
        checkedCandidates
      };
    }
  };
}

function toEvolutionButton(button: z.infer<typeof buttonSchema>) {
  const displayText = button.label.trim();
  const value = button.value?.trim();

  if (button.type === "url" && value) return { type: "url", displayText, url: value };
  if (button.type === "call" && value) {
    return { type: "call", displayText, phoneNumber: value };
  }
  if (button.type === "copy" && value) return { type: "copy", displayText, copyCode: value };
  return { type: "reply", displayText, id: button.id };
}

function readExists(payload: unknown) {
  if (!payload || typeof payload !== "object") return undefined;
  const value = readValue(payload as Record<string, unknown>, [
    "exists",
    "isInWhatsapp",
    "hasWhatsapp",
    "data.exists"
  ]);
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (["true", "yes", "valid", "exists"].includes(value.toLowerCase())) return true;
    if (["false", "no", "invalid", "missing"].includes(value.toLowerCase())) return false;
  }
  return undefined;
}

function readString(payload: Record<string, unknown>, paths: string[]) {
  const value = readValue(payload, paths);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readValue(payload: Record<string, unknown>, paths: string[]) {
  for (const path of paths) {
    const value = path.split(".").reduce<unknown>((current, key) => {
      if (!current || typeof current !== "object") return undefined;
      return (current as Record<string, unknown>)[key];
    }, payload);
    if (value !== undefined) return value;
  }
  return undefined;
}
