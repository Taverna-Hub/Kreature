import { CreditCard as Chip, Wifi } from "lucide-react";
import { catalogInstitution } from "@/domain/institution-catalog";
import type { CreditCard } from "@/domain/types";

export function CreditCardVisual({ card }: { card: CreditCard }) {
  const issuer = catalogInstitution(card.issuer);
  const primary = issuer?.primaryColor ?? "#3730a3";
  const secondary = issuer?.secondaryColor ?? "#1e1b4b";
  const foreground = issuer?.foregroundColor ?? "#ffffff";
  return <article className="credit-card-visual" style={{ "--card-primary": primary, "--card-secondary": secondary, "--card-foreground": foreground } as React.CSSProperties} aria-label={`Cartão ${card.name}`}>
    <div className="credit-card-noise" aria-hidden="true" /><header><span className="credit-card-issuer">{issuer ? <img src={issuer.logoPath} alt={`Logo ${issuer.name}`} /> : card.issuerName ?? "Cartão"}</span><Wifi aria-hidden="true" /></header>
    <div className="credit-card-chip"><Chip aria-hidden="true" /></div><div className="credit-card-number">•••• •••• •••• {card.lastFour ?? "••••"}</div>
    <footer><span><small>{card.cardholderName ? "Titular" : "Cartão"}</small><strong>{card.cardholderName ?? card.name}</strong></span><span className="credit-card-network">{card.network ?? "CRÉDITO"}</span></footer>
  </article>;
}
