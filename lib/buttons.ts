import type { MessageButton, MessageType, MessageVariant } from "./types";

export const optOutButton: MessageButton = {
  id: "opt_out",
  label: "Não receber mais contatos",
  type: "reply",
  isOptOut: true
};

export function ensureOptOutButton(buttons: MessageButton[] = []) {
  const withoutDuplicate = buttons.filter((button) => !button.isOptOut && button.id !== "opt_out");
  return [...withoutDuplicate, optOutButton];
}

export function normalizeVariantButtons(variant: MessageVariant): MessageVariant {
  const messageType: MessageType = variant.messageType ?? "buttons";

  return {
    ...variant,
    messageType,
    buttons: messageType === "buttons" ? ensureOptOutButton(variant.buttons) : []
  };
}
