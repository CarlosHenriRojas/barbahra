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
