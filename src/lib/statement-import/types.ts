export type StatementSource = "native" | "ocr";
export type TransactionDirection = "credit" | "debit" | "unknown";

export type StatementPageInput = {
  page: number;
  source: StatementSource;
  text: string;
  ocrConfidence?: number;
};

export type StatementTransaction = {
  page: number;
  source: StatementSource;
  rawText: string;
  date: string;
  description: string;
  amount: string;
  direction: TransactionDirection;
  confidence: number;
  needsReview: boolean;
  reviewReasons: string[];
};

export type StatementMetadata = {
  periodStart?: string;
  periodEnd?: string;
  openingBalance?: string;
  closingBalance?: string;
  totalCredits?: string;
  totalDebits?: string;
};

export type StatementPageResult = {
  page: number;
  source: StatementSource;
  transactions: StatementTransaction[];
  metadata: StatementMetadata;
  warnings: string[];
};

export type StatementProgress = {
  stage: "reading" | "analyzing" | "ocr" | "parsing" | "validating";
  message: string;
  currentPage?: number;
  totalPages?: number;
};
