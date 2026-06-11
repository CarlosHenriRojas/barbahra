import { z } from "zod";

export const campaignSendingConfigSchema = z.object({
  minIntervalSeconds: z.number().int().min(15).max(3600),
  maxIntervalSeconds: z.number().int().min(15).max(7200),
  dailyStartTime: z.string().regex(/^\d{2}:\d{2}$/),
  dailyEndTime: z.string().regex(/^\d{2}:\d{2}$/)
});

const contactStatusSchema = z.enum([
  "imported",
  "queued",
  "sent",
  "error",
  "replied",
  "opt_out",
  "no_whatsapp"
]);

const whatsappStatusSchema = z.enum(["unchecked", "checking", "valid", "invalid"]);

export const campaignSnapshotSchema = z.object({
  campaign: z.object({
    name: z.string().min(1),
    consentBasis: z.string().min(1),
    sendingConfig: campaignSendingConfigSchema
  }),
  contacts: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      phone: z.string(),
      company: z.string().optional(),
      customFields: z.record(z.string()),
      status: contactStatusSchema,
      whatsappStatus: whatsappStatusSchema,
      errors: z.array(z.string()),
      duplicate: z.boolean()
    })
  ),
  variants: z.array(
    z.object({
      id: z.string(),
      label: z.string().min(1),
      body: z.string().min(1),
      messageType: z.enum(["text", "buttons"]).default("buttons"),
      allocationPercent: z.number().int().min(0).max(100).default(0),
      buttons: z.array(
        z.object({
          id: z.string().min(1),
          label: z.string().min(1),
          type: z.enum(["reply", "url", "call", "copy"]),
          value: z.string().optional(),
          isOptOut: z.boolean().optional()
        })
      )
    })
  ),
  jobs: z.array(
    z.object({
      id: z.string(),
      contactId: z.string(),
      variantId: z.string(),
      renderedMessage: z.string().min(1),
      messageType: z.enum(["text", "buttons"]).default("buttons"),
      buttons: z.array(
        z.object({
          id: z.string().min(1),
          label: z.string().min(1),
          type: z.enum(["reply", "url", "call", "copy"]),
          value: z.string().optional(),
          isOptOut: z.boolean().optional()
        })
      ),
      status: contactStatusSchema,
      error: z.string().optional(),
      scheduledAt: z.string().optional(),
      delaySeconds: z.number().optional()
    })
  )
});
