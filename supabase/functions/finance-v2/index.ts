import { createClient } from "npm:@supabase/supabase-js@2";

type CipherEnvelope = {
  sensitive_payload_b64: string;
  encryption_nonce_b64: string;
  encryption_key_version: number;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
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

async function deriveKey(userId: string, purpose: string, keyVersion: number, usage: KeyUsage[]) {
  const root = Deno.env.get(`DATA_ROOT_KEY_V${keyVersion}`);
  if (!root) throw new Error(`Chave de dados V${keyVersion} indisponível.`);
  const rootKey = await crypto.subtle.importKey("raw", fromBase64(root), "HKDF", false, ["deriveKey"]);
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
  const root = Deno.env.get(`DATA_ROOT_KEY_V${version}`);
  if (!root) throw new Error(`Chave de dados V${version} indisponível.`);
  const rootKey = await crypto.subtle.importKey("raw", fromBase64(root), "HKDF", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: encoder.encode(userId), info: encoder.encode(`kreature:finance-v2:${purpose}:v${version}`) }, rootKey, { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign"]);
  return toBase64(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

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
  const plaintext = encoder.encode(JSON.stringify(input.value));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: aad(input.userId, input.table, input.rowId, "sensitive_payload", encryption_key_version) },
    key,
    plaintext,
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
      additionalData: aad(input.userId, input.table, input.rowId, "sensitive_payload", input.envelope.encryption_key_version),
    },
    key,
    fromBase64(input.envelope.sensitive_payload_b64),
  );
  return JSON.parse(decoder.decode(plaintext));
}

async function authenticatedClient(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) throw new Error("Sessão ausente.");
  const url = Deno.env.get("SUPABASE_URL");
  const publishable = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !publishable) throw new Error("Configuração Supabase ausente.");
  const client = createClient(url, publishable, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error("Sessão inválida.");
  return { client, userId: data.user.id };
}

async function listEvents(client: ReturnType<typeof createClient>, userId: string, body: Record<string, unknown>) {
  const limit = typeof body.limit === "number" ? body.limit : 100;
  const before = typeof body.before === "string" ? body.before : null;
  const { data, error } = await client.rpc("list_financial_events", { p_limit: limit, p_before: before });
  if (error) throw error;
  return Promise.all((data ?? []).map(async (row) => ({
    id: row.id,
    version: row.version,
    kind: row.kind,
    categoryId: row.category_id,
    occurredAt: row.occurred_at,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sensitive: await decryptPayload({
      userId,
      purpose: "event",
      table: "app_private.financial_events",
      rowId: row.id,
      envelope: {
        sensitive_payload_b64: row.sensitive_payload_b64,
        encryption_nonce_b64: row.encryption_nonce_b64,
        encryption_key_version: row.encryption_key_version,
      },
    }),
  })));
}

async function writeEvent(client: ReturnType<typeof createClient>, userId: string, body: Record<string, unknown>) {
  const command = body.command;
  if (!command || typeof command !== "object" || Array.isArray(command)) throw new Error("Comando inválido.");
  const raw = command as Record<string, unknown>;
  const operation = raw.operation;
  if (operation !== "create" && operation !== "update" && operation !== "delete") throw new Error("Operação inválida.");
  const event = raw.event;
  const id = typeof raw.id === "string" ? raw.id : crypto.randomUUID();
  const eventPayload = event && typeof event === "object" && !Array.isArray(event) ? event as Record<string, unknown> : undefined;
  const sensitive = eventPayload?.sensitive;
  const encryptedEvent = operation === "delete" ? undefined : await encryptPayload({
    userId,
    purpose: "event",
    table: "app_private.financial_events",
    rowId: id,
    value: sensitive ?? {},
  });

  const audit = raw.audit;
  const encryptedAudit = audit === undefined ? undefined : await encryptPayload({
    userId,
    purpose: "audit",
    table: "app_private.audit_revisions",
    rowId: id,
    value: audit,
  });

  const dbCommand = {
    operation,
    ...(operation === "create" ? {} : { id, expected_version: raw.expectedVersion }),
    ...(eventPayload && encryptedEvent ? {
      event: {
        kind: eventPayload.kind,
        occurred_at: eventPayload.occurredAt,
        category_id: eventPayload.categoryId ?? null,
        import_batch_id: eventPayload.importBatchId ?? null,
        source: eventPayload.source,
        ...encryptedEvent,
      },
      postings: raw.postings,
    } : {}),
    ...(encryptedAudit ? { audit: encryptedAudit } : {}),
  };
  const { data, error } = await client.rpc("write_financial_event", { p_command: dbCommand });
  if (error) throw error;
  return data?.[0] ?? null;
}

async function bootstrap(client: ReturnType<typeof createClient>) {
  const { data, error } = await client.rpc("finance_bootstrap");
  if (error) throw error;
  return data ?? {};
}

async function writeProfile(client: ReturnType<typeof createClient>, body: Record<string, unknown>) {
  const profile = body.profile;
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) throw new Error("Perfil inválido.");
  const { error } = await client.rpc("write_profile", { p_profile: profile });
  if (error) throw error;
  return { ok: true };
}

async function writeCategory(client: ReturnType<typeof createClient>, body: Record<string, unknown>) {
  const command = body.command;
  if (!command || typeof command !== "object" || Array.isArray(command)) throw new Error("Categoria inválida.");
  const { data, error } = await client.rpc("write_category", { p_command: command });
  if (error) throw error;
  return data?.[0] ?? null;
}

async function writeAccount(client: ReturnType<typeof createClient>, userId: string, body: Record<string, unknown>) {
  const raw = body.command;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Conta inválida.");
  const command = raw as Record<string, unknown>;
  const account = command.account;
  if (!account || typeof account !== "object" || Array.isArray(account)) throw new Error("Dados da conta ausentes.");
  const id = typeof command.id === "string" ? command.id : crypto.randomUUID();
  const encrypted = await encryptPayload({ userId, purpose: "account", table: "app_private.accounts", rowId: id, value: (account as Record<string, unknown>).sensitive ?? {} });
  const input = account as Record<string, unknown>;
  const dbCommand = {
    ...command,
    id,
    account: { institution_id: input.institutionId ?? null, kind: input.kind, currency_code: input.currencyCode, archived_at: input.archivedAt ?? null, ...encrypted },
  };
  const { data, error } = await client.rpc("write_account", { p_command: dbCommand });
  if (error) throw error;
  return data?.[0] ?? null;
}

async function listAccounts(client: ReturnType<typeof createClient>, userId: string) {
  const { data, error } = await client.rpc("list_accounts");
  if (error) throw error;
  return Promise.all((data ?? []).map(async (row) => ({
    id: row.id, version: row.version, institutionId: row.institution_id, ledgerAccountId: row.ledger_account_id,
    kind: row.kind, currencyCode: row.currency_code, archivedAt: row.archived_at, createdAt: row.created_at, updatedAt: row.updated_at,
    sensitive: await decryptPayload({ userId, purpose: "account", table: "app_private.accounts", rowId: row.id, envelope: { sensitive_payload_b64: row.sensitive_payload_b64, encryption_nonce_b64: row.encryption_nonce_b64, encryption_key_version: row.encryption_key_version } }),
  })));
}

async function writeCard(client: ReturnType<typeof createClient>, userId: string, body: Record<string, unknown>) {
  const raw = body.command;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Cartão inválido.");
  const command = raw as Record<string, unknown>;
  const card = command.card;
  if (!card || typeof card !== "object" || Array.isArray(card)) throw new Error("Dados do cartão ausentes.");
  const id = typeof command.id === "string" ? command.id : crypto.randomUUID();
  const encrypted = await encryptPayload({ userId, purpose: "card", table: "app_private.cards", rowId: id, value: (card as Record<string, unknown>).sensitive ?? {} });
  const input = card as Record<string, unknown>;
  const dbCard = { institution_id: input.institutionId ?? null, linked_account_id: input.linkedAccountId ?? null, payer_account_id: input.payerAccountId ?? null, kind: input.kind, network: input.network, currency_code: input.currencyCode, credit_limit: input.creditLimit, closing_day: input.closingDay, due_day: input.dueDay, archived_at: input.archivedAt ?? null, ...encrypted };
  const { data, error } = await client.rpc("write_card", { p_command: { ...command, id, card: dbCard } });
  if (error) throw error;
  return data?.[0] ?? null;
}

async function writeInvestmentAsset(client: ReturnType<typeof createClient>, userId: string, body: Record<string, unknown>) {
  const raw = body.command;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Ativo inválido.");
  const command = raw as Record<string, unknown>;
  const asset = command.asset;
  if (!asset || typeof asset !== "object" || Array.isArray(asset)) throw new Error("Dados do ativo ausentes.");
  const id = typeof command.id === "string" ? command.id : crypto.randomUUID();
  const input = asset as Record<string, unknown>;
  const encrypted = await encryptPayload({ userId, purpose: "investment", table: "app_private.investment_assets", rowId: id, value: input.sensitive ?? {} });
  const dbAsset = { instrument_id: input.instrumentId ?? null, asset_type_code: input.assetTypeCode, currency_code: input.currencyCode, custody_account_id: input.custodyAccountId, archived_at: input.archivedAt ?? null, ...encrypted };
  const { data, error } = await client.rpc("write_investment_asset", { p_command: { ...command, id, holding_id: command.holdingId, asset: dbAsset } });
  if (error) throw error;
  return data?.[0] ?? null;
}

async function writeRecurrenceRule(client: ReturnType<typeof createClient>, userId: string, body: Record<string, unknown>) {
  const raw = body.command;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Planejamento inválido.");
  const command = raw as Record<string, unknown>;
  const rule = command.rule;
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) throw new Error("Dados do planejamento ausentes.");
  const id = typeof command.id === "string" ? command.id : crypto.randomUUID();
  const input = rule as Record<string, unknown>;
  const encrypted = await encryptPayload({ userId, purpose: "plan", table: "app_private.recurrence_rules", rowId: id, value: input.sensitive ?? {} });
  const dbRule = { category_id: input.categoryId ?? null, account_id: input.accountId ?? null, card_id: input.cardId ?? null, flow: input.flow, frequency: input.frequency, start_date: input.startDate, end_date: input.endDate ?? null, occurrence_count: input.occurrenceCount ?? null, amount: input.amount, currency_code: input.currencyCode, payment_method: input.paymentMethod, ...encrypted };
  const { data, error } = await client.rpc("write_recurrence_rule", { p_command: { ...command, id, rule: dbRule } });
  if (error) throw error;
  return data?.[0] ?? null;
}

async function writeClassificationRule(client: ReturnType<typeof createClient>, userId: string, body: Record<string, unknown>) {
  const raw = body.command;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Regra inválida.");
  const command = raw as Record<string, unknown>; const rule = command.rule;
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) throw new Error("Dados da regra ausentes.");
  const input = rule as Record<string, unknown>; const id = typeof command.id === "string" ? command.id : crypto.randomUUID();
  const match = typeof input.match === "string" ? input.match.trim().toLocaleLowerCase("pt-BR") : "";
  if (!match) throw new Error("Texto da regra ausente.");
  const encrypted = await encryptPayload({ userId, purpose: "classification", table: "app_private.classification_rules", rowId: id, value: { match } });
  const dbRule = { category_id: input.categoryId, flow: input.flow, match_hmac_b64: await hmac(userId, "classification-match", match), ...encrypted };
  const { data, error } = await client.rpc("write_classification_rule", { p_command: { ...command, id, rule: dbRule } });
  if (error) throw error;
  return data?.[0] ?? null;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);
  try {
    const body = await request.json() as Record<string, unknown>;
    const { client, userId } = await authenticatedClient(request);
    switch (body.action) {
      case "bootstrap": return json({ data: await bootstrap(client) });
      case "write-profile": return json({ data: await writeProfile(client, body) });
      case "write-category": return json({ data: await writeCategory(client, body) });
      case "write-account": return json({ data: await writeAccount(client, userId, body) });
      case "list-accounts": return json({ data: await listAccounts(client, userId) });
      case "write-card": return json({ data: await writeCard(client, userId, body) });
      case "write-investment-asset": return json({ data: await writeInvestmentAsset(client, userId, body) });
      case "write-recurrence-rule": return json({ data: await writeRecurrenceRule(client, userId, body) });
      case "write-classification-rule": return json({ data: await writeClassificationRule(client, userId, body) });
      case "list-events": return json({ data: await listEvents(client, userId, body) });
      case "write-event": return json({ data: await writeEvent(client, userId, body) });
      default: return json({ error: "Ação inválida." }, 400);
    }
  } catch (error) {
    console.error("finance-v2 request failed", error instanceof Error ? error.message : "unknown error");
    return json({ error: "Não foi possível processar a operação financeira." }, 400);
  }
});
