import { renderMessage, selectVariantByAllocation } from "./message";
import { normalizeVariantButtons } from "./buttons";
import type {
  Campaign,
  CampaignSendingConfig,
  Contact,
  MessageJob,
  MessageVariant
} from "./types";

export function buildCampaignQueue({
  campaign,
  contacts,
  variants,
  optedOutPhones,
  random = Math.random
}: {
  campaign: Campaign;
  contacts: Contact[];
  variants: MessageVariant[];
  optedOutPhones: Set<string>;
  random?: () => number;
}) {
  const eligible = eligibleContacts(contacts, optedOutPhones);
  const schedule = buildQueueSchedule(eligible.length, {
    config: campaign.sendingConfig,
    startAt: new Date()
  });

  return eligible.reduce<MessageJob[]>((jobs, contact, index) => {
    const variant = selectVariantByAllocation(variants, random);
    if (!variant) return jobs;

    const normalizedVariant = normalizeVariantButtons(variant);
    const rendered = renderMessage(normalizedVariant.body, contact);
    jobs.push({
      id: crypto.randomUUID(),
      campaignId: campaign.id,
      contactId: contact.id,
      variantId: normalizedVariant.id,
      renderedMessage: rendered.text,
      messageType: normalizedVariant.messageType,
      buttons: normalizedVariant.buttons,
      status: rendered.missing.length ? "error" : "queued",
      error: rendered.missing.length
        ? `Variaveis sem valor: ${rendered.missing.join(", ")}`
        : undefined,
      scheduledAt: schedule[index]?.scheduledAt.toISOString(),
      delaySeconds: schedule[index]?.delaySeconds
    });
    return jobs;
  }, []);
}

export function normalizeSendingConfig(
  config: CampaignSendingConfig
): CampaignSendingConfig {
  const minIntervalSeconds = clamp(Math.round(config.minIntervalSeconds), 15, 3600);
  const maxIntervalSeconds = clamp(
    Math.round(config.maxIntervalSeconds),
    minIntervalSeconds,
    7200
  );

  return {
    minIntervalSeconds,
    maxIntervalSeconds,
    dailyStartTime: config.dailyStartTime || "09:00",
    dailyEndTime: config.dailyEndTime || "18:00"
  };
}

export function buildQueueSchedule(
  count: number,
  {
    config,
    random = Math.random,
    startAt = new Date()
  }: {
    config: CampaignSendingConfig;
    random?: () => number;
    startAt?: Date;
  }
) {
  const normalized = normalizeSendingConfig(config);
  const schedule: Array<{ scheduledAt: Date; delaySeconds: number }> = [];
  let cursor = alignToSendingWindow(new Date(startAt), normalized);

  for (let index = 0; index < count; index += 1) {
    const delaySeconds =
      index === 0
        ? 0
        : randomInt(
            normalized.minIntervalSeconds,
            normalized.maxIntervalSeconds,
            random
          );

    cursor = alignToSendingWindow(addSeconds(cursor, delaySeconds), normalized);
    schedule.push({ scheduledAt: new Date(cursor), delaySeconds });
  }

  return schedule;
}

export function calculateMetrics(contacts: Contact[], jobs: MessageJob[]) {
  return {
    spreadsheetsImported: contacts.length ? 1 : 0,
    imported: contacts.length,
    contacts: contacts.length,
    queued: jobs.filter((job) => job.status === "queued").length,
    sent: jobs.filter((job) => job.status === "sent").length,
    error:
      contacts.filter((contact) => contact.status === "error").length +
      jobs.filter((job) => job.status === "error").length,
    replied: contacts.filter((contact) => contact.status === "replied").length,
    optOut: contacts.filter((contact) => contact.status === "opt_out").length,
    whatsappValid: contacts.filter((contact) => contact.whatsappStatus === "valid").length,
    whatsappInvalid: contacts.filter((contact) => contact.whatsappStatus === "invalid").length,
    whatsappUnchecked: contacts.filter((contact) => contact.whatsappStatus === "unchecked").length
  };
}

function eligibleContacts(contacts: Contact[], optedOutPhones: Set<string>) {
  return contacts.filter(
    (contact) =>
      contact.errors.length === 0 &&
      !contact.duplicate &&
      contact.status !== "opt_out" &&
      contact.status !== "no_whatsapp" &&
      contact.whatsappStatus !== "invalid" &&
      !optedOutPhones.has(contact.phone)
  );
}

function alignToSendingWindow(date: Date, config: CampaignSendingConfig) {
  const [startHour, startMinute] = parseTime(config.dailyStartTime);
  const [endHour, endMinute] = parseTime(config.dailyEndTime);
  const start = new Date(date);
  start.setHours(startHour, startMinute, 0, 0);
  const end = new Date(date);
  end.setHours(endHour, endMinute, 0, 0);

  if (date < start) return start;
  if (date > end || start >= end) {
    const nextDay = new Date(start);
    nextDay.setDate(nextDay.getDate() + 1);
    return nextDay;
  }

  return date;
}

function parseTime(value: string) {
  const [hour, minute] = value.split(":").map((part) => Number(part));
  return [
    Number.isFinite(hour) ? hour : 9,
    Number.isFinite(minute) ? minute : 0
  ] as const;
}

function addSeconds(date: Date, seconds: number) {
  return new Date(date.getTime() + seconds * 1000);
}

function randomInt(min: number, max: number, random: () => number) {
  return Math.floor(random() * (max - min + 1)) + min;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
