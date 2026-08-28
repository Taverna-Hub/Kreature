export type MarketResult = { value: string; asOf: string; message: string };

export async function fetchExchangeRate(from: string, to = "BRL"): Promise<MarketResult> {
  if (from === to) return { value: "1", asOf: new Date().toISOString(), message: "Moeda base" };
  const response = await fetch(
    `https://api.frankfurter.dev/v2/rate/${encodeURIComponent(from)}/${encodeURIComponent(to)}`,
  );
  if (!response.ok) throw new Error("Cotação automática indisponível. Informe a taxa manualmente.");
  const payload = (await response.json()) as { rate?: number; date?: string };
  if (!payload.rate) throw new Error("O provedor não retornou uma taxa válida.");
  return {
    value: String(payload.rate),
    asOf: payload.date ?? new Date().toISOString(),
    message: "Frankfurter",
  };
}

export async function fetchAssetQuote(ticker: string): Promise<MarketResult> {
  const response = await fetch(
    `https://brapi.dev/api/v2/stocks/quote?tickers=${encodeURIComponent(ticker.toUpperCase())}`,
  );
  if (!response.ok) throw new Error("Cotação automática indisponível para este ativo.");
  const payload = (await response.json()) as {
    results?: Array<{ regularMarketPrice?: number; regularMarketTime?: string }>;
  };
  const quote = payload.results?.[0];
  if (!quote?.regularMarketPrice)
    throw new Error("Ticker sem cotação automática. Atualize o preço manualmente.");
  return {
    value: String(quote.regularMarketPrice),
    asOf: quote.regularMarketTime ?? new Date().toISOString(),
    message: "brapi",
  };
}
