import { Wifi } from "lucide-react";
import { catalogInstitution, searchInstitutionCatalog } from "@/domain/institution-catalog";
import type { CreditCard } from "@/domain/types";
import { cardNetworkDetails } from "@/domain/card-brands";

export function CreditCardVisual({ card }: { card: CreditCard }) {
  const searchableIdentity = `${card.issuerName ?? ""} ${card.name}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  const issuer = catalogInstitution(card.issuer) ?? searchInstitutionCatalog("").find((item) => searchableIdentity.includes(item.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR")) || searchableIdentity.includes(item.id));
  const institutionId = issuer?.id ?? "other";
  const primary = issuer?.id === "mercado-pago" ? "#111111" : issuer?.primaryColor ?? "#3730a3";
  const secondary = issuer?.secondaryColor ?? "#1e1b4b";
  const foreground = issuer?.foregroundColor ?? "#ffffff";
  const network = cardNetworkDetails(card.network);
  const cardType = card.cardType === "debit" ? "DÉBITO" : "CRÉDITO";
  return <article className={`credit-card-visual credit-card-${institutionId}`} style={{ "--card-primary": primary, "--card-secondary": secondary, "--card-foreground": foreground } as React.CSSProperties} aria-label={`Cartão ${card.name}`}>
    <div className={`credit-card-noise credit-card-noise-${institutionId}`} aria-hidden="true" />
    <div className={`credit-card-art credit-card-art-${institutionId}`} aria-hidden="true"><span /><span /><span /><span /></div>
    <header><span className={`credit-card-issuer credit-card-issuer-${institutionId}`}>{issuer ? <img src={issuer.logoPath} alt={`Logo ${issuer.name}`} /> : card.issuerName ?? "Cartão"}</span><Wifi aria-hidden="true" /></header>
    <div className="credit-card-middle"><div className="credit-card-chip"><img src="/card_banner/chip.png" alt="" aria-hidden="true" /></div><div className="credit-card-number">•••• •••• •••• {card.lastFour ?? "••••"}</div></div>
    <footer><span><small>{card.cardholderName ? "Titular" : "Cartão"}</small><strong>{card.cardholderName ?? card.name}</strong></span><span className="credit-card-branding">
      {network ? <img className={`credit-card-network-logo network-${network.value}`} src={network.logoPath} alt={network.label} /> : null}
      <span className="credit-card-type">{cardType}</span>
    </span></footer>
  </article>;
}
