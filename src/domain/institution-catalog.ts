import type { InstitutionCatalogId, InstitutionLogoKey, InstitutionType } from "./types";

export interface InstitutionCatalogItem {
  id: InstitutionCatalogId; name: string; type: InstitutionType; bankCode?: string; logoKey: InstitutionLogoKey; logoPath: string;
  primaryColor: string; secondaryColor: string; foregroundColor: string; aliases: string[];
}
type CatalogSeed = [InstitutionCatalogId, string, InstitutionType, string | undefined, string, string, string];
const seed: CatalogSeed[] = [
  ["nubank", "Nubank", "bank", "260", "#820ad1", "#5d0798", "#ffffff"], ["itau", "Itaú", "bank", "341", "#ec7000", "#c55400", "#ffffff"],
  ["inter", "Inter", "bank", "077", "#ff7a00", "#dd5600", "#ffffff"], ["bradesco", "Bradesco", "bank", "237", "#cc092f", "#9e0624", "#ffffff"],
  ["santander", "Santander", "bank", "033", "#ec0000", "#b40000", "#ffffff"], ["banco-do-brasil", "Banco do Brasil", "bank", "001", "#f8d117", "#1e3a8a", "#102a63"],
  ["caixa", "Caixa", "bank", "104", "#005ca9", "#003e78", "#ffffff"], ["c6", "C6 Bank", "bank", "336", "#1a1a1a", "#000000", "#ffffff"],
  ["btg-pactual", "BTG Pactual", "broker", "208", "#153d6b", "#0b294d", "#ffffff"], ["xp", "XP Investimentos", "broker", undefined, "#111827", "#030712", "#ffffff"],
  ["rico", "Rico", "broker", undefined, "#00a651", "#00753a", "#ffffff"], ["clear", "Clear", "broker", undefined, "#00a6e0", "#007ead", "#ffffff"],
  ["mercado-pago", "Mercado Pago", "wallet", undefined, "#009ee3", "#007eb6", "#ffffff"], ["picpay", "PicPay", "wallet", undefined, "#21c25e", "#12873d", "#ffffff"],
  ["neon", "Neon", "bank", "536", "#00e5ff", "#15224f", "#15224f"], ["wise", "Wise", "wallet", undefined, "#9fe870", "#163300", "#163300"],
];
export const INSTITUTION_CATALOG: readonly InstitutionCatalogItem[] = seed.map(([id, name, type, bankCode, primaryColor, secondaryColor, foregroundColor]) => ({ id, name, type, bankCode, primaryColor, secondaryColor, foregroundColor, logoKey: id as InstitutionLogoKey, logoPath: `/institutions/${id}.svg`, aliases: [name, name.replace(/\s+/g, ""), id.replace(/-/g, " ")] }));
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim();
export function searchInstitutionCatalog(query: string): InstitutionCatalogItem[] { const term = normalize(query); return !term ? [...INSTITUTION_CATALOG] : INSTITUTION_CATALOG.filter((item) => item.aliases.some((alias) => normalize(alias).includes(term))); }
export function catalogInstitution(id?: string) { return INSTITUTION_CATALOG.find((item) => item.id === id); }
