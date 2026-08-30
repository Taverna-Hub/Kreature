import { lazy, Suspense, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Check,
  FileUp,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Monitor,
  Moon,
  LogOut,
  Sun,
  Trash2,
  TrendingUp,
  Undo2,
} from "lucide-react";
import Decimal from "decimal.js";
import { useFinance } from "@/data/finance-context";
import { now, uid } from "@/domain/defaults";
import {
  institutionBalance,
  investmentContribution,
  investmentWithdrawal,
  movementsFor,
  reconcileInstitution,
  recordEntry,
  removeEntry,
  signedAmount,
  transfer,
  updateEntry,
  type EntryInput,
} from "@/domain/ledger";
import { buildSummary, buildSummaryComparison, monthlyHistory, previousMonthAbbreviation } from "@/domain/queries";
import { importedRdbPositionKey, investmentDisplayGroups, investmentMovementAmount, rdbPositionKey } from "@/domain/investment-groups";
import { learnClassificationRule, normalizeClassificationText } from "@/domain/classification";
import { suggestInternalTransfer } from "@/domain/internal-transfers";
import { editRecurrence, occurrencesFor, settleOccurrence, undoOccurrence } from "@/domain/recurrence";
import type {
  Category,
  CreditCard,
  EntryKind,
  FinanceState,
  ImportCandidate,
  Institution,
  InstitutionType,
  Investment,
  InvestmentType,
  LedgerEntry,
  PeriodFilter,
  PlannedEntry,
  PaymentMethod,
  RecurrenceFrequency,
  ThemeMode,
} from "@/domain/types";
import { analyzeFile, cleanTransactionDescription, importFingerprint, type ImportAnalysis } from "@/lib/importers";
import { fetchAssetQuote, fetchExchangeRate } from "@/lib/market";
import { dateLabel, decimalInput, money, monthLabel } from "@/lib/format";
import { catalogInstitution, searchInstitutionCatalog } from "@/domain/institution-catalog";
import { CARD_NETWORKS, CARD_TYPES, normalizeCardNetwork } from "@/domain/card-brands";
import { cardInvoices, payCardInvoice, recordCardPurchase, updateCardPurchase } from "@/domain/cards";
import { CreditCardVisual } from "@/features/finance/CreditCardVisual";
import { DatePicker, FormDatePicker, MonthPicker } from "@/DatePicker";
import { InstitutionLogo } from "@/InstitutionLogo";
import { Button, buttonClassName, IconButton } from "@/shared/ui/Button";
import { CustomSelect } from "@/shared/ui/CustomSelect";
import { Dialog as Modal } from "@/shared/ui/Dialog";
import { EmptyState as Empty } from "@/shared/ui/EmptyState";
import { FormField as Field } from "@/shared/ui/FormField";
import { Page } from "@/shared/ui/Page";
import { Tabs } from "@/shared/ui/Tabs";
import { CATEGORY_ICON_NAMES, categoryIcon } from "@/features/finance/category-icons";
import { useObjectUrl } from "@/shared/hooks/useObjectUrl";
import { useFeedback } from "@/shared/ui/FeedbackProvider";
import { useAuth } from "@/auth/auth-context";
import { applyTheme } from "@/app/theme";

const DashboardCharts = lazy(() => import("@/features/summary/DashboardCharts").then((module) => ({ default: module.DashboardCharts })));
const CharacterCustomizer = lazy(() => import("@/features/profile/CharacterCustomizer").then((module) => ({ default: module.CharacterCustomizer })));
const ProfileCard = lazy(() => import("@/features/profile/ProfileCard").then((module) => ({ default: module.ProfileCard })));

const today = () => new Date().toISOString().slice(0, 10);
const emptyOption = (label: string) => [["", label]] as const;
const entryFormKindOptions = [
  ["internal_transfer", "Transferência entre minhas contas"],
  ["investment_contribution", "Aplicar em investimento"],
  ["investment_withdrawal", "Resgatar investimento"],
  ["income", "Entrada"],
  ["expense", "Despesa"],
  ["pix", "Pix"],
  ["transfer", "Transferência"],
  ["card_purchase", "Compra no cartão"],
  ["credit_payment", "Pagamento de fatura"],
] as const;
const importKindOptions = [
  ["internal_transfer", "Transferência interna"],
  ["income", "Entrada"],
  ["expense", "Despesa"],
  ["investment_contribution", "Aplicar em investimento"],
  ["transfer", "Transferência"],
  ["pix", "Pix"],
  ["credit_payment", "Pagamento de fatura"],
] as const;
const currencyOptions = [
  ["BRL", "Real brasileiro (BRL)"],
  ["USD", "Dólar (USD)"],
  ["EUR", "Euro (EUR)"],
  ["GBP", "Libra (GBP)"],
] as const;
const catalogOptions = [...emptyOption("Outra — preenchimento manual"), ...searchInstitutionCatalog("").map((item) => [item.id, item.name] as const)];
/** Qualquer instituição do catálogo pode ser criada durante a importação, não só a detectada. */
const catalogCreationOptions = (detected: ReadonlySet<string>) =>
  searchInstitutionCatalog("")
    .filter((item) => !detected.has(item.id))
    .map((item) => [`create:${item.id}`, `Criar ${item.name}`] as const);
const institutionOptions = (institutions: Institution[], withCurrency = false) =>
  institutions.filter((item) => !item.archivedAt).map((item) => [item.id, withCurrency ? `${item.name} · ${item.currency}` : item.name] as const);
const categoryOptions = (categories: Category[], flow: Category["flow"]) =>
  categories.filter((item) => !item.archivedAt && item.flow === flow).map((item) => [item.id, item.name] as const);
const flowSuffix = (flow: Category["flow"]) => (flow === "income" ? "receita" : "despesa");
/** Pix pode entrar ou sair: a categoria escolhida é que define o sentido do valor. */
const bothFlowCategoryOptions = (categories: Category[]) =>
  categories.filter((item) => !item.archivedAt).map((item) => [item.id, `${item.name} · ${flowSuffix(item.flow)}`] as const);
const ambiguousKind = (kind: EntryKind) => kind === "pix" || kind === "transfer" || kind === "adjustment";
const historyMonthTones = ["violet", "teal", "amber", "rose", "sky"];
const namesOf = (items: ImportCandidate[]) =>
  items.slice(0, 3).map((item) => `“${item.description.trim() || "sem descrição"}”`).join(", ") + (items.length > 3 ? ` e mais ${items.length - 3}` : "");
/** Editar o valor pode inverter o sentido da linha; a categoria antiga não pode ficar para trás. */
const withMatchingCategory = (item: ImportCandidate, categories: Category[]): ImportCandidate => {
  const category = categories.find((value) => value.id === item.categoryId);
  return category && category.flow !== importCategoryFlow(item) ? { ...item, categoryId: undefined } : item;
};
const withImportKind = (item: ImportCandidate, kind: EntryKind): ImportCandidate => {
  let amount = item.amount;
  try {
    const absolute = new Decimal(item.amount || 0).abs();
    amount = kind === "income" ? absolute.toString() : kind === "expense" || kind === "credit_payment" || kind === "investment_contribution" ? absolute.negated().toString() : item.amount;
  } catch { /* A validação antes da confirmação exibirá o erro. */ }
  return { ...item, kind, amount, categoryId: undefined };
};
const importCategoryFlow = (item: ImportCandidate) => {
  if (item.kind === "income") return "income";
  if (item.kind === "expense") return "expense";
  try { return new Decimal(item.amount).isNegative() ? "expense" : "income"; }
  catch { return "expense"; }
};

function CategoryImage({ image, name }: { image: Blob; name: string }) {
  const source = useObjectUrl(image);
  return source ? <img src={source} alt={`Imagem de ${name}`} /> : null;
}

/** Imagem enviada, ícone escolhido ou — sem os dois — a inicial do nome. */
function CategoryGlyph({ category }: { category: Pick<Category, "name" | "icon" | "image"> }) {
  const Icon = categoryIcon(category.icon);
  if (category.image) return <CategoryImage image={category.image} name={category.name} />;
  if (Icon) return <Icon aria-hidden="true" />;
  return <>{category.name.slice(0, 1)}</>;
}

function categoryIconForeground(color: string) {
  const match = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(color);
  if (!match) return "#fff";
  const channels = match.slice(1).map((value) => Number.parseInt(value, 16) / 255);
  const [red, green, blue] = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
  return luminance > 0.42 ? "#18181b" : "#fff";
}

export function SummaryPage() {
  const { state } = useFinance();
  const date = new Date();
  const [filter, setFilter] = useState<PeriodFilter>({
    mode: "month",
    month: date.getMonth() + 1,
    year: date.getFullYear(),
  });
  const summary = useMemo(() => buildSummary(state, filter), [state, filter]);
  const comparison = useMemo(() => buildSummaryComparison(state, filter), [state, filter]);
  const comparisonMonth = previousMonthAbbreviation(filter);
  const history = useMemo(() => monthlyHistory(state).slice().reverse().slice(-8), [state]);
  const cards = [
    { key: "available", label: "Disponível", value: summary.available, tone: "available" },
    { key: "expenses", label: "Gastos do período", value: summary.expenses, tone: "expense" },
    { key: "invested", label: "Total investido", value: summary.invested, tone: "invested" },
    { key: "income", label: "Entradas", value: summary.income, tone: "income" },
  ] as const;
  return (
    <Page
      eyebrow="Visão geral"
      title="Resumo financeiro"
      description="Tudo que importa no período escolhido, sem depender de conexão externa."
      actions={
        <Link className={buttonClassName()} to="/lancamentos">
          <Plus />
          Novo lançamento
        </Link>
      }
    >
      <section className="filter-card">
        <div className="field">
          <span>Período</span>
          <CustomSelect
            label="Período do resumo"
            value={filter.mode}
            onChange={(mode) => setFilter((current) => ({ ...current, mode: mode as PeriodFilter["mode"] }))}
            items={[
              ["month", "Mês"],
              ["year", "Ano"],
              ["all", "Todo o período"],
              ["custom", "Intervalo personalizado"],
            ]}
          />
        </div>
        {filter.mode === "month" && (
          <Field label="Mês">
            <MonthPicker
              value={`${filter.year}-${String(filter.month).padStart(2, "0")}`}
              onChange={(value) => {
                const [year, month] = value.split("-").map(Number);
                setFilter({ mode: "month", year, month });
              }}
            />
          </Field>
        )}
        {filter.mode === "year" && (
          <Field label="Ano">
            <input
              type="number"
              min="2000"
              max="2200"
              value={filter.year}
              onChange={(event) => setFilter({ mode: "year", year: Number(event.target.value) })}
            />
          </Field>
        )}
        {filter.mode === "custom" && (
          <>
            <Field label="De">
              <DatePicker
                value={filter.startDate ?? ""}
                onChange={(startDate) => setFilter((current) => ({ ...current, startDate }))}
              />
            </Field>
            <Field label="Até">
              <DatePicker
                value={filter.endDate ?? ""}
                onChange={(endDate) => setFilter((current) => ({ ...current, endDate }))}
              />
            </Field>
          </>
        )}
      </section>
      <section className="metric-grid" aria-label="Indicadores financeiros">
        {cards.map(({ key, label, value, tone }) => {
          const item = comparison?.[key];
          const delta = item ? new Decimal(item.delta) : undefined;
          const direction = delta?.isZero() ? "stable" : delta?.isPositive() ? "up" : "down";
          return <article className={`metric ${tone}`} key={label}>
            <span>{label}</span>
            <strong>{money(value)}</strong>
            {item && comparisonMonth ? <small className={`metric-comparison ${direction}`} aria-label={`Variação de ${money(item.delta)} em relação a ${comparisonMonth}`}>
              {delta?.isZero() ? `Sem variação vs. ${comparisonMonth}` : `${delta?.isPositive() ? "↑" : "↓"} ${money(delta?.abs().toString() ?? "0")}${item.percentage ? ` (${Number(item.percentage).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%)` : ""} vs. ${comparisonMonth}`}
            </small> : null}
          </article>;
        })}
      </section>
      <Suspense fallback={<div className="panel page-route-loading">Carregando gráficos…</div>}>
        <DashboardCharts categoryTotals={summary.categoryTotals} history={history} />
      </Suspense>
    </Page>
  );
}

export function LaunchesPage() {
  const { state, commit } = useFinance();
  const [tab, setTab] = useState("entries");
  const [editing, setEditing] = useState<LedgerEntry | null>();
  const [dialog, setDialog] = useState(false);
  const [pendingDeletion, setPendingDeletion] = useState<LedgerEntry>();
  const [search, setSearch] = useState("");
  const movementKinds = new Map(movementsFor(state).map((movement) => [movement.id, movement.kind]));
  const entries = state.entries
    .filter((entry) => !entry.systemGenerated)
    .filter((entry, index, all) => {
      const group = entry.financialMovementId ?? entry.transferGroupId;
      return !group || all.findIndex((candidate) => (candidate.financialMovementId ?? candidate.transferGroupId) === group) === index;
    })
    .filter((entry) => normalizeText(entry.description).includes(normalizeText(search)))
    .sort((a, b) => b.date.localeCompare(a.date));
  const save = async (input: EntryInput & { installments?: number }, toInstitutionId?: string, investmentId?: string) => {
    await commit((draft) => {
      if (editing && input.kind === "card_purchase" && input.creditCardId) {
        const updated = updateEntry(draft, editing.id, input);
        updateCardPurchase(draft, updated.id, {
          cardId: input.creditCardId,
          description: input.description,
          amount: new Decimal(input.amount).abs().toString(),
          currency: input.currency,
          date: input.date,
          categoryId: input.categoryId,
          installments: input.installments ?? 1,
          notes: input.notes,
        });
      } else if (input.kind === "card_purchase" && input.creditCardId) {
        recordCardPurchase(draft, {
          cardId: input.creditCardId,
          description: input.description,
          amount: input.amount,
          currency: input.currency,
          date: input.date,
          categoryId: input.categoryId,
          installments: input.installments ?? 1,
          notes: input.notes,
        });
      } else if (input.kind === "credit_payment" && input.creditCardId && input.invoiceKey && input.institutionId) {
        payCardInvoice(draft, { cardId: input.creditCardId, invoiceKey: input.invoiceKey, institutionId: input.institutionId, date: input.date, notes: input.notes });
      } else if ((input.kind === "transfer" || input.kind === "internal_transfer") && input.institutionId && toInstitutionId)
        transfer(draft, {
          fromInstitutionId: input.institutionId,
          toInstitutionId,
          amount: input.amount,
          date: input.date,
          description: input.description,
        });
      else if (input.kind === "investment_contribution" && input.institutionId && investmentId)
        investmentContribution(draft, { fromInstitutionId: input.institutionId, investmentId, amount: input.amount, date: input.date, description: input.description });
      else if (input.kind === "investment_withdrawal" && input.institutionId && investmentId)
        investmentWithdrawal(draft, { toInstitutionId: input.institutionId, investmentId, amount: input.amount, date: input.date, description: input.description });
      else if (editing) updateEntry(draft, editing.id, input);
      else recordEntry(draft, input);
    });
    setDialog(false);
    setEditing(null);
  };
  return (
    <Page
      eyebrow="Dia a dia"
      title="Lançamentos"
      description="Registre, consulte e revise toda a movimentação financeira."
      actions={
        <Button
          onClick={() => {
            setEditing(null);
            setDialog(true);
          }}
        >
          <Plus />
          Novo lançamento
        </Button>
      }
    >
      <Tabs
        className="launch-tabs"
        label="Seções de lançamentos"
        value={tab}
        onChange={setTab}
        items={[
          ["entries", "Movimentações"],
          ["history", "Histórico mensal"],
          ["import", "Importar"],
          ["categories", "Categorias"],
          ["cards", "Cartões"],
        ]}
      />
      {tab === "entries" && (
        <section className="panel">
          <div className="toolbar">
            <div className="search">
              <Search />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar descrição"
              />
            </div>
            <span>{entries.length} lançamento(s)</span>
          </div>
          {entries.length ? (
            <div className="responsive-table">
              <table>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Descrição</th>
                    <th>Tipo</th>
                    <th>Instituição</th>
                    <th>Valor</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id}>
                      <td data-label="Data">{dateLabel(entry.date)}</td>
                      <td data-label="Descrição">
                        <strong title={entry.description}>{cleanTransactionDescription(entry.description)}</strong>
                        {entry.ignoredFromAnalytics && <small>Fora dos totais</small>}
                        {entry.plannedOccurrenceKey && !state.plannedEntries.some((plan) => entry.plannedOccurrenceKey?.startsWith(`${plan.id}:`)) && <small>Planejamento removido</small>}
                      </td>
                      <td data-label="Tipo">
                        <span className={`badge ${movementKinds.get(entry.financialMovementId ?? entry.transferGroupId ?? entry.id) ?? entry.kind}`}>{entryKindLabel((movementKinds.get(entry.financialMovementId ?? entry.transferGroupId ?? entry.id) ?? entry.kind) as EntryKind)}</span>
                      </td>
                      <td data-label="Instituição">
                        {state.institutions.find((item) => item.id === entry.institutionId)?.name ??
                          "—"}
                      </td>
                      <td
                        data-label="Valor"
                        className={["internal_transfer", "investment_contribution", "investment_withdrawal"].includes(movementKinds.get(entry.financialMovementId ?? entry.transferGroupId ?? entry.id) ?? entry.kind) ? "" : new Decimal(entry.amount).isPositive() ? "positive" : "negative"}
                      >
                        {money(["internal_transfer", "investment_contribution", "investment_withdrawal"].includes(movementKinds.get(entry.financialMovementId ?? entry.transferGroupId ?? entry.id) ?? entry.kind) ? new Decimal(entry.amount).abs().toString() : entry.amount, entry.currency)}
                      </td>
                      <td className="row-actions">
                        {!entry.transferGroupId && (
                          <IconButton
                            label="Editar"
                            onClick={() => {
                              setEditing(entry);
                              setDialog(true);
                            }}
                          >
                            <Pencil />
                          </IconButton>
                        )}
                        <IconButton label="Excluir" onClick={() => setPendingDeletion(entry)}>
                          <Trash2 />
                        </IconButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="Nenhum lançamento" description="Use “Novo lançamento” para começar." />
          )}
        </section>
      )}
      {tab === "history" && <HistoryView state={state} />} {tab === "import" && <ImportView />}{" "}
      {tab === "categories" && <CategoriesView />}
      {tab === "cards" && <CreditCardsView />}
      {dialog && (
        <Modal
          title={editing ? "Editar lançamento" : "Novo lançamento"}
          onClose={() => {
            setDialog(false);
            setEditing(null);
          }}
        >
          <EntryForm state={state} entry={editing ?? undefined} onSave={save} />
        </Modal>
      )}
      {pendingDeletion ? (
        <Modal title="Excluir lançamento" onClose={() => setPendingDeletion(undefined)}>
          <p>Excluir “{pendingDeletion.description}”? Esta ação não pode ser desfeita.</p>
          <div className="form-actions">
            <Button type="button" variant="secondary" onClick={() => setPendingDeletion(undefined)}>Cancelar</Button>
            <Button type="button" variant="danger" onClick={() => { void commit((draft) => removeEntry(draft, pendingDeletion.id)); setPendingDeletion(undefined); }}>Excluir lançamento</Button>
          </div>
        </Modal>
      ) : null}
    </Page>
  );
}

function EntryForm({
  state,
  entry,
  onSave,
}: {
  state: FinanceState;
  entry?: LedgerEntry;
  onSave: (input: EntryInput & { installments?: number }, toInstitutionId?: string, investmentId?: string) => Promise<void>;
}) {
  const [kind, setKind] = useState<EntryKind>(entry?.kind ?? "expense");
  const [date, setDate] = useState(entry?.date ?? today());
  const [toInstitutionId, setToInstitutionId] = useState("");
  const [investmentId, setInvestmentId] = useState(entry?.investmentId ?? "");
  const [creditCardId, setCreditCardId] = useState(entry?.creditCardId ?? "");
  const invoices = creditCardId ? cardInvoices(state, creditCardId).filter((item) => !item.paidEntryId) : [];
  return (
    <form
      className="form-grid"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
          const institutionId = String(data.get("institutionId") || "") || undefined;
          const institution = state.institutions.find((item) => item.id === institutionId);
          const card = state.creditCards.find((item) => item.id === creditCardId);
        void onSave(
          {
            date,
            description: String(data.get("description")),
            amount: decimalInput(data.get("amount")),
            currency: institution?.currency ?? card?.currency ?? "BRL",
            brlRate: institution?.exchangeRate ?? "1",
            kind,
            categoryId: String(data.get("categoryId") || "") || undefined,
            institutionId,
            creditCardId: creditCardId || undefined,
            invoiceKey: String(data.get("invoiceKey") || "") || undefined,
            installments: Number(data.get("installments") || 1),
            notes: String(data.get("notes") || "") || undefined,
          },
          toInstitutionId,
          investmentId || undefined,
        );
      }}
    >
      <Field label="Tipo">
        <CustomSelect
          label="Tipo do lançamento"
          value={kind}
          onChange={(next) => setKind(next as EntryKind)}
          items={entryFormKindOptions}
        />
      </Field>
      <Field label="Data">
        <DatePicker value={date} onChange={setDate} label="Data do lançamento" />
      </Field>
      <Field className="full" label="Descrição">
        <input required name="description" defaultValue={entry?.description} />
      </Field>
      <Field label="Valor">
        <input
          required
          name="amount"
          inputMode="decimal"
          defaultValue={entry ? new Decimal(entry.amount).abs().toString() : ""}
          placeholder="0,00"
        />
      </Field>
      <Field label="Instituição">
        <CustomSelect
          label="Instituição"
          name="institutionId"
          defaultValue={entry?.institutionId ?? ""}
          items={[...emptyOption("Sem instituição"), ...institutionOptions(state.institutions, true)]}
        />
      </Field>
      {(kind === "transfer" || kind === "internal_transfer") && (
        <Field label="Instituição de destino">
          <CustomSelect
            label="Instituição de destino"
            required
            value={toInstitutionId}
            onChange={setToInstitutionId}
            items={[...emptyOption("Selecione"), ...institutionOptions(state.institutions)]}
          />
        </Field>
      )}
      {(kind === "investment_contribution" || kind === "investment_withdrawal") && (
        <Field label="Investimento">
          <CustomSelect
            label="Investimento"
            required
            value={investmentId}
            onChange={setInvestmentId}
            items={[...emptyOption("Selecione"), ...state.investments.filter((item) => !item.archivedAt).map((item) => [item.id, item.name] as const)]}
          />
        </Field>
      )}
      {(kind === "card_purchase" || kind === "credit_payment") && (
        <Field label="Cartão">
          <CustomSelect
            label="Cartão"
            required
            value={creditCardId}
            onChange={setCreditCardId}
            items={[...emptyOption("Selecione"), ...state.creditCards.filter((item) => !item.archivedAt && item.cardType !== "debit").map((item) => [item.id, item.name] as const)]}
          />
        </Field>
      )}
      {kind === "card_purchase" && (
        <Field label="Parcelas"><input required min="1" max="360" type="number" name="installments" defaultValue={state.cardPurchases.find((purchase) => purchase.ledgerEntryId === entry?.id)?.installments ?? 1} /></Field>
      )}
      {kind === "credit_payment" && (
        <Field label="Fatura aberta">
          <CustomSelect
            label="Fatura aberta"
            required
            name="invoiceKey"
            items={[...emptyOption("Selecione"), ...invoices.map((item) => [item.key, `${dateLabel(item.dueDate)} · ${money(item.total)}`] as const)]}
          />
        </Field>
      )}
      {kind !== "transfer" && kind !== "internal_transfer" && kind !== "investment_contribution" && kind !== "investment_withdrawal" && kind !== "credit_payment" && <Field label="Categoria">
        <CustomSelect
          label="Categoria"
          name="categoryId"
          defaultValue={entry?.categoryId ?? ""}
          items={[
            ...emptyOption("Sem categoria"),
            ...(ambiguousKind(kind)
              ? bothFlowCategoryOptions(state.categories)
              : categoryOptions(state.categories, kind === "income" ? "income" : "expense")),
          ]}
        />
        {ambiguousKind(kind) ? <small className="form-hint">A categoria define o sentido: despesa sai da conta, receita entra.</small> : null}
      </Field>}
      <Field className="full" label="Observações">
        <textarea name="notes" rows={3} defaultValue={entry?.notes} />
      </Field>
      <div className="form-actions full">
        <Button type="submit">Salvar lançamento</Button>
      </div>
    </form>
  );
}

function CardInvoicesPanel({ card }: { card: CreditCard }) {
  const { state, commit } = useFinance();
  const { notify } = useFeedback();
  const [paying, setPaying] = useState<string>();
  const [paymentDate, setPaymentDate] = useState(today());
  const [paymentAccount, setPaymentAccount] = useState(card.payerInstitutionId ?? state.institutions.find((item) => !item.archivedAt)?.id ?? "");
  const invoices = cardInvoices(state, card.id);
  const accounts = institutionOptions(state.institutions, true);
  return <div className="card-invoices-panel">
    <div className="card-invoices-heading"><strong>Faturas</strong><small>{invoices.length} fatura(s)</small></div>
    {invoices.length === 0 ? <p className="form-hint">Nenhuma compra gerou fatura ainda.</p> : invoices.map((invoice) => {
      const status = invoice.status === "paid" ? `Paga${invoice.paidAt ? ` em ${dateLabel(invoice.paidAt)}` : ""}` : invoice.status === "overdue" ? "Vencida" : "Em aberto";
      return <details className="card-invoice" key={invoice.key}>
        <summary><span><strong>{dateLabel(invoice.dueDate)}</strong><small>Vencimento · {status}</small></span><b>{money(invoice.total, card.currency)}</b></summary>
        <div className="card-invoice-content">
          <div className="card-invoice-meta"><span>Fechamento {dateLabel(invoice.closingDate)}</span><span className={`badge ${invoice.status}`}>{status}</span></div>
          {invoice.installments.length ? <div className="card-invoice-lines">{invoice.installments.map((line) => <div className="card-invoice-line" key={`${line.purchaseId}-${line.installment}`}>
            <span><strong>{line.description}</strong><small>{dateLabel(line.date)} · {line.installment}/{line.totalInstallments} parcela · {line.transactionKind}{plannedOriginLabel(state, state.cardPurchases.find((item) => item.id === line.purchaseId) ? state.entries.find((entry) => entry.id === state.cardPurchases.find((item) => item.id === line.purchaseId)?.ledgerEntryId)?.plannedOccurrenceKey : undefined)}</small></span>
            <b className={new Decimal(line.amount).isNegative() ? "positive" : "negative"}>{money(line.amount, card.currency)}</b>
          </div>)}</div> : <p className="form-hint">Nenhum lançamento nesta fatura ainda.</p>}
          {invoice.status !== "paid" && <div className="card-invoice-actions">
            {paying === invoice.key ? <form className="inline-form" onSubmit={(event) => { event.preventDefault(); void commit((draft) => payCardInvoice(draft, { cardId: card.id, invoiceKey: invoice.key, institutionId: paymentAccount, date: paymentDate })).then(() => { setPaying(undefined); notify("Fatura paga."); }).catch((error) => notify(error instanceof Error ? error.message : "Não foi possível quitar a fatura.", "error")); }}>
              <CustomSelect label="Conta para pagar" value={paymentAccount} onChange={setPaymentAccount} items={accounts} required />
              <DatePicker value={paymentDate} onChange={setPaymentDate} label="Data do pagamento" />
              <Button type="submit">Quitar fatura</Button><Button type="button" variant="secondary" onClick={() => setPaying(undefined)}>Cancelar</Button>
            </form> : <Button onClick={() => { setPaymentAccount(card.payerInstitutionId ?? accounts[0]?.[0] ?? ""); setPaymentDate(today()); setPaying(invoice.key); }}>Quitar integralmente</Button>}
          </div>}
          {invoice.status === "paid" && <p className="form-hint">Fatura paga — {money(invoice.total, card.currency)}. A quitação não gera uma nova despesa.</p>}
        </div>
      </details>;
    })}
  </div>;
}

function CreditCardsView() {
  const { state, commit } = useFinance();
  const { notify } = useFeedback();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CreditCard>();
  const [expandedCardId, setExpandedCardId] = useState<string>();
  const active = state.creditCards.filter((item) => !item.archivedAt);
  return <section className="panel">
    <div className="panel-heading"><div><span className="eyebrow">Crédito</span><h2>Cartões e faturas</h2></div><Button onClick={() => { setEditing(undefined); setOpen(true); }}><Plus />Novo cartão</Button></div>
    <div className="entity-grid institutions">{active.length ? active.map((card) => {
      const upcoming = cardInvoices(state, card.id).find((item) => !item.paidEntryId);
      return <article className="entity-card credit-card-record" key={card.id}><CreditCardVisual card={card} /><header><div><h2>{card.name}</h2><p>Fecha dia {card.closingDay} · vence dia {card.dueDay}</p></div><div className="row-actions"><IconButton label={`Editar cartão ${card.name}`} onClick={() => { setEditing(card); setOpen(true); }}><Pencil /></IconButton></div></header><div className="balance"><span>Limite</span><strong>{money(card.limit, card.currency)}</strong><small>{upcoming ? `Fatura: ${money(upcoming.total, card.currency)} em ${dateLabel(upcoming.dueDate)}` : "Sem faturas abertas"}</small></div><Button variant="secondary" onClick={() => setExpandedCardId((current) => current === card.id ? undefined : card.id)}>{expandedCardId === card.id ? "Ocultar faturas" : "Acessar faturas"}</Button>{expandedCardId === card.id && <CardInvoicesPanel card={card} />}</article>;
    }) : <Empty title="Nenhum cartão" description="Cadastre um cartão para registrar compras, parcelas e faturas." />}</div>
    {open && <CreditCardDialog value={editing} institutions={state.institutions} onClose={() => setOpen(false)} onSave={async (card) => { try { await commit((draft) => { const index = draft.creditCards.findIndex((item) => item.id === card.id); if (index >= 0) draft.creditCards[index] = card; else draft.creditCards.push(card); }); setOpen(false); notify("Cartão salvo."); } catch (error) { notify(error instanceof Error ? error.message : "Não foi possível salvar o cartão.", "error"); } }} />}
  </section>;
}

function HistoryView({ state }: { state: FinanceState }) {
  const history = monthlyHistory(state);
  return (
    <div className="history-list">
      {history.length ? (
        history.map((item, index) => (
          <article className={`history-month panel tone-${historyMonthTones[index % historyMonthTones.length]}`} key={item.month}>
            <header className="history-header">
              <span className="history-title">
                <strong>{monthLabel(item.month)}</strong>
                <small>{item.entries.length} lançamento(s)</small>
              </span>
              <span className="history-numbers" aria-label="Resumo do mês">
                <span className="history-number income">
                  <small>Entrou</small>
                  <b>+{money(item.income)}</b>
                </span>
                <span className="history-number expense">
                  <small>Saiu</small>
                  <b>−{money(item.expenses)}</b>
                </span>
                <span className="history-number balance">
                  <small>Saldo</small>
                  <b>{money(item.balance)}</b>
                </span>
              </span>
            </header>
            <details className="history-details">
              <summary><span>Movimentações</span><small>Ver detalhes</small></summary>
              <div className="history-entries">
                {item.entries.map((entry) => (
                  <div className="history-entry" key={entry.id}>
                    <span className="history-entry-copy">
                      <small>{dateLabel(entry.date)}</small>
                      <strong>{cleanTransactionDescription(entry.description)}</strong>
                    </span>
                    <strong className={new Decimal(entry.brlAmount).isNegative() ? "negative" : "positive"}>{money(entry.brlAmount)}</strong>
                  </div>
                ))}
              </div>
            </details>
          </article>
        ))
      ) : (
        <Empty
          title="Histórico vazio"
          description="Os meses aparecerão conforme você registrar lançamentos."
        />
      )}
    </div>
  );
}

function CategoriesView() {
  const { state, commit } = useFinance();
  const [editing, setEditing] = useState<Category>();
  const [open, setOpen] = useState(false);
  const archive = (category: Category) =>
    void commit((draft) => {
      const used =
        draft.entries.some((item) => item.categoryId === category.id) ||
        draft.plannedEntries.some((item) => item.categoryId === category.id);
      if (used || category.isDefault) {
        const found = draft.categories.find((item) => item.id === category.id)!;
        found.archivedAt = now();
      } else draft.categories = draft.categories.filter((item) => item.id !== category.id);
      draft.classificationRules = draft.classificationRules.filter((rule) => rule.categoryId !== category.id);
    });
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Classificação</span>
          <h2>Categorias</h2>
        </div>
        <Button
          onClick={() => {
            setEditing(undefined);
            setOpen(true);
          }}
        >
          <Plus />
          Nova categoria
        </Button>
      </div>
      <div className="entity-grid">
        {state.categories
          .filter((item) => !item.archivedAt)
          .map((item) => (
            <article className="category-card" key={item.id}>
              <span className="category-icon" style={{ background: item.color, color: categoryIconForeground(item.color) }}>
                <CategoryGlyph category={item} />
              </span>
              <div>
                <strong>{item.name}</strong>
                <small>{item.flow === "income" ? "Receita" : "Despesa"} · {item.isDefault ? "Padrão" : "Personalizada"}</small>
              </div>
              <div className="row-actions">
                <IconButton
                  label={`Editar categoria ${item.name}`}
                  onClick={() => {
                    setEditing(item);
                    setOpen(true);
                  }}
                >
                  <Pencil />
                </IconButton>
                <IconButton label={`Arquivar categoria ${item.name}`} onClick={() => archive(item)}>
                  <Trash2 />
                </IconButton>
              </div>
            </article>
          ))}
      </div>
      <section className="rules-panel" aria-labelledby="learned-rules-title">
        <div><span className="eyebrow">Automação privada</span><h3 id="learned-rules-title">Regras aprendidas</h3><p>Sincronizadas somente com a sua conta para reconhecer a mesma descrição novamente.</p></div>
        {state.classificationRules.length ? <div className="rules-list">{state.classificationRules.map((rule) => <div className="rule-row" key={rule.id}><input aria-label={`Descrição da regra ${rule.match}`} defaultValue={rule.match} onBlur={(event) => void commit((draft) => { const found = draft.classificationRules.find((item) => item.id === rule.id); const match = normalizeClassificationText(event.target.value); if (!found || !match || match === found.match) return; found.match = match; found.updatedAt = now(); })} /><CustomSelect label={`Categoria da regra ${rule.match}`} value={rule.categoryId} onChange={(next) => void commit((draft) => { const found = draft.classificationRules.find((item) => item.id === rule.id); if (found) { found.categoryId = next; found.updatedAt = now(); } })} items={categoryOptions(state.categories, rule.kind)} /><IconButton label={`Remover regra ${rule.match}`} onClick={() => void commit((draft) => { draft.classificationRules = draft.classificationRules.filter((item) => item.id !== rule.id); })}><Trash2 /></IconButton></div>)}</div> : <p className="muted">As regras aparecem quando você corrige uma categoria durante uma importação ou salva um lançamento manual.</p>}
      </section>
      {open && (
        <CategoryDialog
          value={editing}
          onClose={() => setOpen(false)}
          onSave={async (record) => {
            await commit((draft) => {
              const index = draft.categories.findIndex((item) => item.id === record.id);
              if (index >= 0) draft.categories[index] = record;
              else draft.categories.push(record);
            });
            setOpen(false);
          }}
        />
      )}
    </section>
  );
}

function CategoryDialog({ value, onClose, onSave }: { value?: Category; onClose: () => void; onSave: (value: Category) => Promise<void> }) {
  const [source, setSource] = useState(value?.image || value?.imagePath ? "image" : "icon");
  const [icon, setIcon] = useState(value?.icon ?? "ShoppingBag");
  const [color, setColor] = useState(value?.color ?? "#f97316");
  const [image, setImage] = useState<File>();
  const keptImage = value?.image && !image ? value.image : undefined;
  const preview = image ?? keptImage;
  return (
    <Modal title={value ? "Editar categoria" : "Nova categoria"} onClose={onClose}>
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const timestamp = now();
          const usesImage = source === "image" && Boolean(preview);
          void onSave({
            id: value?.id ?? uid("category"),
            name: String(data.get("name")),
            icon,
            color,
            flow: String(data.get("flow")) as Category["flow"],
            // Trocar para o ícone descarta a imagem, e o repositório apaga o arquivo guardado.
            image: usesImage ? preview : undefined,
            imagePath: usesImage && !image ? value?.imagePath : undefined,
            isDefault: value?.isDefault ?? false,
            createdAt: value?.createdAt ?? timestamp,
            updatedAt: timestamp,
          });
        }}
      >
        <Field label="Nome">
          <input required name="name" defaultValue={value?.name} />
        </Field>
        <Field label="Cor">
          <input type="color" name="color" value={color} onChange={(event) => setColor(event.target.value)} />
        </Field>
        <Field label="Fluxo">
          <CustomSelect label="Fluxo da categoria" name="flow" defaultValue={value?.flow ?? "expense"} items={[["expense", "Despesa"], ["income", "Receita"]]} />
        </Field>
        <div className="full category-visual">
          <div className="category-visual-head">
            <span className="category-icon category-preview" style={{ background: color, color: categoryIconForeground(color) }}>
              <CategoryGlyph category={{ name: "Categoria", icon: source === "icon" ? icon : "", image: source === "image" ? preview : undefined }} />
            </span>
            <Tabs
              className="category-source"
              label="Origem do ícone"
              value={source}
              onChange={setSource}
              items={[["icon", "Ícone"], ["image", "Imagem"]]}
            />
          </div>
          {source === "icon" ? (
            <div className="icon-choices" role="group" aria-label="Escolha um ícone">
              {CATEGORY_ICON_NAMES.map((name) => {
                const Icon = categoryIcon(name)!;
                return (
                  <button
                    type="button"
                    key={name}
                    className={`icon-choice ${icon === name ? "selected" : ""}`}
                    aria-pressed={icon === name}
                    aria-label={name}
                    onClick={() => setIcon(name)}
                  >
                    <Icon aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="category-image-picker">
              <label className={buttonClassName({ variant: "secondary" })}>
                {preview ? "Trocar imagem" : "Escolher imagem"}
                <input hidden type="file" accept="image/*" onChange={(event) => setImage(event.currentTarget.files?.[0])} />
              </label>
              {preview ? <Button variant="ghost" onClick={() => { setImage(undefined); setSource("icon"); }}>Remover imagem</Button> : null}
              <p className="form-hint">PNG, JPG ou SVG. A imagem fica guardada na sua conta e substitui o ícone.</p>
            </div>
          )}
        </div>
        <div className="form-actions full">
          <Button type="submit">Salvar categoria</Button>
        </div>
      </form>
    </Modal>
  );
}

function CreditCardDialog({ value, institutions, onClose, onSave }: { value?: CreditCard; institutions: Institution[]; onClose: () => void; onSave: (value: CreditCard) => Promise<void>; }) {
  return <Modal title={value ? "Editar cartão" : "Novo cartão"} onClose={onClose}><form className="form-grid" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); const timestamp = now(); void onSave({ id: value?.id ?? uid("card"), name: String(data.get("name")), issuer: (String(data.get("issuer") || "other") as CreditCard["issuer"]), issuerName: String(data.get("issuerName") || "") || undefined, lastFour: String(data.get("lastFour") || "").replace(/\D/g, "").slice(-4) || undefined, network: normalizeCardNetwork(String(data.get("network") || "")), cardType: String(data.get("cardType") || "credit") as CreditCard["cardType"], cardholderName: String(data.get("cardholderName") || "") || undefined, payerInstitutionId: String(data.get("payerInstitutionId") || "") || undefined, limit: decimalInput(data.get("limit")), closingDay: Number(data.get("closingDay")), dueDay: Number(data.get("dueDay")), currency: String(data.get("currency") || "BRL").toUpperCase(), notes: String(data.get("notes") || "") || undefined, createdAt: value?.createdAt ?? timestamp, updatedAt: timestamp }); }}>
    <Field label="Nome"><input required name="name" defaultValue={value?.name} /></Field><Field label="Instituição emissora"><CustomSelect label="Instituição emissora" name="issuer" defaultValue={value?.issuer ?? "other"} items={[["other", "Outra"], ...searchInstitutionCatalog("").map((item) => [item.id, item.name] as const)]} /></Field><Field label="Nome do emissor"><input name="issuerName" defaultValue={value?.issuerName} /></Field><Field label="Últimos 4 dígitos"><input name="lastFour" inputMode="numeric" maxLength={4} defaultValue={value?.lastFour} /></Field><Field label="Bandeira"><CustomSelect label="Bandeira" name="network" required defaultValue={normalizeCardNetwork(value?.network) ?? "visa"} items={CARD_NETWORKS.map((item) => [item.value, item.label] as const)} /></Field><Field label="Tipo do cartão"><CustomSelect label="Tipo do cartão" name="cardType" required defaultValue={value?.cardType ?? "credit"} items={CARD_TYPES} /></Field><Field label="Titular"><input name="cardholderName" defaultValue={value?.cardholderName} /></Field><Field label="Conta pagadora"><CustomSelect label="Conta pagadora" name="payerInstitutionId" defaultValue={value?.payerInstitutionId ?? ""} items={[...emptyOption("Definir ao pagar"), ...institutionOptions(institutions)]} /></Field><Field label="Limite"><input required name="limit" inputMode="decimal" defaultValue={value?.limit ?? "0"} /></Field><Field label="Fechamento"><input required name="closingDay" min="1" max="31" type="number" defaultValue={value?.closingDay ?? 10} /></Field><Field label="Vencimento"><input required name="dueDay" min="1" max="31" type="number" defaultValue={value?.dueDay ?? 20} /></Field><Field label="Moeda"><input required name="currency" maxLength={5} defaultValue={value?.currency ?? "BRL"} /></Field><Field className="full" label="Observações"><textarea name="notes" rows={3} defaultValue={value?.notes} /></Field><div className="form-actions full"><Button type="submit">Salvar cartão</Button></div>
  </form></Modal>;
}

export function ImportView() {
  const { state, commit } = useFinance();
  const { notify } = useFeedback();
  const [candidates, setCandidates] = useState<ImportCandidate[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [validation, setValidation] = useState<ImportAnalysis["validation"]>();
  const [document, setDocument] = useState<ImportAnalysis["document"]>();
  const [creditCardId, setCreditCardId] = useState("");
  const [busy, setBusy] = useState<string>();
  // A importação acontece em duas etapas: primeiro editar e selecionar, depois confirmar.
  const [step, setStep] = useState<"review" | "confirm">("review");
  const [batch, setBatch] = useState({ kind: "", categoryId: "", institutionId: "" });
  // Os impedimentos só aparecem depois da primeira tentativa, e somem sozinhos ao serem resolvidos.
  const [showBlockers, setShowBlockers] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const selected = candidates.filter((item) => item.include);
  const patchCandidate = (index: number, patch: Partial<ImportCandidate>) =>
    setCandidates((current) => current.map((value, position) => (position === index ? withMatchingCategory({ ...value, ...patch }, state.categories) : value)));
  const setIncludeAll = (include: boolean) => setCandidates((current) => current.map((item) => ({ ...item, include })));
  const selectOnlyNew = () => setCandidates((current) => current.map((item) => ({ ...item, include: !item.duplicate && !item.similarDuplicate })));
  const detectedIds = new Set(
    candidates
      .map((item) => item.detectedInstitutionId)
      .filter((id): id is NonNullable<ImportCandidate["detectedInstitutionId"]> => Boolean(id))
      .filter((id) => !state.institutions.some((item) => item.catalogId === id && !item.archivedAt)),
  );
  const detected = [...detectedIds].map((id) => [`create:${id}`, `Criar ${catalogInstitution(id)?.name ?? "instituição detectada"} (detectada)`] as const);
  const creatable = catalogCreationOptions(detectedIds);
  const importInstitutionOptions = [...detected, ...emptyOption("Sem instituição"), ...institutionOptions(state.institutions), ...creatable];
  const batchCategoryOptions = state.categories
    .filter((item) => !item.archivedAt)
    .map((item) => [item.id, `${item.name} · ${item.flow === "income" ? "receita" : "despesa"}`] as const);
  const applyBatch = () => {
    const category = state.categories.find((item) => item.id === batch.categoryId);
    const touched = selected.length;
    setCandidates((current) => current.map((item) => {
      if (!item.include) return item;
      let next = batch.kind ? withImportKind(item, batch.kind as EntryKind) : item;
      // Categoria só se aplica a quem tem o mesmo fluxo, senão o lançamento sairia classificado errado.
      if (category && importCategoryFlow(next) === category.flow) next = { ...next, categoryId: category.id };
      if (batch.institutionId) next = { ...next, institutionId: batch.institutionId };
      return next;
    }));
    setBatch({ kind: "", categoryId: "", institutionId: "" });
    notify(`Alterações aplicadas a ${touched} movimentação(ões).`);
  };
  const incomplete = selected.filter((item) => {
    try { return !item.date || !item.description.trim() || new Decimal(item.amount || 0).isZero(); }
    catch { return true; }
  });
  const missingRate = selected.filter((item) => item.currency !== "BRL" && !item.exchangeRate);
  const missingTransferCounterparty = selected.filter((item) => item.kind === "internal_transfer" && !item.counterpartyInstitutionId);
  const blockers = [
    ...(selected.length ? [] : ["Selecione ao menos uma movimentação para importar."]),
    ...(incomplete.length ? [`${incomplete.length} movimentação(ões) sem data, descrição ou valor: ${namesOf(incomplete)}.`] : []),
    ...(missingRate.length ? [`Informe a cotação em BRL de ${[...new Set(missingRate.map((item) => item.currency))].join(", ")} nas linhas destacadas.`] : []),
    ...(missingTransferCounterparty.length ? [`Selecione a outra conta em ${missingTransferCounterparty.length} transferência(s) interna(s).`] : []),
    ...(document?.requiresCard && !creditCardId ? ["Selecione ou cadastre o cartão desta importação antes de continuar."] : []),
    ...(document && state.importedDocuments.some((item) => item.contentHash === document.contentHash) ? ["Este documento já foi importado."] : []),
  ];
  const blockedIds = new Set([...incomplete, ...missingRate].map((item) => item.id));
  const advance = () => {
    setShowBlockers(true);
    if (blockers.length) return;
    setStep("confirm");
    panel.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  };
  const reset = () => {
    setCandidates([]);
    setWarnings([]);
    setValidation(undefined);
    setDocument(undefined);
    setCreditCardId("");
    setBatch({ kind: "", categoryId: "", institutionId: "" });
    setShowBlockers(false);
    setStep("review");
  };
  const read = async (file?: File) => {
    if (!file) return;
    setCandidates([]);
    setWarnings([]);
    setValidation(undefined);
    setBusy("Lendo arquivo");
    try {
      const result = await analyzeFile(file, state, { onProgress: (progress) => setBusy(progress.message) });
      setDocument(result.document);
      const currencies = [...new Set(result.candidates.map((item) => item.currency).filter((currency) => currency !== "BRL"))];
      const rates = new Map<string, string>([["BRL", "1"]]);
      const rateWarnings: string[] = [];
      await Promise.all(currencies.map(async (currency) => {
        try {
          const quote = await fetchExchangeRate(currency);
          rates.set(currency, quote.value);
        } catch {
          rateWarnings.push(`Não foi possível obter a cotação de ${currency}. Informe-a manualmente antes de confirmar.`);
        }
      }));
      setCandidates(result.candidates.map((item) => {
        const known = state.institutions.find((institution) => institution.catalogId === item.detectedInstitutionId && !institution.archivedAt);
        return suggestInternalTransfer(state, {
          ...item,
          institutionId: item.institutionId ?? known?.id ?? (item.detectedInstitutionId ? `create:${item.detectedInstitutionId}` : undefined),
          exchangeRate: rates.get(item.currency),
        });
      }));
      setWarnings([...result.warnings, ...rateWarnings]);
      setValidation(result.validation);
    } catch (error) {
      setWarnings([error instanceof Error ? error.message : "Falha ao processar arquivo."]);
    } finally {
      setBusy(undefined);
    }
  };
  const confirm = async () => {
    if (blockers.length) {
      setShowBlockers(true);
      setStep("review");
      return;
    }
    await commit((draft) => {
      const importedDocumentId = document ? uid("import-document") : undefined;
      if (document && importedDocumentId) draft.importedDocuments.push({ id: importedDocumentId, kind: document.kind, contentHash: document.contentHash, source: document.source, creditCardId: creditCardId || undefined, createdAt: now(), updatedAt: now() });
      const createdInstitutions = new Map<string, string>();
      for (const item of candidates.filter(
        (candidate) => candidate.include,
      )) {
        let institutionId = item.institutionId;
        if (institutionId?.startsWith("create:")) {
          const catalogId = institutionId.slice("create:".length);
          const catalog = catalogInstitution(catalogId);
          const cached = createdInstitutions.get(catalogId);
          if (cached) institutionId = cached;
          else if (catalog) {
            institutionId = uid("institution");
            const timestamp = now();
            draft.institutions.push({
              id: institutionId,
              name: catalog.name,
              type: catalog.type,
              bankCode: catalog.bankCode,
              currency: item.currency,
              openingBalance: "0",
              exchangeRate: item.exchangeRate ?? "1",
              exchangeRateAsOf: new Date().toISOString().slice(0, 10),
              catalogId: catalog.id,
              logoKey: catalog.logoKey,
              createdAt: timestamp,
              updatedAt: timestamp,
            });
            createdInstitutions.set(catalogId, institutionId);
          }
        }
        if (item.createInvestment && item.kind === "investment_contribution" && institutionId) {
          const amount = new Decimal(item.amount).abs().toString();
          const positionKey = rdbPositionKey(institutionId, item.description);
          let investment = positionKey ? draft.investments.find((value) => importedRdbPositionKey(value) === positionKey) : undefined;
          if (!investment) {
            investment = { id: uid("investment"), institutionId, type: "other" as const, name: item.description, quantity: "0", averagePrice: "0", investedAmount: "0", currentPrice: "0", currentValue: "0", dividends: "0", currency: item.currency, quoteStatus: "manual" as const, quoteMessage: "Criado pela importação", createdAt: now(), updatedAt: now() };
            draft.investments.push(investment);
          }
          const result = investmentContribution(draft, { fromInstitutionId: institutionId, investmentId: investment.id, amount, date: item.date, description: item.description });
          Object.assign(result.movement, { source: "import" as const, importedDocumentId, fingerprint: importFingerprint(institutionId, item.date, item.description, item.amount, item.kind) });
          Object.assign(result.debit, { source: "import" as const, importedDocumentId, fingerprint: result.movement.fingerprint, notes: `${item.externalId ? `external:${item.externalId} ` : ""}Importado por ${item.parser}`.trim() });
          continue;
        }
        if (item.kind === "internal_transfer" && institutionId && item.counterpartyInstitutionId) {
          const isOutflow = new Decimal(item.amount).isNegative();
          const [debit, credit] = transfer(draft, {
            fromInstitutionId: isOutflow ? institutionId : item.counterpartyInstitutionId,
            toInstitutionId: isOutflow ? item.counterpartyInstitutionId : institutionId,
            amount: item.amount,
            date: item.date,
            description: item.description,
          });
          const observed = isOutflow ? debit : credit;
          const pending = isOutflow ? credit : debit;
          Object.assign(observed, { source: "import" as const, importedDocumentId, fingerprint: importFingerprint(institutionId, item.date, item.description, item.amount, item.kind), notes: `${item.externalId ? `external:${item.externalId} ` : ""}Importado por ${item.parser}`.trim() });
          pending.pendingReconciliation = true;
          const movement = draft.financialMovements.find((value) => value.id === observed.financialMovementId);
          if (movement) Object.assign(movement, { source: "import" as const, importedDocumentId, fingerprint: observed.fingerprint, notes: observed.notes });
          continue;
        }
        const institution = draft.institutions.find((value) => value.id === institutionId);
        const entry = recordEntry(draft, {
          date: item.date,
          description: item.description,
          amount: item.amount,
          currency: item.currency ?? institution?.currency ?? "BRL",
          brlRate: item.exchangeRate ?? institution?.exchangeRate ?? "1",
          kind: item.kind,
          categoryId: item.categoryId,
          institutionId,
          creditCardId: document?.requiresCard ? creditCardId : undefined,
          importedDocumentId,
          source: "import",
          fingerprint: importFingerprint(institutionId, item.date, item.description, item.amount, item.kind),
          notes: `${item.externalId ? `external:${item.externalId} ` : ""}Importado por ${item.parser}`.trim(),
        });
        if (document?.requiresCard && item.cardTransactionKind && creditCardId) {
          const card = draft.creditCards.find((value) => value.id === creditCardId);
          if (card) draft.cardPurchases.push({
            id: uid("card-transaction"), cardId: card.id, description: item.description, amount: new Decimal(entry.amount).abs().toString(), currency: entry.currency,
            date: item.date, categoryId: item.categoryId, installments: 1, installmentNumber: item.installmentNumber, totalInstallments: item.totalInstallments,
            transactionKind: item.cardTransactionKind, importedDocumentId, firstInvoiceKey: `${card.id}:${item.date.slice(0, 7)}`, ledgerEntryId: entry.id, createdAt: now(), updatedAt: now(),
          });
        }
        if (item.categoryId && (item.categoryId !== item.suggestedCategoryId || item.kind !== item.suggestedKind)) learnClassificationRule(draft, entry);
        if (item.createInvestment && item.kind === "investment_contribution") {
          const amount = new Decimal(item.amount).abs().toString();
          const positionKey = rdbPositionKey(institutionId, item.description);
          const existing = positionKey
            ? draft.investments.find((investment) => importedRdbPositionKey(investment) === positionKey)
            : undefined;
          if (existing) {
            const quantity = new Decimal(existing.quantity).plus(1);
            existing.quantity = quantity.toString();
            existing.investedAmount = new Decimal(existing.investedAmount).plus(amount).toString();
            existing.currentValue = new Decimal(existing.currentValue).plus(amount).toString();
            existing.averagePrice = new Decimal(existing.investedAmount).div(quantity).toString();
            existing.currentPrice = new Decimal(existing.currentValue).div(quantity).toString();
            existing.updatedAt = now();
            entry.investmentId = existing.id;
          } else {
            const investment = {
              id: uid("investment"),
              institutionId,
              type: "other" as const,
              name: item.description,
              quantity: "1",
              averagePrice: amount,
              investedAmount: amount,
              currentPrice: amount,
              currentValue: amount,
              dividends: "0",
              currency: entry.currency,
              quoteStatus: "manual" as const,
              quoteMessage: "Criado pela importação",
              createdAt: now(),
              updatedAt: now(),
            };
            draft.investments.push(investment);
            entry.investmentId = investment.id;
          }
        }
      }
    });
    const imported = selected.length;
    reset();
    notify(`${imported} movimentação(ões) importada(s) com sucesso.`);
  };
  return (
    <section className="panel" ref={panel}>
      {step === "review" && (
        <div className="upload">
          <FileUp />
          <h2>Importe extrato ou fatura</h2>
          <p>
            PDF pesquisável ou escaneado, CSV, XLS ou XLSX. O arquivo é processado no navegador e não é armazenado.
          </p>
          <label className={buttonClassName()}>
            {busy ? <span className="button-spinner" aria-hidden="true" /> : null}
            {busy ?? (candidates.length ? "Trocar arquivo" : "Selecionar arquivo")}
            <input
              hidden
              type="file"
              accept=".ofx,.qfx,.pdf,.csv,.xls,.xlsx,.png,.jpg,.jpeg,.webp"
              disabled={Boolean(busy)}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                void read(file);
              }}
            />
          </label>
        </div>
      )}
      {busy && <p className="import-progress" role="status">{busy}</p>}
      {validation && validation.status !== "unavailable" && (
        <div className={`import-validation ${validation.status}`} role={validation.status === "warning" ? "alert" : "status"}>
          {validation.message}
        </div>
      )}
      {warnings.length > 0 && (
        <div className="warnings" role="alert">
          {warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      )}
      {candidates.length > 0 && step === "review" && (
        <>
          {document?.requiresCard && <div className="import-batch"><Field label="Cartão da fatura"><CustomSelect label="Cartão da fatura" value={creditCardId} onChange={setCreditCardId} items={[...emptyOption("Selecione o cartão"), ...state.creditCards.filter((card) => !card.archivedAt).map((card) => [card.id, `${card.name}${card.lastFour ? ` •••• ${card.lastFour}` : ""}`] as const)]} /></Field><p className="form-hint">O arquivo não contém identificadores suficientes para associação automática.</p></div>}
          <div className="import-batch">
            <div className="import-batch-head">
              <div>
                <h3>Revise antes de importar</h3>
                <p className="form-hint">{selected.length} de {candidates.length} movimentação(ões) selecionada(s). Edite linha a linha ou aplique uma alteração a todas as selecionadas.</p>
              </div>
              <div className="import-batch-actions">
                <Button size="sm" variant="secondary" onClick={() => setIncludeAll(true)}>Selecionar tudo</Button>
                <Button size="sm" variant="secondary" onClick={() => setIncludeAll(false)}>Limpar seleção</Button>
                <Button size="sm" variant="secondary" onClick={selectOnlyNew}>Somente inéditas</Button>
              </div>
            </div>
            <div className="import-batch-fields">
              <Field label="Tipo em lote">
                <CustomSelect
                  label="Aplicar tipo às selecionadas"
                  value={batch.kind}
                  onChange={(kind) => setBatch((current) => ({ ...current, kind }))}
                  items={[...emptyOption("Manter como está"), ...importKindOptions]}
                />
              </Field>
              <Field label="Categoria em lote">
                <CustomSelect
                  label="Aplicar categoria às selecionadas"
                  value={batch.categoryId}
                  onChange={(categoryId) => setBatch((current) => ({ ...current, categoryId }))}
                  items={[...emptyOption("Manter como está"), ...batchCategoryOptions]}
                />
              </Field>
              <Field label="Instituição em lote">
                <CustomSelect
                  label="Aplicar instituição às selecionadas"
                  value={batch.institutionId}
                  onChange={(institutionId) => setBatch((current) => ({ ...current, institutionId }))}
                  items={[...emptyOption("Manter como está"), ...detected, ...institutionOptions(state.institutions), ...creatable]}
                />
              </Field>
              <Button
                variant="secondary"
                onClick={applyBatch}
                disabled={!selected.length || (!batch.kind && !batch.categoryId && !batch.institutionId)}
              >
                Aplicar às selecionadas
              </Button>
            </div>
          </div>
          <div className="import-list">
            {candidates.map((item, index) => (
              <article className={`import-row ${item.duplicate || item.similarDuplicate ? "duplicate" : ""} ${item.needsReview ? "needs-review" : ""} ${showBlockers && blockedIds.has(item.id) ? "blocked" : ""}`} key={item.id}>
                <input
                  aria-label={`Incluir ${item.description}`}
                  type="checkbox"
                  checked={item.include}
                  onChange={(event) => patchCandidate(index, { include: event.target.checked })}
                />
                <div className="import-fields">
                  <DatePicker
                    value={item.date}
                    label={`Data de ${item.description}`}
                    onChange={(date) => patchCandidate(index, { date })}
                  />
                  <input
                    aria-label="Descrição"
                    value={item.description}
                    onChange={(event) => patchCandidate(index, { description: event.target.value })}
                  />
                  <input
                    aria-label="Valor"
                    inputMode="decimal"
                    value={item.amount}
                    onChange={(event) => patchCandidate(index, { amount: event.target.value })}
                  />
                  <CustomSelect
                    label="Moeda"
                    value={item.currency}
                    onChange={(currency) => patchCandidate(index, { currency: currency as ImportCandidate["currency"] })}
                    items={currencyOptions}
                  />
                  {item.currency !== "BRL" && <input aria-label={`Cotação ${item.currency} para BRL`} inputMode="decimal" placeholder="Cotação em BRL" value={item.exchangeRate ?? ""} onChange={(event) => patchCandidate(index, { exchangeRate: decimalInput(event.target.value) })} />}
                  <CustomSelect
                    label="Tipo de movimentação"
                    value={item.kind}
                    onChange={(kind) => setCandidates((current) => current.map((value, position) => (position === index ? withImportKind(value, kind as EntryKind) : value)))}
                    items={importKindOptions}
                  />
                  <CustomSelect
                    label="Categoria"
                    value={item.categoryId ?? ""}
                    onChange={(categoryId) => patchCandidate(index, { categoryId: categoryId || undefined })}
                    items={[...emptyOption("Sem categoria"), ...categoryOptions(state.categories, importCategoryFlow(item))]}
                  />
                  <CustomSelect
                    label="Conta de destino"
                    value={item.institutionId ?? ""}
                    onChange={(institutionId) => patchCandidate(index, { institutionId: institutionId || undefined })}
                    items={importInstitutionOptions}
                  />
                  {item.kind === "internal_transfer" && (
                    <CustomSelect
                      label="Outra conta própria"
                      value={item.counterpartyInstitutionId ?? ""}
                      onChange={(counterpartyInstitutionId) => patchCandidate(index, { counterpartyInstitutionId: counterpartyInstitutionId || undefined })}
                      items={[...emptyOption("Selecione para confirmar"), ...institutionOptions(state.institutions)]}
                    />
                  )}
                </div>
                <div className="confidence">
                  <span>{Math.round(item.confidence * 100)}%</span>
                  {item.page && <small>Página {item.page} · {item.extractionSource === "ocr" ? "OCR" : "texto do PDF"}</small>}
                  <small>{item.duplicate ? "Duplicata provável — desmarcada por segurança" : item.similarDuplicate ? "Movimentação parecida já existe — revise antes de incluir" : item.reason}</small>
                  {item.kind === "investment_contribution" && (
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={item.createInvestment}
                        onChange={(event) => patchCandidate(index, { createInvestment: event.target.checked })}
                      />
                      Criar ativo
                    </label>
                  )}
                </div>
              </article>
            ))}
          </div>
          {showBlockers && blockers.length > 0 && (
            <div className="import-blockers" role="alert">
              {blockers.map((message) => <p key={message}>{message}</p>)}
            </div>
          )}
          <div className="form-actions">
            <Button variant="secondary" onClick={reset}>Cancelar importação</Button>
            <Button onClick={advance}>Revisar e importar</Button>
          </div>
        </>
      )}
      {candidates.length > 0 && step === "confirm" && (
        <ImportConfirmation
          state={state}
          selected={selected}
          onBack={() => setStep("review")}
          onConfirm={() => void confirm()}
        />
      )}
    </section>
  );
}

function ImportConfirmation({ state, selected, onBack, onConfirm }: {
  state: FinanceState;
  selected: ImportCandidate[];
  onBack: () => void;
  onConfirm: () => void;
}) {
  const finalAmount = (item: ImportCandidate) =>
    signedAmount(item.kind, item.amount, state.categories.find((value) => value.id === item.categoryId)?.flow);
  const brlAmount = (item: ImportCandidate) => {
    try { return new Decimal(finalAmount(item)).times(item.exchangeRate ?? "1"); }
    catch { return new Decimal(0); }
  };
  const totals = selected.reduce(
    (accumulator, item) => {
      const value = brlAmount(item);
      return value.isNegative()
        ? { ...accumulator, debits: accumulator.debits.plus(value.abs()) }
        : { ...accumulator, credits: accumulator.credits.plus(value) };
    },
    { credits: new Decimal(0), debits: new Decimal(0) },
  );
  const kindCounts = importKindOptions
    .map(([kind, label]) => [label, selected.filter((item) => item.kind === kind).length] as const)
    .filter(([, count]) => count > 0);
  const duplicates = selected.filter((item) => item.duplicate || item.similarDuplicate).length;
  const newInstitutions = new Set(selected.map((item) => item.institutionId).filter((id) => id?.startsWith("create:"))).size;
  const withoutCategory = selected.filter((item) => !item.categoryId).length;
  const institutionName = (id?: string) => {
    if (!id) return "Sem instituição";
    if (id.startsWith("create:")) return `${catalogInstitution(id.slice("create:".length))?.name ?? "Nova instituição"} (nova)`;
    return state.institutions.find((item) => item.id === id)?.name ?? "Sem instituição";
  };
  return (
    <div className="import-summary">
      <div className="panel-heading">
        <div>
          <h3>Confirme a importação</h3>
          <p className="form-hint">Nada é gravado até você confirmar. Volte para a edição se algo estiver diferente do esperado.</p>
        </div>
      </div>
      <div className="metric-grid">
        <div className="metric"><span>Movimentações</span><strong>{selected.length}</strong></div>
        <div className="metric income"><span>Entradas</span><strong>{money(totals.credits.toString())}</strong></div>
        <div className="metric expense"><span>Saídas</span><strong>{money(totals.debits.toString())}</strong></div>
        <div className="metric available"><span>Resultado</span><strong>{money(totals.credits.minus(totals.debits).toString())}</strong></div>
      </div>
      <ul className="import-summary-notes">
        <li>Tipos: {kindCounts.map(([label, count]) => `${count} ${label.toLowerCase()}`).join(" · ") || "—"}</li>
        {newInstitutions > 0 && <li>{newInstitutions} instituição(ões) será(ão) criada(s) durante a importação.</li>}
        {withoutCategory > 0 && <li>{withoutCategory} movimentação(ões) sem categoria — dá para classificar depois.</li>}
        {duplicates > 0 && <li className="warning-text">{duplicates} movimentação(ões) marcada(s) como possível duplicata continuam selecionadas.</li>}
      </ul>
      <div className="responsive-table import-preview">
        <table>
          <thead>
            <tr><th>Data</th><th>Descrição</th><th>Tipo</th><th>Instituição</th><th>Valor</th></tr>
          </thead>
          <tbody>
            {selected.map((item) => (
              <tr key={item.id}>
                <td data-label="Data">{dateLabel(item.date)}</td>
                <td data-label="Descrição"><strong>{cleanTransactionDescription(item.description)}</strong></td>
                <td data-label="Tipo"><span className={`badge ${item.kind}`}>{entryKindLabel(item.kind)}</span></td>
                <td data-label="Instituição">{institutionName(item.institutionId)}</td>
                <td data-label="Valor" className={brlAmount(item).isNegative() ? "negative" : "positive"}>{money(finalAmount(item), item.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="form-actions">
        <Button variant="secondary" onClick={onBack}>Voltar e editar</Button>
        <Button onClick={onConfirm}>Confirmar importação</Button>
      </div>
    </div>
  );
}

export function InstitutionsPage() {
  const { state, commit } = useFinance();
  const { notify } = useFeedback();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Institution>();
  const [reconciling, setReconciling] = useState<Institution>();
  const [busy, setBusy] = useState<string>();
  const active = state.institutions.filter((item) => !item.archivedAt);
  const totalInBrl = active
    .reduce((sum, item) => sum.plus(new Decimal(institutionBalance(state, item.id)).mul(item.exchangeRate)), new Decimal(0))
    .toString();
  const archive = (item: Institution) =>
    void commit((draft) => {
      const used =
        draft.entries.some((entry) => entry.institutionId === item.id) ||
        draft.investments.some((investment) => investment.institutionId === item.id) ||
        draft.plannedEntries.some((plan) => plan.institutionId === item.id);
      if (used) {
        draft.institutions.find((value) => value.id === item.id)!.archivedAt = now();
      } else draft.institutions = draft.institutions.filter((value) => value.id !== item.id);
    });
  const sync = async (item: Institution) => {
    setBusy(item.id);
    try {
      const result = await fetchExchangeRate(item.currency);
      await commit((draft) => {
        const found = draft.institutions.find((value) => value.id === item.id)!;
        found.exchangeRate = result.value;
        found.exchangeRateAsOf = result.asOf;
        found.updatedAt = now();
      });
    } catch (error) {
      notify(error instanceof Error ? error.message : "Não foi possível atualizar a cotação.", "error");
    } finally {
      setBusy(undefined);
    }
  };
  return (
    <Page
      eyebrow="Patrimônio"
      title="Instituições"
      description="Bancos, corretoras e carteiras em qualquer moeda."
      actions={
        <>
          <Link className={buttonClassName({ variant: "secondary" })} to="/patrimonio/investimentos">
            Ver investimentos
          </Link>
          <Button
            onClick={() => {
              setEditing(undefined);
              setOpen(true);
            }}
          >
            <Plus />
            Nova instituição
          </Button>
        </>
      }
    >
      <section className="metric-grid institution-total-grid" aria-label="Total nas instituições">
        <article className="metric institutions-total">
          <span>Total em instituições</span>
          <strong>{money(totalInBrl)}</strong>
        </article>
      </section>
      <div className="entity-grid institutions">
        {active.length ? (
          active.map((item) => {
            const balance = institutionBalance(state, item.id);
            return (
              <article className="entity-card" key={item.id}>
                <header>
                  <span className={`entity-symbol${item.catalogId === "nubank" ? " entity-symbol-nubank" : ""}`}><InstitutionLogo institution={item} size={34} symbolOnly={item.catalogId === "nubank"} /></span>
                  <div>
                    <h2>{item.name}</h2>
                    <p>
                      {institutionTypeLabel(item.type)} · {item.currency}
                    </p>
                  </div>
                  <div className="row-actions">
                    <IconButton
                      label={`Editar ${item.name}`}
                      onClick={() => {
                        setEditing(item);
                        setOpen(true);
                      }}
                    >
                      <Pencil />
                    </IconButton>
                    <IconButton label={`Arquivar ${item.name}`} onClick={() => archive(item)}>
                      <Trash2 />
                    </IconButton>
                  </div>
                </header>
                <div className="balance">
                  <span>Saldo original</span>
                  <strong>{money(balance, item.currency)}</strong>
                  <small>
                    Em reais: {money(new Decimal(balance).mul(item.exchangeRate).toString())}
                  </small>
                </div>
                <dl>
                  <div>
                    <dt>Banco / agência</dt>
                    <dd>
                      {[item.bankCode, item.agency].filter(Boolean).join(" · ") || "Não informado"}
                    </dd>
                  </div>
                  <div>
                    <dt>Conta</dt>
                    <dd>{item.accountNumber || "Não informada"}</dd>
                  </div>
                  <div>
                    <dt>Cotação</dt>
                    <dd>
                      {item.exchangeRate}{" "}
                      {item.exchangeRateAsOf && `· ${dateLabel(item.exchangeRateAsOf)}`}
                    </dd>
                  </div>
                </dl>
                <footer>
                  {item.currency !== "BRL" && (
                    <Button
                      variant="ghost"
                      disabled={busy === item.id}
                      onClick={() => void sync(item)}
                    >
                      <RefreshCw />
                      Atualizar cotação
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    onClick={() => setReconciling(item)}
                  >
                    Corrigir saldo
                  </Button>
                </footer>
              </article>
            );
          })
        ) : (
          <Empty
            title="Nenhuma instituição"
            description="Cadastre onde seu dinheiro está guardado."
          />
        )}
      </div>
      {open && (
        <InstitutionDialog
          value={editing}
          onClose={() => setOpen(false)}
          onSave={async (record) => {
            await commit((draft) => {
              const index = draft.institutions.findIndex((item) => item.id === record.id);
              if (index >= 0) draft.institutions[index] = record;
              else draft.institutions.push(record);
            });
            setOpen(false);
          }}
        />
      )}
      {reconciling ? (
        <Modal title={`Corrigir saldo de ${reconciling.name}`} onClose={() => setReconciling(undefined)}>
          <form className="form-grid" onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            void commit((draft) => reconcileInstitution(draft, reconciling.id, decimalInput(data.get("balance")), today(), "Reconciliação pela instituição"));
            setReconciling(undefined);
          }}>
            <Field className="full" label="Saldo correto"><input required name="balance" inputMode="decimal" defaultValue={institutionBalance(state, reconciling.id)} /></Field>
            <div className="form-actions full"><Button type="button" variant="secondary" onClick={() => setReconciling(undefined)}>Cancelar</Button><Button type="submit">Salvar saldo</Button></div>
          </form>
        </Modal>
      ) : null}
    </Page>
  );
}

function InstitutionDialog({
  value,
  onClose,
  onSave,
}: {
  value?: Institution;
  onClose: () => void;
  onSave: (value: Institution) => Promise<void>;
}) {
  const [catalogId, setCatalogId] = useState(value?.catalogId ?? "");
  const [name, setName] = useState(value?.name ?? "");
  const [type, setType] = useState<InstitutionType>(value?.type ?? "bank");
  const [bankCode, setBankCode] = useState(value?.bankCode ?? "");
  const selectCatalog = (next: string) => {
    setCatalogId(next);
    const item = catalogInstitution(next);
    if (!item) return;
    setName(item.name);
    setType(item.type);
    setBankCode(item.bankCode ?? "");
  };
  return (
    <Modal title={value ? "Editar instituição" : "Nova instituição"} onClose={onClose}>
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const timestamp = now();
          const currency = String(data.get("currency")).toUpperCase();
          void onSave({
            id: value?.id ?? uid("institution"),
            name: String(data.get("name")),
            type: String(data.get("type")) as InstitutionType,
            bankCode: String(data.get("bankCode") || "") || undefined,
            agency: String(data.get("agency") || "") || undefined,
            accountNumber: String(data.get("accountNumber") || "") || undefined,
            identifier: String(data.get("identifier") || "") || undefined,
            notes: String(data.get("notes") || "") || undefined,
            currency,
            openingBalance: decimalInput(data.get("openingBalance")),
            exchangeRate: decimalInput(data.get("exchangeRate"), currency === "BRL" ? "1" : "0"),
            exchangeRateAsOf: value?.exchangeRateAsOf,
            catalogId: catalogInstitution(String(data.get("catalogId") || ""))?.id,
            logoKey: catalogInstitution(String(data.get("catalogId") || ""))?.logoKey,
            createdAt: value?.createdAt ?? timestamp,
            updatedAt: timestamp,
          });
        }}
      >
        <Field className="full" label="Instituição conhecida">
          <CustomSelect
            label="Instituição conhecida"
            name="catalogId"
            searchable
            value={catalogId}
            onChange={selectCatalog}
            items={catalogOptions}
          />
        </Field>
        <Field label="Nome">
          <input required name="name" value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Tipo">
          <CustomSelect
            label="Tipo de instituição"
            name="type"
            value={type}
            onChange={(next) => setType(next as InstitutionType)}
            items={[
              ["bank", "Banco"],
              ["broker", "Corretora"],
              ["wallet", "Carteira digital"],
              ["other", "Outra"],
            ]}
          />
        </Field>
        <Field label="Código do banco">
          <input name="bankCode" value={bankCode} onChange={(event) => setBankCode(event.target.value)} />
        </Field>
        <Field label="Agência">
          <input name="agency" defaultValue={value?.agency} />
        </Field>
        <Field label="Conta">
          <input name="accountNumber" defaultValue={value?.accountNumber} />
        </Field>
        <Field label="CPF/CNPJ ou identificador">
          <input name="identifier" defaultValue={value?.identifier} />
        </Field>
        <Field label="Moeda">
          <input required maxLength={5} name="currency" defaultValue={value?.currency ?? "BRL"} />
        </Field>
        <Field label="Saldo inicial">
          <input
            required
            inputMode="decimal"
            name="openingBalance"
            defaultValue={value?.openingBalance ?? "0"}
          />
        </Field>
        <Field label="Cotação para BRL">
          <input
            required
            inputMode="decimal"
            name="exchangeRate"
            defaultValue={value?.exchangeRate ?? "1"}
          />
        </Field>
        <Field className="full" label="Observações">
          <textarea name="notes" rows={3} defaultValue={value?.notes} />
        </Field>
        <div className="form-actions full">
          <Button type="submit">Salvar instituição</Button>
        </div>
      </form>
    </Modal>
  );
}

export function InvestmentsPage() {
  const { state, commit } = useFinance();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Investment>();
  const [editingGroupId, setEditingGroupId] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const active = state.investments.filter((item) => !item.archivedAt);
  const displayGroups = useMemo(() => investmentDisplayGroups(state), [state]);
  const total = active
    .reduce((sum, item) => sum.plus(item.currentValue), new Decimal(0))
    .toString();
  const sync = async (item: Investment) => {
    if (!item.ticker) return;
    setBusy(item.id);
    try {
      const result = await fetchAssetQuote(item.ticker);
      await commit((draft) => {
        const found = draft.investments.find((value) => value.id === item.id)!;
        found.currentPrice = result.value;
        found.currentValue = new Decimal(found.quantity).mul(result.value).toString();
        found.quoteStatus = "ok";
        found.quoteAsOf = result.asOf;
        found.quoteMessage = result.message;
        found.updatedAt = now();
      });
    } catch (error) {
      await commit((draft) => {
        const found = draft.investments.find((value) => value.id === item.id)!;
        found.quoteStatus = "error";
        found.quoteMessage = error instanceof Error ? error.message : "Falha na cotação";
      });
    } finally {
      setBusy(undefined);
    }
  };
  return (
    <Page
      eyebrow="Patrimônio"
      title="Investimentos"
      description="Acompanhe aplicações, ativos, rentabilidade e proventos."
      actions={
        <>
          <Link className={buttonClassName({ variant: "secondary" })} to="/patrimonio/instituicoes">
            Ver instituições
          </Link>
          <Button
            onClick={() => {
              setEditing(undefined);
              setOpen(true);
            }}
          >
            <Plus />
            Novo investimento
          </Button>
        </>
      }
    >
      <section className="metric-grid compact">
        <article className="metric invested">
          <span>Valor atual</span>
          <strong>{money(total)}</strong>
        </article>
        <article className="metric income">
          <span>Proventos</span>
          <strong>
            {money(
              active.reduce((sum, item) => sum.plus(item.dividends), new Decimal(0)).toString(),
            )}
          </strong>
        </article>
      </section>
      <div className="entity-grid investments">
        {displayGroups.length ? (
          displayGroups.map((group) => {
            const item = group.investments[0];
            const institution = state.institutions.find((candidate) => candidate.id === item.institutionId && !candidate.archivedAt);
            const isConsolidated = group.investments.length > 1;
            const applicationDetails = [item.applicationType ?? investmentTypeLabel(item.type), item.contractedYield].filter(Boolean).join(" · ");
            const investedAmount = group.investments.reduce((sum, investment) => sum.plus(investment.investedAmount), new Decimal(0));
            const currentValue = group.investments.reduce((sum, investment) => sum.plus(investment.currentValue), new Decimal(0));
            const dividends = group.investments.reduce((sum, investment) => sum.plus(investment.dividends), new Decimal(0));
            const gain = currentValue.minus(investedAmount);
            return (
              <article className="entity-card investment-card" key={group.id}>
                <header>
                  <span className="entity-symbol investment">
                    <TrendingUp />
                  </span>
                  <div>
                    <h2>{item.name}</h2>
                    <p>
                      {applicationDetails || `${group.investments.length} aplicações importadas`}{item.ticker && ` · ${item.ticker}`}
                    </p>
                  </div>
                  <div className="investment-card-actions">
                    {institution && <InstitutionLogo institution={institution} size={32} symbolOnly={institution.catalogId === "nubank"} />}
                    {isConsolidated && <IconButton
                      label={`Editar detalhes de ${item.name}`}
                      onClick={() => {
                        setEditing(item);
                        setEditingGroupId(group.id);
                        setOpen(true);
                      }}
                    >
                      <Pencil />
                    </IconButton>}
                    {!isConsolidated && <div className="row-actions">
                      <IconButton
                        label={`Editar ${item.name}`}
                        onClick={() => {
                          setEditing(item);
                          setEditingGroupId(undefined);
                          setOpen(true);
                        }}
                      >
                        <Pencil />
                      </IconButton>
                      <IconButton
                        label={`Arquivar ${item.name}`}
                        onClick={() =>
                          void commit((draft) => {
                            const used = draft.entries.some(
                              (entry) => entry.investmentId === item.id,
                            );
                            if (used)
                              draft.investments.find((value) => value.id === item.id)!.archivedAt =
                                now();
                            else
                              draft.investments = draft.investments.filter(
                                (value) => value.id !== item.id,
                              );
                          })
                        }
                      >
                        <Trash2 />
                      </IconButton>
                    </div>}
                  </div>
                </header>
                <div className="investment-values">
                  <div>
                    <span>Aplicado</span>
                    <strong>{money(investedAmount.toString(), item.currency)}</strong>
                  </div>
                  <div>
                    <span>Atual</span>
                    <strong>{money(currentValue.toString(), item.currency)}</strong>
                  </div>
                  <div>
                    <span>Resultado</span>
                    <strong className={gain.isNegative() ? "negative" : "positive"}>
                      {money(gain.toString(), item.currency)}
                    </strong>
                  </div>
                  <div>
                    <span>Proventos</span>
                    <strong>{money(dividends.toString(), item.currency)}</strong>
                  </div>
                </div>
                <p className={item.quoteStatus === "error" ? "warning-text" : "muted"}>
                  {isConsolidated ? "Posição consolidada das importações desta instituição" : item.quoteMessage ?? "Valores informados manualmente"}
                </p>
                {group.history.length > 0 && <details className="investment-history">
                  <summary><span>Histórico da posição</span><small>{group.history.length} movimentação(ões)</small></summary>
                  <div>
                    {group.history.map((entry) => {
                      const amount = investmentMovementAmount(entry);
                      const positive = new Decimal(amount).isPositive();
                      return <article key={entry.id}>
                        <span><small>{dateLabel(entry.date)}</small><strong>{cleanTransactionDescription(entry.description)}</strong></span>
                        <b className={positive ? "positive" : "negative"}>{positive ? "+" : ""}{money(amount, entry.currency)}</b>
                      </article>;
                    })}
                  </div>
                </details>}
                <footer>
                  {item.ticker && (
                    <Button
                      variant="ghost"
                      disabled={busy === item.id}
                      onClick={() => void sync(item)}
                    >
                      <RefreshCw />
                      Atualizar cotação
                    </Button>
                  )}
                </footer>
              </article>
            );
          })
        ) : (
          <Empty
            title="Nenhum investimento"
            description="Cadastre um ativo manualmente ou crie um pela importação."
          />
        )}
      </div>
      {open && (
        <InvestmentDialog
          value={editing}
          institutions={state.institutions}
          consolidated={Boolean(editingGroupId)}
          onClose={() => {
            setOpen(false);
            setEditingGroupId(undefined);
          }}
          onSave={async (record, createEntry) => {
            await commit((draft) => {
              if (editingGroupId) {
                const group = investmentDisplayGroups(draft).find((candidate) => candidate.id === editingGroupId);
                group?.investments.forEach((investment) => {
                  investment.type = record.type;
                  investment.applicationType = record.applicationType;
                  investment.contractedYield = record.contractedYield;
                  investment.maturityDate = record.maturityDate;
                  investment.updatedAt = now();
                });
                return;
              }
              const index = draft.investments.findIndex((item) => item.id === record.id);
              if (index >= 0) draft.investments[index] = record;
              else {
                if (createEntry && record.institutionId) {
                  const initialAmount = record.investedAmount;
                  draft.investments.push({ ...record, quantity: "0", averagePrice: "0", investedAmount: "0", currentPrice: "0", currentValue: "0", dividends: "0" });
                  investmentContribution(draft, { fromInstitutionId: record.institutionId, investmentId: record.id, amount: initialAmount, date: today(), description: `Aplicação em ${record.name}` });
                  return;
                }
                draft.investments.push(record);
                if (createEntry && record.institutionId)
                  recordEntry(draft, {
                    date: today(),
                    description: `Aplicação em ${record.name}`,
                    amount: record.investedAmount,
                    currency: record.currency,
                    brlRate:
                      draft.institutions.find((item) => item.id === record.institutionId)
                        ?.exchangeRate ?? "1",
                    kind: "investment_contribution",
                    institutionId: record.institutionId,
                    investmentId: record.id,
                  });
              }
            });
            setOpen(false);
            setEditingGroupId(undefined);
          }}
        />
      )}
    </Page>
  );
}

function InvestmentDialog({
  value,
  institutions,
  consolidated,
  onClose,
  onSave,
}: {
  value?: Investment;
  institutions: Institution[];
  consolidated?: boolean;
  onClose: () => void;
  onSave: (value: Investment, createEntry: boolean) => Promise<void>;
}) {
  return (
    <Modal title={value ? "Editar investimento" : "Novo investimento"} onClose={onClose}>
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const timestamp = now();
          const quantity = decimalInput(data.get("quantity"), "1");
          const averagePrice = decimalInput(data.get("averagePrice"));
          const currentPrice = decimalInput(data.get("currentPrice"), averagePrice);
          void onSave(
            {
              id: value?.id ?? uid("investment"),
              institutionId: String(data.get("institutionId") || "") || undefined,
              type: String(data.get("type")) as InvestmentType,
              applicationType: String(data.get("applicationType") || "") || undefined,
              name: String(data.get("name")),
              ticker: String(data.get("ticker") || "").toUpperCase() || undefined,
              quantity,
              averagePrice,
              investedAmount: decimalInput(
                data.get("investedAmount"),
                new Decimal(quantity).mul(averagePrice).toString(),
              ),
              currentPrice,
              currentValue: decimalInput(
                data.get("currentValue"),
                new Decimal(quantity).mul(currentPrice).toString(),
              ),
              dividends: decimalInput(data.get("dividends")),
              currency: String(data.get("currency") || "BRL").toUpperCase(),
              contractedYield: String(data.get("contractedYield") || "") || undefined,
              maturityDate: String(data.get("maturityDate") || "") || undefined,
              quoteStatus: value?.quoteStatus ?? "manual",
              quoteMessage: value?.quoteMessage,
              quoteAsOf: value?.quoteAsOf,
              createdAt: value?.createdAt ?? timestamp,
              updatedAt: timestamp,
            },
            Boolean(data.get("createEntry")),
          );
        }}
      >
        <Field label="Classe financeira">
          <CustomSelect label="Classe financeira" name="type" defaultValue={value?.type ?? "cdb"} items={investmentTypeOptions} />
        </Field>
        <Field label="Instituição">
          <CustomSelect
            label="Instituição"
            name="institutionId"
            defaultValue={value?.institutionId ?? ""}
            items={[...emptyOption("Sem instituição"), ...institutionOptions(institutions)]}
          />
        </Field>
        <Field className="full" label="Nome do ativo">
          <input required name="name" defaultValue={value?.name} />
        </Field>
        <Field className="full" label="Tipo da aplicação">
          <input name="applicationType" list="application-type-options" placeholder="Ex.: Caixinha Turbo" defaultValue={value?.applicationType} />
          <datalist id="application-type-options">
            <option value="Caixinha" />
            <option value="Caixinha Turbo" />
            <option value="CDB pós-fixado" />
            <option value="CDB prefixado" />
            <option value="RDB" />
          </datalist>
        </Field>
        <Field label="Ticker / símbolo">
          <input name="ticker" defaultValue={value?.ticker} />
        </Field>
        <Field label="Moeda">
          <input name="currency" defaultValue={value?.currency ?? "BRL"} />
        </Field>
        <Field label="Quantidade">
          <input name="quantity" inputMode="decimal" defaultValue={value?.quantity ?? "1"} />
        </Field>
        <Field label="Preço médio">
          <input name="averagePrice" inputMode="decimal" defaultValue={value?.averagePrice} />
        </Field>
        <Field label="Valor aplicado">
          <input name="investedAmount" inputMode="decimal" defaultValue={value?.investedAmount} />
        </Field>
        <Field label="Preço atual">
          <input name="currentPrice" inputMode="decimal" defaultValue={value?.currentPrice} />
        </Field>
        <Field label="Valor atual">
          <input name="currentValue" inputMode="decimal" defaultValue={value?.currentValue} />
        </Field>
        <Field label="Proventos">
          <input name="dividends" inputMode="decimal" defaultValue={value?.dividends ?? "0"} />
        </Field>
        <Field label="Rendimento / indexador">
          <input name="contractedYield" placeholder="Ex.: 115% do CDI" defaultValue={value?.contractedYield} />
        </Field>
        <Field label="Vencimento">
          <FormDatePicker name="maturityDate" defaultValue={value?.maturityDate} label="Data de vencimento" />
        </Field>
        {!value && (
          <label className="check full">
            <input type="checkbox" name="createEntry" defaultChecked />
            Registrar aplicação e reduzir saldo disponível
          </label>
        )}
        {consolidated && <p className="form-hint full">Esses detalhes serão aplicados a todas as movimentações desta posição importada.</p>}
        <div className="form-actions full">
          <Button type="submit">Salvar investimento</Button>
        </div>
      </form>
    </Modal>
  );
}

export function PlanningPage() {
  const { state, commit } = useFinance();
  const { notify } = useFeedback();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PlannedEntry>();
  const [editingDate, setEditingDate] = useState<string>();
  const [completing, setCompleting] = useState<ReturnType<typeof occurrencesFor>[number]>();
  const rangeEnd = new Date();
  rangeEnd.setFullYear(rangeEnd.getFullYear() + 1);
  const occurrences = state.plannedEntries
    .flatMap((plan) => occurrencesFor(plan, today(), rangeEnd.toISOString().slice(0, 10)))
    .sort((a, b) => a.date.localeCompare(b.date));
  let projected = state.institutions.reduce(
    (sum, item) => sum.plus(new Decimal(institutionBalance(state, item.id)).mul(item.exchangeRate)),
    new Decimal(0),
  );
  const projection = occurrences.map((item) => {
    if (item.paymentMethod !== "credit_card") projected = item.kind === "income" ? projected.plus(item.amount) : projected.minus(item.amount);
    return { ...item, projected: projected.toString() };
  });
  const plannedIncome = occurrences.filter((item) => item.kind === "income").reduce((sum, item) => sum.plus(item.amount), new Decimal(0));
  const plannedExpenses = occurrences.filter((item) => item.kind === "expense").reduce((sum, item) => sum.plus(item.amount), new Decimal(0));
  return (
    <Page
      eyebrow="Próximos passos"
      title="Planejamento"
      description="Visualize o fluxo futuro e transforme previsões em movimentos reais."
      actions={
        <Button
          onClick={() => {
            setEditing(undefined);
            setEditingDate(undefined);
            setOpen(true);
          }}
        >
          <Plus />
          Novo planejamento
        </Button>
      }
    >
      <section className="metric-grid compact planning-metrics">
        <article className="metric income"><span>Entradas previstas</span><strong>{money(plannedIncome.toString())}</strong></article>
        <article className="metric expense"><span>Saídas previstas</span><strong>{money(plannedExpenses.toString())}</strong></article>
        <article className="metric available"><span>Saldo ao fim do período</span><strong>{money(projection[projection.length - 1]?.projected ?? projected.toString())}</strong></article>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Próximos 12 meses</span>
            <h2>Fluxo de caixa projetado</h2>
          </div>
        </div>
        {projection.length ? (
          <div className="timeline">
            {projection.map((item) => (
              <article key={item.key} className={item.settled ? "settled" : ""}>
                <span className="timeline-date">{dateLabel(item.date)}</span>
                <div>
                  <strong>{item.description}</strong>
                   <small>{item.settled ? "Realizado" : "Planejado"} Â· {paymentMethodLabel(item.paymentMethod)}</small>
                </div>
                <span className={item.kind === "income" ? "positive" : "negative"}>
                  {item.kind === "income" ? "+" : "−"}
                  {money(item.amount)}
                </span>
                <span className="projected">Saldo {money(item.projected)}</span>
                <div className="row-actions">
                  {!item.settled && (
                    <IconButton
                      label="Marcar como realizado"
                      onClick={() => setCompleting(item)}
                    >
                      <Check />
                    </IconButton>
                  )}
                  {item.settled && (
                    <IconButton
                      label="Desfazer conclusÃ£o"
                      onClick={() => void commit((draft) => undoOccurrence(draft, item.planId, item.date)).catch((error) => notify(error instanceof Error ? error.message : "NÃ£o foi possÃ­vel desfazer a conclusÃ£o.", "error"))}
                    >
                      <Undo2 />
                    </IconButton>
                  )}
                  <IconButton
                    label="Editar série"
                    onClick={() => {
                      setEditing(state.plannedEntries.find((plan) => plan.id === item.planId));
                      setEditingDate(item.date);
                      setOpen(true);
                    }}
                  >
                    <Pencil />
                  </IconButton>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty
            title="Nada planejado"
            description="Cadastre receitas ou despesas futuras, únicas ou recorrentes."
          />
        )}
      </section>
      {open && (
        <PlanningDialog
          value={editing}
          effectiveDate={editingDate}
          state={state}
          onClose={() => setOpen(false)}
          onSave={async (record, mode, effectiveDate) => {
            await commit((draft) => {
              const index = draft.plannedEntries.findIndex((item) => item.id === record.id);
              if (index < 0) {
                draft.plannedEntries.push(record);
                return;
              }
              if (mode === "all") {
                draft.plannedEntries[index] = record;
                return;
              }
              const changed = editRecurrence(
                draft,
                record.id,
                effectiveDate,
                {
                  description: record.description,
                  amount: record.amount,
                  kind: record.kind,
                  categoryId: record.categoryId,
                  institutionId: record.institutionId,
                  paymentMethod: record.paymentMethod,
                  creditCardId: record.creditCardId,
                },
                mode,
              );
              if (mode === "future") {
                changed.frequency = record.frequency;
                changed.endDate = record.endDate;
                changed.occurrenceCount = record.occurrenceCount;
                changed.updatedAt = record.updatedAt;
              }
            });
            setOpen(false);
          }}
          onRemove={
            editing
              ? async () => {
                  await commit((draft) => {
                    draft.plannedEntries = draft.plannedEntries.filter(
                      (item) => item.id !== editing.id,
                    );
                  });
                  setOpen(false);
                }
              : undefined
          }
        />
      )}
      {completing && <CompleteOccurrenceDialog occurrence={completing} onClose={() => setCompleting(undefined)} onConfirm={async (effectiveDate, effectiveAmount) => {
        try {
          await commit((draft) => settleOccurrence(draft, completing.planId, completing.date, { effectiveDate, effectiveAmount }));
          notify("Planejamento concluÃ­do.");
          setCompleting(undefined);
        } catch (error) {
          notify(error instanceof Error ? error.message : "NÃ£o foi possÃ­vel concluir o planejamento.", "error");
        }
      }} />}
    </Page>
  );
}

function CompleteOccurrenceDialog({
  occurrence,
  onClose,
  onConfirm,
}: {
  occurrence: ReturnType<typeof occurrencesFor>[number];
  onClose: () => void;
  onConfirm: (effectiveDate: string, effectiveAmount: string) => Promise<void>;
}) {
  const [effectiveDate, setEffectiveDate] = useState(occurrence.date);
  const [effectiveAmount, setEffectiveAmount] = useState(occurrence.amount);
  const isCard = occurrence.paymentMethod === "credit_card";
  return (
    <Modal title="Concluir planejamento" onClose={onClose}>
      <form className="form-grid" onSubmit={(event) => {
        event.preventDefault();
        void onConfirm(effectiveDate, decimalInput(effectiveAmount));
      }}>
        <p className="form-hint full">Previsto: {dateLabel(occurrence.date)} · {money(occurrence.amount)}. O previsto serÃ¡ preservado para comparaÃ§Ã£o.</p>
        {!isCard && <>
        <Field label="Data efetiva">
          <DatePicker value={effectiveDate} onChange={setEffectiveDate} label="Data efetiva" />
        </Field>
        <Field label="Valor efetivo">
          <input required inputMode="decimal" value={effectiveAmount} onChange={(event) => setEffectiveAmount(event.target.value)} />
        </Field>
        </>}
        {isCard && <p className="form-hint full">A compra serÃ¡ criada na fatura com a data e o valor originais. Nenhuma conta bancÃ¡ria serÃ¡ debitada agora.</p>}
        <div className="form-actions full">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit">{isCard ? "Adicionar à fatura" : `Concluir em ${dateLabel(effectiveDate)}`}</Button>
        </div>
      </form>
    </Modal>
  );
}

function PlanningDialog({
  value,
  effectiveDate,
  state,
  onClose,
  onSave,
  onRemove,
}: {
  value?: PlannedEntry;
  effectiveDate?: string;
  state: FinanceState;
  onClose: () => void;
  onSave: (
    value: PlannedEntry,
    mode: "one" | "future" | "all",
    effectiveDate: string,
  ) => Promise<void>;
  onRemove?: () => Promise<void>;
}) {
  const [editMode, setEditMode] = useState<"one" | "future" | "all">("all");
  const [kind, setKind] = useState<"income" | "expense">(value?.kind ?? "expense");
  const [description, setDescription] = useState(value?.description ?? "");
  const [frequency, setFrequency] = useState<RecurrenceFrequency>(value?.frequency ?? "once");
  const [categoryId, setCategoryId] = useState(value?.categoryId ?? "");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(value?.paymentMethod ?? "pix");
  const [institutionId, setInstitutionId] = useState(value?.institutionId ?? "");
  const [creditCardId, setCreditCardId] = useState(value?.creditCardId ?? "");
  const showSchedule = !value || editMode !== "one";
  const settledEditDate = effectiveDate ?? value?.startDate;
  const editingSettledOccurrence = Boolean(value?.exceptions.some((item) => item.date === settledEditDate && item.settledEntryId));
  const categories = state.categories.filter((item) => !item.archivedAt && item.flow === kind);
  const applyIncomePreset = (description: string, categoryName: string) => {
    setDescription(description);
    setFrequency("monthly");
    const category = categories.find((item) => item.name === categoryName);
    if (category) setCategoryId(category.id);
  };
  return (
    <Modal title={value ? "Editar planejamento" : "Novo planejamento"} onClose={onClose}>
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const timestamp = now();
          const scopeDate = String(data.get("effectiveDate") || effectiveDate || value?.startDate || today());
          void onSave(
            {
              id: value?.id ?? uid("plan"),
              startDate: String(data.get("startDate") || value?.startDate || scopeDate),
              description: String(data.get("description")),
              amount: decimalInput(data.get("amount")),
              kind: String(data.get("kind")) as "income" | "expense",
              categoryId: String(data.get("categoryId") || "") || undefined,
              institutionId: String(data.get("institutionId") || "") || undefined,
              paymentMethod: String(data.get("paymentMethod") || "pix") as PaymentMethod,
              creditCardId: String(data.get("creditCardId") || "") || undefined,
              frequency: String(data.get("frequency") || value?.frequency || "once") as RecurrenceFrequency,
              endDate: String(data.get("endDate") || "") || undefined,
              occurrenceCount: Number(data.get("occurrenceCount")) || undefined,
              exceptions: value?.exceptions ?? [],
              createdAt: value?.createdAt ?? timestamp,
              updatedAt: timestamp,
            },
            value ? editMode : "all",
            scopeDate,
          );
        }}
      >
        {value && value.frequency !== "once" && (
          <>
            <Field label="Aplicar alteração em">
              <CustomSelect
                label="Aplicar alteração em"
                name="editMode"
                value={editMode}
                onChange={(next) => setEditMode(next as typeof editMode)}
                items={[
                  ["all", "Série inteira"],
                  ...(!editingSettledOccurrence ? [["one", "Somente esta ocorrência"] as const] : []),
                  ["future", "Esta e as futuras"],
                ]}
              />
            </Field>
            {editMode !== "all" && (
              <Field label="Data da ocorrência">
                <FormDatePicker name="effectiveDate" defaultValue={effectiveDate ?? value.startDate} label="Data da ocorrência" required />
              </Field>
            )}
          </>
        )}
        <Field label="Tipo">
          <CustomSelect
            label="Tipo do planejamento"
            name="kind"
            value={kind}
            onChange={(next) => setKind(next as typeof kind)}
            items={[
              ["income", "Receita"],
              ["expense", "Despesa"],
            ]}
          />
        </Field>
        {kind === "income" && <div className="income-presets full" aria-label="Atalhos de receita"><span>Preencher como</span><div><button type="button" onClick={() => applyIncomePreset("Salário", "Salário")}>Salário mensal</button><button type="button" onClick={() => applyIncomePreset("Aluguel recebido", "Aluguel recebido")}>Aluguel mensal</button><button type="button" onClick={() => applyIncomePreset("Freela", "Freela e serviços")}>Freela</button></div></div>}
        <Field className="full" label="Descrição">
          <input required name="description" value={description} onChange={(event) => setDescription(event.target.value)} />
        </Field>
        <Field label="Valor">
          <input required name="amount" inputMode="decimal" defaultValue={value?.amount} />
        </Field>
        {showSchedule && (
          <>
            {(!value || editMode === "all") && <Field label="Primeira data">
              <FormDatePicker name="startDate" defaultValue={value?.startDate ?? today()} label="Primeira data" required />
            </Field>}
            <Field label="Quantidade máxima">
              <input
                type="number"
                min="1"
                name="occurrenceCount"
                defaultValue={value?.occurrenceCount}
              />
            </Field>
            <Field label="Frequência">
              <CustomSelect
                label="Frequência"
                name="frequency"
                value={frequency}
                onChange={(next) => setFrequency(next as RecurrenceFrequency)}
                items={[
                  ["once", "Uma vez"],
                  ["daily", "Diária"],
                  ["weekly", "Semanal"],
                  ["biweekly", "Quinzenal"],
                  ["monthly", "Mensal"],
                  ["yearly", "Anual"],
                ]}
              />
            </Field>
            <Field label="Termina em">
              <FormDatePicker name="endDate" defaultValue={value?.endDate} label="Data de término" />
            </Field>
          </>
        )}
        <Field label="Categoria">
          <CustomSelect
            label="Categoria"
            name="categoryId"
            value={categoryId}
            onChange={setCategoryId}
            items={[...emptyOption("Sem categoria"), ...categories.map((item) => [item.id, item.name] as const)]}
          />
        </Field>
        <Field label="Instituição">
          <CustomSelect
            label="Instituição"
            name="institutionId"
            value={institutionId}
            onChange={setInstitutionId}
            required={paymentMethod !== "credit_card"}
            items={[...emptyOption("Sem instituição"), ...institutionOptions(state.institutions)]}
          />
        </Field>
        <Field label="Forma de pagamento">
          <CustomSelect
            label="Forma de pagamento"
            name="paymentMethod"
            value={paymentMethod}
            onChange={(next) => setPaymentMethod(next as PaymentMethod)}
            items={[
              ["pix", "Pix"],
              ["automatic_debit", "Débito automático"],
              ["credit_card", "Cartão de crédito"],
            ]}
          />
        </Field>
        {paymentMethod === "credit_card" && <Field label="Cartão de crédito">
          <CustomSelect
            label="Cartão de crédito"
            name="creditCardId"
            value={creditCardId}
            onChange={setCreditCardId}
            required
            items={state.creditCards.filter((item) => !item.archivedAt && item.cardType !== "debit").map((item) => [item.id, item.name] as const)}
          />
        </Field>}
        <div className="form-actions full">
          {onRemove && (
            <Button type="button" variant="danger" onClick={() => void onRemove()}>
              Remover
            </Button>
          )}
          <Button type="submit">Salvar planejamento</Button>
        </div>
      </form>
    </Modal>
  );
}

export function ProfilePage() {
  const { state, commit } = useFinance();
  const { notify } = useFeedback();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  return (
    <Page
      eyebrow="Seu espaço"
      title="Perfil"
      description="Seu personagem e sua identidade, integrados ao mesmo produto."
    >
      <Suspense fallback={<div className="panel page-route-loading">Carregando perfil…</div>}>
        <section className="profile-area">
        {!editing && <article className="panel profile-copy">
          <span className="eyebrow">Kreature atual</span>
          <h2>Um perfil com a sua cara</h2>
          <p>Personalize formato, cor, expressão, acessórios, moldura, fundo e identidade. As alterações acompanham sua conta.</p>
          <Button onClick={() => setEditing(true)}><Sparkles />Editar personagem</Button>
          <ThemePanel mode={state.theme ?? "light"} onChange={(mode) => {
            const previous = state.theme ?? "light";
            applyTheme(mode);
            void commit((draft) => { draft.theme = mode; })
              .then(() => notify("Tema atualizado."))
              .catch((error) => {
                applyTheme(previous);
                notify(error instanceof Error ? error.message : "Não foi possível salvar o tema.", "error");
              });
          }} />
          <section className="profile-session" aria-labelledby="session-title">
            <div>
              <span className="eyebrow">Sessão</span>
              <h2 id="session-title">Acesso neste dispositivo</h2>
              <p>Sair encerra o acesso neste dispositivo. Seus dados permanecem protegidos na sua conta.</p>
            </div>
            <Button variant="secondary" onClick={() => setSignOutOpen(true)}><LogOut />Sair</Button>
          </section>
        </article>}
        {editing ? <CharacterCustomizer value={state.profile} onCancel={() => setEditing(false)} onSave={async (profile) => { await commit((draft) => { draft.profile = profile; }); setEditing(false); }} /> : <div className="profile-card-wrap"><ProfileCard config={state.profile} size={168} /></div>}
        </section>
      </Suspense>
      {signOutOpen && <Modal title="Sair do Kreature" onClose={() => setSignOutOpen(false)}>
        <p className="modal-copy">Você voltará para a tela de entrada. Seus dados não serão apagados.</p>
        <div className="form-actions">
          <Button variant="secondary" onClick={() => setSignOutOpen(false)}>Cancelar</Button>
          <Button variant="danger" onClick={() => { void signOut().then(() => navigate({ to: "/login" })); }}><LogOut />Sair agora</Button>
        </div>
      </Modal>}
    </Page>
  );
}

function ThemePanel({ mode, onChange }: { mode: ThemeMode; onChange: (mode: ThemeMode) => void }) {
  const options: Array<{ id: ThemeMode; label: string; description: string; Icon: typeof Sun }> = [
    { id: "light", label: "Claro", description: "A interface clara e colorida do Kreature.", Icon: Sun },
    { id: "dark", label: "Escuro", description: "Mais conforto para ambientes com pouca luz.", Icon: Moon },
    { id: "system", label: "Sistema", description: "Acompanha a preferência do seu dispositivo.", Icon: Monitor },
  ];
  return (
    <section className="panel theme-panel" aria-labelledby="theme-title">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Aparência</span>
          <h2 id="theme-title">Escolha o tema do Kreature</h2>
        </div>
      </div>
      <div className="theme-choices">
        {options.map(({ id, label, description, Icon }) => (
          <button
            type="button"
            key={id}
            className={`theme-choice ${mode === id ? "selected" : ""}`}
            aria-pressed={mode === id}
            onClick={() => onChange(id)}
          >
            <span className="theme-icon"><Icon /></span>
            <span>
              <strong>{label}</strong>
              <small>{description}</small>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

const normalizeText = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
const entryKindLabel = (kind: EntryKind) =>
  ({
    internal_transfer: "Transferência interna",
    investment_contribution: "Aplicação",
    investment_withdrawal: "Resgate",
    investment_income: "Rendimento de investimento",
    income: "Entrada",
    expense: "Despesa",
    investment: "Aplicação",
    transfer: "Transferência",
    credit_payment: "Pagamento de fatura",
    reserve: "Reserva",
    card_purchase: "Compra no cartão",
    card_refund: "Estorno do cartão",
    card_fee: "Tarifa do cartão",
    card_interest: "Juros do cartão",
    pix: "Pix",
    adjustment: "Ajuste",
  })[kind];
const paymentMethodLabel = (method: PaymentMethod) =>
  ({ pix: "Pix", automatic_debit: "Débito automático", credit_card: "Cartão de crédito" })[method];
const plannedOriginLabel = (state: FinanceState, key?: string) => {
  if (!key) return "";
  return ` · ${state.plannedEntries.some((plan) => key.startsWith(`${plan.id}:`)) ? "Planejamento" : "Planejamento removido"}`;
};
const institutionTypeLabel = (type: InstitutionType) =>
  ({ bank: "Banco", broker: "Corretora", wallet: "Carteira digital", other: "Outra" })[type];
const investmentTypeOptions: Array<[InvestmentType, string]> = [
  ["cash_box", "Caixinha / reserva remunerada"],
  ["cdb", "CDB"],
  ["cri", "CRI"],
  ["cra", "CRA"],
  ["fixed_income", "Renda fixa"],
  ["stock", "Ação"],
  ["fii", "FII"],
  ["etf", "ETF"],
  ["bdr", "BDR"],
  ["crypto", "Criptomoeda"],
  ["fund", "Fundo"],
  ["pension", "Previdência"],
  ["other", "Outro"],
];
const investmentTypeLabel = (type: InvestmentType) =>
  investmentTypeOptions.find(([value]) => value === type)?.[1] ?? type;
