import readXlsxFile from "read-excel-file/browser";
import type { ColumnMapping, Contact, ImportedRow } from "./types";
import { normalizeBrazilianPhone } from "./phone";

export async function parseSpreadsheet(file: File): Promise<{
  headers: string[];
  rows: ImportedRow[];
}> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  const matrix =
    extension === "csv" || file.type === "text/csv"
      ? parseCsvText(await file.text())
      : ((await readXlsxFile(file)) as unknown as unknown[][]);

  return matrixToRows(matrix);
}

export function parseCsvText(text: string) {
  const normalized = text.replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(normalized);
  return parseDelimitedText(normalized, delimiter);
}

export function mapRowsToContacts(rows: ImportedRow[], mapping: ColumnMapping): Contact[] {
  const seenPhones = new Set<string>();

  return rows.reduce<Contact[]>((contacts, row) => {
    const name = row.raw[mapping.nameColumn]?.trim() ?? "";
    const phoneResult = normalizeBrazilianPhone(row.raw[mapping.phoneColumn] ?? "");
    const customFields = mapping.customColumns.reduce<Record<string, string>>((acc, column) => {
      acc[column] = row.raw[column] ?? "";
      return acc;
    }, {});

    const errors = [
      !name ? "Nome obrigatorio" : "",
      !phoneResult.valid ? phoneResult.reason ?? "Telefone invalido" : ""
    ].filter(Boolean);

    if (phoneResult.valid && seenPhones.has(phoneResult.value)) {
      return contacts;
    }

    if (phoneResult.valid) {
      seenPhones.add(phoneResult.value);
    }

    contacts.push({
      id: row.id,
      name,
      phone: phoneResult.value,
      company: mapping.companyColumn ? row.raw[mapping.companyColumn] : undefined,
      customFields,
      status: errors.length ? "error" : "imported",
      whatsappStatus: "unchecked",
      errors,
      duplicate: false
    });

    return contacts;
  }, []);
}

export function guessColumn(headers: string[], candidates: string[]) {
  const normalizedCandidates = candidates.map(normalizeHeader);
  return headers.find((header) => normalizedCandidates.includes(normalizeHeader(header))) ?? "";
}

function matrixToRows(matrix: unknown[][]) {
  const headers = uniqueHeaders((matrix[0] ?? []).map((header) => String(header ?? "").trim()));
  const rows = matrix
    .slice(1)
    .filter(hasValue)
    .map((line) => {
      const raw = headers.reduce<Record<string, string>>((acc, header, index) => {
        acc[header] = String(line[index] ?? "").trim();
        return acc;
      }, {});

      return {
        id: crypto.randomUUID(),
        raw
      };
    });

  return { headers, rows };
}

export function uniqueHeaders(headers: string[]) {
  const seen = new Map<string, number>();

  return headers.map((header, index) => {
    const base = header || `Coluna ${index + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base} ${count + 1}`;
  });
}

function normalizeHeader(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function hasValue(row: unknown[]) {
  return row.some((cell) => String(cell ?? "").trim().length > 0);
}

function detectDelimiter(text: string) {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim()) ?? "";
  const candidates = [",", ";", "\t"];
  return (
    candidates
      .map((delimiter) => ({
        delimiter,
        count: parseDelimitedLine(firstLine, delimiter).length
      }))
      .sort((a, b) => b.count - a.count)[0]?.delimiter ?? ","
  );
}

function parseDelimitedText(text: string, delimiter: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        cell += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell);
  rows.push(row);

  return rows.filter(hasValue);
}

function parseDelimitedLine(line: string, delimiter: string) {
  return parseDelimitedText(line, delimiter)[0] ?? [];
}
