import Decimal from "decimal.js";

export function money(value: string | number, currency = "BRL") {
  const numeric = new Decimal(value || 0).toNumber();
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(numeric);
  } catch {
    return `${currency} ${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2 }).format(numeric)}`;
  }
}

export const decimalInput = (value: FormDataEntryValue | null, fallback = "0") => {
  const normalized = String(value ?? "")
    .trim()
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  try {
    return new Decimal(normalized || fallback).toString();
  } catch {
    return fallback;
  }
};

export const dateLabel = (value: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(
    new Date(`${value.slice(0, 10)}T12:00:00Z`),
  );
export const monthLabel = (value: string) =>
  new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${value}-15T12:00:00Z`),
  );
