import type { ThemeMode } from "@/domain/types";

export function resolvedTheme(mode: ThemeMode, prefersDark: boolean) {
  return mode === "system" ? (prefersDark ? "dark" : "light") : mode;
}

/** Applies the preference immediately; persistence is handled by the finance repository. */
export function applyTheme(mode: ThemeMode) {
  if (typeof window === "undefined") return;
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const theme = resolvedTheme(mode, media.matches);
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    "content",
    theme === "dark" ? "#18181b" : "#fffaf5",
  );
}
