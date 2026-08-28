import type { Institution } from "@/domain/types";

const MARKS: Record<string, { label: string; color: string; foreground?: string }> = {
  nubank: { label: "nu", color: "#820ad1" }, itau: { label: "itaú", color: "#ec7000" }, inter: { label: "inter", color: "#ff7a00" },
  bradesco: { label: "bra", color: "#cc092f" }, santander: { label: "san", color: "#ec0000" }, "banco-do-brasil": { label: "BB", color: "#f8d117", foreground: "#1e3a8a" },
  caixa: { label: "CAIXA", color: "#005ca9" }, c6: { label: "C6", color: "#151515" }, "btg-pactual": { label: "BTG", color: "#153d6b" },
  xp: { label: "XP", color: "#111827" }, rico: { label: "rico", color: "#00a651" }, clear: { label: "clear", color: "#00a6e0" },
  "mercado-pago": { label: "MP", color: "#009ee3" }, picpay: { label: "pic", color: "#21c25e" }, neon: { label: "neon", color: "#00e5ff", foreground: "#15224f" }, wise: { label: "wise", color: "#9fe870", foreground: "#163300" },
};
const OFFICIAL_SVGS = new Set(["nubank", "itau", "inter", "bradesco", "santander", "banco-do-brasil", "c6", "btg-pactual", "xp", "mercado-pago", "picpay", "neon"]);

export function InstitutionLogo({ institution, size = 28 }: { institution?: Institution; size?: number }) {
  const mark = institution?.logoKey ? MARKS[institution.logoKey] : undefined;
  if (!mark) return <span className="institution-fallback" style={{ width: size, height: size }} aria-hidden="true">{institution?.name.slice(0, 1) ?? "?"}</span>;
  if (institution?.logoKey && OFFICIAL_SVGS.has(institution.logoKey)) return <img className="institution-logo official" src={`/institutions/${institution.logoKey}.svg`} width={size} height={size} alt={`Logo ${institution.name}`} />;
  const textSize = mark.label.length > 4 ? 6.6 : mark.label.length > 3 ? 8 : 11;
  return <svg className="institution-logo" viewBox="0 0 32 32" width={size} height={size} role="img" aria-label={`Marca ${institution?.name}`}>
    <rect width="32" height="32" rx="10" fill={mark.color} />
    <text x="16" y="19.7" textAnchor="middle" fill={mark.foreground ?? "#fff"} fontFamily="Sora, sans-serif" fontWeight="800" fontSize={textSize}>{mark.label}</text>
  </svg>;
}
