import type { CardNetwork } from "./types";

export const CARD_NETWORKS = [
  { value: "visa", label: "Visa", logoPath: "/card_banner/Visa_Inc._logo_(2005%E2%80%932014).svg" },
  { value: "mastercard", label: "MasterCard", logoPath: "/card_banner/Mastercard-Logo.wine.svg" },
  { value: "elo", label: "Elo", logoPath: "/card_banner/elo-30.svg" },
] as const satisfies readonly { value: CardNetwork; label: string; logoPath: string }[];

export const CARD_TYPES = [
  ["credit", "Crédito"],
  ["debit", "Débito"],
] as const;

export function normalizeCardNetwork(value?: string): CardNetwork | undefined {
  const normalized = value?.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]/gi, "").toLowerCase();
  if (normalized === "visa") return "visa";
  if (normalized === "mastercard" || normalized === "master") return "mastercard";
  if (normalized === "elo") return "elo";
  return undefined;
}

export function cardNetworkDetails(value?: string) {
  const network = normalizeCardNetwork(value);
  return CARD_NETWORKS.find((item) => item.value === network);
}
