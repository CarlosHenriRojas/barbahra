import { describe, expect, it } from "vitest";
import { buildCampaignQueue, buildQueueSchedule } from "../lib/queue";
import { demoCampaign, demoContacts, demoVariants } from "../lib/demo-data";

describe("buildCampaignQueue", () => {
  it("creates queued jobs for valid contacts", () => {
    const jobs = buildCampaignQueue({
      campaign: demoCampaign,
      contacts: demoContacts,
      variants: demoVariants,
      optedOutPhones: new Set()
    });

    expect(jobs).toHaveLength(3);
    expect(jobs.map((job) => job.status)).toEqual(["queued", "queued", "queued"]);
  });

  it("keeps unchecked contacts in the queue so the worker can verify them at send time", () => {
    const jobs = buildCampaignQueue({
      campaign: demoCampaign,
      contacts: demoContacts.map((contact) => ({
        ...contact,
        whatsappStatus: "unchecked" as const
      })),
      variants: demoVariants,
      optedOutPhones: new Set()
    });

    expect(jobs).toHaveLength(3);
  });

  it("does not queue contacts already known to be without WhatsApp", () => {
    const jobs = buildCampaignQueue({
      campaign: demoCampaign,
      contacts: demoContacts.map((contact, index) =>
        index === 0 ? { ...contact, whatsappStatus: "invalid" as const } : contact
      ),
      variants: demoVariants,
      optedOutPhones: new Set()
    });

    expect(jobs).toHaveLength(2);
    expect(jobs.map((job) => job.contactId)).not.toContain(demoContacts[0].id);
  });

  it("blocks contacts with opt-out", () => {
    const jobs = buildCampaignQueue({
      campaign: demoCampaign,
      contacts: demoContacts,
      variants: demoVariants,
      optedOutPhones: new Set([demoContacts[0].phone])
    });

    expect(jobs).toHaveLength(2);
    expect(jobs[0].contactId).toBe(demoContacts[1].id);
  });

  it("selects variants using allocation percentages", () => {
    const jobs = buildCampaignQueue({
      campaign: demoCampaign,
      contacts: demoContacts,
      variants: [
        { ...demoVariants[0], allocationPercent: 100 },
        { ...demoVariants[1], allocationPercent: 0 }
      ],
      optedOutPhones: new Set(),
      random: () => 0.99
    });

    expect(jobs.map((job) => job.variantId)).toEqual([
      demoVariants[0].id,
      demoVariants[0].id,
      demoVariants[0].id
    ]);
  });

  it("schedules jobs using the configured interval range", () => {
    const schedule = buildQueueSchedule(3, {
      config: demoCampaign.sendingConfig,
      random: () => 0,
      startAt: new Date("2026-06-01T12:00:00.000Z")
    });

    expect(schedule).toHaveLength(3);
    expect(schedule[0].delaySeconds).toBe(0);
    expect(schedule[1].delaySeconds).toBe(demoCampaign.sendingConfig.minIntervalSeconds);
    expect(schedule[2].delaySeconds).toBe(demoCampaign.sendingConfig.minIntervalSeconds);
  });
});
