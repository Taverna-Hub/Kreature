import { catalogInstitution } from "@/domain/institution-catalog";
import type { Institution } from "@/domain/types";

export function InstitutionLogo({ institution, size = 28 }: { institution?: Institution; size?: number }) {
  const catalog = catalogInstitution(institution?.logoKey ?? institution?.catalogId);
  if (!catalog) return <span className="institution-fallback" style={{ width: size, height: size }} aria-hidden="true">{institution?.name.slice(0, 1) ?? "?"}</span>;
  return <img className="institution-logo official" src={catalog.logoPath} width={size} height={size} alt={`Logo ${institution?.name ?? catalog.name}`} />;
}
