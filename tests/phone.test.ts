import { describe, expect, it } from "vitest";
import { buildBrazilianWhatsappCandidates, normalizeBrazilianPhone } from "../lib/phone";

describe("normalizeBrazilianPhone", () => {
  it("normalizes masked Brazilian mobile numbers", () => {
    expect(normalizeBrazilianPhone("(11) 99999-1111")).toEqual({
      value: "5511999991111",
      valid: true
    });
  });

  it("rejects empty values", () => {
    const result = normalizeBrazilianPhone("");
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("Telefone vazio");
  });

  it("builds candidates for numbers without Brazil country code", () => {
    expect(buildBrazilianWhatsappCandidates("(11) 99999-1111")).toEqual([
      "5511999991111",
      "551199991111"
    ]);
  });

  it("builds candidates for mobile numbers without the ninth digit", () => {
    expect(buildBrazilianWhatsappCandidates("1133334444")).toEqual([
      "551133334444",
      "5511933334444"
    ]);
  });
});
