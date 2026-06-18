import { z } from "zod";
import { isOptOutMessage } from "../opt-out";
import { buildBrazilianWhatsappCandidates } from "../phone";

const TYPING_DELAY_MS = 6000;

const sendTextSchema = z.object({
  phone: z.string().min(10),
  message: z.string().min(1),
  referenceId: z.string().optional()
});

const checkNumberSchema = z.object({
  phone: z.string().min(10)
});

const buttonSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(["reply", "url", "call", "copy"]),
  value: z.string().optional(),
  isOptOut: z.boolean().optional()
});

const sendButtonsSchema = z.object({
  phone: z.string().min(10),
  message: z.string().min(1),
  buttons: z.array(buttonSchema).min(1),
  referenceId: z.string().optional()
});

const webhookSchema = z.record(z.unknown());

export type UazapiWebhookResult = {
  raw: Record<string, unknown>;
  fromPhone?: string;
  messageText?: string;
  messageId?: string;
  isOptOut: boolean;
};

export function createUazapiAdapter() {
  const baseUrl = process.env.UAZAPI_BASE_URL;
  const token = process.env.UAZAPI_TOKEN;
  const sendTextPath = process.env.UAZAPI_SEND_TEXT_PATH ?? "/send/text";
  const configuredMenuPath =
    process.env.UAZAPI_SEND_MENU_PATH ?? process.env.UAZAPI_SEND_BUTTONS_PATH;
  const sendMenuPath =
    configuredMenuPath && configuredMenuPath !== "/send/buttons" ? configuredMenuPath : "/send/menu";
  const statusPath = process.env.UAZAPI_STATUS_PATH ?? "/instance/status";
  const checkNumberPath = process.env.UAZAPI_CHECK_NUMBER_PATH ?? "/chat/check";

  function assertConfigured() {
    if (!baseUrl || !token) {
      throw new Error("UAZAPI_BASE_URL and UAZAPI_TOKEN must be configured on the server.");
    }
  }

  async function request(path: string, body?: unknown) {
    assertConfigured();
    const response = await fetch(new URL(path, baseUrl).toString(), {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        token: token as string
      },
      body: body ? JSON.stringify(body) : undefined
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(`UAZAPI ${response.status}: ${JSON.stringify(data)}`);
    }

    return data;
  }

  return {
    async checkInstanceStatus() {
      return request(statusPath);
    },

    async sendTextMessage(input: z.infer<typeof sendTextSchema>) {
      const payload = sendTextSchema.parse(input);
      return request(sendTextPath, {
        number: payload.phone,
        phone: payload.phone,
        to: payload.phone,
        text: payload.message,
        message: payload.message,
        delay: TYPING_DELAY_MS,
        referenceId: payload.referenceId
      });
    },

    async sendButtonMessage(input: z.infer<typeof sendButtonsSchema>) {
      const payload = sendButtonsSchema.parse(input);
      return request(sendMenuPath, {
        number: payload.phone,
        type: "button",
        text: payload.message,
        choices: buildUazapiMenuChoices(payload.buttons),
        readchat: true,
        delay: TYPING_DELAY_MS,
        referenceId: payload.referenceId
      });
    },

    async checkWhatsappNumber(input: z.infer<typeof checkNumberSchema>) {
      const payload = checkNumberSchema.parse(input);
      const candidates = buildBrazilianWhatsappCandidates(payload.phone);
      const checkedCandidates = candidates.length ? candidates : [payload.phone.replace(/\D/g, "")];
      const data = await request(checkNumberPath, {
        numbers: checkedCandidates
      });
      const results = Array.isArray(data) ? data : [data];
      const match = results.find((result) => readWhatsappCheckResult(result) === true);
      if (match) {
        const query =
          match && typeof match === "object"
            ? extractString(match as Record<string, unknown>, ["query", "number", "phone"])
            : undefined;
        return {
          raw: data,
          hasWhatsapp: true,
          matchedPhone: query?.replace(/\D/g, "") || checkedCandidates[0],
          checkedCandidates
        };
      }
      const hasUnknown = results.some((result) => readWhatsappCheckResult(result) === undefined);

      return {
        raw: data,
        hasWhatsapp: hasUnknown ? undefined : false,
        matchedPhone: undefined,
        checkedCandidates
      };
    },

    handleWebhookEvent(payload: unknown): UazapiWebhookResult {
      const raw = webhookSchema.parse(payload);
      const fromPhone = extractString(raw, [
        "message.sender_pn",
        "chat.phone",
        "from",
        "phone",
        "number",
        "sender",
        "remoteJid"
      ]);
      const messageText = extractString(raw, [
        "message.vote",
        "message.buttonOrListid",
        "message.content.selectedDisplayText",
        "message.content.selectedID",
        "chat.wa_lastMessageTextVote",
        "text",
        "body",
        "caption",
        "buttonText",
        "selectedButtonId",
        "selectedDisplayText",
        "buttonsResponseMessage.selectedButtonId",
        "buttonsResponseMessage.selectedDisplayText",
        "message.buttonsResponseMessage.selectedButtonId",
        "message.buttonsResponseMessage.selectedDisplayText"
      ]);
      const messageId = extractString(raw, ["message.messageid", "message.id", "messageId", "id", "key.id"]);

      return {
        raw,
        fromPhone: fromPhone?.replace(/\D/g, ""),
        messageText,
        messageId,
        isOptOut: messageText
          ? isOptOutMessage(messageText) || /opt[_-]?out/i.test(messageText)
          : false
      };
    }
  };
}

function readWhatsappCheckResult(payload: unknown) {
  return readBoolean(payload, [
    "isInWhatsapp",
    "hasWhatsapp",
    "isWhatsapp",
    "isWhatsApp",
    "onWhatsApp",
    "exists",
    "existsWhatsapp",
    "valid",
    "result.isInWhatsapp",
    "result.hasWhatsapp",
    "result.exists",
    "result.existsWhatsapp",
    "data.isInWhatsapp",
    "data.hasWhatsapp",
    "data.exists",
    "data.existsWhatsapp"
  ]);
}

export function buildUazapiMenuChoices(buttons: Array<z.infer<typeof buttonSchema>>) {
  return buttons.map((button) => {
    const label = button.label.trim();
    const value = button.value?.trim();

    if (button.type === "copy" && value) return `${label}|copy:${value}`;
    if (button.type === "call" && value) return `${label}|call:${value}`;
    if (button.type === "url" && value) return `${label}|${value}`;

    return label;
  });
}

function readBoolean(payload: unknown, keys: string[]) {
  if (!payload || typeof payload !== "object") return undefined;

  for (const key of keys) {
    const value = getPath(payload as Record<string, unknown>, key);
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.toLowerCase();
      if (["true", "valid", "exists", "yes"].includes(normalized)) return true;
      if (["false", "invalid", "missing", "no"].includes(normalized)) return false;
    }
  }

  return undefined;
}

function extractString(payload: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = getPath(payload, key);
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function getPath(payload: Record<string, unknown>, path: string) {
  return path.split(".").reduce<unknown>((value, key) => {
    if (!value || typeof value !== "object") return undefined;
    return (value as Record<string, unknown>)[key];
  }, payload);
}
