import { catalogInstitution } from "@/domain/institution-catalog";
import type { Institution } from "@/domain/types";

export function InstitutionLogo({ institution, size = 28, symbolOnly = false }: { institution?: Institution; size?: number; symbolOnly?: boolean }) {
  const catalog = catalogInstitution(institution?.logoKey ?? institution?.catalogId);
  if (!catalog) return <span className="institution-fallback" style={{ width: size, height: size }} aria-hidden="true">{institution?.name.slice(0, 1) ?? "?"}</span>;
  const nubankSymbol = symbolOnly && catalog.id === "nubank";
  return <img className={`institution-logo official${nubankSymbol ? " institution-logo-symbol institution-logo-nubank" : ""}`} src={nubankSymbol ? "/institutions/nubank-symbol.svg" : catalog.logoPath} width={size} height={size} alt={`Logo ${institution?.name ?? catalog.name}`} />;
}
