import { describe, expect, it } from "vitest";
import { campaignSnapshotSchema } from "../lib/server/schemas";

describe("campaignSnapshotSchema", () => {
  it("accepts contact rows that are invalid but carry validation errors", () => {
    const result = campaignSnapshotSchema.shape.contacts.safeParse([
      {
        id: "row-1",
        name: "",
        phone: "",
        customFields: {},
        status: "error",
        whatsappStatus: "unchecked",
        errors: ["Nome obrigatorio", "Telefone invalido"],
        duplicate: false
      }
    ]);

    expect(result.success).toBe(true);
  });
});
