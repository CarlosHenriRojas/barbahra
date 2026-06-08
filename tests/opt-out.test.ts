import { describe, expect, it } from "vitest";
import { isOptOutMessage } from "../lib/opt-out";

describe("isOptOutMessage", () => {
  it("detects configured opt-out keywords", () => {
    expect(isOptOutMessage("Por favor, remover meu contato.")).toBe(true);
    expect(isOptOutMessage("Quero sair")).toBe(true);
  });

  it("does not match unrelated text", () => {
    expect(isOptOutMessage("Pode enviar mais detalhes")).toBe(false);
  });
});
