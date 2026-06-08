import { describe, expect, it } from "vitest";
import { simulateWhatsappVerification } from "../lib/whatsapp";
import { demoContacts } from "../lib/demo-data";

describe("simulateWhatsappVerification", () => {
  it("marks numbers ending in configured invalid digits as no WhatsApp in demo mode", () => {
    const contact = simulateWhatsappVerification(demoContacts[2]);

    expect(contact.whatsappStatus).toBe("invalid");
    expect(contact.status).toBe("no_whatsapp");
    expect(contact.errors).toContain("Número sem WhatsApp");
  });

  it("keeps valid WhatsApp numbers eligible", () => {
    const contact = simulateWhatsappVerification(demoContacts[0]);

    expect(contact.whatsappStatus).toBe("valid");
    expect(contact.status).toBe("imported");
  });
});
