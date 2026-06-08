import { describe, expect, it } from "vitest";
import { mapRowsToContacts, parseCsvText, uniqueHeaders } from "../lib/spreadsheet";

describe("parseCsvText", () => {
  it("parses semicolon CSV files exported by Brazilian spreadsheets", () => {
    const matrix = parseCsvText(
      "Nome;Telefone;Produto;Upsell\nMariana;(11) 99999-1111;Curso Base;Mentoria"
    );

    expect(matrix).toEqual([
      ["Nome", "Telefone", "Produto", "Upsell"],
      ["Mariana", "(11) 99999-1111", "Curso Base", "Mentoria"]
    ]);
  });

  it("parses quoted comma values", () => {
    const matrix = parseCsvText(
      'Nome,Telefone,Observacao\n"Mariana, A.",11999991111,"Lead quente"'
    );

    expect(matrix[1]).toEqual(["Mariana, A.", "11999991111", "Lead quente"]);
  });

  it("suffixes repeated header names", () => {
    expect(uniqueHeaders(["Nome", "Moeda", "Moeda", ""])).toEqual([
      "Nome",
      "Moeda",
      "Moeda 2",
      "Coluna 4"
    ]);
  });
});

describe("mapRowsToContacts", () => {
  it("maps CSV rows to contacts with flexible columns", () => {
    const rows = [
      {
        id: "1",
        raw: {
          Nome: "Mariana",
          Telefone: "(11) 99999-1111",
          Produto: "Curso Base",
          Upsell: "Mentoria"
        }
      }
    ];

    const contacts = mapRowsToContacts(rows, {
      nameColumn: "Nome",
      phoneColumn: "Telefone",
      customColumns: ["Produto", "Upsell"]
    });

    expect(contacts[0].phone).toBe("5511999991111");
    expect(contacts[0].customFields.Upsell).toBe("Mentoria");
    expect(contacts[0].errors).toEqual([]);
  });

  it("removes duplicate valid phone numbers after normalization", () => {
    const rows = [
      {
        id: "1",
        raw: {
          Nome: "Mariana",
          Telefone: "(11) 99999-1111"
        }
      },
      {
        id: "2",
        raw: {
          Nome: "Mariana duplicada",
          Telefone: "5511999991111"
        }
      },
      {
        id: "3",
        raw: {
          Nome: "Renato",
          Telefone: "(21) 99999-2222"
        }
      }
    ];

    const contacts = mapRowsToContacts(rows, {
      nameColumn: "Nome",
      phoneColumn: "Telefone",
      customColumns: []
    });

    expect(contacts).toHaveLength(2);
    expect(contacts.map((contact) => contact.phone)).toEqual([
      "5511999991111",
      "5521999992222"
    ]);
    expect(contacts.some((contact) => contact.duplicate)).toBe(false);
  });
});
