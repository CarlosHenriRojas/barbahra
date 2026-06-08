const defaultKeywords = [
  "sair",
  "parar",
  "remover",
  "descadastrar",
  "cancelar",
  "nao receber",
  "não receber",
  "nao receber mais contatos",
  "não receber mais contatos"
];

export function isOptOutMessage(message: string, keywords = defaultKeywords) {
  const normalized = message
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

  return keywords.some((keyword) => {
    const normalizedKeyword = keyword
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
    return new RegExp(`(^|\\s)${escapeRegExp(normalizedKeyword)}($|\\s|[.!?])`).test(
      normalized
    );
  });
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
