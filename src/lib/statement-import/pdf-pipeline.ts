import { parseStatementDocument } from "./statement-parser";
import type { StatementPageInput, StatementProgress } from "./types";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";

type PdfTextItem = { str?: string; transform?: number[] };
type PdfPage = {
  getTextContent: () => Promise<{ items: PdfTextItem[] }>;
  getViewport: (options: { scale: number }) => { width: number; height: number };
  render: (options: { canvas: HTMLCanvasElement; canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> };
};
type PdfDocument = { numPages: number; getPage: (page: number) => Promise<PdfPage> };

export type PdfStatementAnalysis = { pages: StatementPageInput[]; warnings: string[] };
const OCR_PAGE_TIMEOUT_MS = 90_000;

const readBuffer = (file: File) =>
  typeof file.arrayBuffer === "function"
    ? file.arrayBuffer()
    : new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(file);
      });

function textFromItems(items: PdfTextItem[]) {
  const positioned = items
    .filter((item) => item.str?.trim())
    .map((item) => ({ text: item.str!.trim(), x: item.transform?.[4] ?? 0, y: item.transform?.[5] ?? 0 }));
  const lines = new Map<number, Array<{ text: string; x: number }>>();
  for (const item of positioned) {
    const key = Math.round(item.y / 3) * 3;
    const line = lines.get(key) ?? [];
    line.push({ text: item.text, x: item.x });
    lines.set(key, line);
  }
  return [...lines.entries()]
    .sort(([first], [second]) => second - first)
    .map(([, line]) => line.sort((first, second) => first.x - second.x).map((item) => item.text).join(" "))
    .join("\n");
}

export function nativeTextScore(text: string) {
  const compact = text.replace(/\s/g, "");
  if (compact.length < 40) return 0;
  const words = (text.match(/[a-záàâãéêíóôõúç]{2,}/gi) ?? []).length;
  const dates = (text.match(/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/g) ?? []).length;
  const amounts = (text.match(/(?:R\$\s*)?[+-]?\s*\d{1,3}(?:\.\d{3})*,\d{2}/g) ?? []).length;
  const noise = (text.match(/[�□]/g) ?? []).length;
  // Texto de cabeçalho não prova que as movimentações da página são
  // pesquisáveis. Datas e valores são âncoras obrigatórias para evitar esse
  // falso positivo comum em PDFs escaneados com cabeçalho textual.
  const financialAnchors = dates > 0 && amounts > 0 ? .45 : 0;
  return Math.max(0, Math.min(1, Math.min(words / 60, .25) + financialAnchors + Math.min(dates, 3) * .08 + Math.min(amounts, 3) * .08 - noise * .08));
}

function userError(cause: unknown) {
  const name = cause && typeof cause === "object" && "name" in cause ? String(cause.name) : "";
  const message = cause instanceof Error ? cause.message : "";
  if (/password/i.test(`${name} ${message}`)) return "Este PDF é protegido por senha. Remova a proteção antes de importar.";
  if (/invalid|format|corrupt/i.test(`${name} ${message}`)) return "Não foi possível abrir o PDF. Verifique se o arquivo não está corrompido.";
  return "Não foi possível ler este PDF.";
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timer = 0;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error("OCR_TIMEOUT")), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timer));
}

export async function analyzePdfStatement(
  file: File,
  onProgress?: (progress: StatementProgress) => void,
): Promise<PdfStatementAnalysis> {
  if (file.type && file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) throw new Error("O arquivo selecionado não é um PDF.");
  if (file.size > 25 * 1024 * 1024) throw new Error("O PDF é maior que 25 MB. Escolha um arquivo menor.");
  onProgress?.({ stage: "reading", message: "Abrindo documento" });
  let pdf: PdfDocument;
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // Vite emits this module as a local asset. PDF.js otherwise tries to create
    // a fake worker and throws before it can read the first page.
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    pdf = await pdfjs.getDocument({ data: await readBuffer(file) }).promise as PdfDocument;
  } catch (cause) {
    throw new Error(userError(cause));
  }
  const warnings: string[] = [];
  const nativePages: Array<{ page: number; text: string; score: number; source: "native" | "ocr"; ocrConfidence?: number }> = [];
  for (let index = 1; index <= pdf.numPages; index += 1) {
    onProgress?.({ stage: "analyzing", message: `Analisando página ${index} de ${pdf.numPages}`, currentPage: index, totalPages: pdf.numPages });
    try {
      const text = textFromItems((await (await pdf.getPage(index)).getTextContent()).items);
      nativePages.push({ page: index, text, score: nativeTextScore(text), source: "native" });
    } catch {
      nativePages.push({ page: index, text: "", score: 0, source: "native" });
      warnings.push(`Página ${index}: não foi possível ler a camada de texto; o OCR será tentado.`);
    }
  }
  const ocrPages = nativePages.filter((page) => page.score < .58);
  let worker: Awaited<ReturnType<(typeof import("tesseract.js"))["createWorker"]>> | undefined;
  try {
    if (ocrPages.length) {
      const { createWorker } = await import("tesseract.js");
      worker = await createWorker("por");
      for (const item of ocrPages) {
        onProgress?.({ stage: "ocr", message: `Reconhecendo texto na página ${item.page} de ${pdf.numPages}`, currentPage: item.page, totalPages: pdf.numPages });
        try {
          const page = await pdf.getPage(item.page);
          const viewport = page.getViewport({ scale: 2.25 });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Canvas indisponível");
          await page.render({ canvas, canvasContext: context, viewport }).promise;
          const result = await withTimeout(worker.recognize(canvas), OCR_PAGE_TIMEOUT_MS);
          const ocrText = result.data.text.trim();
          const ocrScore = nativeTextScore(ocrText);
          const ocrConfidence = Math.max(0, Math.min(100, result.data.confidence ?? 0));
          if (ocrText && (ocrScore > item.score || !item.text.trim())) {
            item.text = ocrText;
            item.score = ocrScore;
            item.ocrConfidence = ocrConfidence;
            item.source = "ocr";
          } else {
            warnings.push(`Página ${item.page}: o OCR não produziu conteúdo melhor que o texto disponível.`);
          }
        } catch (cause) {
          const timedOut = cause instanceof Error && cause.message === "OCR_TIMEOUT";
          warnings.push(`Página ${item.page}: ${timedOut ? "o OCR excedeu o tempo limite" : "o OCR falhou"}. As demais páginas continuam disponíveis para revisão.`);
          if (timedOut) break;
        }
      }
    }
  } catch {
    warnings.push("O mecanismo de OCR não pôde ser iniciado. Páginas pesquisáveis continuam disponíveis.");
  } finally {
    await worker?.terminate();
  }
  warnings.push(...nativePages.filter((page) => !page.text.trim()).map((page) => `Página ${page.page} não possui texto utilizável.`));
  return {
    pages: nativePages.map((page) => ({ page: page.page, source: page.source, text: page.text, ocrConfidence: page.ocrConfidence })),
    warnings,
  };
}

export function parsePdfPages(pages: StatementPageInput[], onProgress?: (progress: StatementProgress) => void) {
  onProgress?.({ stage: "parsing", message: "Identificando movimentações no documento", currentPage: pages.length, totalPages: pages.length });
  return parseStatementDocument(pages);
}
