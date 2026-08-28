import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAssetQuote, fetchExchangeRate } from "./market";

afterEach(() => vi.unstubAllGlobals());

describe("MarketData", () => {
  it("retorna câmbio e cotação com a data do provedor", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ rate: 5.25, date: "2026-04-10" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [{ regularMarketPrice: 42.3, regularMarketTime: "2026-04-10T18:00:00Z" }],
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchExchangeRate("USD")).resolves.toMatchObject({
      value: "5.25",
      asOf: "2026-04-10",
    });
    await expect(fetchAssetQuote("PETR4")).resolves.toMatchObject({ value: "42.3" });
  });

  it("explica que o preenchimento manual continua disponível", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })));
    await expect(fetchAssetQuote("SEM-COTACAO")).rejects.toThrow("indisponível");
    await expect(fetchExchangeRate("XYZ")).rejects.toThrow("manualmente");
  });
});
