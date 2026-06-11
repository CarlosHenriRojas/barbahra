import { renderMessage, selectVariantByAllocation } from "./message";
import { normalizeVariantButtons } from "./buttons";
import type {
  Campaign,
  CampaignSendingConfig,
  Contact,
  MessageJob,
  MessageVariant
} from "./types";

const defaultSchedulingTimeZone = "America/Sao_Paulo";

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
    startAt = new Date(),
    timeZone = defaultSchedulingTimeZone
  }: {
    config: CampaignSendingConfig;
    random?: () => number;
    startAt?: Date;
    timeZone?: string;
  }
) {
  const normalized = normalizeSendingConfig(config);
  const schedule: Array<{ scheduledAt: Date; delaySeconds: number }> = [];
  let cursor = alignToSendingWindow(new Date(startAt), normalized, timeZone);

  for (let index = 0; index < count; index += 1) {
    const delaySeconds =
      index === 0
        ? 0
        : randomInt(
            normalized.minIntervalSeconds,
            normalized.maxIntervalSeconds,
            random
          );

    cursor = alignToSendingWindow(addSeconds(cursor, delaySeconds), normalized, timeZone);
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

function alignToSendingWindow(date: Date, config: CampaignSendingConfig, timeZone: string) {
  const [startHour, startMinute] = parseTime(config.dailyStartTime);
  const [endHour, endMinute] = parseTime(config.dailyEndTime);
  const local = getZonedParts(date, timeZone);
  const currentMinutes = local.hour * 60 + local.minute;
  const startMinutes = startHour * 60 + startMinute;
  const endMinutes = endHour * 60 + endMinute;

  const start = zonedTimeToDate(
    local.year,
    local.month,
    local.day,
    startHour,
    startMinute,
    timeZone
  );
  if (currentMinutes < startMinutes) return start;
  if (currentMinutes > endMinutes || startMinutes >= endMinutes) {
    return addDays(start, 1);
  }

  return date;
}

function getZonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);

  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const hour = value("hour");

  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: hour === 24 ? 0 : hour,
    minute: value("minute")
  };
}

function zonedTimeToDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
) {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
  const offsetMinutes = getTimeZoneOffsetMinutes(utcGuess, timeZone);
  return new Date(utcGuess.getTime() - offsetMinutes * 60_000);
}

function getTimeZoneOffsetMinutes(date: Date, timeZone: string) {
  const parts = getZonedParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  return (asUtc - date.getTime()) / 60_000;
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

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function randomInt(min: number, max: number, random: () => number) {
  return Math.floor(random() * (max - min + 1)) + min;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
