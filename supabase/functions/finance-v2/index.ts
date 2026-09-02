import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

type CipherEnvelope = {
  sensitive_payload_b64: string;
  encryption_nonce_b64: string;
  encryption_key_version: number;
};

type Json = Record<string, unknown>;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// The browser calls this from the app origin, so the preflight has to be
// answered before any of the financial contracts below are reachable at all.
const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-max-age": "86400",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

function fromBase64(value: string): Uint8Array {
  const decoded = atob(value);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function toBase64(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function activeKeyVersion() {
  const parsed = Number(Deno.env.get("DATA_ROOT_KEY_ACTIVE_VERSION") ?? "1");
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error("Versão de chave inválida.");
  return parsed;
}

function rootKeyMaterial(keyVersion: number) {
  const root = Deno.env.get(`DATA_ROOT_KEY_V${keyVersion}`);
  if (!root) throw new Error(`Chave de dados V${keyVersion} indisponível.`);
  const bytes = fromBase64(root);
  if (bytes.length < 32) throw new Error(`Chave de dados V${keyVersion} é curta demais.`);
  return bytes;
}

/** One key per user, per purpose, per key version. The root key never leaves this function. */
async function deriveKey(userId: string, purpose: string, keyVersion: number, usage: KeyUsage[]) {
  const rootKey = await crypto.subtle.importKey("raw", rootKeyMaterial(keyVersion), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode(userId),
      info: encoder.encode(`kreature:finance-v2:${purpose}:v${keyVersion}`),
    },
    rootKey,
    { name: "AES-GCM", length: 256 },
    false,
    usage,
  );
}

async function hmac(userId: string, purpose: string, value: string) {
  const version = activeKeyVersion();
  const rootKey = await crypto.subtle.importKey("raw", rootKeyMaterial(version), "HKDF", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode(userId),
      info: encoder.encode(`kreature:finance-v2:${purpose}:v${version}`),
    },
    rootKey,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign"],
  );
  return toBase64(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

/**
 * The associated data pins a ciphertext to one row and one column, so a stolen
 * payload cannot be replayed into a different record.
 */
function aad(userId: string, table: string, rowId: string, column: string, keyVersion: number) {
  return encoder.encode(`${userId}|${table}|${rowId}|${column}|v${keyVersion}`);
}

async function encryptPayload(input: {
  userId: string;
  purpose: string;
  table: string;
  rowId: string;
  value: unknown;
  keyVersion?: number;
}): Promise<CipherEnvelope> {
  const encryption_key_version = input.keyVersion ?? activeKeyVersion();
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(input.userId, input.purpose, encryption_key_version, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonce,
      additionalData: aad(input.userId, input.table, input.rowId, "sensitive_payload", encryption_key_version),
    },
    key,
    encoder.encode(JSON.stringify(input.value ?? {})),
  );
  return {
    sensitive_payload_b64: toBase64(ciphertext),
    encryption_nonce_b64: toBase64(nonce),
    encryption_key_version,
  };
}

async function decryptPayload(input: {
  userId: string;
  purpose: string;
  table: string;
  rowId: string;
  envelope: CipherEnvelope;
}) {
  const key = await deriveKey(input.userId, input.purpose, input.envelope.encryption_key_version, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: fromBase64(input.envelope.encryption_nonce_b64),
      additionalData: aad(
        input.userId,
        input.table,
        input.rowId,
        "sensitive_payload",
        input.envelope.encryption_key_version,
      ),
    },
    key,
    fromBase64(input.envelope.sensitive_payload_b64),
  );
  return JSON.parse(decoder.decode(plaintext)) as Json;
}

/** A row whose payload cannot be opened is reported, never silently dropped. */
async function openRow(userId: string, purpose: string, table: string, row: Json, rowId = String(row.id)) {
  const payload = row.sensitive_payload_b64;
  const nonce = row.encryption_nonce_b64;
  const version = row.encryption_key_version;
  if (typeof payload !== "string" || typeof nonce !== "string" || typeof version !== "number") {
    return { sensitive: {}, sensitiveUnavailable: true };
  }
  try {
    return {
      sensitive: await decryptPayload({
        userId,
        purpose,
        table,
        rowId,
        envelope: { sensitive_payload_b64: payload, encryption_nonce_b64: nonce, encryption_key_version: version },
      }),
      sensitiveUnavailable: false,
    };
  } catch {
    return { sensitive: {}, sensitiveUnavailable: true };
  }
}

/** Ciphertext, nonce and key version are boundary concerns and never leave it. */
const CIPHER_FIELDS = ["sensitive_payload_b64", "encryption_nonce_b64", "encryption_key_version"];
const stripCipher = (row: Json) =>
  Object.fromEntries(Object.entries(row).filter(([field]) => !CIPHER_FIELDS.includes(field)));

class RequestError extends Error {
  constructor(message: string, readonly status = 400, readonly code?: string) {
    super(message);
  }
}

async function authenticatedClient(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) throw new RequestError("Sessão ausente.", 401);
  const url = Deno.env.get("SUPABASE_URL");
  const publishable = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !publishable) throw new RequestError("Configuração Supabase ausente.", 500);
  // The caller's JWT is forwarded so every statement runs under their RLS.
  // service_role is never used for user-owned data.
  const client = createClient(url, publishable, {
    db: { schema: "api" },
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new RequestError("Sessão inválida.", 401);
  return { client, userId: data.user.id };
}

/**
 * The api routines raise messages written for the person using the app. Anything
 * the engine itself produced names constraints, columns and relations, so it is
 * replaced rather than forwarded to the browser.
 */
const ENGINE_MESSAGES: Record<string, string> = {
  "23505": "Este registro já existe.",
  "23502": "Faltam dados obrigatórios para concluir a operação.",
  "23514": "Os valores informados deixariam o lançamento inconsistente.",
  "22P02": "Um dos valores enviados está em formato inválido.",
  "22003": "Um dos valores informados está fora da faixa aceita.",
  "42501": "Sua sessão não tem permissão para esta operação.",
};
const LEAKS_SCHEMA = /violates|constraint |relation |column |function |type |syntax/i;

function safeMessage(code: string | undefined, message: string) {
  const replacement = code ? ENGINE_MESSAGES[code] : undefined;
  if (replacement && LEAKS_SCHEMA.test(message)) return replacement;
  if (LEAKS_SCHEMA.test(message)) return "Não foi possível concluir a operação com os dados informados.";
  return message || "Operação recusada pelo banco.";
}

async function callRpc<T>(client: SupabaseClient, name: string, args: Json): Promise<T> {
  let result = await client.rpc(name, args);
  // PostgREST can briefly reject a freshly-issued, otherwise valid Supabase
  // JWT when its clock lags Auth. Retry exactly once without weakening JWT
  // verification or retrying writes for any other database failure.
  if (result.error?.code === "PGRST303" || /jwt issued at future/i.test(result.error?.message ?? "")) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    result = await client.rpc(name, args);
  }
  const { data, error } = result;
  if (error) {
    const status = error.code === "40001" ? 409 : error.code === "23505" ? 409 : error.code === "42501" ? 403 : 400;
    throw new RequestError(safeMessage(error.code ?? undefined, error.message ?? ""), status, error.code ?? undefined);
  }
  return data as T;
}

const asRecord = (value: unknown, label: string): Json => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RequestError(`${label} inválido.`);
  return value as Json;
};

const asId = (value: unknown) => (typeof value === "string" && value.length > 0 ? value : crypto.randomUUID());
const asText = (value: unknown) => (value === undefined || value === null ? null : String(value));
const asNullableId = (value: unknown) => (typeof value === "string" && value.length > 0 ? value : null);

const PURPOSE = {
  account: { purpose: "account", table: "app_private.accounts" },
  card: { purpose: "card", table: "app_private.cards" },
  event: { purpose: "event", table: "app_private.financial_events" },
  investment: { purpose: "investment", table: "app_private.investment_assets" },
  classification: { purpose: "classification", table: "app_private.classification_rules" },
  plan: { purpose: "plan", table: "app_private.recurrence_rules" },
  planOccurrence: { purpose: "plan", table: "app_private.planned_occurrences" },
  import: { purpose: "import", table: "app_private.import_batches" },
  audit: { purpose: "audit", table: "app_private.audit_revisions" },
} as const;

type Purpose = typeof PURPOSE[keyof typeof PURPOSE];

const seal = (userId: string, scope: Purpose, rowId: string, value: unknown) =>
  encryptPayload({ userId, purpose: scope.purpose, table: scope.table, rowId, value });

async function openList(userId: string, scope: Purpose, rows: Json[] | null, rowId?: (row: Json) => string) {
  return Promise.all(
    (rows ?? []).map(async (row) => ({
      ...stripCipher(row),
      ...(await openRow(userId, scope.purpose, scope.table, row, rowId?.(row))),
    })),
  );
}

/** Occurrences are addressed by (rule, date), matching how they are written. */
const occurrenceRowId = (row: Json) => `${row.recurrence_rule_id}:${row.scheduled_for}`;

async function bootstrap(client: SupabaseClient) {
  return await callRpc<Json>(client, "finance_bootstrap", {});
}

async function writeProfile(client: SupabaseClient, body: Json) {
  await callRpc(client, "write_profile", { p_profile: asRecord(body.profile, "Perfil") });
  return { ok: true };
}

async function writeCategory(client: SupabaseClient, body: Json) {
  const command = asRecord(body.command, "Categoria");
  const rows = await callRpc<Json[]>(client, "write_category", { p_command: command });
  return rows?.[0] ?? null;
}

async function writeAccount(client: SupabaseClient, userId: string, body: Json) {
  const command = asRecord(body.command, "Conta");
  const id = asId(command.id);
  const operation = command.operation;
  const dbCommand: Json = { operation, id, expected_version: command.expectedVersion ?? null };
  if (operation !== "delete") {
    const account = asRecord(command.account, "Dados da conta");
    dbCommand.account = {
      institution_id: asNullableId(account.institutionId),
      kind: account.kind,
      currency_code: account.currencyCode,
      archived_at: account.archivedAt ?? null,
      ...(await seal(userId, PURPOSE.account, id, account.sensitive ?? {})),
    };
  }
  const rows = await callRpc<Json[]>(client, "write_account", { p_command: dbCommand });
  return rows?.[0] ?? null;
}

async function writeCard(client: SupabaseClient, userId: string, body: Json) {
  const command = asRecord(body.command, "Cartão");
  const id = asId(command.id);
  const operation = command.operation;
  const dbCommand: Json = { operation, id, expected_version: command.expectedVersion ?? null };
  if (operation !== "delete") {
    const card = asRecord(command.card, "Dados do cartão");
    dbCommand.card = {
      institution_id: asNullableId(card.institutionId),
      linked_account_id: asNullableId(card.linkedAccountId),
      payer_account_id: asNullableId(card.payerAccountId),
      kind: card.kind,
      network: card.network,
      currency_code: card.currencyCode,
      credit_limit: asText(card.creditLimit ?? "0"),
      closing_day: card.closingDay ?? 1,
      due_day: card.dueDay ?? 10,
      archived_at: card.archivedAt ?? null,
      ...(await seal(userId, PURPOSE.card, id, card.sensitive ?? {})),
    };
  }
  const rows = await callRpc<Json[]>(client, "write_card", { p_command: dbCommand });
  return rows?.[0] ?? null;
}

async function writeInvestmentAsset(client: SupabaseClient, userId: string, body: Json) {
  const command = asRecord(body.command, "Ativo");
  const id = asId(command.id);
  const operation = command.operation;
  const dbCommand: Json = {
    operation,
    id,
    holding_id: asNullableId(command.holdingId),
    expected_version: command.expectedVersion ?? null,
  };
  if (operation !== "delete") {
    const asset = asRecord(command.asset, "Dados do ativo");
    dbCommand.asset = {
      instrument_id: asNullableId(asset.instrumentId),
      asset_type_code: asset.assetTypeCode,
      currency_code: asset.currencyCode,
      custody_account_id: asNullableId(asset.custodyAccountId),
      archived_at: asset.archivedAt ?? null,
      ...(await seal(userId, PURPOSE.investment, id, asset.sensitive ?? {})),
    };
  }
  const rows = await callRpc<Json[]>(client, "write_investment_asset", { p_command: dbCommand });
  return rows?.[0] ?? null;
}

async function writeRecurrenceRule(client: SupabaseClient, userId: string, body: Json) {
  const command = asRecord(body.command, "Planejamento");
  const id = asId(command.id);
  const operation = command.operation;
  const dbCommand: Json = { operation, id, expected_version: command.expectedVersion ?? null };
  if (operation !== "delete") {
    const rule = asRecord(command.rule, "Dados do planejamento");
    dbCommand.rule = {
      category_id: asNullableId(rule.categoryId),
      account_id: asNullableId(rule.accountId),
      card_id: asNullableId(rule.cardId),
      flow: rule.flow,
      frequency: rule.frequency,
      start_date: rule.startDate,
      end_date: rule.endDate ?? null,
      occurrence_count: rule.occurrenceCount ?? null,
      amount: asText(rule.amount),
      currency_code: rule.currencyCode,
      payment_method: rule.paymentMethod,
      ...(await seal(userId, PURPOSE.plan, id, rule.sensitive ?? {})),
    };
  }
  const rows = await callRpc<Json[]>(client, "write_recurrence_rule", { p_command: dbCommand });
  return rows?.[0] ?? null;
}

async function writePlannedOccurrence(client: SupabaseClient, userId: string, body: Json) {
  const command = asRecord(body.command, "Ocorrência");
  const occurrence = asRecord(command.occurrence, "Dados da ocorrência");
  // An occurrence is upserted on (rule, date), so its row id is not stable
  // across writes. The associated data is bound to that natural key instead,
  // which is what actually identifies the occurrence.
  const id = `${occurrence.recurrenceRuleId}:${occurrence.scheduledFor}`;
  const payload: Json = {
    recurrence_rule_id: occurrence.recurrenceRuleId,
    scheduled_for: occurrence.scheduledFor,
    status: occurrence.status ?? "scheduled",
    settled_event_id: asNullableId(occurrence.settledEventId),
    effective_at: occurrence.effectiveAt ?? null,
    effective_amount: occurrence.effectiveAmount === undefined ? null : asText(occurrence.effectiveAmount),
  };
  if (occurrence.sensitive !== undefined) {
    Object.assign(payload, await seal(userId, PURPOSE.planOccurrence, id, occurrence.sensitive));
  }
  return await callRpc<string>(client, "write_planned_occurrence", {
    p_command: { operation: command.operation ?? "upsert", occurrence: payload },
  });
}

async function writeClassificationRule(client: SupabaseClient, userId: string, body: Json) {
  const command = asRecord(body.command, "Regra");
  const id = asId(command.id);
  const operation = command.operation;
  const dbCommand: Json = { operation, id };
  if (operation !== "delete") {
    const rule = asRecord(command.rule, "Dados da regra");
    // Normalizing before both the ciphertext and the HMAC keeps "Farmácia" and
    // " farmacia " from becoming two rules that never match the same statement.
    const match = typeof rule.match === "string" ? rule.match.trim().toLocaleLowerCase("pt-BR") : "";
    if (!match) throw new RequestError("Texto da regra ausente.");
    dbCommand.rule = {
      category_id: rule.categoryId,
      flow: rule.flow,
      match_hmac_b64: await hmac(userId, "classification-match", match),
      ...(await seal(userId, PURPOSE.classification, id, { match })),
    };
  }
  const rows = await callRpc<Json[]>(client, "write_classification_rule", { p_command: dbCommand });
  return rows?.[0] ?? null;
}

async function writeImportBatch(client: SupabaseClient, userId: string, body: Json) {
  const command = asRecord(body.command, "Importação");
  const id = asId(command.id);
  const operation = command.operation ?? "create";
  const dbCommand: Json = { operation, id };
  if (operation !== "delete") {
    const batch = asRecord(command.batch, "Dados da importação");
    if (typeof batch.fingerprint !== "string" || batch.fingerprint.length === 0) {
      throw new RequestError("Impressão digital da importação ausente.");
    }
    // Only the batch, its period and a keyed fingerprint are kept. The file,
    // the PDF, the spreadsheet and the extracted text never reach the database.
    dbCommand.batch = {
      kind: batch.kind,
      fingerprint_hmac_b64: await hmac(userId, "import-fingerprint", batch.fingerprint),
      period_start: batch.periodStart ?? null,
      period_end: batch.periodEnd ?? null,
      ...(await seal(userId, PURPOSE.import, id, batch.sensitive ?? {})),
    };
  }
  const rows = await callRpc<Json[]>(client, "write_import_batch", { p_command: dbCommand });
  return rows?.[0] ?? null;
}

async function importBatchExists(client: SupabaseClient, userId: string, body: Json) {
  const fingerprint = body.fingerprint;
  if (typeof fingerprint !== "string" || !fingerprint) throw new RequestError("Impressão digital ausente.");
  const id = await callRpc<string | null>(client, "import_batch_exists", {
    p_fingerprint_hmac_b64: await hmac(userId, "import-fingerprint", fingerprint),
  });
  return { batchId: id ?? null };
}

async function listEvents(client: SupabaseClient, userId: string, body: Json) {
  const rows = await callRpc<Json[]>(client, "list_financial_events", {
    p_limit: typeof body.limit === "number" ? body.limit : 1000,
    p_before: typeof body.before === "string" ? body.before : null,
    p_since: typeof body.since === "string" ? body.since : null,
  });
  return openList(userId, PURPOSE.event, rows);
}

async function writeCashEvent(client: SupabaseClient, userId: string, body: Json) {
  const command = asRecord(body.command, "Lançamento");
  const id = asId(command.id);
  const operation = command.operation ?? "create";
  const dbCommand: Json = { operation, id, expected_version: command.expectedVersion ?? null };
  if (operation !== "delete") {
    const event = asRecord(command.event, "Dados do lançamento");
    dbCommand.event = {
      kind: event.kind,
      source: event.source ?? "manual",
      occurred_at: event.occurredAt,
      amount: asText(event.amount),
      account_id: event.accountId,
      counterpart_account_id: asNullableId(event.counterpartAccountId),
      category_id: asNullableId(event.categoryId),
      import_batch_id: asNullableId(event.importBatchId),
      increases_balance: event.increasesBalance ?? true,
      ...(await seal(userId, PURPOSE.event, id, event.sensitive ?? {})),
    };
  }
  const rows = await callRpc<Json[]>(client, "write_cash_event", { p_command: dbCommand });
  return rows?.[0] ?? null;
}

async function writeEvent(client: SupabaseClient, userId: string, body: Json) {
  const command = asRecord(body.command, "Comando");
  const operation = command.operation;
  if (operation !== "create" && operation !== "update" && operation !== "delete") {
    throw new RequestError("Operação inválida.");
  }
  // The id is minted here and sent to the database, so the id bound into the
  // associated data is the id the row is actually stored under.
  const id = asId(command.id);
  const dbCommand: Json = { operation, id, expected_version: command.expectedVersion ?? null };
  if (operation !== "delete") {
    const event = asRecord(command.event, "Evento");
    dbCommand.event = {
      kind: event.kind,
      occurred_at: event.occurredAt,
      category_id: asNullableId(event.categoryId),
      import_batch_id: asNullableId(event.importBatchId),
      source: event.source,
      ...(await seal(userId, PURPOSE.event, id, event.sensitive ?? {})),
    };
    dbCommand.postings = (Array.isArray(command.postings) ? command.postings : []).map((entry) => {
      const posting = asRecord(entry, "Partida");
      return {
        ledger_account_id: posting.ledgerAccountId,
        amount: asText(posting.amount),
        currency_code: posting.currencyCode,
        operation_fx_rate_id: asNullableId(posting.operationFxRateId),
      };
    });
  }
  if (command.audit !== undefined) {
    dbCommand.audit = await seal(userId, PURPOSE.audit, id, command.audit);
  }
  const rows = await callRpc<Json[]>(client, "write_financial_event", { p_command: dbCommand });
  return rows?.[0] ?? null;
}

async function writeCardTransaction(client: SupabaseClient, userId: string, body: Json) {
  const command = asRecord(body.command, "Lançamento de cartão");
  const event = asRecord(command.event, "Dados do lançamento");
  const installments = Number(command.installments ?? 1);
  if (!Number.isInteger(installments) || installments < 1 || installments > 360) {
    throw new RequestError("Número de parcelas inválido.");
  }
  // Every installment is its own row, so every installment gets its own id,
  // its own nonce and its own associated data.
  const installmentEvents = await Promise.all(
    Array.from({ length: installments }, async () => {
      const id = crypto.randomUUID();
      return { id, ...(await seal(userId, PURPOSE.event, id, event.sensitive ?? {})) };
    }),
  );
  return await callRpc<Json>(client, "write_card_transaction", {
    p_command: {
      card_id: command.cardId,
      kind: command.kind ?? "purchase",
      amount: asText(command.amount),
      installments,
      occurred_at: command.occurredAt,
      first_invoice_month: command.firstInvoiceMonth ?? null,
      installment_events: installmentEvents,
      event: {
        source: event.source ?? "manual",
        category_id: asNullableId(event.categoryId),
        import_batch_id: asNullableId(event.importBatchId),
      },
    },
  });
}

async function payCardInvoice(client: SupabaseClient, userId: string, body: Json) {
  const command = asRecord(body.command, "Pagamento de fatura");
  const event = asRecord(command.event ?? {}, "Dados do pagamento");
  const id = asId(command.eventId);
  return await callRpc<string>(client, "pay_card_invoice", {
    p_command: {
      event_id: id,
      card_id: command.cardId,
      account_id: command.accountId,
      amount: asText(command.amount),
      occurred_at: command.occurredAt,
      event: { source: event.source ?? "manual", ...(await seal(userId, PURPOSE.event, id, event.sensitive ?? {})) },
    },
  });
}

async function writeInvestmentOperation(client: SupabaseClient, userId: string, body: Json) {
  const command = asRecord(body.command, "Operação de investimento");
  const event = asRecord(command.event ?? {}, "Dados da operação");
  const operation = command.operation;
  const eventId = asId(command.eventId);
  const dbCommand: Json = {
    operation,
    event_id: eventId,
    holding_id: command.holdingId,
    destination_holding_id: asNullableId(command.destinationHoldingId),
    cash_account_id: asNullableId(command.cashAccountId),
    traded_at: command.tradedAt,
    settled_at: command.settledAt ?? null,
    quantity: command.quantity === undefined ? null : asText(command.quantity),
    unit_price: command.unitPrice === undefined ? null : asText(command.unitPrice),
    principal_amount: command.principalAmount === undefined ? null : asText(command.principalAmount),
    income_amount: command.incomeAmount === undefined ? null : asText(command.incomeAmount),
    gross_amount: command.grossAmount === undefined ? null : asText(command.grossAmount),
    withheld_tax: command.withheldTax === undefined ? null : asText(command.withheldTax),
    income_kind: command.incomeKind ?? "yield",
    payment_date: command.paymentDate ?? null,
    ex_date: command.exDate ?? null,
    record_date: command.recordDate ?? null,
    reinvest: command.reinvest ?? false,
    charges: Array.isArray(command.charges)
      ? command.charges.map((entry) => {
        const charge = asRecord(entry, "Custo");
        return { kind: charge.kind ?? "other", amount: asText(charge.amount) };
      })
      : [],
    event: {
      source: event.source ?? "manual",
      category_id: asNullableId(event.categoryId),
      import_batch_id: asNullableId(event.importBatchId),
      ...(await seal(userId, PURPOSE.event, eventId, event.sensitive ?? {})),
    },
  };
  if (operation === "transfer") {
    const pairedId = asId(command.pairedEventId);
    dbCommand.paired_event_id = pairedId;
    dbCommand.paired_event = await seal(userId, PURPOSE.event, pairedId, event.sensitive ?? {});
  }
  return await callRpc<Json>(client, "write_investment_operation", { p_command: dbCommand });
}

/**
 * One round trip built from the same explicit projections as the individual
 * lists. It is a fan-out over named contracts, not a `select *` of everything
 * the user owns.
 */
async function snapshot(client: SupabaseClient, userId: string, body: Json) {
  const [
    bootstrapData,
    accounts,
    cards,
    assets,
    positions,
    classificationRules,
    recurrenceRules,
    plannedOccurrences,
    importBatches,
    fxRates,
    events,
  ] = await Promise.all([
    bootstrap(client),
    callRpc<Json[]>(client, "list_accounts", {}).then((rows) => openList(userId, PURPOSE.account, rows)),
    callRpc<Json[]>(client, "list_cards", {}).then((rows) => openList(userId, PURPOSE.card, rows)),
    callRpc<Json[]>(client, "list_investment_assets", {}).then((rows) => openList(userId, PURPOSE.investment, rows)),
    callRpc<Json[]>(client, "investment_positions", {}),
    callRpc<Json[]>(client, "list_classification_rules", {}).then((rows) =>
      openList(userId, PURPOSE.classification, rows)
    ),
    callRpc<Json[]>(client, "list_recurrence_rules", {}).then((rows) => openList(userId, PURPOSE.plan, rows)),
    callRpc<Json[]>(client, "list_planned_occurrences", {}).then((rows) =>
      openList(userId, PURPOSE.planOccurrence, rows, occurrenceRowId)
    ),
    callRpc<Json[]>(client, "list_import_batches", {}).then((rows) => openList(userId, PURPOSE.import, rows)),
    callRpc<Json[]>(client, "list_fx_rates", {}),
    listEvents(client, userId, body),
  ]);
  return {
    ...bootstrapData,
    accounts,
    cards,
    investment_assets: assets,
    investment_positions: positions,
    classification_rules: classificationRules,
    recurrence_rules: recurrenceRules,
    planned_occurrences: plannedOccurrences,
    import_batches: importBatches,
    fx_rates: fxRates,
    events,
  };
}

const actions: Record<string, (client: SupabaseClient, userId: string, body: Json) => Promise<unknown>> = {
  "snapshot": snapshot,
  "bootstrap": (client) => bootstrap(client),
  "write-profile": (client, _userId, body) => writeProfile(client, body),
  "write-category": (client, _userId, body) => writeCategory(client, body),

  "write-account": writeAccount,
  "list-accounts": async (client, userId) =>
    openList(userId, PURPOSE.account, await callRpc<Json[]>(client, "list_accounts", {})),

  "write-card": writeCard,
  "list-cards": async (client, userId) => openList(userId, PURPOSE.card, await callRpc<Json[]>(client, "list_cards", {})),

  "write-investment-asset": writeInvestmentAsset,
  "list-investment-assets": async (client, userId) =>
    openList(userId, PURPOSE.investment, await callRpc<Json[]>(client, "list_investment_assets", {})),

  "write-recurrence-rule": writeRecurrenceRule,
  "list-recurrence-rules": async (client, userId) =>
    openList(userId, PURPOSE.plan, await callRpc<Json[]>(client, "list_recurrence_rules", {})),

  "write-planned-occurrence": writePlannedOccurrence,
  "list-planned-occurrences": async (client, userId) =>
    openList(userId, PURPOSE.planOccurrence, await callRpc<Json[]>(client, "list_planned_occurrences", {}), occurrenceRowId),

  "write-classification-rule": writeClassificationRule,
  "list-classification-rules": async (client, userId) =>
    openList(userId, PURPOSE.classification, await callRpc<Json[]>(client, "list_classification_rules", {})),

  "write-import-batch": writeImportBatch,
  "list-import-batches": async (client, userId) =>
    openList(userId, PURPOSE.import, await callRpc<Json[]>(client, "list_import_batches", {})),
  "import-batch-exists": (client, userId, body) => importBatchExists(client, userId, body),

  "list-events": listEvents,
  "write-event": writeEvent,
  "write-cash-event": writeCashEvent,

  "write-card-transaction": writeCardTransaction,
  "pay-card-invoice": payCardInvoice,
  "card-invoices": (client) => callRpc(client, "card_invoices", {}),

  "write-investment-operation": writeInvestmentOperation,
  "delete-investment-operation": (client, _userId, body) =>
    callRpc(client, "delete_investment_operation", { p_event_id: body.eventId }),
  "investment-positions": (client) => callRpc(client, "investment_positions", {}),
  "write-asset-quote": (client, _userId, body) =>
    callRpc(client, "write_asset_quote", {
      p_command: {
        asset_id: asRecord(body.command, "Cotação").assetId,
        unit_price: asText(asRecord(body.command, "Cotação").unitPrice),
        observed_at: asRecord(body.command, "Cotação").observedAt ?? null,
      },
    }),

  "account-balances": (client) => callRpc(client, "account_balances", {}),
  "card-balances": (client) => callRpc(client, "card_balances", {}),

  "list-fx-rates": (client) => callRpc(client, "list_fx_rates", {}),
  "write-fx-rate": (client, _userId, body) => {
    const command = asRecord(body.command, "Cotação");
    return callRpc(client, "write_fx_rate", {
      p_command: {
        base_currency_code: command.baseCurrencyCode,
        quote_currency_code: command.quoteCurrencyCode,
        rate: asText(command.rate),
        observed_at: command.observedAt ?? null,
        source: command.source ?? "manual",
      },
    });
  },
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);
  try {
    const body = (await request.json()) as Json;
    const action = typeof body.action === "string" ? body.action : "";
    const handler = actions[action];
    if (!handler) return json({ error: "Ação inválida." }, 400);
    const { client, userId } = await authenticatedClient(request);
    return json({ data: await handler(client, userId, body) });
  } catch (error) {
    if (error instanceof RequestError) {
      // Only the message this function authored, never a payload or a key.
      console.error("finance-v2 rejected", error.code ?? "", error.message);
      return json({ error: error.message, code: error.code }, error.status);
    }
    console.error("finance-v2 failed", error instanceof Error ? error.name : "unknown");
    return json({ error: "Não foi possível processar a operação financeira." }, 400);
  }
});
