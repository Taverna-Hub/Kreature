import type { InstitutionCatalogId, InstitutionLogoKey, InstitutionType } from "./types";

export interface InstitutionCatalogItem {
  id: InstitutionCatalogId;
  name: string;
  type: InstitutionType;
  bankCode?: string;
  logoKey: InstitutionLogoKey;
  /** A bundled, accessible vector logo. The UI never needs a remote request. */
  logoPath: string;
  aliases: string[];
}

export const INSTITUTION_CATALOG: readonly InstitutionCatalogItem[] = [
  ["nubank", "Nubank", "bank", "260"],
  ["itau", "Itaú", "bank", "341"],
  ["inter", "Inter", "bank", "077"],
  ["bradesco", "Bradesco", "bank", "237"],
  ["santander", "Santander", "bank", "033"],
  ["banco-do-brasil", "Banco do Brasil", "bank", "001"],
  ["caixa", "Caixa", "bank", "104"],
  ["c6", "C6 Bank", "bank", "336"],
  ["btg-pactual", "BTG Pactual", "broker", "208"],
  ["xp", "XP Investimentos", "broker"],
  ["rico", "Rico", "broker"],
  ["clear", "Clear", "broker"],
  ["mercado-pago", "Mercado Pago", "wallet"],
  ["picpay", "PicPay", "wallet"],
  ["neon", "Neon", "bank", "536"],
  ["wise", "Wise", "wallet"],
].map(([id, name, type, bankCode]) => ({
  id: id as InstitutionCatalogId,
  name,
  type: type as InstitutionType,
  bankCode,
  logoKey: id as InstitutionLogoKey,
  logoPath: `/institutions/${id}.svg`,
  aliases: [name, name.replace(/\s+/g, ""), String(id).replace(/-/g, " ")],
}));

const normalize = (value: string) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim();

export function searchInstitutionCatalog(query: string): InstitutionCatalogItem[] {
  const term = normalize(query);
  if (!term) return [...INSTITUTION_CATALOG];
  return INSTITUTION_CATALOG.filter((item) =>
    item.aliases.some((alias) => normalize(alias).includes(term)),
  );
}

export function catalogInstitution(id?: string) {
  return INSTITUTION_CATALOG.find((item) => item.id === id);
}
