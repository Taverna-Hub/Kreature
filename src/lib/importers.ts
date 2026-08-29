import Papa from "papaparse";
import Decimal from "decimal.js";
import type { FinanceState, ImportCandidate, InstitutionCatalogId } from "@/domain/types";
import { uid } from "@/domain/defaults";
import { classifyTransaction, normalizeClassificationText } from "@/domain/classification";
import { detectStatementInstitution } from "./statement-import/bank-detector";
import { analyzePdfStatement, parsePdfPages } from "./statement-import/pdf-pipeline";
import type { StatementProgress } from "./statement-import/types";
import { validateStatementBalances, type StatementValidation } from "./statement-import/validation";
import { detectImportDuplicate } from "./statement-import/duplicate-detector";

export type ImportAnalysis = {
  source: string;
  institutionHint?: InstitutionCatalogId;
  currency: string;
  candidates: ImportCandidate[];
  warnings: string[];
  validation?: StatementValidation;
};

export type ImportAnalysisOptions = { onProgress?: (progress: StatementProgress) => void };

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
  const compact = String(value ?? "").replace(/R\$|US\$|€|£|\s/g, "");
  const marker = compact.at(-1)?.toUpperCase();
  const negative = compact.startsWith("-") || marker === "D" || marker === "-";
  const unsigned = compact.replace(/[CD-]$/i, "").replace(/^[-+]/, "");
  const normalized = unsigned.includes(",") ? unsigned.replace(/\./g, "").replace(",", ".") : unsigned;
  try {
    const amount = new Decimal(normalized || 0).abs();
    return (negative ? amount.negated() : amount).toString();
  } catch { return "0"; }
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

const detectInstitution = detectStatementInstitution;
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

export const importFingerprint = (institutionId: string | undefined, date: string, description: string, amount: string, kind: string) =>
  `${institutionId ?? ""}|${date}|${normalize(description).replace(/\s+/g, " ")}|${amount}|${kind}`;
function candidate(
  row: ParsedRow,
  state: FinanceState,
  parser: string,
  institutionHint?: InstitutionCatalogId,
  extraction?: Pick<ImportCandidate, "page" | "extractionSource" | "rawText" | "needsReview" | "reviewReasons"> & { confidence?: number },
): ImportCandidate {
  const description = cleanTransactionDescription(row.description);
  const result = classifyTransaction(description, row.amount, state.categories, state.classificationRules);
  const key = importFingerprint(institutionHint, row.date, description, row.amount, result.kind);
  const duplicateResult = detectImportDuplicate(state, {
    date: row.date,
    description,
    amount: row.amount,
    kind: result.kind,
    fingerprint: key,
    externalId: row.externalId,
    institutionHint,
  });
  const reviewReasons = extraction?.reviewReasons ?? [];
  const needsReview = extraction?.needsReview || reviewReasons.length > 0;
  return {
    id: uid("candidate"), date: row.date, description, amount: row.amount, currency: row.currency ?? "BRL", externalId: row.externalId,
    detectedInstitutionId: institutionHint, parser, source: parser, ...result,
    suggestedKind: result.kind, suggestedCategoryId: result.categoryId,
    confidence: Math.min(result.confidence, extraction?.confidence ?? 1),
    reason: needsReview ? reviewReasons.join(" ") || result.reason : result.reason,
    include: !duplicateResult.exact && !duplicateResult.possible && !needsReview, createInvestment: result.kind === "investment", fingerprint: key,
    duplicate: duplicateResult.exact, similarDuplicate: duplicateResult.possible, ...extraction,
  };
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

async function parsePdfHybrid(file: File, state: FinanceState, options?: ImportAnalysisOptions): Promise<ImportAnalysis> {
  const extracted = await analyzePdfStatement(file, options?.onProgress);
  const pages = parsePdfPages(extracted.pages, options?.onProgress);
  const documentText = extracted.pages.map((page) => page.text).join("\n");
  const institutionHint = detectStatementInstitution(`${file.name}\n${documentText}`);
  const currency = detectCurrency(documentText);
  const candidates = pages.flatMap((page) => page.transactions.map((transaction) => candidate(
    { date: transaction.date, description: transaction.description, amount: transaction.amount, currency },
    state,
    institutionHint ? `${institutionHint}-pdf` : "pdf-hibrido",
    institutionHint,
    {
      page: transaction.page,
      extractionSource: transaction.source,
      rawText: transaction.rawText,
      needsReview: transaction.needsReview,
      reviewReasons: transaction.reviewReasons,
      confidence: transaction.confidence,
    },
  )));
  const validation = validateStatementBalances(pages, options?.onProgress);
  if (validation.status === "warning") {
    for (const item of candidates) {
      const reviewReasons = [...new Set([...(item.reviewReasons ?? []), validation.message])];
      item.needsReview = true;
      item.reviewReasons = reviewReasons;
      item.reason = reviewReasons.join(" ");
      item.include = false;
    }
  }
  const warnings = [...extracted.warnings, ...pages.flatMap((page) => page.warnings)];
  if (!candidates.length) warnings.push("Nenhuma movimentação confiável foi encontrada. Tente um PDF mais nítido ou registre os itens manualmente.");
  return { source: institutionHint ? `${institutionHint}-pdf` : "pdf-hibrido", institutionHint, currency, candidates, warnings, validation };
}

async function ocr(file: File): Promise<{ text: string; confidence: number }> {
  const { createWorker } = await import("tesseract.js"); const worker = await createWorker("por");
  try {
    const result = await worker.recognize(file);
    return { text: result.data.text, confidence: result.data.confidence ?? 0 };
  } finally { await worker.terminate(); }
}

async function parseStatementImage(file: File, state: FinanceState, options?: ImportAnalysisOptions): Promise<ImportAnalysis> {
  options?.onProgress?.({ stage: "ocr", message: "Reconhecendo texto da imagem", currentPage: 1, totalPages: 1 });
  let extracted: Awaited<ReturnType<typeof ocr>>;
  try { extracted = await ocr(file); }
  catch { throw new Error("Não foi possível reconhecer esta imagem. Verifique se o arquivo está legível e tente novamente."); }
  const input = { page: 1, source: "ocr" as const, text: extracted.text, ocrConfidence: extracted.confidence };
  const pages = parsePdfPages([input], options?.onProgress);
  const institutionHint = detectStatementInstitution(`${file.name}\n${extracted.text}`);
  const currency = detectCurrency(extracted.text);
  const candidates = pages[0].transactions.map((transaction) => candidate(
    { date: transaction.date, description: transaction.description, amount: transaction.amount, currency },
    state,
    institutionHint ? `${institutionHint}-imagem` : "imagem-ocr",
    institutionHint,
    {
      page: transaction.page,
      extractionSource: "ocr",
      rawText: transaction.rawText,
      needsReview: transaction.needsReview,
      reviewReasons: transaction.reviewReasons,
      confidence: transaction.confidence,
    },
  ));
  const warnings = [...pages[0].warnings];
  if (!candidates.length) warnings.push("Nenhuma movimentação foi reconhecida na imagem. Use uma imagem mais nítida ou registre os itens manualmente.");
  return { source: institutionHint ? `${institutionHint}-imagem` : "imagem-ocr", institutionHint, currency, candidates, warnings };
}

export async function analyzeFile(file: File, state: FinanceState, options?: ImportAnalysisOptions): Promise<ImportAnalysis> {
  if (!file.size) throw new Error("O arquivo está vazio.");
  if (file.size > 25 * 1024 * 1024) throw new Error("O arquivo é maior que 25 MB. Escolha um arquivo menor.");
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".ofx") || lower.endsWith(".qfx")) return parseOfx(await readText(file), state);
  if (lower.endsWith(".csv")) return parseCsv(await readText(file), state, file.name);
  if (lower.endsWith(".xls") || lower.endsWith(".xlsx")) { const XLSX = await import("xlsx"); const workbook = XLSX.read(await readBuffer(file), { type: "array" }); const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[workbook.SheetNames[0]]); return parseCsv(csv, state, file.name); }
  if (lower.endsWith(".pdf")) return parsePdfHybrid(file, state, options);
  if (/\.(png|jpe?g|webp)$/i.test(lower)) return parseStatementImage(file, state, options);
  throw new Error("Formato não suportado. Selecione OFX, CSV, XLS, XLSX, PDF ou imagem.");
}
