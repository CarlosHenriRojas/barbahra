import { describe, expect, it } from "vitest";
import { renderMessage } from "../lib/message";
import type { Contact } from "../lib/types";

const contact: Contact = {
  id: "1",
  name: "Mariana",
  phone: "5511999991111",
  customFields: {
    produto_comprado: "Curso Base",
    upsell: "Mentoria"
  },
  status: "imported",
  whatsappStatus: "unchecked",
  errors: [],
  duplicate: false
};

describe("renderMessage", () => {
  it("replaces standard and custom variables", () => {
    const rendered = renderMessage(
      "Oi {{nome}}, vi seu {{produto_comprado}}. Próximo passo: {{upsell}}",
      contact
    );
    expect(rendered.text).toBe("Oi Mariana, vi seu Curso Base. Próximo passo: Mentoria");
    expect(rendered.missing).toEqual([]);
  });

  it("reports missing variables", () => {
    const rendered = renderMessage("Oi {{cargo}}", contact);
    expect(rendered.text).toBe("Oi");
    expect(rendered.missing).toEqual(["cargo"]);
  });

  it("resolves common spreadsheet column aliases", () => {
    const rendered = renderMessage(
      "Oi {{nome}}, vi seu {{produto_comprado}}. Próximo passo: {{upsell}}",
      {
        ...contact,
        customFields: {
          Produto: "Curso Base",
          Oferta: "Mentoria"
        }
      }
    );

    expect(rendered.text).toBe("Oi Mariana, vi seu Curso Base. Próximo passo: Mentoria");
    expect(rendered.missing).toEqual([]);
  });
});
