import { describe, expect, it } from "vitest";
import { resolvedTheme } from "./theme";

describe("theme preference", () => {
  it("resolves the system preference without requiring a page refresh", () => {
    expect(resolvedTheme("system", true)).toBe("dark");
    expect(resolvedTheme("system", false)).toBe("light");
    expect(resolvedTheme("dark", false)).toBe("dark");
  });
});
