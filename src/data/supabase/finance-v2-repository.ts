import Decimal from "decimal.js";
import { emptyFinanceState } from "@/domain/defaults";
import type {
  CardPurchase,
  Category,
  ClassificationRule,
  CreditCard,
  FinanceState,
  FinancialMovement,
  ImportedDocument,
  Institution,
  Investment,
  InvestmentType,
  LedgerEntry,
  PlannedEntry,
  RecurrenceException,
} from "@/domain/types";
import type { ProfileConfig } from "@/features/profile/types";
import { getSupabase } from "./client";
import {
  SupabaseFinanceV2Gateway,
  type FinanceV2Account,
  type FinanceV2Event,
  type FinanceV2InvestmentAsset,
  type FinanceV2InvestmentPosition,
  type FinanceV2Snapshot,
} from "./finance-v2-gateway";
import type { FinanceRepository } from "../repository";

const clone = <T,>(value: T): T => structuredClone(value);
const text = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);
const optional = (value: unknown) => (typeof value === "string" && value.length > 0 ? value : undefined);
const decimal = (value: unknown, fallback = "0") =>
  value === null || value === undefined ? fallback : new Decimal(String(value)).toString();
const same = (before: unknown, after: unknown) => JSON.stringify(before) === JSON.stringify(after);
const day = (value: string) => value.slice(0, 10);

const ACCOUNT_KIND_BY_TYPE: Record<Institution["type"], FinanceV2Account["kind"]> = {
  bank: "bank",
  broker: "brokerage",
  wallet: "wallet",
  other: "other",
};
const TYPE_BY_ACCOUNT_KIND: Record<FinanceV2Account["kind"], Institution["type"]> = {
  bank: "bank",
  brokerage: "broker",
  wallet: "wallet",
  exchange: "other",
  crypto_wallet: "wallet",
  other: "other",
};
const ASSET_TYPE_BY_INVESTMENT: Record<InvestmentType, string> = {
  cash_box: "cash_box",
  cdb: "fixed_income",
  cri: "fixed_income",
  cra: "fixed_income",
  fixed_income: "fixed_income",
  stock: "stock",
  fii: "fii",
  etf: "etf",
  bdr: "bdr",
  crypto: "crypto",
  fund: "fund",
  pension: "pension",
  other: "other",
};
const INVESTMENT_BY_ASSET_TYPE: Record<string, InvestmentType> = {
  cash_box: "cash_box",
  fixed_income: "fixed_income",
  stock: "stock",
  fii: "fii",
  etf: "etf",
  bdr: "bdr",
  crypto: "crypto",
  fund: "fund",
  pension: "pension",
  other: "other",
};
const CARD_NETWORKS = new Set(["visa", "mastercard", "elo"]);
const GROWS_POSITION = new Set(["buy", "contribution", "transfer_in", "reinvestment", "opening_position"]);

/** v1 called them "movements"; v2 calls them events. The mapping is one to one. */
function movementKindOf(event: FinanceV2Event): FinancialMovement["kind"] {
  switch (event.kind) {
    case "income":
      return "income";
    case "expense":
      return "expense";
    case "internal_transfer":
    case "currency_exchange":
      return "internal_transfer";
    case "adjustment":
    case "opening_balance":
      return "adjustment";
    case "credit_card_payment":
      return "credit_payment";
    case "investment_income":
      return "investment_income";
    case "investment_transaction":
      return event.investment && GROWS_POSITION.has(event.investment.operation)
        ? "investment_contribution"
        : "investment_withdrawal";
    case "card_transaction":
      switch (event.card?.kind) {
        case "refund":
          return "card_refund";
        case "fee":
          return "card_fee";
        case "interest":
          return "card_interest";
        default:
          return "card_purchase";
      }
  }
}

/** The repository depends on the gateway's shape, so a test can stand in for it. */
export type FinanceV2Api = Pick<
  SupabaseFinanceV2Gateway,
  | "snapshot"
  | "writeProfile"
  | "writeCategory"
  | "writeAccount"
  | "writeCard"
  | "writeInvestmentAsset"
  | "writeRecurrenceRule"
  | "writePlannedOccurrence"
  | "writeClassificationRule"
  | "writeImportBatch"
  | "writeCashEvent"
  | "writeCardTransaction"
  | "payCardInvoice"
  | "writeInvestmentOperation"
  | "deleteInvestmentOperation"
  | "writeAssetQuote"
  | "writeFxRate"
>;

type LedgerOwner =
  | { kind: "account"; id: string }
  | { kind: "investment"; id: string }
  | { kind: "card"; id: string };

/**
 * The application's persistence seam, backed only by the v2 api. Every read is
 * a named projection and every write is an atomic api call: there is no
 * `select *` and no table the client touches directly.
 */
export class SupabaseFinanceV2Repository implements FinanceRepository {
  private readonly gateway: FinanceV2Api;
  /** Optimistic-locking versions captured on the last read. */
  private versions = new Map<string, number>();
  /** v1 has no place for the holding id, so it is remembered alongside the asset. */
  private holdings = new Map<string, string>();
  private ledgerOwners = new Map<string, LedgerOwner>();
  /** The catalog is addressed by slug in the UI and by organization id in the database. */
  private institutionIdBySlug = new Map<string, string>();
  private eventsById = new Map<string, FinanceV2Event>();
  private reportingCurrency = "BRL";

  constructor(gateway: FinanceV2Api = new SupabaseFinanceV2Gateway()) {
    this.gateway = gateway;
  }

  async load(): Promise<FinanceState> {
    const snapshot = await this.gateway.snapshot();
    return this.project(snapshot);
  }

  async transact(change: (draft: FinanceState) => unknown | Promise<unknown>): Promise<FinanceState> {
    const previous = await this.load();
    const next = clone(previous);
    await change(next);
    await this.persist(previous, next);
    return this.load();
  }

  // -- read ----------------------------------------------------------------

  private async project(snapshot: FinanceV2Snapshot): Promise<FinanceState> {
    this.versions = new Map();
    this.holdings = new Map();
    this.ledgerOwners = new Map();
    this.eventsById = new Map(snapshot.events.map((event) => [event.id, event]));
    this.reportingCurrency = snapshot.profile.reporting_currency_code ?? "BRL";

    const institutionByOrganization = new Map(snapshot.financial_institutions.map((item) => [item.id, item]));
    this.institutionIdBySlug = new Map(snapshot.financial_institutions.map((item) => [item.slug, item.id]));
    const rateByCurrency = new Map(
      snapshot.fx_rates
        .filter((rate) => rate.quote_currency_code === this.reportingCurrency)
        .map((rate) => [rate.base_currency_code, rate]),
    );
    const rateFor = (currency: string) =>
      currency === this.reportingCurrency ? "1" : decimal(rateByCurrency.get(currency)?.rate, "0");

    for (const account of snapshot.accounts) {
      this.versions.set(account.id, account.version);
      this.ledgerOwners.set(account.ledger_account_id, { kind: "account", id: account.id });
    }
    for (const card of snapshot.cards) {
      this.versions.set(card.id, card.version);
      if (card.liability_ledger_account_id) {
        this.ledgerOwners.set(card.liability_ledger_account_id, { kind: "card", id: card.id });
      }
    }
    for (const asset of snapshot.investment_assets) {
      this.versions.set(asset.id, asset.version);
      if (asset.holding_id) this.holdings.set(asset.id, asset.holding_id);
      if (asset.ledger_account_id) {
        this.ledgerOwners.set(asset.ledger_account_id, { kind: "investment", id: asset.id });
      }
    }
    for (const rule of snapshot.recurrence_rules) this.versions.set(rule.id, rule.version);
    for (const event of snapshot.events) this.versions.set(event.id, event.version);

    const positionByHolding = new Map(snapshot.investment_positions.map((item) => [item.holding_id, item]));
    const { entries, movements, cardPurchases } = this.projectEvents(snapshot, rateFor);

    return {
      ...emptyFinanceState(),
      profile: { ...emptyFinanceState().profile, ...(snapshot.profile.mascot as Partial<ProfileConfig>) },
      theme: snapshot.profile.theme ?? "light",
      categories: await this.projectCategories(snapshot),
      classificationRules: snapshot.classification_rules.map((rule): ClassificationRule => ({
        id: rule.id,
        match: text(rule.sensitive.match),
        categoryId: rule.category_id,
        kind: rule.flow,
        createdAt: rule.created_at,
        updatedAt: rule.updated_at,
      })),
      institutions: snapshot.accounts.map((account): Institution => {
        const catalog = account.institution_id ? institutionByOrganization.get(account.institution_id) : undefined;
        return {
          id: account.id,
          name: text(account.sensitive.name, "Conta"),
          type: TYPE_BY_ACCOUNT_KIND[account.kind] ?? "other",
          bankCode: catalog?.bank_code ?? undefined,
          agency: optional(account.sensitive.agency),
          accountNumber: optional(account.sensitive.accountNumber),
          identifier: optional(account.sensitive.identifier),
          notes: optional(account.sensitive.notes),
          currency: account.currency_code,
          // The ledger already carries the opening balance as an event, so the
          // v1 field stays at zero instead of double counting it.
          openingBalance: "0",
          exchangeRate: rateFor(account.currency_code),
          exchangeRateAsOf: rateByCurrency.get(account.currency_code)?.observed_at,
          catalogId: catalog?.slug as Institution["catalogId"],
          logoKey: (catalog?.logo_key ?? undefined) as Institution["logoKey"],
          archivedAt: account.archived_at ?? undefined,
          createdAt: account.created_at,
          updatedAt: account.updated_at,
        };
      }),
      creditCards: snapshot.cards.map((card): CreditCard => {
        const catalog = card.institution_id ? institutionByOrganization.get(card.institution_id) : undefined;
        return {
          id: card.id,
          name: text(card.sensitive.name, "Cartão"),
          issuer: (catalog?.slug ?? "other") as CreditCard["issuer"],
          issuerName: optional(card.sensitive.issuerName),
          lastFour: optional(card.sensitive.lastFour),
          network: CARD_NETWORKS.has(card.network) ? (card.network as CreditCard["network"]) : undefined,
          cardType: card.kind,
          cardholderName: optional(card.sensitive.cardholderName),
          payerInstitutionId: card.payer_account_id ?? undefined,
          limit: decimal(card.credit_limit),
          closingDay: card.closing_day ?? 1,
          dueDay: card.due_day ?? 10,
          currency: card.currency_code,
          notes: optional(card.sensitive.notes),
          archivedAt: card.archived_at ?? undefined,
          createdAt: card.created_at,
          updatedAt: card.updated_at,
        };
      }),
      investments: snapshot.investment_assets.map((asset) =>
        this.projectInvestment(asset, asset.holding_id ? positionByHolding.get(asset.holding_id) : undefined)
      ),
      entries,
      financialMovements: movements,
      cardPurchases,
      importedDocuments: snapshot.import_batches.map((batch): ImportedDocument => ({
        id: batch.id,
        kind: batch.kind,
        contentHash: text(batch.sensitive.contentHash),
        source: text(batch.sensitive.source),
        institutionId: batch.sensitive.institutionId as ImportedDocument["institutionId"],
        creditCardId: optional(batch.sensitive.cardId),
        periodStart: batch.period_start ?? undefined,
        periodEnd: batch.period_end ?? undefined,
        closingDate: optional(batch.sensitive.closingDate),
        dueDate: optional(batch.sensitive.dueDate),
        total: optional(batch.sensitive.total),
        createdAt: batch.created_at,
        updatedAt: batch.updated_at,
      })),
      plannedEntries: this.projectPlans(snapshot),
    };
  }

  private async projectCategories(snapshot: FinanceV2Snapshot): Promise<Category[]> {
    return Promise.all(
      snapshot.categories.map(async (category) => {
        let image: Blob | undefined;
        if (category.image_path) {
          const { data } = await getSupabase().storage.from("category-images").download(category.image_path);
          image = data ?? undefined;
        }
        return {
          id: category.id,
          name: category.name,
          icon: category.icon,
          color: category.color,
          flow: category.flow,
          image,
          imagePath: category.image_path ?? undefined,
          isDefault: category.is_default,
          archivedAt: category.archived_at ?? undefined,
          createdAt: category.created_at,
          updatedAt: category.updated_at,
        } satisfies Category;
      }),
    );
  }

  /** Every number here is replayed from the operations; none of it is stored. */
  private projectInvestment(asset: FinanceV2InvestmentAsset, position?: FinanceV2InvestmentPosition): Investment {
    const quantity = decimal(position?.quantity);
    const costBasis = decimal(position?.cost_basis);
    const average = position?.average_price ? decimal(position.average_price) : "0";
    return {
      id: asset.id,
      institutionId: asset.custody_account_id ?? undefined,
      type: (optional(asset.sensitive.investmentType) as InvestmentType | undefined)
        ?? INVESTMENT_BY_ASSET_TYPE[asset.asset_type_code]
        ?? "other",
      applicationType: optional(asset.sensitive.applicationType),
      name: text(asset.sensitive.name, "Investimento"),
      ticker: optional(asset.sensitive.ticker),
      quantity,
      averagePrice: average,
      investedAmount: costBasis,
      currentPrice: position?.unit_price ? decimal(position.unit_price) : average,
      currentValue: decimal(position?.market_value),
      dividends: decimal(position?.income_gross),
      currency: asset.currency_code,
      contractedYield: optional(asset.sensitive.contractedYield),
      maturityDate: optional(asset.sensitive.maturityDate),
      quoteStatus: "manual",
      quoteMessage: optional(asset.sensitive.quoteMessage),
      quoteAsOf: position?.price_observed_at ?? undefined,
      archivedAt: asset.archived_at ?? undefined,
      createdAt: asset.created_at,
      updatedAt: asset.updated_at,
    };
  }

  private projectEvents(snapshot: FinanceV2Snapshot, rateFor: (currency: string) => string) {
    const entries: LedgerEntry[] = [];
    const movements: FinancialMovement[] = [];
    const purchaseDrafts = new Map<string, { events: FinanceV2Event[]; entryId: string }>();

    for (const event of snapshot.events) {
      const kind = movementKindOf(event);
      const currency = event.postings[0]?.currency_code ?? this.reportingCurrency;
      const rate = rateFor(currency);
      const description = text(event.sensitive.description);
      const legs: LedgerEntry[] = [];

      const push = (amount: string, extra: Partial<LedgerEntry>) => {
        const brlAmount = new Decimal(amount).mul(rate).toString();
        const entry: LedgerEntry = {
          id: extra.id ?? event.id,
          date: day(event.occurred_at),
          description,
          amount,
          currency,
          brlAmount,
          kind: kind as LedgerEntry["kind"],
          categoryId: event.category_id ?? undefined,
          financialMovementId: event.id,
          importedDocumentId: event.import_batch_id ?? undefined,
          plannedOccurrenceKey: optional(event.sensitive.plannedOccurrenceKey),
          source: event.source,
          ignoredFromAnalytics: kind === "internal_transfer" || kind === "credit_payment"
            || kind === "investment_contribution" || kind === "investment_withdrawal",
          notes: optional(event.sensitive.notes),
          fingerprint: optional(event.sensitive.fingerprint),
          createdAt: event.created_at,
          updatedAt: event.updated_at,
          ...extra,
        };
        legs.push(entry);
        entries.push(entry);
      };

      if (event.kind === "card_transaction" && event.card) {
        const liability = event.postings.find(
          (posting) => this.ledgerOwners.get(posting.ledger_account_id)?.kind === "card",
        );
        if (liability) {
          push(decimal(liability.amount), {
            creditCardId: event.card.card_id,
            paymentMethod: "credit_card",
            institutionId: undefined,
          });
        }
      } else if (event.kind === "credit_card_payment") {
        const cash = event.postings.find(
          (posting) => this.ledgerOwners.get(posting.ledger_account_id)?.kind === "account",
        );
        const liability = event.postings.find(
          (posting) => this.ledgerOwners.get(posting.ledger_account_id)?.kind === "card",
        );
        if (cash) {
          const owner = this.ledgerOwners.get(cash.ledger_account_id) as { kind: "account"; id: string };
          push(decimal(cash.amount), {
            institutionId: owner.id,
            creditCardId: liability
              ? (this.ledgerOwners.get(liability.ledger_account_id) as { id: string }).id
              : undefined,
            invoiceKey: optional(event.sensitive.invoiceKey),
            systemGenerated: true,
          });
        }
      } else {
        // Only legs that move a balance the user recognises become entries: the
        // income, expense, equity and clearing counterparts stay in the ledger.
        for (const posting of event.postings) {
          const owner = this.ledgerOwners.get(posting.ledger_account_id);
          if (!owner) continue;
          push(decimal(posting.amount), {
            id: `${event.id}:${posting.id}`,
            institutionId: owner.kind === "account" ? owner.id : undefined,
            investmentId: owner.kind === "investment" ? owner.id : undefined,
            transferGroupId: kind === "internal_transfer" ? event.id : undefined,
          });
        }
      }

      const economic = event.investment_income
        ? decimal(event.investment_income.gross_amount)
        : legs.reduce((max, leg) => Decimal.max(max, new Decimal(leg.amount).abs()), new Decimal(0)).toString();

      movements.push({
        id: event.id,
        kind,
        date: day(event.occurred_at),
        description,
        amount: new Decimal(economic).abs().toString(),
        currency,
        brlAmount: new Decimal(economic).abs().mul(rate).toString(),
        categoryId: event.category_id ?? undefined,
        paymentMethod: event.kind === "card_transaction" ? "credit_card" : undefined,
        investmentId: event.investment?.asset_id ?? event.investment_income?.asset_id ?? undefined,
        creditCardId: event.card?.card_id ?? undefined,
        importedDocumentId: event.import_batch_id ?? undefined,
        plannedOccurrenceKey: optional(event.sensitive.plannedOccurrenceKey),
        source: event.source,
        notes: optional(event.sensitive.notes),
        fingerprint: optional(event.sensitive.fingerprint),
        systemGenerated: event.kind === "credit_card_payment",
        createdAt: event.created_at,
        updatedAt: event.updated_at,
      });

      if (event.kind === "card_transaction" && event.card && legs[0]) {
        // A purchase split across invoice months is one purchase to the reader.
        const groupId = text(event.sensitive.purchaseId, event.id);
        const draft = purchaseDrafts.get(groupId) ?? { events: [], entryId: legs[0].id };
        draft.events.push(event);
        purchaseDrafts.set(groupId, draft);
      }
    }

    const cardPurchases: CardPurchase[] = [...purchaseDrafts].map(([groupId, draft]) => {
      const ordered = [...draft.events].sort(
        (a, b) => (a.card?.installment_number ?? 0) - (b.card?.installment_number ?? 0),
      );
      const first = ordered[0];
      const total = ordered.reduce((sum, event) => {
        const liability = event.postings.find(
          (posting) => this.ledgerOwners.get(posting.ledger_account_id)?.kind === "card",
        );
        return sum.plus(new Decimal(decimal(liability?.amount)).abs());
      }, new Decimal(0));
      const month = first.card?.first_invoice_month ?? day(first.occurred_at);
      return {
        id: groupId,
        cardId: first.card!.card_id,
        ledgerEntryId: draft.entryId,
        description: text(first.sensitive.description),
        amount: total.toString(),
        currency: first.postings[0]?.currency_code ?? this.reportingCurrency,
        date: day(first.occurred_at),
        categoryId: first.category_id ?? undefined,
        installments: ordered.length,
        installmentNumber: first.sensitive.installmentNumber as number | undefined,
        totalInstallments: first.sensitive.totalInstallments as number | undefined,
        transactionKind: first.card!.kind,
        importedDocumentId: first.import_batch_id ?? undefined,
        firstInvoiceKey: `${first.card!.card_id}:${month.slice(0, 7)}`,
        notes: optional(first.sensitive.notes),
        createdAt: first.created_at,
        updatedAt: first.updated_at,
      } satisfies CardPurchase;
    });

    return { entries, movements, cardPurchases };
  }

  private projectPlans(snapshot: FinanceV2Snapshot): PlannedEntry[] {
    const byRule = new Map<string, RecurrenceException[]>();
    for (const occurrence of snapshot.planned_occurrences) {
      const stored = occurrence.sensitive as Partial<RecurrenceException>;
      const exception: RecurrenceException = {
        ...stored,
        date: occurrence.scheduled_for,
        deleted: occurrence.status === "cancelled" ? true : stored.deleted,
        amount: occurrence.effective_amount ? decimal(occurrence.effective_amount) : stored.amount,
        effectiveAmount: occurrence.effective_amount ? decimal(occurrence.effective_amount) : stored.effectiveAmount,
        effectiveDate: occurrence.effective_at ? day(occurrence.effective_at) : stored.effectiveDate,
        settledEntryId: occurrence.settled_event_id ?? stored.settledEntryId,
        settledMovementId: occurrence.settled_event_id ?? stored.settledMovementId,
      };
      byRule.set(occurrence.recurrence_rule_id, [...(byRule.get(occurrence.recurrence_rule_id) ?? []), exception]);
    }

    return snapshot.recurrence_rules.map((rule): PlannedEntry => ({
      id: rule.id,
      startDate: rule.start_date,
      description: text(rule.sensitive.description),
      amount: decimal(rule.amount),
      kind: rule.flow,
      categoryId: rule.category_id ?? undefined,
      institutionId: rule.account_id ?? undefined,
      paymentMethod: rule.payment_method,
      creditCardId: rule.card_id ?? undefined,
      frequency: rule.frequency,
      endDate: rule.end_date ?? undefined,
      occurrenceCount: rule.occurrence_count ?? undefined,
      exceptions: byRule.get(rule.id) ?? [],
      createdAt: rule.created_at,
      updatedAt: rule.updated_at,
    }));
  }

  // -- write ---------------------------------------------------------------

  private version(id: string) {
    const known = this.versions.get(id);
    if (known === undefined) throw new Error("Este registro mudou em outra sessão. Recarregue e tente de novo.");
    return known;
  }

  private async persist(previous: FinanceState, next: FinanceState) {
    // Catalog rows first: events reference categories, accounts, cards and assets.
    if (!same(previous.profile, next.profile) || previous.theme !== next.theme) {
      await this.gateway.writeProfile({
        display_name: text(next.profile.nickname),
        mascot: next.profile as unknown as Record<string, unknown>,
        theme: next.theme,
      });
    }
    await this.syncCategories(previous, next);
    await this.syncRates(previous, next);
    await this.syncAccounts(previous, next);
    await this.syncCards(previous, next);
    await this.syncImports(previous, next);
    await this.syncInvestments(previous, next);
    await this.syncPlans(previous, next);
    await this.syncClassificationRules(previous, next);
    await this.syncMovements(previous, next);
  }

  private async syncCategories(previous: FinanceState, next: FinanceState) {
    if (same(previous.categories, next.categories)) return;
    const before = new Map(previous.categories.map((item) => [item.id, item]));
    for (const category of next.categories) {
      const prior = before.get(category.id);
      if (prior && same({ ...prior, image: undefined }, { ...category, image: undefined })) continue;
      const imagePath = await this.categoryImagePath(category, prior);
      await this.gateway.writeCategory({
        operation: prior ? "update" : "create",
        id: prior ? category.id : undefined,
        category: {
          name: category.name,
          icon: category.icon,
          color: category.color,
          flow: category.flow,
          image_path: imagePath ?? null,
          is_default: category.isDefault,
          archived_at: category.archivedAt ?? null,
        },
      });
    }
    const kept = new Set(next.categories.map((item) => item.id));
    for (const category of previous.categories) {
      if (!kept.has(category.id)) await this.gateway.writeCategory({ operation: "delete", id: category.id });
    }
  }

  private async categoryImagePath(category: Category, prior?: Category) {
    let imagePath = category.imagePath;
    if (category.image && !imagePath) {
      const { data: session } = await getSupabase().auth.getSession();
      const owner = session.session?.user.id;
      if (!owner) throw new Error("Entre novamente para enviar a imagem da categoria.");
      imagePath = `${owner}/${category.id}/${crypto.randomUUID()}`;
      const { error } = await getSupabase().storage
        .from("category-images")
        .upload(imagePath, category.image, { upsert: false, contentType: category.image.type || undefined });
      if (error) throw new Error("Não foi possível enviar a imagem da categoria.");
    }
    if (prior?.imagePath && !category.image && !imagePath) {
      await getSupabase().storage.from("category-images").remove([prior.imagePath]);
    }
    return imagePath;
  }

  /** A conversion rate is a new observation, never an overwrite of the old one. */
  private async syncRates(previous: FinanceState, next: FinanceState) {
    const before = new Map(previous.institutions.map((item) => [item.currency, item.exchangeRate]));
    const written = new Set<string>();
    for (const institution of next.institutions) {
      if (institution.currency === this.reportingCurrency || written.has(institution.currency)) continue;
      const prior = before.get(institution.currency);
      if (prior !== undefined && new Decimal(prior).eq(institution.exchangeRate || 0)) continue;
      if (!institution.exchangeRate || new Decimal(institution.exchangeRate).lte(0)) continue;
      written.add(institution.currency);
      await this.gateway.writeFxRate({
        baseCurrencyCode: institution.currency,
        quoteCurrencyCode: this.reportingCurrency,
        rate: institution.exchangeRate,
      });
    }
  }

  private async syncAccounts(previous: FinanceState, next: FinanceState) {
    if (same(previous.institutions, next.institutions)) return;
    const before = new Map(previous.institutions.map((item) => [item.id, item]));
    for (const institution of next.institutions) {
      const prior = before.get(institution.id);
      if (prior && same(prior, institution)) continue;
      const command = {
        institutionId: institution.catalogId ? this.institutionIdBySlug.get(institution.catalogId) : undefined,
        kind: ACCOUNT_KIND_BY_TYPE[institution.type] ?? "other",
        currencyCode: institution.currency,
        archivedAt: institution.archivedAt,
        sensitive: {
          name: institution.name,
          agency: institution.agency,
          accountNumber: institution.accountNumber,
          identifier: institution.identifier,
          notes: institution.notes,
          catalogSlug: institution.catalogId,
        },
      };
      const written = await this.gateway.writeAccount(
        prior
          ? { operation: "update", id: institution.id, expectedVersion: this.version(institution.id), account: command }
          : { operation: "create", account: command },
      );
      // A brand new account states its opening balance as an event, not a column.
      if (!prior && institution.openingBalance && !new Decimal(institution.openingBalance).isZero()) {
        await this.gateway.writeCashEvent({
          operation: "create",
          event: {
            kind: "opening_balance",
            occurredAt: institution.createdAt,
            amount: new Decimal(institution.openingBalance).abs().toString(),
            accountId: written.account_id,
            increasesBalance: !new Decimal(institution.openingBalance).isNegative(),
            sensitive: { description: "Saldo inicial" },
          },
        });
      }
    }
    const kept = new Set(next.institutions.map((item) => item.id));
    for (const institution of previous.institutions) {
      if (kept.has(institution.id)) continue;
      await this.gateway.writeAccount({
        operation: "delete",
        id: institution.id,
        expectedVersion: this.version(institution.id),
      });
    }
  }

  private async syncCards(previous: FinanceState, next: FinanceState) {
    if (same(previous.creditCards, next.creditCards)) return;
    const before = new Map(previous.creditCards.map((item) => [item.id, item]));
    for (const card of next.creditCards) {
      const prior = before.get(card.id);
      if (prior && same(prior, card)) continue;
      const payload = {
        institutionId: card.issuer && card.issuer !== "other" ? this.institutionIdBySlug.get(card.issuer) : undefined,
        payerAccountId: card.payerInstitutionId,
        kind: card.cardType ?? "credit",
        network: (CARD_NETWORKS.has(card.network ?? "") ? card.network : "other") as "visa" | "mastercard" | "elo" | "other",
        currencyCode: card.currency,
        creditLimit: decimal(card.limit),
        closingDay: card.closingDay,
        dueDay: card.dueDay,
        archivedAt: card.archivedAt,
        sensitive: {
          name: card.name,
          lastFour: card.lastFour,
          cardholderName: card.cardholderName,
          issuerName: card.issuerName,
          notes: card.notes,
          catalogSlug: card.issuer,
        },
      };
      await this.gateway.writeCard(
        prior
          ? { operation: "update", id: card.id, expectedVersion: this.version(card.id), card: payload }
          : { operation: "create", card: payload },
      );
    }
    const kept = new Set(next.creditCards.map((item) => item.id));
    for (const card of previous.creditCards) {
      if (kept.has(card.id)) continue;
      await this.gateway.writeCard({ operation: "delete", id: card.id, expectedVersion: this.version(card.id) });
    }
  }

  private async syncImports(previous: FinanceState, next: FinanceState) {
    if (same(previous.importedDocuments, next.importedDocuments)) return;
    const before = new Set(previous.importedDocuments.map((item) => item.id));
    for (const document of next.importedDocuments) {
      if (before.has(document.id)) continue;
      // Only the batch, its period and a keyed fingerprint are persisted. The
      // file, the PDF and the extracted text stay in the browser.
      await this.gateway.writeImportBatch({
        operation: "create",
        batch: {
          kind: document.kind,
          fingerprint: document.contentHash,
          periodStart: document.periodStart,
          periodEnd: document.periodEnd,
          sensitive: {
            source: document.source,
            contentHash: document.contentHash,
            cardId: document.creditCardId,
            institutionId: document.institutionId,
            closingDate: document.closingDate,
            dueDate: document.dueDate,
            total: document.total,
          },
        },
      });
    }
    const kept = new Set(next.importedDocuments.map((item) => item.id));
    for (const document of previous.importedDocuments) {
      if (!kept.has(document.id)) await this.gateway.writeImportBatch({ operation: "delete", id: document.id });
    }
  }

  private async syncInvestments(previous: FinanceState, next: FinanceState) {
    if (same(previous.investments, next.investments)) return;
    const before = new Map(previous.investments.map((item) => [item.id, item]));
    for (const investment of next.investments) {
      const prior = before.get(investment.id);
      const payload = {
        assetTypeCode: ASSET_TYPE_BY_INVESTMENT[investment.type] ?? "other",
        currencyCode: investment.currency,
        custodyAccountId: investment.institutionId ?? "",
        archivedAt: investment.archivedAt,
        sensitive: {
          name: investment.name,
          ticker: investment.ticker,
          applicationType: investment.applicationType,
          contractedYield: investment.contractedYield,
          maturityDate: investment.maturityDate,
          investmentType: investment.type,
          quoteMessage: investment.quoteMessage,
        },
      };
      if (!prior) {
        if (!investment.institutionId) throw new Error("Escolha a conta de custódia do investimento.");
        const written = await this.gateway.writeInvestmentAsset({ operation: "create", asset: payload });
        if (written.holding_id) {
          this.holdings.set(written.asset_id, written.holding_id);
          await this.stateOpeningPosition(written.holding_id, investment);
        }
        continue;
      }
      if (!same(prior, investment)) {
        await this.gateway.writeInvestmentAsset({
          operation: "update",
          id: investment.id,
          expectedVersion: this.version(investment.id),
          asset: payload,
        });
      }
      // Quantity and invested amount are replayed, so a manual correction is
      // restated as an opening operation rather than written into a column.
      const holding = this.holdings.get(investment.id);
      if (
        holding
        && prior
        && (!new Decimal(prior.quantity).eq(investment.quantity)
          || !new Decimal(prior.investedAmount).eq(investment.investedAmount))
      ) {
        await this.stateOpeningPosition(holding, investment, prior);
      }
      if (prior && !new Decimal(prior.currentPrice || 0).eq(investment.currentPrice || 0)
        && new Decimal(investment.currentPrice || 0).gt(0)) {
        await this.gateway.writeAssetQuote({ assetId: investment.id, unitPrice: decimal(investment.currentPrice) });
      }
    }
    const kept = new Set(next.investments.map((item) => item.id));
    for (const investment of previous.investments) {
      if (kept.has(investment.id)) continue;
      await this.gateway.writeInvestmentAsset({
        operation: "delete",
        id: investment.id,
        expectedVersion: this.version(investment.id),
      });
    }
  }

  /** Restates the position as an explicit operation so nothing is a snapshot. */
  private async stateOpeningPosition(holdingId: string, investment: Investment, prior?: Investment) {
    const quantityDelta = new Decimal(investment.quantity || 0).minus(prior?.quantity ?? 0);
    const costDelta = new Decimal(investment.investedAmount || 0).minus(prior?.investedAmount ?? 0);
    if (quantityDelta.isZero() && costDelta.isZero()) return;
    if (costDelta.isNegative()) {
      throw new Error("Reduza a posição registrando uma venda ou um resgate, não editando o valor aplicado.");
    }
    await this.gateway.writeInvestmentOperation({
      operation: "opening",
      holdingId,
      tradedAt: new Date().toISOString(),
      quantity: quantityDelta.gt(0) ? quantityDelta.toString() : undefined,
      principalAmount: costDelta.toString(),
      event: { sensitive: { description: prior ? `Ajuste de posição • ${investment.name}` : `Posição inicial • ${investment.name}` } },
    });
  }

  private async syncPlans(previous: FinanceState, next: FinanceState) {
    if (same(previous.plannedEntries, next.plannedEntries)) return;
    const before = new Map(previous.plannedEntries.map((item) => [item.id, item]));
    for (const plan of next.plannedEntries) {
      const prior = before.get(plan.id);
      const payload = {
        categoryId: plan.categoryId,
        accountId: plan.paymentMethod === "credit_card" ? undefined : plan.institutionId,
        cardId: plan.paymentMethod === "credit_card" ? plan.creditCardId : undefined,
        flow: plan.kind,
        frequency: plan.frequency,
        startDate: plan.startDate,
        endDate: plan.endDate,
        occurrenceCount: plan.occurrenceCount,
        amount: decimal(plan.amount),
        currencyCode: this.reportingCurrency,
        paymentMethod: plan.paymentMethod ?? "pix",
        sensitive: { description: plan.description },
      };
      let ruleId = plan.id;
      if (!prior) {
        ruleId = (await this.gateway.writeRecurrenceRule({ operation: "create", rule: payload })).rule_id;
      } else if (!same({ ...prior, exceptions: [] }, { ...plan, exceptions: [] })) {
        await this.gateway.writeRecurrenceRule({
          operation: "update",
          id: plan.id,
          expectedVersion: this.version(plan.id),
          rule: payload,
        });
      }

      const priorExceptions = new Map((prior?.exceptions ?? []).map((item) => [item.date, item]));
      for (const exception of plan.exceptions) {
        if (same(priorExceptions.get(exception.date), exception)) continue;
        const { date, amount, effectiveAmount, effectiveDate, settledEntryId, deleted, ...rest } = exception;
        await this.gateway.writePlannedOccurrence({
          occurrence: {
            recurrenceRuleId: ruleId,
            scheduledFor: date,
            status: deleted ? "cancelled" : settledEntryId ? "settled" : "scheduled",
            settledEventId: settledEntryId,
            effectiveAt: effectiveDate ? `${effectiveDate}T12:00:00.000Z` : undefined,
            effectiveAmount: effectiveAmount ?? amount,
            sensitive: { ...rest, deleted },
          },
        });
      }
      for (const [date] of priorExceptions) {
        if (plan.exceptions.some((item) => item.date === date)) continue;
        await this.gateway.writePlannedOccurrence({
          operation: "delete",
          occurrence: { recurrenceRuleId: ruleId, scheduledFor: date },
        });
      }
    }
    const kept = new Set(next.plannedEntries.map((item) => item.id));
    for (const plan of previous.plannedEntries) {
      if (kept.has(plan.id)) continue;
      await this.gateway.writeRecurrenceRule({
        operation: "delete",
        id: plan.id,
        expectedVersion: this.version(plan.id),
      });
    }
  }

  private async syncClassificationRules(previous: FinanceState, next: FinanceState) {
    if (same(previous.classificationRules, next.classificationRules)) return;
    const before = new Map(previous.classificationRules.map((item) => [item.id, item]));
    for (const rule of next.classificationRules) {
      const prior = before.get(rule.id);
      if (prior && same(prior, rule)) continue;
      if (!rule.match.trim()) continue;
      await this.gateway.writeClassificationRule({
        operation: prior ? "update" : "create",
        id: prior ? rule.id : undefined,
        rule: { match: rule.match, categoryId: rule.categoryId, flow: rule.kind },
      });
    }
    const kept = new Set(next.classificationRules.map((item) => item.id));
    for (const rule of previous.classificationRules) {
      if (!kept.has(rule.id)) await this.gateway.writeClassificationRule({ operation: "delete", id: rule.id });
    }
  }

  private async syncMovements(previous: FinanceState, next: FinanceState) {
    const before = new Map(previous.financialMovements.map((item) => [item.id, item]));
    const after = new Map(next.financialMovements.map((item) => [item.id, item]));

    for (const movement of next.financialMovements) {
      const prior = before.get(movement.id);
      if (prior && same(prior, movement) && same(this.legsOf(previous, movement.id), this.legsOf(next, movement.id))) {
        continue;
      }
      if (prior) await this.removeMovement(movement.id);
      await this.writeMovement(next, movement);
    }
    for (const movement of previous.financialMovements) {
      if (!after.has(movement.id)) await this.removeMovement(movement.id);
    }
  }

  private legsOf(state: FinanceState, movementId: string) {
    return state.entries
      .filter((entry) => entry.financialMovementId === movementId)
      .map((entry) => ({ amount: entry.amount, institutionId: entry.institutionId, investmentId: entry.investmentId }));
  }

  private async removeMovement(movementId: string) {
    const event = this.eventsById.get(movementId);
    if (!event) return;
    if (event.kind === "investment_transaction" || event.kind === "investment_income") {
      await this.gateway.deleteInvestmentOperation(movementId);
      return;
    }
    await this.gateway.writeCashEvent({
      operation: "delete",
      id: movementId,
      expectedVersion: this.version(movementId),
    });
  }

  private async writeMovement(state: FinanceState, movement: FinancialMovement) {
    const legs = state.entries.filter((entry) => entry.financialMovementId === movement.id);
    const sensitive = {
      description: movement.description,
      notes: movement.notes,
      fingerprint: movement.fingerprint,
      plannedOccurrenceKey: movement.plannedOccurrenceKey,
    };

    if (movement.kind === "card_purchase" || movement.kind === "card_refund"
      || movement.kind === "card_fee" || movement.kind === "card_interest") {
      const purchase = state.cardPurchases.find((item) => item.ledgerEntryId === legs[0]?.id)
        ?? state.cardPurchases.find((item) => item.cardId === movement.creditCardId && item.description === movement.description);
      const card = state.creditCards.find((item) => item.id === movement.creditCardId);
      if (!card) throw new Error("Selecione um cartão válido.");
      await this.gateway.writeCardTransaction({
        cardId: card.id,
        kind: movement.kind === "card_purchase" ? "purchase" : movement.kind === "card_refund" ? "refund" : movement.kind === "card_fee" ? "fee" : "interest",
        amount: new Decimal(movement.amount).abs().toString(),
        installments: purchase?.installments ?? 1,
        occurredAt: `${movement.date}T12:00:00.000Z`,
        firstInvoiceMonth: purchase ? `${purchase.firstInvoiceKey.split(":")[1]}-01` : undefined,
        event: {
          source: movement.source === "reconciliation" ? "manual" : movement.source,
          categoryId: movement.categoryId,
          importBatchId: movement.importedDocumentId,
          sensitive: {
            ...sensitive,
            purchaseId: purchase?.id ?? movement.id,
            installmentNumber: purchase?.installmentNumber,
            totalInstallments: purchase?.totalInstallments,
          } as Record<string, string | number | undefined>,
        },
      });
      return;
    }

    if (movement.kind === "credit_payment") {
      const payer = legs.find((entry) => entry.institutionId)?.institutionId;
      if (!payer || !movement.creditCardId) throw new Error("Escolha a conta que quitou a fatura.");
      await this.gateway.payCardInvoice({
        cardId: movement.creditCardId,
        accountId: payer,
        amount: new Decimal(movement.amount).abs().toString(),
        occurredAt: `${movement.date}T12:00:00.000Z`,
        event: { sensitive: { ...sensitive, invoiceKey: legs[0]?.invoiceKey } as Record<string, string | undefined> },
      });
      return;
    }

    if (movement.kind === "investment_contribution" || movement.kind === "investment_withdrawal"
      || movement.kind === "investment_income") {
      await this.writeInvestmentMovement(state, movement, legs, sensitive);
      return;
    }

    const accountLeg = legs.find((entry) => entry.institutionId && new Decimal(entry.amount).isNegative())
      ?? legs.find((entry) => entry.institutionId);
    if (!accountLeg?.institutionId) throw new Error("Escolha a conta do lançamento.");
    const counterpart = movement.kind === "internal_transfer"
      ? legs.find((entry) => entry.institutionId && entry.institutionId !== accountLeg.institutionId)?.institutionId
      : undefined;
    if (movement.kind === "internal_transfer" && !counterpart) throw new Error("Selecione contas diferentes.");

    await this.gateway.writeCashEvent({
      operation: "create",
      id: movement.id,
      event: {
        kind: movement.kind === "adjustment" ? "adjustment" : movement.kind === "income" ? "income" : movement.kind === "expense" ? "expense" : "internal_transfer",
        source: movement.source === "reconciliation" ? "manual" : movement.source,
        occurredAt: `${movement.date}T12:00:00.000Z`,
        amount: new Decimal(movement.amount).abs().toString(),
        accountId: accountLeg.institutionId,
        counterpartAccountId: counterpart,
        categoryId: movement.categoryId,
        importBatchId: movement.importedDocumentId,
        increasesBalance: !new Decimal(accountLeg.amount).isNegative(),
        sensitive,
      },
    });
  }

  private async writeInvestmentMovement(
    state: FinanceState,
    movement: FinancialMovement,
    legs: LedgerEntry[],
    sensitive: Record<string, string | undefined>,
  ) {
    const investment = state.investments.find((item) => item.id === movement.investmentId);
    const holdingId = investment ? this.holdings.get(investment.id) : undefined;
    if (!investment || !holdingId) throw new Error("Selecione um investimento válido.");
    const cashLeg = legs.find((entry) => entry.institutionId);
    const amount = new Decimal(movement.amount).abs();
    const tradedAt = `${movement.date}T12:00:00.000Z`;

    if (movement.kind === "investment_income") {
      await this.gateway.writeInvestmentOperation({
        operation: "income",
        holdingId,
        cashAccountId: cashLeg?.institutionId,
        reinvest: !cashLeg?.institutionId,
        tradedAt,
        grossAmount: amount.toString(),
        incomeKind: "yield",
        paymentDate: movement.date,
        event: { source: movement.source === "reconciliation" ? "manual" : movement.source, sensitive },
      });
      return;
    }

    if (!cashLeg?.institutionId) throw new Error("Escolha a conta que liquida a operação.");

    if (movement.kind === "investment_contribution") {
      await this.gateway.writeInvestmentOperation({
        operation: "contribution",
        holdingId,
        cashAccountId: cashLeg.institutionId,
        tradedAt,
        principalAmount: amount.toString(),
        event: { source: movement.source === "reconciliation" ? "manual" : movement.source, sensitive },
      });
      return;
    }

    // A redemption splits into the cost it removes and the yield it realizes,
    // both taken from the replayed position rather than a stored average.
    const marketValue = new Decimal(investment.currentValue || 0);
    const costBasis = new Decimal(investment.investedAmount || 0);
    const principal = marketValue.isZero()
      ? Decimal.min(amount, costBasis)
      : Decimal.min(costBasis, costBasis.mul(amount).div(marketValue));
    await this.gateway.writeInvestmentOperation({
      operation: "redemption",
      holdingId,
      cashAccountId: cashLeg.institutionId,
      tradedAt,
      principalAmount: principal.toString(),
      incomeAmount: Decimal.max(new Decimal(0), amount.minus(principal)).toString(),
      event: { source: movement.source === "reconciliation" ? "manual" : movement.source, sensitive },
    });
  }
}
