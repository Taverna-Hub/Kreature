import { emptyFinanceState } from "@/domain/defaults";
import type {
  CardPurchase,
  Category,
  ClassificationRule,
  CreditCard,
  FinanceState,
  Institution,
  Investment,
  ImportedDocument,
  LedgerEntry,
  FinancialMovement,
  PlannedEntry,
} from "@/domain/types";
import type { ProfileConfig } from "@/features/profile/types";
import { getSupabase } from "./client";
import type { FinanceRepository } from "../repository";

type Row = Record<string, unknown>;
type TableName =
  | "profiles"
  | "categories"
  | "financial_accounts"
  | "investments"
  | "credit_cards"
  | "ledger_entries"
  | "financial_movements"
  | "card_purchases"
  | "imported_documents"
  | "classification_rules"
  | "planned_entries";
type CatalogRow = { id: string; slug: string; name: string; type: Institution["type"]; bank_code: string | null; logo_key: string };
type DatabaseCause = { code?: string; message?: string };

class RepositoryDatabaseError extends Error {
  readonly code?: string;

  constructor(message: string, cause: DatabaseCause) {
    super(message);
    this.name = "RepositoryDatabaseError";
    this.code = cause.code;
  }
}

const clone = <T,>(value: T): T => structuredClone(value);
const asString = (value: unknown, fallback = "") => typeof value === "string" ? value : fallback;
const asOptionalString = (value: unknown) => typeof value === "string" && value.length > 0 ? value : undefined;
const asNumberString = (value: unknown, fallback = "0") => typeof value === "number" || typeof value === "string" ? String(value) : fallback;
const asDate = (value: unknown) => asString(value).slice(0, 10);
const asTimestamp = (value: unknown) => asString(value, new Date(0).toISOString());
const nullable = (value: string | undefined) => value ?? null;
const isMissingCardTypeColumn = (cause: unknown) => {
  const error = cause as Partial<RepositoryDatabaseError> & { message?: string };
  return (error.code === "PGRST204" || error.code === "42703") && /card_type/i.test(error.message ?? "");
};
const changed = (before: unknown, after: unknown) => JSON.stringify(before) !== JSON.stringify(after);

function databaseMessage(context: string, cause: { code?: string; message?: string } | null) {
  if (cause?.message) console.error(`Supabase ${context}:`, cause.message);
  if (cause?.message && /failed to fetch|network|fetch failed|load failed/i.test(cause.message)) {
    return "Não foi possível conectar ao Supabase. Confira as variáveis públicas do deploy e tente novamente.";
  }
  if (cause?.code === "42P01" || cause?.code === "PGRST205") {
    return "O banco do Kreature ainda não foi configurado. Aplique as migrations do Supabase e tente novamente.";
  }
  if (cause?.code === "42501") {
    return "Sua sessão não tem permissão para salvar este dado. Entre novamente e tente outra vez.";
  }
  if (cause?.code === "23503") {
    return "Uma conta, categoria ou instituição selecionada não está disponível para esta sessão.";
  }
  if ((cause?.code === "PGRST204" || cause?.code === "42703") && /card_type/i.test(cause.message ?? "")) {
    return "A coluna card_type ainda nÃ£o existe no Supabase. Aplique a migration de tipo do cartÃ£o.";
  }
  if (cause?.code === "PGRST204" || cause?.code === "42703") {
    return "A base do Supabase estÃ¡ desatualizada. Aplique as migrations locais antes de salvar novamente.";
  }
  if (cause?.code === "23505") {
    return "Este registro já existe. Revise os itens duplicados antes de confirmar.";
  }
  return `Não foi possível ${context}. Tente novamente em instantes.`;
}

export class SupabaseFinanceRepository implements FinanceRepository {
  async load(): Promise<FinanceState> {
    await this.userId();
    const [profileRows, categoryRows, accountRows, investmentRows, cardRows, entryRows, movementRows, purchaseRows, documentRows, ruleRows, planRows, catalogRows] = await Promise.all([
      this.rows("profiles"), this.rows("categories"), this.rows("financial_accounts"), this.rows("investments"), this.rows("credit_cards"),
      this.rows("ledger_entries"), this.rows("financial_movements"), this.rows("card_purchases"), this.rows("imported_documents"), this.rows("classification_rules"), this.rows("planned_entries"), this.catalogRows(),
    ]);
    const catalogById = new Map(catalogRows.map((row) => [row.id, row]));
    const profile = profileRows[0];
    const categories = await this.categories(categoryRows);
    return {
      ...emptyFinanceState(),
      profile: profile ? this.profile(profile) : emptyFinanceState().profile,
      theme: profile ? asString(profile.theme, "light") as FinanceState["theme"] : "light",
      categories,
      classificationRules: ruleRows.map(this.rule),
      institutions: accountRows.map((row) => this.account(row, catalogById)),
      investments: investmentRows.map(this.investment),
      creditCards: cardRows.map((row) => this.card(row, catalogById)),
      entries: entryRows.map(this.entry),
      financialMovements: movementRows.map(this.movement),
      cardPurchases: purchaseRows.map(this.purchase),
      importedDocuments: documentRows.map(this.document),
      plannedEntries: planRows.map(this.plan),
    };
  }

  async transact(change: (draft: FinanceState) => unknown | Promise<unknown>): Promise<FinanceState> {
    const previous = await this.load();
    const next = clone(previous);
    await change(next);
    const userId = await this.userId();
    await this.persist(previous, next, userId);
    return next;
  }

  private async userId() {
    // The AuthProvider restores and observes the official Supabase session.
    // Repository reads must not start a competing network getUser() check.
    const { data, error } = await getSupabase().auth.getSession();
    if (error || !data.session?.user) throw new Error("Entre novamente para carregar suas informações.");
    return data.session.user.id;
  }

  private async rows(table: TableName): Promise<Row[]> {
    const { data, error } = await getSupabase().from(table).select("*");
    if (error) throw new Error(databaseMessage("carregar seus dados", error));
    return (data ?? []) as unknown as Row[];
  }

  private async catalogRows(): Promise<CatalogRow[]> {
    const { data, error } = await getSupabase().from("financial_institutions").select("id, slug, name, type, bank_code, logo_key").order("name");
    if (error) throw new Error(databaseMessage("carregar o catálogo de instituições", error));
    return (data ?? []) as unknown as CatalogRow[];
  }

  private profile(row: Row): ProfileConfig {
    const mascot = row.mascot && typeof row.mascot === "object" ? row.mascot as ProfileConfig : emptyFinanceState().profile;
    return { ...emptyFinanceState().profile, ...mascot };
  }

  private async categories(rows: Row[]): Promise<Category[]> {
    return Promise.all(rows.map(async (row) => {
      const imagePath = asOptionalString(row.image_path);
      let image: Blob | undefined;
      if (imagePath) {
        const { data } = await getSupabase().storage.from("category-images").download(imagePath);
        image = data ?? undefined;
      }
      return {
        id: asString(row.id), name: asString(row.name), icon: asString(row.icon), color: asString(row.color),
        flow: asString(row.flow) as Category["flow"], image, imagePath, isDefault: Boolean(row.is_default),
        archivedAt: asOptionalString(row.archived_at), createdAt: asTimestamp(row.created_at), updatedAt: asTimestamp(row.updated_at),
      };
    }));
  }

  private account = (row: Row, catalogById: Map<string, CatalogRow>): Institution => {
    const catalog = catalogById.get(asString(row.financial_institution_id));
    return {
      id: asString(row.id), name: asString(row.name), type: asString(row.type) as Institution["type"], bankCode: asOptionalString(row.bank_code),
      agency: asOptionalString(row.agency), accountNumber: asOptionalString(row.account_number), identifier: asOptionalString(row.identifier),
      notes: asOptionalString(row.notes), currency: asString(row.currency, "BRL"), openingBalance: asNumberString(row.opening_balance),
      exchangeRate: asNumberString(row.exchange_rate, "1"), exchangeRateAsOf: asOptionalString(row.exchange_rate_as_of),
      catalogId: catalog?.slug as Institution["catalogId"], logoKey: catalog?.logo_key as Institution["logoKey"], archivedAt: asOptionalString(row.archived_at),
      createdAt: asTimestamp(row.created_at), updatedAt: asTimestamp(row.updated_at),
    };
  };

  private investment = (row: Row): Investment => ({
    id: asString(row.id), institutionId: asOptionalString(row.account_id), type: asString(row.type) as Investment["type"], applicationType: asOptionalString(row.application_type),
    name: asString(row.name), ticker: asOptionalString(row.ticker), quantity: asNumberString(row.quantity), averagePrice: asNumberString(row.average_price),
    investedAmount: asNumberString(row.invested_amount), currentPrice: asNumberString(row.current_price), currentValue: asNumberString(row.current_value),
    dividends: asNumberString(row.dividends), currency: asString(row.currency, "BRL"), contractedYield: asOptionalString(row.contracted_yield),
    maturityDate: asOptionalString(row.maturity_date), quoteStatus: asString(row.quote_status, "manual") as Investment["quoteStatus"], quoteMessage: asOptionalString(row.quote_message),
    quoteAsOf: asOptionalString(row.quote_as_of), archivedAt: asOptionalString(row.archived_at), createdAt: asTimestamp(row.created_at), updatedAt: asTimestamp(row.updated_at),
  });

  private card = (row: Row, catalogById: Map<string, CatalogRow>): CreditCard => {
    const catalog = catalogById.get(asString(row.issuer_institution_id));
    return {
      id: asString(row.id), name: asString(row.name), issuer: (catalog?.slug ?? "other") as CreditCard["issuer"], issuerName: asOptionalString(row.issuer_name),
      lastFour: asOptionalString(row.last_four), network: asOptionalString(row.network) as CreditCard["network"], cardType: asString(row.card_type, "credit") as CreditCard["cardType"], cardholderName: asOptionalString(row.cardholder_name),
      payerInstitutionId: asOptionalString(row.payer_account_id), limit: asNumberString(row.credit_limit), closingDay: Number(row.closing_day),
      dueDay: Number(row.due_day), currency: asString(row.currency, "BRL"), notes: asOptionalString(row.notes), archivedAt: asOptionalString(row.archived_at),
      createdAt: asTimestamp(row.created_at), updatedAt: asTimestamp(row.updated_at),
    };
  };

  private entry = (row: Row): LedgerEntry => ({
    id: asString(row.id), date: asDate(row.occurred_on), description: asString(row.description), amount: asNumberString(row.amount), currency: asString(row.currency, "BRL"),
    brlAmount: asNumberString(row.brl_amount), kind: asString(row.kind) as LedgerEntry["kind"], categoryId: asOptionalString(row.category_id),
    institutionId: asOptionalString(row.account_id), transferGroupId: asOptionalString(row.transfer_group_id), financialMovementId: asOptionalString(row.financial_movement_id), investmentId: asOptionalString(row.investment_id),
    creditCardId: asOptionalString(row.credit_card_id), importedDocumentId: asOptionalString(row.imported_document_id), invoiceKey: asOptionalString(row.invoice_key), plannedOccurrenceKey: asOptionalString(row.planned_occurrence_key), pendingReconciliation: Boolean(row.pending_reconciliation),
    source: asString(row.source, "manual") as LedgerEntry["source"], ignoredFromAnalytics: Boolean(row.ignored_from_analytics), systemGenerated: Boolean(row.system_generated), notes: asOptionalString(row.notes),
    fingerprint: asOptionalString(row.fingerprint), createdAt: asTimestamp(row.created_at), updatedAt: asTimestamp(row.updated_at),
  });

  private movement = (row: Row): FinancialMovement => ({
    id: asString(row.id), kind: asString(row.kind) as FinancialMovement["kind"], date: asDate(row.occurred_on), description: asString(row.description),
    amount: asNumberString(row.amount), currency: asString(row.currency, "BRL"), brlAmount: asNumberString(row.brl_amount), categoryId: asOptionalString(row.category_id),
    investmentId: asOptionalString(row.investment_id), creditCardId: asOptionalString(row.credit_card_id), importedDocumentId: asOptionalString(row.imported_document_id),
    plannedOccurrenceKey: asOptionalString(row.planned_occurrence_key), relatedMovementId: asOptionalString(row.related_movement_id), source: asString(row.source, "manual") as FinancialMovement["source"],
    notes: asOptionalString(row.notes), fingerprint: asOptionalString(row.fingerprint), legacyUnbalanced: Boolean(row.legacy_unbalanced), systemGenerated: Boolean(row.system_generated), createdAt: asTimestamp(row.created_at), updatedAt: asTimestamp(row.updated_at),
  });

  private purchase = (row: Row): CardPurchase => ({
    id: asString(row.id), cardId: asString(row.card_id), ledgerEntryId: asString(row.ledger_entry_id), description: asString(row.description),
    amount: asNumberString(row.amount), currency: asString(row.currency, "BRL"), date: asDate(row.occurred_on), categoryId: asOptionalString(row.category_id),
    installments: Number(row.installments), installmentNumber: typeof row.installment_number === "number" ? row.installment_number : undefined, totalInstallments: typeof row.total_installments === "number" ? row.total_installments : undefined, transactionKind: asOptionalString(row.transaction_kind) as CardPurchase["transactionKind"], importedDocumentId: asOptionalString(row.imported_document_id), firstInvoiceKey: asString(row.first_invoice_key), notes: asOptionalString(row.notes),
    createdAt: asTimestamp(row.created_at), updatedAt: asTimestamp(row.updated_at),
  });

  private document = (row: Row): ImportedDocument => ({
    id: asString(row.id), kind: asString(row.kind) as ImportedDocument["kind"], contentHash: asString(row.content_hash), source: asString(row.source), creditCardId: asOptionalString(row.credit_card_id), periodStart: asOptionalString(row.period_start), periodEnd: asOptionalString(row.period_end), closingDate: asOptionalString(row.closing_date), dueDate: asOptionalString(row.due_date), total: asOptionalString(row.total), createdAt: asTimestamp(row.created_at), updatedAt: asTimestamp(row.updated_at),
  });

  private rule = (row: Row): ClassificationRule => ({
    id: asString(row.id), match: asString(row.match), categoryId: asString(row.category_id), kind: asString(row.flow) as ClassificationRule["kind"],
    createdAt: asTimestamp(row.created_at), updatedAt: asTimestamp(row.updated_at),
  });

  private plan = (row: Row): PlannedEntry => ({
    id: asString(row.id), startDate: asDate(row.start_date), description: asString(row.description), amount: asNumberString(row.amount),
    kind: asString(row.kind) as PlannedEntry["kind"], categoryId: asOptionalString(row.category_id), institutionId: asOptionalString(row.account_id), paymentMethod: asString(row.payment_method, "pix") as PlannedEntry["paymentMethod"], creditCardId: asOptionalString(row.credit_card_id),
    frequency: asString(row.frequency) as PlannedEntry["frequency"], endDate: asOptionalString(row.end_date),
    occurrenceCount: typeof row.occurrence_count === "number" ? row.occurrence_count : undefined,
    exceptions: Array.isArray(row.exceptions) ? row.exceptions as PlannedEntry["exceptions"] : [], createdAt: asTimestamp(row.created_at), updatedAt: asTimestamp(row.updated_at),
  });

  private async persist(previous: FinanceState, next: FinanceState, userId: string) {
    const catalog = await this.catalogRows();
    const catalogIdBySlug = new Map(catalog.map((item) => [item.slug, item.id]));
    if (changed(previous.profile, next.profile) || previous.theme !== next.theme) {
      await this.upsert("profiles", [{ user_id: userId, display_name: next.profile.nickname, mascot: next.profile, theme: next.theme }]);
    }
    if (changed(previous.categories, next.categories)) {
      const categories = await this.categoryRecords(previous.categories, next.categories, userId);
      await this.sync("categories", previous.categories, next.categories, categories);
    }
    if (changed(previous.institutions, next.institutions)) await this.sync("financial_accounts", previous.institutions, next.institutions, next.institutions.map((item) => ({
      id: item.id, user_id: userId, financial_institution_id: nullable(item.catalogId ? catalogIdBySlug.get(item.catalogId) : undefined), name: item.name, type: item.type,
      bank_code: nullable(item.bankCode), agency: nullable(item.agency), account_number: nullable(item.accountNumber), identifier: nullable(item.identifier), notes: nullable(item.notes),
      currency: item.currency, opening_balance: item.openingBalance, exchange_rate: item.exchangeRate, exchange_rate_as_of: nullable(item.exchangeRateAsOf), archived_at: nullable(item.archivedAt), created_at: item.createdAt,
    })));
    if (changed(previous.investments, next.investments)) await this.sync("investments", previous.investments, next.investments, next.investments.map((item) => ({
      id: item.id, user_id: userId, account_id: nullable(item.institutionId), type: item.type, application_type: nullable(item.applicationType), name: item.name, ticker: nullable(item.ticker),
      quantity: item.quantity, average_price: item.averagePrice, invested_amount: item.investedAmount, current_price: item.currentPrice, current_value: item.currentValue,
      dividends: item.dividends, currency: item.currency, contracted_yield: nullable(item.contractedYield), maturity_date: nullable(item.maturityDate), quote_status: item.quoteStatus,
      quote_message: nullable(item.quoteMessage), quote_as_of: nullable(item.quoteAsOf), archived_at: nullable(item.archivedAt), created_at: item.createdAt,
    })));
    if (changed(previous.creditCards, next.creditCards)) {
      const cardRecords = next.creditCards.map((item) => ({
      id: item.id, user_id: userId, name: item.name, issuer_institution_id: nullable(item.issuer && item.issuer !== "other" ? catalogIdBySlug.get(item.issuer) : undefined),
      issuer_name: nullable(item.issuerName), last_four: nullable(item.lastFour), network: nullable(item.network), card_type: item.cardType ?? "credit", cardholder_name: nullable(item.cardholderName), payer_account_id: nullable(item.payerInstitutionId), credit_limit: item.limit, closing_day: item.closingDay, due_day: item.dueDay,
      currency: item.currency, notes: nullable(item.notes), archived_at: nullable(item.archivedAt), created_at: item.createdAt,
      }));
      try {
        await this.sync("credit_cards", previous.creditCards, next.creditCards, cardRecords);
      } catch (cause) {
        if (!isMissingCardTypeColumn(cause)) throw cause;
        if (next.creditCards.some((item) => item.cardType === "debit")) {
          throw new Error("Para salvar cartões de débito, aplique a migration 20260830110000_credit_card_type.sql no Supabase.");
        }
        // Compatibility with a remote database that has not received the new column yet.
        const legacyCardRecords = cardRecords.map((record) => Object.fromEntries(Object.entries(record).filter(([key]) => key !== "card_type")));
        await this.sync("credit_cards", previous.creditCards, next.creditCards, legacyCardRecords);
      }
    }
    if (changed(previous.importedDocuments, next.importedDocuments)) await this.sync("imported_documents", previous.importedDocuments, next.importedDocuments, next.importedDocuments.map((item) => ({ id: item.id, user_id: userId, kind: item.kind, content_hash: item.contentHash, source: item.source, credit_card_id: nullable(item.creditCardId), period_start: nullable(item.periodStart), period_end: nullable(item.periodEnd), closing_date: nullable(item.closingDate), due_date: nullable(item.dueDate), total: nullable(item.total), created_at: item.createdAt })));
    if (changed(previous.financialMovements, next.financialMovements)) await this.sync("financial_movements", previous.financialMovements, next.financialMovements, next.financialMovements.map((item) => ({
      id: item.id, user_id: userId, kind: item.kind, occurred_on: item.date.slice(0, 10), description: item.description, amount: item.amount, currency: item.currency, brl_amount: item.brlAmount,
      category_id: nullable(item.categoryId), investment_id: nullable(item.investmentId), credit_card_id: nullable(item.creditCardId), imported_document_id: nullable(item.importedDocumentId),
      planned_occurrence_key: nullable(item.plannedOccurrenceKey), related_movement_id: nullable(item.relatedMovementId), source: item.source, notes: nullable(item.notes), fingerprint: nullable(item.fingerprint), legacy_unbalanced: Boolean(item.legacyUnbalanced), system_generated: Boolean(item.systemGenerated), created_at: item.createdAt,
    })));
    if (changed(previous.entries, next.entries)) await this.sync("ledger_entries", previous.entries, next.entries, next.entries.map((item) => ({
      id: item.id, user_id: userId, account_id: nullable(item.institutionId), category_id: nullable(item.categoryId), investment_id: nullable(item.investmentId), credit_card_id: nullable(item.creditCardId),
      transfer_group_id: nullable(item.transferGroupId), financial_movement_id: nullable(item.financialMovementId), imported_document_id: nullable(item.importedDocumentId), occurred_on: item.date.slice(0, 10), occurred_at: item.date.includes("T") ? item.date : null, description: item.description,
      amount: item.amount, currency: item.currency, brl_amount: item.brlAmount, kind: item.kind, invoice_key: nullable(item.invoiceKey), planned_occurrence_key: nullable(item.plannedOccurrenceKey),
      source: item.source, ignored_from_analytics: item.ignoredFromAnalytics, system_generated: Boolean(item.systemGenerated), notes: nullable(item.notes), fingerprint: nullable(item.fingerprint), pending_reconciliation: Boolean(item.pendingReconciliation), created_at: item.createdAt,
    })));
    if (changed(previous.cardPurchases, next.cardPurchases)) await this.sync("card_purchases", previous.cardPurchases, next.cardPurchases, next.cardPurchases.map((item) => ({
      id: item.id, user_id: userId, card_id: item.cardId, ledger_entry_id: item.ledgerEntryId, description: item.description, amount: item.amount, currency: item.currency,
      occurred_on: item.date, category_id: nullable(item.categoryId), installments: item.installments, installment_number: item.installmentNumber ?? null, total_installments: item.totalInstallments ?? null, transaction_kind: item.transactionKind ?? "purchase", imported_document_id: nullable(item.importedDocumentId), first_invoice_key: item.firstInvoiceKey, notes: nullable(item.notes), created_at: item.createdAt,
    })));
    if (changed(previous.classificationRules, next.classificationRules)) await this.sync("classification_rules", previous.classificationRules, next.classificationRules, next.classificationRules.map((item) => ({
      id: item.id, user_id: userId, match: item.match, category_id: item.categoryId, flow: item.kind, created_at: item.createdAt,
    })));
    if (changed(previous.plannedEntries, next.plannedEntries)) await this.sync("planned_entries", previous.plannedEntries, next.plannedEntries, next.plannedEntries.map((item) => ({
      id: item.id, user_id: userId, start_date: item.startDate, description: item.description, amount: item.amount, kind: item.kind, category_id: nullable(item.categoryId),
      account_id: nullable(item.institutionId), payment_method: item.paymentMethod ?? "pix", credit_card_id: nullable(item.creditCardId), frequency: item.frequency, end_date: nullable(item.endDate), occurrence_count: item.occurrenceCount ?? null, exceptions: item.exceptions, created_at: item.createdAt,
    })));
  }

  private async categoryRecords(previous: Category[], next: Category[], userId: string): Promise<Row[]> {
    const previousById = new Map(previous.map((item) => [item.id, item]));
    return Promise.all(next.map(async (item) => {
      let imagePath = item.imagePath;
      if (item.image && !imagePath) {
        imagePath = `${userId}/${item.id}/${crypto.randomUUID()}`;
        const { error } = await getSupabase().storage.from("category-images").upload(imagePath, item.image, { upsert: false, contentType: item.image.type || undefined });
        if (error) throw new Error(databaseMessage("enviar a imagem da categoria", error));
      }
      const prior = previousById.get(item.id);
      if (prior?.imagePath && !item.image && !imagePath) await getSupabase().storage.from("category-images").remove([prior.imagePath]);
      return { id: item.id, user_id: userId, name: item.name, icon: item.icon, color: item.color, flow: item.flow, image_path: nullable(imagePath), is_default: item.isDefault, archived_at: nullable(item.archivedAt), created_at: item.createdAt };
    }));
  }

  private async sync(table: TableName, previous: Array<{ id: string }>, next: Array<{ id: string }>, records: Row[]) {
    const nextIds = new Set(next.map((item) => item.id));
    const deletedIds = previous.filter((item) => !nextIds.has(item.id)).map((item) => item.id);
    if (deletedIds.length > 0) {
      const { error } = await getSupabase().from(table).delete().in("id", deletedIds);
      if (error) throw new Error(databaseMessage("remover um registro", error));
    }
    if (records.length > 0) await this.upsert(table, records);
  }

  private async upsert(table: TableName, records: Row[]) {
    const { error } = await getSupabase().from(table).upsert(records);
    if (error) throw new RepositoryDatabaseError(databaseMessage("salvar seus dados", error), error);
  }
}
