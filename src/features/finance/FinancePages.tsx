import { lazy, Suspense, useMemo, useState, type MouseEvent } from "react";
import { Link } from "@tanstack/react-router";
import {
  FileUp,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Monitor,
  Moon,
  Sun,
  Trash2,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import Decimal from "decimal.js";
import { useFinance } from "@/data/finance-context";
import { now, uid } from "@/domain/defaults";
import {
  institutionBalance,
  reconcileInstitution,
  recordEntry,
  removeEntry,
  transfer,
  updateEntry,
  type EntryInput,
} from "@/domain/ledger";
import { buildSummary, monthlyHistory } from "@/domain/queries";
import { importedRdbPositionKey, investmentDisplayGroups, investmentMovementAmount, rdbPositionKey } from "@/domain/investment-groups";
import { learnClassificationRule, normalizeClassificationText } from "@/domain/classification";
import { editRecurrence, occurrencesFor, settleOccurrence } from "@/domain/recurrence";
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
  RecurrenceFrequency,
  ThemeMode,
} from "@/domain/types";
import { analyzeFile, cleanTransactionDescription } from "@/lib/importers";
import { fetchAssetQuote, fetchExchangeRate } from "@/lib/market";
import { dateLabel, decimalInput, money, monthLabel } from "@/lib/format";
import { catalogInstitution, searchInstitutionCatalog } from "@/domain/institution-catalog";
import { cardInvoices, payCardInvoice, recordCardPurchase } from "@/domain/cards";
import { DatePicker, FormDatePicker, MonthPicker } from "@/DatePicker";
import { InstitutionLogo } from "@/InstitutionLogo";
import { Button } from "@/shared/ui/Button";
import { CustomSelect } from "@/shared/ui/CustomSelect";
import { Dialog as Modal } from "@/shared/ui/Dialog";
import { EmptyState as Empty } from "@/shared/ui/EmptyState";
import { FormField as Field, SelectOptions } from "@/shared/ui/FormField";
import { Page } from "@/shared/ui/Page";
import { Tabs } from "@/shared/ui/Tabs";
import { useObjectUrl } from "@/shared/hooks/useObjectUrl";
import { useFeedback } from "@/shared/ui/FeedbackProvider";

const DashboardCharts = lazy(() => import("@/features/summary/DashboardCharts").then((module) => ({ default: module.DashboardCharts })));
const CharacterCustomizer = lazy(() => import("@/features/profile/CharacterCustomizer").then((module) => ({ default: module.CharacterCustomizer })));
const ProfileCard = lazy(() => import("@/features/profile/ProfileCard").then((module) => ({ default: module.ProfileCard })));

const today = () => new Date().toISOString().slice(0, 10);
const historyMonthTones = ["violet", "teal", "amber", "rose", "sky"];

function CategoryImage({ image, name }: { image: Blob; name: string }) {
  const source = useObjectUrl(image);
  return source ? <img src={source} alt={`Imagem de ${name}`} /> : null;
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
  const history = useMemo(() => monthlyHistory(state).slice().reverse().slice(-8), [state]);
  const cards = [
    ["Gastos do período", summary.expenses, "expense"],
    ["Disponível", summary.available, "available"],
    ["Total investido", summary.invested, "invested"],
    ["Entradas", summary.income, "income"],
  ] as const;
  return (
    <Page
      eyebrow="Visão geral"
      title="Resumo financeiro"
      description="Tudo que importa no período escolhido, sem depender de conexão externa."
      actions={
        <Link className="button primary" to="/lancamentos">
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
      <section className="metric-grid">
        {cards.map(([label, value, tone]) => (
          <article className={`metric ${tone}`} key={label}>
            <span>{label}</span>
            <strong>{money(value)}</strong>
          </article>
        ))}
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
  const entries = state.entries
    .filter((entry) => normalizeText(entry.description).includes(normalizeText(search)))
    .sort((a, b) => b.date.localeCompare(a.date));
  const save = async (input: EntryInput & { installments?: number }, toInstitutionId?: string) => {
    await commit((draft) => {
      if (input.kind === "card_purchase" && input.creditCardId) {
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
      } else if (input.kind === "transfer" && input.institutionId && toInstitutionId)
        transfer(draft, {
          fromInstitutionId: input.institutionId,
          toInstitutionId,
          amount: input.amount,
          date: input.date,
          description: input.description,
        });
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
                      </td>
                      <td data-label="Tipo">
                        <span className={`badge ${entry.kind === "transfer" && normalizeText(entry.description).includes("pix") ? "pix" : entry.kind}`}>{entryKindLabel(entry.kind === "transfer" && normalizeText(entry.description).includes("pix") ? "pix" : entry.kind)}</span>
                      </td>
                      <td data-label="Instituição">
                        {state.institutions.find((item) => item.id === entry.institutionId)?.name ??
                          "—"}
                      </td>
                      <td
                        data-label="Valor"
                        className={new Decimal(entry.amount).isPositive() ? "positive" : "negative"}
                      >
                        {money(entry.amount, entry.currency)}
                      </td>
                      <td className="row-actions">
                        {!entry.transferGroupId && (
                          <button
                            aria-label="Editar"
                            onClick={() => {
                              setEditing(entry);
                              setDialog(true);
                            }}
                          >
                            <Pencil />
                          </button>
                        )}
                        <button
                          aria-label="Excluir"
                          onClick={() => setPendingDeletion(entry)}
                        >
                          <Trash2 />
                        </button>
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
  onSave: (input: EntryInput & { installments?: number }, toInstitutionId?: string) => Promise<void>;
}) {
  const [kind, setKind] = useState<EntryKind>(entry?.kind ?? "expense");
  const [date, setDate] = useState(entry?.date ?? today());
  const [toInstitutionId, setToInstitutionId] = useState("");
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
        );
      }}
    >
      <Field label="Tipo">
        <select value={kind} onChange={(event) => setKind(event.target.value as EntryKind)}>
          <SelectOptions
            values={[
              ["income", "Entrada"],
              ["expense", "Despesa"],
              ["investment", "Economia / aplicação"],
              ["reserve", "Reserva"],
              ["pix", "Pix"],
              ["transfer", "Transferência"],
              ["card_purchase", "Compra no cartão"],
              ["credit_payment", "Pagamento de fatura"],
            ]}
          />
        </select>
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
        <select name="institutionId" defaultValue={entry?.institutionId ?? ""}>
          <option value="">Sem instituição</option>
          {state.institutions
            .filter((item) => !item.archivedAt)
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.currency}
              </option>
            ))}
        </select>
      </Field>
      {kind === "transfer" && (
        <Field label="Instituição de destino">
          <select
            required
            value={toInstitutionId}
            onChange={(event) => setToInstitutionId(event.target.value)}
          >
            <option value="">Selecione</option>
            {state.institutions
              .filter((item) => !item.archivedAt)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
        </Field>
      )}
      {(kind === "card_purchase" || kind === "credit_payment") && (
        <Field label="Cartão">
          <select required value={creditCardId} onChange={(event) => setCreditCardId(event.target.value)}>
            <option value="">Selecione</option>
            {state.creditCards.filter((item) => !item.archivedAt).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </Field>
      )}
      {kind === "card_purchase" && (
        <Field label="Parcelas"><input required min="1" max="360" type="number" name="installments" defaultValue="1" /></Field>
      )}
      {kind === "credit_payment" && (
        <Field label="Fatura aberta">
          <select required name="invoiceKey"><option value="">Selecione</option>{invoices.map((item) => <option key={item.key} value={item.key}>{dateLabel(item.dueDate)} · {money(item.total)}</option>)}</select>
        </Field>
      )}
      {kind !== "transfer" && kind !== "credit_payment" && <Field label="Categoria">
        <select name="categoryId" defaultValue={entry?.categoryId ?? ""}>
          <option value="">Sem categoria</option>
          {state.categories
            .filter((item) => !item.archivedAt && item.flow === (kind === "income" ? "income" : "expense"))
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
        </select>
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

function CreditCardsView() {
  const { state, commit } = useFinance();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CreditCard>();
  const active = state.creditCards.filter((item) => !item.archivedAt);
  return <section className="panel">
    <div className="panel-heading"><div><span className="eyebrow">Crédito</span><h2>Cartões e faturas</h2></div><Button onClick={() => { setEditing(undefined); setOpen(true); }}><Plus />Novo cartão</Button></div>
    <div className="entity-grid institutions">{active.length ? active.map((card) => {
      const upcoming = cardInvoices(state, card.id).find((item) => !item.paidEntryId);
      return <article className="entity-card" key={card.id}><header><span className="entity-symbol"><WalletCards /></span><div><h2>{card.name}</h2><p>Fecha dia {card.closingDay} · vence dia {card.dueDay}</p></div><div className="row-actions"><button aria-label="Editar cartão" onClick={() => { setEditing(card); setOpen(true); }}><Pencil /></button></div></header><div className="balance"><span>Limite</span><strong>{money(card.limit, card.currency)}</strong><small>{upcoming ? `Fatura: ${money(upcoming.total, card.currency)} em ${dateLabel(upcoming.dueDate)}` : "Sem faturas abertas"}</small></div></article>;
    }) : <Empty title="Nenhum cartão" description="Cadastre um cartão para registrar compras, parcelas e faturas." />}</div>
    {open && <CreditCardDialog value={editing} institutions={state.institutions} onClose={() => setOpen(false)} onSave={async (card) => { await commit((draft) => { const index = draft.creditCards.findIndex((item) => item.id === card.id); if (index >= 0) draft.creditCards[index] = card; else draft.creditCards.push(card); }); setOpen(false); }} />}
  </section>;
}

function CreditCardDialog({ value, institutions, onClose, onSave }: { value?: CreditCard; institutions: Institution[]; onClose: () => void; onSave: (value: CreditCard) => Promise<void>; }) {
  return <Modal title={value ? "Editar cartão" : "Novo cartão"} onClose={onClose}><form className="form-grid" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); const timestamp = now(); void onSave({ id: value?.id ?? uid("card"), name: String(data.get("name")), issuerName: String(data.get("issuerName") || "") || undefined, payerInstitutionId: String(data.get("payerInstitutionId") || "") || undefined, limit: decimalInput(data.get("limit")), closingDay: Number(data.get("closingDay")), dueDay: Number(data.get("dueDay")), currency: String(data.get("currency") || "BRL").toUpperCase(), notes: String(data.get("notes") || "") || undefined, createdAt: value?.createdAt ?? timestamp, updatedAt: timestamp }); }}>
    <Field label="Nome"><input required name="name" defaultValue={value?.name} /></Field><Field label="Emissor"><input name="issuerName" defaultValue={value?.issuerName} /></Field>
    <Field label="Conta pagadora"><select name="payerInstitutionId" defaultValue={value?.payerInstitutionId ?? ""}><option value="">Definir ao pagar</option>{institutions.filter((item) => !item.archivedAt).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
    <Field label="Limite"><input required name="limit" inputMode="decimal" defaultValue={value?.limit ?? "0"} /></Field><Field label="Fechamento"><input required name="closingDay" min="1" max="31" type="number" defaultValue={value?.closingDay ?? 10} /></Field><Field label="Vencimento"><input required name="dueDay" min="1" max="31" type="number" defaultValue={value?.dueDay ?? 20} /></Field><Field label="Moeda"><input required name="currency" maxLength={5} defaultValue={value?.currency ?? "BRL"} /></Field><Field className="full" label="Observações"><textarea name="notes" rows={3} defaultValue={value?.notes} /></Field><div className="form-actions full"><Button type="submit">Salvar cartão</Button></div>
  </form></Modal>;
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
                {item.image ? (
                  <CategoryImage image={item.image} name={item.name} />
                ) : (
                  item.name.slice(0, 1)
                )}
              </span>
              <div>
                <strong>{item.name}</strong>
                <small>{item.flow === "income" ? "Receita" : "Despesa"} · {item.isDefault ? "Padrão" : "Personalizada"}</small>
              </div>
              <div className="row-actions">
                <button
                  aria-label={`Editar categoria ${item.name}`}
                  onClick={() => {
                    setEditing(item);
                    setOpen(true);
                  }}
                >
                  <Pencil />
                </button>
                <button aria-label={`Arquivar categoria ${item.name}`} onClick={() => archive(item)}>
                  <Trash2 />
                </button>
              </div>
            </article>
          ))}
      </div>
      <section className="rules-panel" aria-labelledby="learned-rules-title">
        <div><span className="eyebrow">Automação local</span><h3 id="learned-rules-title">Regras aprendidas</h3><p>Usadas apenas neste navegador para reconhecer a mesma descrição novamente.</p></div>
        {state.classificationRules.length ? <div className="rules-list">{state.classificationRules.map((rule) => <div className="rule-row" key={rule.id}><input aria-label={`Descrição da regra ${rule.match}`} defaultValue={rule.match} onBlur={(event) => void commit((draft) => { const found = draft.classificationRules.find((item) => item.id === rule.id); const match = normalizeClassificationText(event.target.value); if (!found || !match || match === found.match) return; found.match = match; found.updatedAt = now(); })} /><select aria-label={`Categoria da regra ${rule.match}`} value={rule.categoryId} onChange={(event) => void commit((draft) => { const found = draft.classificationRules.find((item) => item.id === rule.id); if (found) { found.categoryId = event.target.value; found.updatedAt = now(); } })}>{state.categories.filter((category) => !category.archivedAt && category.flow === rule.kind).map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select><button aria-label={`Remover regra ${rule.match}`} onClick={() => void commit((draft) => { draft.classificationRules = draft.classificationRules.filter((item) => item.id !== rule.id); })}><Trash2 /></button></div>)}</div> : <p className="muted">As regras aparecem quando você corrige uma categoria durante uma importação ou salva um lançamento manual.</p>}
      </section>
      {open && (
        <Modal
          title={editing ? "Editar categoria" : "Nova categoria"}
          onClose={() => setOpen(false)}
        >
          <form
            className="form-grid"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              const file = data.get("image") as File;
              void commit((draft) => {
                const timestamp = now();
              const record: Category = {
                  id: editing?.id ?? uid("category"),
                  name: String(data.get("name")),
                  icon: "Circle",
                color: String(data.get("color")),
                flow: String(data.get("flow")) as Category["flow"],
                  image: file?.size ? file : editing?.image,
                  isDefault: editing?.isDefault ?? false,
                  createdAt: editing?.createdAt ?? timestamp,
                  updatedAt: timestamp,
                };
                const index = draft.categories.findIndex((item) => item.id === record.id);
                if (index >= 0) draft.categories[index] = record;
                else draft.categories.push(record);
              }).then(() => setOpen(false));
            }}
          >
            <Field label="Nome">
              <input required name="name" defaultValue={editing?.name} />
            </Field>
            <Field label="Cor">
              <input type="color" name="color" defaultValue={editing?.color ?? "#f97316"} />
            </Field>
            <Field label="Fluxo">
              <select name="flow" defaultValue={editing?.flow ?? "expense"}><SelectOptions values={[["expense", "Despesa"], ["income", "Receita"]]} /></select>
            </Field>
            <Field className="full" label="Imagem opcional">
              <input type="file" name="image" accept="image/*" />
            </Field>
            <div className="form-actions full">
              <Button type="submit">Salvar categoria</Button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}

function ImportView() {
  const { state, commit } = useFinance();
  const [candidates, setCandidates] = useState<ImportCandidate[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const read = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      const result = await analyzeFile(file, state);
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
        return {
          ...item,
          institutionId: item.institutionId ?? known?.id ?? (item.detectedInstitutionId ? `create:${item.detectedInstitutionId}` : undefined),
          exchangeRate: rates.get(item.currency),
        };
      }));
      setWarnings([...result.warnings, ...rateWarnings]);
    } catch (error) {
      setWarnings([error instanceof Error ? error.message : "Falha ao processar arquivo."]);
    } finally {
      setBusy(false);
    }
  };
  const confirm = async () => {
    const pendingForeignRate = candidates.find((item) => item.include && !item.duplicate && item.currency !== "BRL" && !item.exchangeRate);
    if (pendingForeignRate) {
      setWarnings([`Informe a cotação de ${pendingForeignRate.currency} para BRL antes de confirmar a importação.`]);
      return;
    }
    await commit((draft) => {
      const createdInstitutions = new Map<string, string>();
      for (const item of candidates.filter(
        (candidate) => candidate.include && !candidate.duplicate,
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
          source: "import",
          fingerprint: item.fingerprint,
          notes: `${item.externalId ? `external:${item.externalId} ` : ""}Importado por ${item.parser}`.trim(),
        });
        if (item.categoryId && (item.categoryId !== item.suggestedCategoryId || item.kind !== item.suggestedKind)) learnClassificationRule(draft, entry);
        if (item.createInvestment && item.kind === "investment") {
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
    setCandidates([]);
    setWarnings([]);
  };
  return (
    <section className="panel">
      <div className="upload">
        <FileUp />
        <h2>Importe extrato ou fatura</h2>
        <p>
          PDF pesquisável, CSV, XLS ou XLSX. O arquivo é processado no navegador e não é armazenado.
        </p>
        <label className="button primary">
          {busy ? "Processando..." : "Selecionar arquivo"}
          <input
            hidden
            type="file"
            accept=".ofx,.qfx,.pdf,.csv,.xls,.xlsx,.png,.jpg,.jpeg,.webp"
            disabled={busy}
            onChange={(event) => void read(event.target.files?.[0])}
          />
        </label>
      </div>
      {warnings.length > 0 && (
        <div className="warnings" role="alert">
          {warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      )}
      {candidates.length > 0 && (
        <>
          <div className="import-list">
            {candidates.map((item, index) => (
              <article className={`import-row ${item.duplicate ? "duplicate" : ""}`} key={item.id}>
                <input
                  aria-label="Incluir"
                  type="checkbox"
                  checked={item.include}
                  disabled={item.duplicate}
                  onChange={(event) =>
                    setCandidates((current) =>
                      current.map((value, i) =>
                        i === index ? { ...value, include: event.target.checked } : value,
                      ),
                    )
                  }
                />
                <div className="import-fields">
                  <DatePicker
                    value={item.date}
                    label={`Data de ${item.description}`}
                    onChange={(date) => setCandidates((current) => current.map((value, i) => i === index ? { ...value, date } : value))}
                  />
                  <input
                    value={item.description}
                    onChange={(event) =>
                      setCandidates((current) =>
                        current.map((value, i) =>
                          i === index ? { ...value, description: event.target.value } : value,
                        ),
                      )
                    }
                  />
                  <input
                    value={item.amount}
                    onChange={(event) =>
                      setCandidates((current) =>
                        current.map((value, i) =>
                          i === index ? { ...value, amount: event.target.value } : value,
                        ),
                      )
                    }
                  />
                  <select
                    value={item.currency}
                    aria-label="Moeda"
                    onChange={(event) => setCandidates((current) => current.map((value, i) => i === index ? { ...value, currency: event.target.value as ImportCandidate["currency"] } : value))}
                  >
                    <SelectOptions values={[["BRL", "Real brasileiro (BRL)"], ["USD", "Dólar (USD)"], ["EUR", "Euro (EUR)"], ["GBP", "Libra (GBP)"]]} />
                  </select>
                  {item.currency !== "BRL" && <input aria-label={`Cotação ${item.currency} para BRL`} inputMode="decimal" placeholder="Cotação em BRL" value={item.exchangeRate ?? ""} onChange={(event) => setCandidates((current) => current.map((value, i) => i === index ? { ...value, exchangeRate: decimalInput(event.target.value) } : value))} />}
                  <select
                    value={item.kind}
                    onChange={(event) =>
                      setCandidates((current) =>
                        current.map((value, i) =>
                          i === index ? { ...value, kind: event.target.value as EntryKind } : value,
                        ),
                      )
                    }
                  >
                    <SelectOptions
                      values={[
                        ["income", "Entrada"],
                        ["expense", "Despesa"],
                        ["investment", "Investimento"],
                        ["transfer", "Transferência"],
                        ["pix", "Pix"],
                        ["credit_payment", "Pagamento de fatura"],
                      ]}
                    />
                  </select>
                  <select
                    value={item.categoryId ?? ""}
                    onChange={(event) =>
                      setCandidates((current) =>
                        current.map((value, i) =>
                          i === index
                            ? { ...value, categoryId: event.target.value || undefined }
                            : value,
                        ),
                      )
                    }
                  >
                    <option value="">Sem categoria</option>
                    {state.categories
                      .filter((value) => !value.archivedAt && value.flow === (new Decimal(item.amount).isNegative() ? "expense" : "income"))
                      .map((value) => (
                        <option value={value.id} key={value.id}>
                          {value.name}
                        </option>
                      ))}
                  </select>
                  <select
                    value={item.institutionId ?? ""}
                    onChange={(event) =>
                      setCandidates((current) =>
                        current.map((value, i) =>
                          i === index
                            ? { ...value, institutionId: event.target.value || undefined }
                            : value,
                        ),
                      )
                    }
                  >
                    {item.detectedInstitutionId && !state.institutions.some((value) => value.catalogId === item.detectedInstitutionId && !value.archivedAt) && (
                      <option value={`create:${item.detectedInstitutionId}`}>Criar {catalogInstitution(item.detectedInstitutionId)?.name ?? "Instituição detectada"}</option>
                    )}
                    <option value="">Sem instituição</option>
                    {state.institutions
                      .filter((value) => !value.archivedAt)
                      .map((value) => (
                        <option value={value.id} key={value.id}>
                          {value.name}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="confidence">
                  <span>{Math.round(item.confidence * 100)}%</span>
                  <small>{item.duplicate ? "Possível duplicata" : item.reason}</small>
                  {item.kind === "investment" && (
                    <label>
                      <input
                        type="checkbox"
                        checked={item.createInvestment}
                        onChange={(event) =>
                          setCandidates((current) =>
                            current.map((value, i) =>
                              i === index
                                ? { ...value, createInvestment: event.target.checked }
                                : value,
                            ),
                          )
                        }
                      />
                      Criar ativo
                    </label>
                  )}
                </div>
              </article>
            ))}
          </div>
          <div className="form-actions">
            <Button
              variant="secondary"
              onClick={() => {
                setCandidates([]);
                setWarnings([]);
              }}
            >
              Cancelar importação
            </Button>
            <Button
              onClick={() => void confirm()}
              disabled={!candidates.some((item) => item.include && !item.duplicate)}
            >
              Confirmar importação
            </Button>
          </div>
        </>
      )}
    </section>
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
          <Link className="button secondary" to="/patrimonio/investimentos">
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
                  <span className="entity-symbol"><InstitutionLogo institution={item} size={34} /></span>
                  <div>
                    <h2>{item.name}</h2>
                    <p>
                      {institutionTypeLabel(item.type)} · {item.currency}
                    </p>
                  </div>
                  <div className="row-actions">
                    <button
                      onClick={() => {
                        setEditing(item);
                        setOpen(true);
                      }}
                    >
                      <Pencil />
                    </button>
                    <button onClick={() => archive(item)}>
                      <Trash2 />
                    </button>
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
  const [catalogQuery, setCatalogQuery] = useState("");
  const selectCatalog = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const item = catalogInstitution(event.target.value);
    if (!item || !event.currentTarget.form) return;
    const form = event.currentTarget.form;
    (form.elements.namedItem("name") as HTMLInputElement).value = item.name;
    (form.elements.namedItem("type") as HTMLSelectElement).value = item.type;
    (form.elements.namedItem("bankCode") as HTMLInputElement).value = item.bankCode ?? "";
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
          <input value={catalogQuery} onChange={(event) => setCatalogQuery(event.target.value)} placeholder="Buscar Nubank, Itaú, XP…" aria-label="Buscar instituição" />
          <select name="catalogId" defaultValue={value?.catalogId ?? ""} onChange={selectCatalog}>
            <option value="">Outra — preenchimento manual</option>
            {searchInstitutionCatalog(catalogQuery).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </Field>
        <Field label="Nome">
          <input required name="name" defaultValue={value?.name} />
        </Field>
        <Field label="Tipo">
          <select name="type" defaultValue={value?.type ?? "bank"}>
            <SelectOptions
              values={[
                ["bank", "Banco"],
                ["broker", "Corretora"],
                ["wallet", "Carteira digital"],
                ["other", "Outra"],
              ]}
            />
          </select>
        </Field>
        <Field label="Código do banco">
          <input name="bankCode" defaultValue={value?.bankCode} />
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
          <Link className="button secondary" to="/patrimonio/instituicoes">
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
                    {institution && <InstitutionLogo institution={institution} size={32} />}
                    {isConsolidated && <button
                      aria-label={`Editar detalhes de ${item.name}`}
                      onClick={() => {
                        setEditing(item);
                        setEditingGroupId(group.id);
                        setOpen(true);
                      }}
                    >
                      <Pencil />
                    </button>}
                    {!isConsolidated && <div className="row-actions">
                      <button
                        aria-label={`Editar ${item.name}`}
                        onClick={() => {
                          setEditing(item);
                          setEditingGroupId(undefined);
                          setOpen(true);
                        }}
                      >
                        <Pencil />
                      </button>
                      <button
                        aria-label={`Arquivar ${item.name}`}
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
                      </button>
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
                    kind: "investment",
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
          <select name="type" defaultValue={value?.type ?? "cdb"}>
            <SelectOptions values={investmentTypeOptions} />
          </select>
        </Field>
        <Field label="Instituição">
          <select name="institutionId" defaultValue={value?.institutionId ?? ""}>
            <option value="">Sem instituição</option>
            {institutions
              .filter((item) => !item.archivedAt)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
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
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PlannedEntry>();
  const [editingDate, setEditingDate] = useState<string>();
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
    projected = item.kind === "income" ? projected.plus(item.amount) : projected.minus(item.amount);
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
                  <small>{item.settled ? "Realizado" : "Planejado"}</small>
                </div>
                <span className={item.kind === "income" ? "positive" : "negative"}>
                  {item.kind === "income" ? "+" : "−"}
                  {money(item.amount)}
                </span>
                <span className="projected">Saldo {money(item.projected)}</span>
                <div className="row-actions">
                  {!item.settled && (
                    <button
                      title="Marcar como realizado"
                      onClick={() =>
                        void commit((draft) => settleOccurrence(draft, item.planId, item.date))
                      }
                    >
                      ✓
                    </button>
                  )}
                  <button
                    title="Editar série"
                    onClick={() => {
                      setEditing(state.plannedEntries.find((plan) => plan.id === item.planId));
                      setEditingDate(item.date);
                      setOpen(true);
                    }}
                  >
                    <Pencil />
                  </button>
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
    </Page>
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
  const showSchedule = !value || editMode !== "one";
  const categories = state.categories.filter((item) => !item.archivedAt && item.flow === kind);
  const applyIncomePreset = (event: MouseEvent<HTMLButtonElement>, description: string, categoryName: string) => {
    const form = event.currentTarget.form;
    const category = categories.find((item) => item.name === categoryName);
    const descriptionInput = form?.elements.namedItem("description") as HTMLInputElement | null;
    const frequencyInput = form?.elements.namedItem("frequency") as HTMLSelectElement | null;
    const categoryInput = form?.elements.namedItem("categoryId") as HTMLSelectElement | null;
    if (descriptionInput) descriptionInput.value = description;
    if (frequencyInput) frequencyInput.value = "monthly";
    if (categoryInput && category) categoryInput.value = category.id;
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
              <select
                name="editMode"
                value={editMode}
                onChange={(event) => setEditMode(event.target.value as typeof editMode)}
              >
                <SelectOptions
                  values={[
                    ["all", "Série inteira"],
                    ["one", "Somente esta ocorrência"],
                    ["future", "Esta e as futuras"],
                  ]}
                />
              </select>
            </Field>
            {editMode !== "all" && (
              <Field label="Data da ocorrência">
                <FormDatePicker name="effectiveDate" defaultValue={effectiveDate ?? value.startDate} label="Data da ocorrência" required />
              </Field>
            )}
          </>
        )}
        <Field label="Tipo">
          <select name="kind" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
            <SelectOptions
              values={[
                ["income", "Receita"],
                ["expense", "Despesa"],
              ]}
            />
          </select>
        </Field>
        {kind === "income" && <div className="income-presets full" aria-label="Atalhos de receita"><span>Preencher como</span><div><button type="button" onClick={(event) => applyIncomePreset(event, "Salário", "Salário")}>Salário mensal</button><button type="button" onClick={(event) => applyIncomePreset(event, "Aluguel recebido", "Aluguel recebido")}>Aluguel mensal</button><button type="button" onClick={(event) => applyIncomePreset(event, "Freela", "Freela e serviços")}>Freela</button></div></div>}
        {(!value || editMode === "all") && (
          <Field label="Primeira data">
            <FormDatePicker name="startDate" defaultValue={value?.startDate ?? today()} label="Primeira data" required />
          </Field>
        )}
        <Field className="full" label="Descrição">
          <input required name="description" defaultValue={value?.description} />
        </Field>
        <Field label="Valor">
          <input required name="amount" inputMode="decimal" defaultValue={value?.amount} />
        </Field>
        {showSchedule && (
          <>
            <Field label="Frequência">
              <select name="frequency" defaultValue={value?.frequency ?? "once"}>
                <SelectOptions
                  values={[
                    ["once", "Uma vez"],
                    ["daily", "Diária"],
                    ["weekly", "Semanal"],
                    ["biweekly", "Quinzenal"],
                    ["monthly", "Mensal"],
                    ["yearly", "Anual"],
                  ]}
                />
              </select>
            </Field>
            <Field label="Termina em">
              <FormDatePicker name="endDate" defaultValue={value?.endDate} label="Data de término" />
            </Field>
            <Field label="Quantidade máxima">
              <input
                type="number"
                min="1"
                name="occurrenceCount"
                defaultValue={value?.occurrenceCount}
              />
            </Field>
          </>
        )}
        <Field label="Categoria">
          <select name="categoryId" defaultValue={value?.categoryId ?? ""}>
            <option value="">Sem categoria</option>
            {categories
              .map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Instituição">
          <select name="institutionId" defaultValue={value?.institutionId ?? ""}>
            <option value="">Sem instituição</option>
            {state.institutions
              .filter((item) => !item.archivedAt)
              .map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
        </Field>
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
  const [editing, setEditing] = useState(false);
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
          <p>Personalize formato, cor, expressão, acessórios, moldura, fundo e identidade. As alterações ficam somente neste navegador.</p>
          <Button onClick={() => setEditing(true)}><Sparkles />Editar personagem</Button>
          <ThemePanel mode={state.theme ?? "light"} onChange={(mode) => void commit((draft) => { draft.theme = mode; })} />
        </article>}
        {editing ? <CharacterCustomizer value={state.profile} onCancel={() => setEditing(false)} onSave={async (profile) => { await commit((draft) => { draft.profile = profile; }); setEditing(false); }} /> : <div className="profile-card-wrap"><ProfileCard config={state.profile} size={168} /></div>}
        </section>
      </Suspense>
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
    income: "Entrada",
    expense: "Despesa",
    investment: "Aplicação",
    transfer: "Transferência",
    credit_payment: "Pagamento de fatura",
    reserve: "Reserva",
    card_purchase: "Compra no cartão",
    pix: "Pix",
    adjustment: "Ajuste",
  })[kind];
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
