import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(sourceRoot, "..");
const scannedRoots = [sourceRoot, resolve(repositoryRoot, "supabase/functions"), resolve(repositoryRoot, "supabase/migrations")];
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".html", ".sql"]);

const mojibakePatterns = [
  /[\u00c2\u00c3][\u0080-\u00bf\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u0192\u02c6\u02dc\u2013\u2014\u2018-\u201e\u2020-\u2022\u2026\u2030\u2039\u203a\u20ac\u2122]/u,
  /\u00e2[\u0080-\u00bf\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u0192\u02c6\u02dc\u2013\u2014\u2018-\u201e\u2020-\u2022\u2026\u2030\u2039\u203a\u20ac\u2122]/u,
];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return sourceExtensions.has(extname(entry.name)) ? [path] : [];
  });
}

describe("codifica\u00e7\u00e3o dos textos da interface", () => {
  it("n\u00e3o cont\u00e9m sequ\u00eancias UTF-8 interpretadas como Windows-1252", () => {
    const corrupted = scannedRoots.flatMap(sourceFiles)
      .filter((path) => mojibakePatterns.some((pattern) => pattern.test(readFileSync(path, "utf8"))))
      .map((path) => relative(repositoryRoot, path));

    expect(corrupted).toEqual([]);
  });
});
