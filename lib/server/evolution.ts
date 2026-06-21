import { z } from "zod";
import { buildBrazilianWhatsappCandidates } from "../phone";
import { isOptOutMessage } from "../opt-out";

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
const webhookSchema = z.record(z.unknown());

export type EvolutionWebhookResult = {
  raw: Record<string, unknown>;
  fromPhone?: string;
  messageText?: string;
  messageId?: string;
  isOptOut: boolean;
  ignored: boolean;
};

export function createEvolutionAdapter() {
  const baseUrl = process.env.EVOLUTION_API_URL;
  const apiKey = process.env.EVOLUTION_API_KEY;
  const instance = process.env.EVOLUTION_INSTANCE_NAME;
  const sendTextPath = process.env.EVOLUTION_SEND_TEXT_PATH ?? "/message/sendText/{instance}";
  const sendButtonsPath =
    process.env.EVOLUTION_SEND_BUTTONS_PATH ?? "/message/sendButtons/{instance}";
  const checkNumberPath =
    process.env.EVOLUTION_CHECK_NUMBER_PATH ?? "/chat/whatsappNumbers/{instance}";
  const connectionStatusPath =
    process.env.EVOLUTION_CONNECTION_STATUS_PATH ?? "/instance/connectionState/{instance}";
  const connectPath = process.env.EVOLUTION_CONNECT_PATH ?? "/instance/connect/{instance}";

  function isConfigured() {
    return Boolean(baseUrl && apiKey && instance);
  }

  function resolvePath(path: string) {
    return path.replace("{instance}", encodeURIComponent(instance as string));
  }

  async function request(path: string, body?: unknown) {
    if (!isConfigured()) {
      throw new Error(
        "EVOLUTION_API_URL, EVOLUTION_API_KEY and EVOLUTION_INSTANCE_NAME must be configured on the server."
      );
    }

    const response = await fetch(new URL(resolvePath(path), baseUrl).toString(), {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: apiKey as string
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(`Evolution ${response.status}: ${JSON.stringify(data)}`);
    }

    return data;
  }

  return {
    isConfigured,

    async checkInstanceStatus() {
      return request(connectionStatusPath);
    },

    async connectInstance() {
      return request(connectPath);
    },

    async sendTextMessage(input: z.infer<typeof sendTextSchema>) {
      const payload = sendTextSchema.parse(input);
      return request(sendTextPath, {
        number: payload.phone,
        text: payload.message,
        delay: TYPING_DELAY_MS,
        presence: "composing"
      });
    },

    async sendButtonMessage(input: z.infer<typeof sendButtonsSchema>) {
      const payload = sendButtonsSchema.parse(input);
      const buttonMessage = buildEvolutionButtonMessage(payload.message, payload.buttons);
      return request(sendButtonsPath, {
        number: payload.phone,
        title: "",
        description: buttonMessage.description,
        footer: "",
        buttons: buttonMessage.buttons,
        delay: TYPING_DELAY_MS
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
    },

    handleWebhookEvent(payload: unknown): EvolutionWebhookResult {
      const raw = webhookSchema.parse(payload);
      const remoteJid = extractString(raw, [
        "data.key.remoteJid",
        "data.key.participant",
        "data.remoteJid",
        "data.sender",
        "sender",
        "key.remoteJid"
      ]);
      const selectedButtonId = extractString(raw, [
        "data.message.buttonsResponseMessage.selectedButtonId",
        "data.message.templateButtonReplyMessage.selectedId",
        "data.message.listResponseMessage.singleSelectReply.selectedRowId",
        "message.buttonsResponseMessage.selectedButtonId"
      ]);
      const messageText = selectedButtonId ?? extractString(raw, [
        "data.message.buttonsResponseMessage.selectedDisplayText",
        "data.message.templateButtonReplyMessage.selectedDisplayText",
        "data.message.listResponseMessage.title",
        "data.message.conversation",
        "data.message.extendedTextMessage.text",
        "data.message.imageMessage.caption",
        "data.body",
        "body",
        "message"
      ]);
      const messageId = extractString(raw, ["data.key.id", "data.id", "key.id", "messageId"]);
      const fromMe = extractBoolean(raw, ["data.key.fromMe", "key.fromMe"]) === true;
      const isGroup = remoteJid?.endsWith("@g.us") ?? false;
      const fromPhone = remoteJid?.replace(/@.*$/, "").replace(/\D/g, "") || undefined;
      const isOptOut = Boolean(
        messageText && (selectedButtonId === "opt_out" || /opt[_-]?out/i.test(messageText) || isOptOutMessage(messageText))
      );

      return {
        raw,
        fromPhone,
        messageText,
        messageId,
        isOptOut,
        ignored: fromMe || isGroup || !fromPhone || !messageText
      };
    }
  };
}

export function buildEvolutionButtonMessage(
  message: string,
  buttons: Array<z.infer<typeof buttonSchema>>
) {
  const replyButtons = buttons.filter((button) => button.type === "reply");
  const actionButtons = buttons.filter((button) => button.type !== "reply");

  if (!replyButtons.length || !actionButtons.length) {
    return {
      description: message,
      buttons: buttons.map(toEvolutionButton)
    };
  }

  const actionLines = actionButtons
    .map(formatEvolutionActionLine)
    .filter((line): line is string => Boolean(line));

  return {
    description: actionLines.length ? `${message}\n\n${actionLines.join("\n")}` : message,
    buttons: replyButtons.map(toEvolutionButton)
  };
}

function formatEvolutionActionLine(button: z.infer<typeof buttonSchema>) {
  const label = button.label.trim();
  const value = button.value?.trim();
  if (!value) return undefined;
  if (button.type === "url") return `Link — ${label}: ${value}`;
  if (button.type === "call") return `Telefone — ${label}: ${value}`;
  if (button.type === "copy") return `Código — ${label}: ${value}`;
  return undefined;
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

function extractString(payload: Record<string, unknown>, paths: string[]) {
  for (const path of paths) {
    const value = getPath(payload, path);
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function extractBoolean(payload: Record<string, unknown>, paths: string[]) {
  for (const path of paths) {
    const value = getPath(payload, path);
    if (typeof value === "boolean") return value;
  }
  return undefined;
}

function getPath(payload: Record<string, unknown>, path: string) {
  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[key];
  }, payload);
}
