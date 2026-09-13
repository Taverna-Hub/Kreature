import Decimal from "decimal.js";
import { businessDate } from "./temporal";

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
    new Date(`${businessDate(value)}T12:00:00Z`),
  );
/** Rótulo curto para cabeçalhos de lançamentos agrupados por dia. */
export const transactionDayLabel = (value: string) =>
  new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" })
    .format(new Date(`${businessDate(value)}T12:00:00Z`))
    .replaceAll(".", "")
    .replace(", ", " - ")
    .replace(/(^| de )(\p{L})/gu, (_, prefix, letter) => `${prefix}${letter.toUpperCase()}`);
export const monthLabel = (value: string) =>
  new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${value}-15T12:00:00Z`),
  );

/** Compact comparison only; keep money() for primary financial values. */
export function compactMoney(value: string | number): string {
  const number = new Decimal(value || 0);
  const absolute = number.abs();
  let divisor = absolute.gte(1000000) ? 1000000 : absolute.gte(1000) ? 1000 : 1;
  let rounded = absolute.div(divisor).toDecimalPlaces(divisor === 1000000 || (divisor === 1000 && absolute.lt(10000)) ? 1 : 0, Decimal.ROUND_HALF_UP);
  if (divisor < 1000000 && rounded.gte(1000)) {
    divisor *= 1000;
    rounded = absolute.div(divisor).toDecimalPlaces(1, Decimal.ROUND_HALF_UP);
  }
  return `${number.isNegative() && !rounded.isZero() ? "-" : ""}R$ ${rounded.toString().replace(".", ",")}${divisor === 1000000 ? " mi" : divisor === 1000 ? "k" : ""}`;
}

export const compactPercentage = (value: string | number) =>
  `${new Decimal(value).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toString()}%`;
