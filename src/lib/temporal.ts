/** Instants cross the API in UTC; civil dates never acquire a timezone. */
export const BUSINESS_TIME_ZONE = "America/Recife";
export const MONTH_ABBREVIATIONS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"] as const;
const civilPattern = /^\d{4}-\d{2}-\d{2}$/;
const businessFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
});

export function businessDate(value: string | Date = new Date()): string {
  if (typeof value === "string" && civilPattern.test(value)) return value;
  const parts = businessFormatter.formatToParts(new Date(value));
  const part = (name: string) => parts.find((item) => item.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export const businessToday = () => businessDate();
export const businessMonth = () => businessToday().slice(0, 7);

/** Calendar carrier only: use UTC getters/formatters, never interpret as an event. */
export const civilCalendar = (date: string) => new Date(`${date}T12:00:00Z`);
export const calendarDate = (date: Date) => date.toISOString().slice(0, 10);

/** Legacy timestamp-only API adapter: noon in Recife, serialized as a UTC instant. */
export function civilDateToInstant(date: string): string {
  if (!civilPattern.test(date) || calendarDate(civilCalendar(date)) !== date) throw new Error("Data inválida");
  const target = civilCalendar(date).getTime();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  let instant = target;
  for (let attempt = 0; attempt < 2; attempt++) {
    const parts = formatter.formatToParts(instant);
    const part = (name: string) => Number(parts.find((item) => item.type === name)!.value);
    const local = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
    instant += target - local;
  }
  return new Date(instant).toISOString();
}
