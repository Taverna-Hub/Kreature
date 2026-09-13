import { describe, expect, it, vi } from "vitest";
import { businessDate, businessToday, civilDateToInstant } from "./temporal";

describe("Recife calendar boundary", () => {
  it.each([
    ["2026-09-14T02:59:59Z", "2026-09-13"], ["2026-09-14T03:00:00Z", "2026-09-14"],
    ["2027-01-01T02:59:59Z", "2026-12-31"], ["2024-03-01T02:59:59Z", "2024-02-29"],
    ["2026-10-01T00:30:00Z", "2026-09-30"], ["2026-10-13", "2026-10-13"],
  ])("projects %s to %s", (instant, day) => expect(businessDate(instant)).toBe(day));
  it.each(["2024-02-29", "2026-09-13", "2026-12-31"])("round trips civil date %s", (date) => {
    expect(civilDateToInstant(date)).toBe(`${date}T15:00:00.000Z`);
    expect(businessDate(civilDateToInstant(date))).toBe(date);
  });
  it("uses Recife today even after UTC midnight", () => {
    vi.useFakeTimers();
    try { vi.setSystemTime(new Date("2026-09-14T02:59:59Z")); expect(businessToday()).toBe("2026-09-13"); }
    finally { vi.useRealTimers(); }
  });
  it("rejects invalid civil dates", () => expect(() => civilDateToInstant("2026-02-29")).toThrow());
});
