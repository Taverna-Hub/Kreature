import Papa from "papaparse";
import Decimal from "decimal.js";
import type { FinanceState, ImportCandidate, InstitutionCatalogId } from "@/domain/types";
import { uid } from "@/domain/defaults";
import { classifyTransaction, normalizeClassificationText } from "@/domain/classification";

export type ImportAnalysis = {
  source: string;
  institutionHint?: InstitutionCatalogId;
  currency: string;
  candidates: ImportCandidate[];
  warnings: string[];
};

type ParsedRow = { date: string; description: string; amount: string; externalId?: string; currency?: string };

const normalize = normalizeClassificationText;
const readText = (file: File) =>
  typeof file.text === "function"
    ? file.text()
    : new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
      });
const readBuffer = (file: File) =>
  typeof file.arrayBuffer === "function"
    ? file.arrayBuffer()
    : new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(file);
      });

export const parseAmount = (value: unknown) => {
  const raw = String(value ?? "").replace(/R\$|US\$|€|£|\s/g, "").replace(/^\+/, "");
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  try { return new Decimal(normalized || 0).toString(); } catch { return "0"; }
};
export const parseDate = (value: unknown) => {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (match) return `${match[3].length === 2 ? `20${match[3]}` : match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  const ofx = raw.match(/^(\d{4})(\d{2})(\d{2})/);
  if (ofx) return `${ofx[1]}-${ofx[2]}-${ofx[3]}`;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
};

const BANK_HINTS: Array<[InstitutionCatalogId, RegExp]> = [
  ["nubank", /nubank|nu pagamentos|nupay/], ["itau", /ita[uú]|unibanco/],
  ["inter", /banco inter/], ["caixa", /caixa econ[oô]mica|\bcaixa\b/],
  ["mercado-pago", /mercado pago/], ["picpay", /picpay/], ["wise", /wise/ as RegExp],
];
const detectInstitution = (text: string) => BANK_HINTS.find(([, pattern]) => pattern.test(normalize(text)))?.[0];
const detectCurrency = (text: string) => /\bEUR\b|€/.test(text) ? "EUR" : /\bUSD\b|US\$/.test(text) ? "USD" : /\bGBP\b|£/.test(text) ? "GBP" : "BRL";

/** Removes banking identifiers while retaining the useful counterparty and movement direction. */
export function cleanTransactionDescription(value: string) {
  const original = value.replace(/\s+/g, " ").trim();
  const text = normalize(original);
  const isPix = /\bpix\b/.test(text);
  const isReceived = /recebid[oa]|credit[oa]|entrada/.test(text);
  const isSent = /enviad[oa]|debit[oa]|pagamento/.test(text);
  if (!isPix && !/transfer/.test(text)) return original;
  const cleanedPrefix = original
    .replace(/^(transfer[eê]ncia\s+(?:recebida|enviada)\s+pelo\s+pix|pix\s*(?:transf(?:er[eê]ncia)?|qrs)?|transfer[eê]ncia)\s*[-:–—]?\s*/i, "")
  let counterparty = cleanedPrefix
    .split(/\s+[-–—]\s+/)[0]
    .replace(/\s*(?:\d{1,3}[.]?\d{3}[.]?\d{3}[-/]?\d{2}|\*{3,}\d{2,}|ag[eê]ncia\s*[:.]?\s*\d[\d-]*|conta\s*[:.]?\s*\d[\d-]*|banco\s+[^|]*|(?:itau|itaú|caixa econ[oô]mica federal|nubank|inter|bradesco|santander)[^|]*\(?\d{3,4}\)?).*$/i, "")
    .replace(/\s+\d{1,2}\/\d{1,2}\s*$/i, "")
    .replace(/\s*[-–—]\s*$/, "")
    .trim();
  counterparty = counterparty.replace(/\b(?:pix|transf)\b/gi, "").replace(/\s{2,}/g, " ").trim();
  const label = isPix ? (isReceived ? "Pix recebido" : isSent ? "Pix enviado" : "Pix") : (isReceived ? "Transferência recebida" : isSent ? "Transferência enviada" : "Transferência");
  return counterparty ? `${label} · ${counterparty}` : label;
}

const fingerprint = (institutionId: string | undefined, date: string, description: string, amount: string) => `${institutionId ?? ""}|${date}|${normalize(description).replace(/\s+/g, " ")}|${amount}`;
function candidate(row: ParsedRow, state: FinanceState, parser: string, institutionHint?: InstitutionCatalogId): ImportCandidate {
  const description = cleanTransactionDescription(row.description);
  const result = classifyTransaction(description, row.amount, state.categories, state.classificationRules);
  const key = fingerprint(institutionHint, row.date, description, row.amount);
  const same = state.entries.filter((entry) => entry.date === row.date && entry.amount === row.amount);
  const duplicate = state.entries.some((entry) => (row.externalId && entry.notes?.includes(`external:${row.externalId}`)) || entry.fingerprint === key);
  return { id: uid("candidate"), date: row.date, description, amount: row.amount, currency: row.currency ?? "BRL", externalId: row.externalId, detectedInstitutionId: institutionHint, parser, source: parser, ...result, suggestedKind: result.kind, suggestedCategoryId: result.categoryId, include: !duplicate, createInvestment: result.kind === "investment", fingerprint: key, duplicate, similarDuplicate: !duplicate && same.some((entry) => normalize(entry.description) === normalize(description)) };
}

function validRows(rows: ParsedRow[], state: FinanceState, parser: string, hint?: InstitutionCatalogId): ImportAnalysis {
  const warnings: string[] = []; const candidates: ImportCandidate[] = [];
  rows.forEach((row, index) => {
    if (!row.date || !row.description || new Decimal(row.amount).isZero()) warnings.push(`Linha ${index + 1} ignorada: data, descrição ou valor inválido.`);
    else if (/saldo(?: do dia| inicial| final)?|total de |limite da conta|per[ií]odo/.test(normalize(row.description))) warnings.push(`Linha ${index + 1} ignorada: saldo ou total.`);
    else candidates.push(candidate(row, state, parser, hint));
  });
  return { source: parser, institutionHint: hint, currency: candidates[0]?.currency ?? "BRL", candidates, warnings };
}

function parseCsv(text: string, state: FinanceState, name: string): ImportAnalysis {
  const parsed = Papa.parse<Record<string, unknown>>(text, { header: true, skipEmptyLines: true });
  const hint = /^nu[_-]/i.test(name) ? "nubank" : detectInstitution(`${name}\n${text.slice(0, 800)}`);
  const rows = parsed.data.map((raw) => {
    const row = Object.fromEntries(Object.entries(raw).map(([key, value]) => [normalize(key), value]));
    return { date: parseDate(row.data ?? row.date ?? row["data da transacao"]), description: String(row.descricao ?? row.description ?? row.historico ?? row.lancamento ?? "").trim(), amount: parseAmount(row.valor ?? row.value ?? row.amount), externalId: String(row.identificador ?? row.id ?? row["id da operacao"] ?? "") || undefined, currency: detectCurrency(String(row.moeda ?? row.currency ?? "")) };
  });
  const result = validRows(rows, state, hint ? `${hint}-csv` : "csv-genérico", hint);
  return { ...result, warnings: [...result.warnings, ...parsed.errors.map((error) => error.message)] };
}

function parseOfx(text: string, state: FinanceState): ImportAnalysis {
  const currency = (text.match(/<CURDEF>([^<\r\n]+)/i)?.[1] ?? "BRL").trim().toUpperCase();
  const rows = [...text.matchAll(/<STMTTRN>([\s\S]*?)<\/STMTTRN>|<STMTTRN>([\s\S]*?)(?=<STMTTRN>|<LEDGERBAL>|$)/gi)].map((match) => {
    const block = match[1] ?? match[2]; const field = (name: string) => block.match(new RegExp(`<${name}>([^<\\r\\n]+)`, "i"))?.[1]?.trim() ?? "";
    return { date: parseDate(field("DTPOSTED")), description: field("MEMO") || field("NAME"), amount: parseAmount(field("TRNAMT")), externalId: field("FITID") || undefined, currency };
  });
  return validRows(rows, state, "ofx", detectInstitution(text));
}

function parsePdfText(text: string, state: FinanceState, name: string): ImportAnalysis {
  const hint = detectInstitution(`${name}\n${text}`); const currency = detectCurrency(text);
  const rows: ParsedRow[] = [];
  const pattern = /(\d{2}[/-]\d{2}[/-]\d{2,4})\s+(.+?)\s+(?:R\$\s*)?([+-]?\d{1,3}(?:\.\d{3})*,\d{2}|[+-]?\d+[.,]\d{2})(?=\s+(?:R\$\s*)?[+-]?\d{1,3}(?:\.\d{3})*,\d{2}|\s+\d{2}[/-]\d{2}[/-]\d{2,4}|$)/g;
  for (const match of text.matchAll(pattern)) rows.push({ date: parseDate(match[1]), description: match[2].replace(/\s+/g, " ").trim(), amount: parseAmount(match[3]), currency });
  return validRows(rows, state, hint ? `${hint}-pdf` : "pdf-genérico", hint);
}

async function pdfText(file: File) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs"); const pdf = await pdfjs.getDocument({ data: await readBuffer(file) }).promise;
  const pages: string[] = [];
  for (let index = 1; index <= pdf.numPages; index += 1) { const content = await (await pdf.getPage(index)).getTextContent(); pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" ")); }
  return pages.join("\n");
}

async function ocr(file: File): Promise<string> {
  const { createWorker } = await import("tesseract.js"); const worker = await createWorker("por");
  try { const result = await worker.recognize(file); return result.data.text; } finally { await worker.terminate(); }
}

async function ocrPdf(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await pdfjs.getDocument({ data: await readBuffer(file) }).promise;
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("por");
  try {
    const pages: string[] = [];
    for (let index = 1; index <= pdf.numPages; index += 1) {
      const page = await pdf.getPage(index);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport }).promise;
      pages.push((await worker.recognize(canvas)).data.text);
    }
    return pages.join("\n");
  } finally { await worker.terminate(); }
}

export async function analyzeFile(file: File, state: FinanceState): Promise<ImportAnalysis> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".ofx") || lower.endsWith(".qfx")) return parseOfx(await readText(file), state);
  if (lower.endsWith(".csv")) return parseCsv(await readText(file), state, file.name);
  if (lower.endsWith(".xls") || lower.endsWith(".xlsx")) { const XLSX = await import("xlsx"); const workbook = XLSX.read(await readBuffer(file), { type: "array" }); const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[workbook.SheetNames[0]]); return parseCsv(csv, state, file.name); }
  if (lower.endsWith(".pdf")) { const text = await pdfText(file); return parsePdfText(text.trim() ? text : await ocrPdf(file), state, file.name); }
  if (/\.(png|jpe?g|webp)$/i.test(lower)) return parsePdfText(await ocr(file), state, `${file.name}-ocr`);
  throw new Error("Formato não suportado. Selecione OFX, CSV, XLS, XLSX, PDF ou imagem.");
}
