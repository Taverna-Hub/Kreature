import Decimal from "decimal.js";
import type {
  StatementMetadata,
  StatementPageInput,
  StatementPageResult,
  StatementTransaction,
  TransactionDirection,
} from "./types";

const monthNumbers: Record<string, number> = {
  jan: 1, janeiro: 1, feb: 2, fev: 2, fevereiro: 2, mar: 3, marco: 3, março: 3,
  apr: 4, abr: 4, abril: 4, may: 5, mai: 5, maio: 5, jun: 6, junho: 6,
  jul: 7, julho: 7, aug: 8, ago: 8, agosto: 8, sep: 9, set: 9, setembro: 9,
  oct: 10, out: 10, outubro: 10, nov: 11, novembro: 11, dec: 12, dez: 12, dezembro: 12,
};

const datePrefix = /^(\d{1,2}\s*[/-]\s*\d{1,2}(?:\s*[/-]\s*\d{2,4})?|\d{1,2}\s+[a-záàâãéêíóôõúç]{3,10}(?:\s+\d{2,4})?)\b\s*/i;
const dateAnywhere = /\b(\d{1,2}\s*[/-]\s*\d{1,2}(?:\s*[/-]\s*\d{2,4})?|\d{1,2}\s+[a-záàâãéêíóôõúç]{3,10}(?:\s+\d{2,4})?)\b/gi;
const amountPattern = /(?:R\$\s*)?[+-]?\s*\d{1,3}(?:\.\d{3})*,\d{2}\s*(?:[CD-])?|(?:R\$\s*)?[+-]?\s*\d+[.,]\d{2}\s*(?:[CD-])?/i;
const ignoredLine = /^(?:saldo(?:\s+(?:anterior|inicial|final|do dia|dispon[ií]vel))?|limite(?:\s+dispon[ií]vel)?|total(?:\s+de)?\s+(?:entradas|sa[ií]das|cr[eé]ditos|d[eé]bitos)|subtotal|ag[eê]ncia|conta|per[ií]odo|extrato)\b/i;
const creditWords = /\b(?:cr[eé]dito|creditado|recebido|recebimento|entrada|dep[oó]sito|sal[aá]rio|resgate|rendimento|provento|estorno)\b/i;
const debitWords = /\b(?:d[eé]bito|debitado|realizado|enviado|pagamento|compra|tarifa|saque|aplica[cç][aã]o|transfer[eê]ncia enviada)\b/i;

const normalizeText = (value: string) => value.replace(/[\u00a0\t]+/g, " ").replace(/\s+/g, " ").trim();
const plain = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function parseAmount(raw: string): { amount: string; direction: TransactionDirection } | undefined {
  const compact = raw.replace(/R\$/i, "").replace(/\s/g, "");
  const last = compact.at(-1)?.toUpperCase();
  const direction: TransactionDirection = last === "C" || compact.startsWith("+")
    ? "credit"
    : last === "D" || last === "-" || compact.startsWith("-")
      ? "debit"
      : "unknown";
  const unsigned = compact.replace(/[CD]$/i, "").replace(/-$/, "").replace(/^[-+]/, "");
  const numeric = unsigned.includes(",")
    ? unsigned.replace(/\./g, "").replace(",", ".")
    : /^\d+\.\d{2}$/.test(unsigned)
      ? unsigned
      : unsigned.replace(/\./g, "");
  try {
    const absolute = new Decimal(numeric);
    if (!absolute.isFinite()) return undefined;
    return { amount: (direction === "debit" ? absolute.negated() : absolute).toString(), direction };
  } catch {
    return undefined;
  }
}

function parseDate(raw: string, metadata: StatementMetadata): string | undefined {
  const cleaned = plain(normalizeText(raw)).replace(/\s*[/-]\s*/g, "/");
  const numeric = cleaned.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  const named = cleaned.match(/^(\d{1,2})\s+([a-z]+)(?:\s+(\d{2,4}))?$/);
  const day = Number(numeric?.[1] ?? named?.[1]);
  const month = Number(numeric?.[2] ?? monthNumbers[named?.[2] ?? ""]);
  const explicitYear = numeric?.[3] ?? named?.[3];
  if (!day || !month || month > 12 || day > 31) return undefined;
  let year = explicitYear ? Number(explicitYear.length === 2 ? `20${explicitYear}` : explicitYear) : undefined;
  if (!year && metadata.periodStart && metadata.periodEnd) {
    const startYear = Number(metadata.periodStart.slice(0, 4));
    const endYear = Number(metadata.periodEnd.slice(0, 4));
    const startMonth = Number(metadata.periodStart.slice(5, 7));
    year = startYear === endYear || month < startMonth ? endYear : startYear;
  }
  if (!year) year = new Date().getFullYear();
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) return undefined;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function metadataFrom(lines: string[]): StatementMetadata {
  const metadata: StatementMetadata = {};
  const dates = [...lines.join("\n").matchAll(dateAnywhere)].map((match) => match[1]);
  if (dates.length >= 2) {
    const first = parseDate(dates[0], metadata);
    const second = parseDate(dates[1], { ...metadata, periodStart: first });
    if (first && second) Object.assign(metadata, { periodStart: first, periodEnd: second });
  }
  for (const line of lines) {
    const value = line.match(amountPattern)?.[0];
    if (!value) continue;
    const amount = parseAmount(value)?.amount;
    if (!amount) continue;
    const text = plain(line);
    if (/saldo\s+(?:anterior|inicial)/.test(text)) metadata.openingBalance = new Decimal(amount).toString();
    else if (/saldo\s+final/.test(text)) metadata.closingBalance = new Decimal(amount).toString();
    else if (/total.*(?:credito|entrada)/.test(text)) metadata.totalCredits = new Decimal(amount).abs().toString();
    else if (/total.*(?:debito|saida)/.test(text)) metadata.totalDebits = new Decimal(amount).abs().toString();
  }
  return metadata;
}

function directionFromDescription(description: string): TransactionDirection {
  if (creditWords.test(description)) return "credit";
  if (debitWords.test(description)) return "debit";
  return "unknown";
}

function finalize(
  input: StatementPageInput,
  rawLines: string[],
  dateToken: string,
  metadata: StatementMetadata,
): StatementTransaction | undefined {
  const rawText = rawLines.join(" ");
  if (ignoredLine.test(rawText)) return undefined;
  const date = parseDate(dateToken, metadata);
  const amountMatch = [...rawLines].reverse().map((line) => line.match(amountPattern)?.[0]).find(Boolean);
  if (!date || !amountMatch) return undefined;
  const parsedAmount = parseAmount(amountMatch);
  if (!parsedAmount) return undefined;
  const description = normalizeText(rawText.replace(datePrefix, "").replace(amountMatch, ""));
  if (!description) return undefined;
  const inferredDirection = parsedAmount.direction === "unknown" ? directionFromDescription(description) : parsedAmount.direction;
  const needsReview = inferredDirection === "unknown" || input.source === "ocr" && (input.ocrConfidence ?? 0) < 70;
  const reasons = [
    ...(inferredDirection === "unknown" ? ["Não foi possível confirmar se o valor é crédito ou débito."] : []),
    ...(input.source === "ocr" && (input.ocrConfidence ?? 0) < 70 ? ["OCR com confiança baixa nesta página."] : []),
  ];
  const absolute = new Decimal(parsedAmount.amount).abs();
  const amount = inferredDirection === "debit" ? absolute.negated().toString() : absolute.toString();
  const confidence = Math.max(.25, Math.min(.98, (input.source === "native" ? .88 : .62) + (inferredDirection === "unknown" ? -.25 : .06) + (description.length > 4 ? .03 : -.12)));
  return { page: input.page, source: input.source, rawText, date, description, amount, direction: inferredDirection, confidence, needsReview, reviewReasons: reasons };
}

const caixaHistories = [
  "PIX ENVIADO",
  "PIX RECEBIDO",
  "COMPRA CARTAO DEBITO",
  "ENVIO TRANSF INTERNET TEV",
  "TARIFA TRANSF RECURSO E/I",
  "CREDITO JUROS",
  "CORRECAO MONETARIA",
] as const;

const caixaRow = /^(\d{2}\/\d{2}\/\d{4})\s*-\s*\d{2}:\d{2}:\d{2}\s+\d{5,8}\s+(.+?)\s+(\d{1,3}(?:\.\d{3})*,\d{2})\s*([CD])\s+(\d{1,3}(?:\.\d{3})*,\d{2})\s*([CD])\s*$/i;
const caixaSaldoRow = /^(\d{2}\/\d{2}\/\d{4})\s*-\s*00:00:00\s+\d+\s+saldo\s+dia\s+(\d{1,3}(?:\.\d{3})*,\d{2})\s*([CD])\s+(\d{1,3}(?:\.\d{3})*,\d{2})\s*([CD])\s*$/i;

function caixaDescription(value: string) {
  const normalized = value.replace(/E\/l\b/gi, "E/I");
  const history = caixaHistories.find((item) => normalized.toUpperCase().startsWith(item));
  if (!history) return normalizeText(normalized);
  const counterparty = normalized.slice(history.length)
    .replace(/\s+(?:\*+|ARE\b|TR\b|FE\b|THE\b).*/i, "")
    .replace(/\s+\d{3}[\d*.\s/-]*$/i, "")
    .trim();
  return counterparty ? `${history} ${counterparty}` : history;
}

function caixaMetadata(lines: string[]): StatementMetadata {
  const text = lines.join("\n");
  const period = text.match(/per[ií]odo\s+dos\s+lan[cç]amentos\s+(\d{2}\/\d{2}\/\d{4})\s+at[ée]\s+(\d{2}\/\d{2}\/\d{4})/i);
  const metadata: StatementMetadata = {};
  if (period) {
    metadata.periodStart = parseDate(period[1], metadata);
    metadata.periodEnd = parseDate(period[2], metadata);
  }
  const opening = text.match(/saldo\s+anterior\s+(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2})\s*([CD])/i);
  if (opening) metadata.openingBalance = parseAmount(`${opening[1]} ${opening[2]}`)?.amount;
  const balanceRows = lines.map((line) => line.match(caixaSaldoRow)).filter((match): match is RegExpMatchArray => Boolean(match));
  const afterPeriod = balanceRows.find((match) => {
    const date = parseDate(match[1], metadata);
    return Boolean(date && metadata.periodEnd && date > metadata.periodEnd);
  }) ?? balanceRows[0];
  if (afterPeriod) metadata.closingBalance = parseAmount(`${afterPeriod[4]} ${afterPeriod[5]}`)?.amount;
  return metadata;
}

function isCaixaDocument(inputs: StatementPageInput[]) {
  const text = plain(inputs.map((input) => input.text).join("\n"));
  return text.includes("caixa") && text.includes("extrato por periodo") && text.includes("historico/complemento");
}

function parseCaixaStatementDocument(inputs: StatementPageInput[]): StatementPageResult[] | undefined {
  if (!isCaixaDocument(inputs)) return undefined;
  const lines = inputs.flatMap((input) => input.text.split(/\r?\n/).map(normalizeText).filter(Boolean));
  const metadata = caixaMetadata(lines);
  return inputs.map((input, index) => {
    const transactions: StatementTransaction[] = [];
    const warnings: string[] = [];
    for (const line of input.text.split(/\r?\n/).map(normalizeText).filter(Boolean)) {
      if (caixaSaldoRow.test(line)) continue;
      const row = line.match(caixaRow);
      if (!row) {
        if (/^\d{2}\/\d{2}\/\d{4}\s*-\s*\d{2}:\d{2}:\d{2}/.test(line)) warnings.push(`Página ${input.page}: uma linha da tabela CAIXA precisa de revisão.`);
        continue;
      }
      const date = parseDate(row[1], metadata);
      const parsed = parseAmount(`${row[3]} ${row[4]}`);
      if (!date || !parsed) {
        warnings.push(`Página ${input.page}: valor ou data não puderam ser confirmados.`);
        continue;
      }
      const description = caixaDescription(row[2]);
      const lowOcrConfidence = input.source === "ocr" && (input.ocrConfidence ?? 0) < 70;
      transactions.push({
        page: input.page,
        source: input.source,
        rawText: line,
        date,
        description,
        amount: parsed.amount,
        direction: parsed.direction,
        confidence: lowOcrConfidence ? .62 : input.source === "ocr" ? .86 : .96,
        needsReview: lowOcrConfidence,
        reviewReasons: lowOcrConfidence ? ["OCR com confiança baixa nesta página."] : [],
      });
    }
    return {
      page: input.page,
      source: input.source,
      transactions,
      metadata: index === 0 ? metadata : {},
      warnings,
    };
  });
}

function parseGenericStatementDocument(inputs: StatementPageInput[]): StatementPageResult[] {
  const documentLines = inputs.flatMap((input) => input.text.split(/\r?\n/).map(normalizeText).filter(Boolean));
  const documentMetadata = metadataFrom(documentLines);
  const transactions: StatementTransaction[] = [];
  const warningsByPage = new Map<number, string[]>();
  let current: { input: StatementPageInput; dateToken: string; lines: string[] } | undefined;
  const flush = () => {
    if (!current) return;
    const transaction = finalize(current.input, current.lines, current.dateToken, documentMetadata);
    if (transaction) transactions.push(transaction);
    else if (current.lines.some((line) => amountPattern.test(line))) {
      const warnings = warningsByPage.get(current.input.page) ?? [];
      warnings.push(`Página ${current.input.page}: uma movimentação não pôde ser interpretada.`);
      warningsByPage.set(current.input.page, warnings);
    }
    current = undefined;
  };
  for (const input of inputs) {
    const lines = input.text.split(/\r?\n/).map(normalizeText).filter(Boolean);
    for (const line of lines) {
      if (ignoredLine.test(line)) {
        // Cabeçalhos repetidos podem ficar entre a descrição no fim de uma
        // página e o valor no início da seguinte.
        if (current?.lines.some((value) => amountPattern.test(value))) flush();
        continue;
      }
      const match = line.match(datePrefix);
      if (match) {
        flush();
        current = { input, dateToken: match[1], lines: [line] };
      } else if (current) {
        current.lines.push(line);
      }
    }
  }
  flush();
  return inputs.map((input) => ({
    page: input.page,
    source: input.source,
    transactions: transactions.filter((transaction) => transaction.page === input.page),
    metadata: metadataFrom(input.text.split(/\r?\n/).map(normalizeText).filter(Boolean)),
    warnings: warningsByPage.get(input.page) ?? [],
  }));
}

export function parseStatementDocument(inputs: StatementPageInput[]): StatementPageResult[] {
  return parseCaixaStatementDocument(inputs) ?? parseGenericStatementDocument(inputs);
}

export function parseStatementPage(input: StatementPageInput): StatementPageResult {
  return parseStatementDocument([input])[0];
}
