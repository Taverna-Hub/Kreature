import type { InstitutionCatalogId } from "@/domain/types";

const bankPatterns: Array<[InstitutionCatalogId, RegExp]> = [
  ["nubank", /\bnubank\b|nu pagamentos|nupay/gi],
  ["itau", /ita[uú]|unibanco/gi],
  ["inter", /banco inter|\binter\b/gi],
  ["bradesco", /bradesco/gi],
  ["santander", /santander/gi],
  ["banco-do-brasil", /banco do brasil|\bbb\b/gi],
  ["caixa", /caixa econ[oô]mica|\bcaixa\b/gi],
  ["c6", /\bc6 bank\b|\bc6\b/gi],
  ["btg-pactual", /btg pactual|banco btg/gi],
  ["xp", /xp investimentos|\bxp\b/gi],
  ["rico", /rico investimentos|corretora rico/gi],
  ["clear", /clear corretora|clear investimentos/gi],
  ["mercado-pago", /mercado pago/gi],
  ["picpay", /picpay/gi],
  ["neon", /banco neon|\bneon\b/gi],
  ["wise", /\bwise\b/gi],
];

const mentionedInstitutions = (text: string) => bankPatterns
  .filter(([, pattern]) => {
    pattern.lastIndex = 0;
    const matches = pattern.test(text);
    pattern.lastIndex = 0;
    return matches;
  })
  .map(([id]) => id);

export const detectCounterpartyInstitution = (text: string, source?: InstitutionCatalogId) => {
  const matches = mentionedInstitutions(text).filter((id) => id !== source);
  return matches.length === 1 ? matches[0] : undefined;
};
/** O emissor assina o topo do documento; no corpo, os nomes citados são contrapartes. */
const headerLength = 600;

/** Nubank exports account CSVs as NU_<account>_<period>.csv. */
const institutionFromFileName = (text: string): InstitutionCatalogId | undefined => {
  const fileName = text.split(/\r?\n/, 1)[0].trim();
  return /^NU_[^/\\]+\.csv$/i.test(fileName) ? "nubank" : undefined;
};

/**
 * Antes a primeira regra que casasse vencia, então um extrato da XP com uma única
 * transferência do Santander virava Santander. Agora vale quem assina o cabeçalho e,
 * na falta disso, quem é mais citado no documento inteiro.
 */
export function detectStatementInstitution(text: string): InstitutionCatalogId | undefined {
  const fileInstitution = institutionFromFileName(text);
  if (fileInstitution) return fileInstitution;

  const header = text.slice(0, headerLength);
  const signature = bankPatterns
    .map(([id, pattern]) => [id, header.search(pattern)] as const)
    .filter(([, at]) => at >= 0)
    .sort(([, a], [, b]) => a - b)[0];
  if (signature) return signature[0];

  let best: { id: InstitutionCatalogId; mentions: number } | undefined;
  for (const [id, pattern] of bankPatterns) {
    const mentions = (text.match(pattern) ?? []).length;
    if (mentions && (!best || mentions > best.mentions)) best = { id, mentions };
  }
  return best?.id;
}
