import type { InstitutionCatalogId } from "@/domain/types";

const bankPatterns: Array<[InstitutionCatalogId, RegExp]> = [
  ["nubank", /\bnubank\b|nu pagamentos|nupay/i],
  ["itau", /ita[uú]|unibanco/i],
  ["inter", /banco inter|\binter\b/i],
  ["bradesco", /bradesco/i],
  ["santander", /santander/i],
  ["banco-do-brasil", /banco do brasil|\bbb\b/i],
  ["caixa", /caixa econ[oô]mica|\bcaixa\b/i],
  ["c6", /\bc6 bank\b|\bc6\b/i],
  ["btg-pactual", /btg pactual|banco btg/i],
  ["xp", /xp investimentos|\bxp\b/i],
  ["rico", /rico investimentos|corretora rico/i],
  ["clear", /clear corretora|clear investimentos/i],
  ["mercado-pago", /mercado pago/i],
  ["picpay", /picpay/i],
  ["neon", /banco neon|\bneon\b/i],
  ["wise", /\bwise\b/i],
];

export function detectStatementInstitution(text: string): InstitutionCatalogId | undefined {
  return bankPatterns.find(([, pattern]) => pattern.test(text))?.[0];
}
