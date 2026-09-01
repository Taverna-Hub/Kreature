-- Cards, imports and planning had write paths for their catalog rows but no
-- atomic path for the facts themselves. A card purchase, an invoice payment and
-- a settled plan are each one balanced event, written in one transaction.

-- Importing twice must be a no-op, so the fingerprint decides rather than the
-- caller. Only the HMAC, the period and the encrypted metadata are kept: the
-- file, the PDF, the spreadsheet and the extracted text are never stored.
drop function if exists api.write_import_batch(jsonb);

create or replace function api.write_import_batch(p_command jsonb)
returns table (batch_id uuid, created boolean)
language plpgsql security invoker set search_path = '' as $$
declare
  caller_id uuid := auth.uid();
  operation text := p_command ->> 'operation';
  payload jsonb := p_command -> 'batch';
  requested uuid := nullif(p_command ->> 'id', '')::uuid;
  fingerprint bytea;
  existing uuid;
begin
  if caller_id is null then raise exception 'Sessão inválida.' using errcode = '42501'; end if;
  if operation not in ('create', 'delete') then
    raise exception 'Operação de importação inválida.' using errcode = '22023';
  end if;

  if operation = 'delete' then
    if requested is null then raise exception 'ID do lote obrigatório.' using errcode = '22023'; end if;
    delete from app_private.import_batches where id = requested and user_id = caller_id;
    if not found then raise exception 'Lote inexistente.' using errcode = 'P0002'; end if;
    return query select requested, false;
    return;
  end if;

  fingerprint := decode(payload ->> 'fingerprint_hmac_b64', 'base64');
  if fingerprint is null or octet_length(fingerprint) = 0 then
    raise exception 'Impressão digital do lote é obrigatória.' using errcode = '22023';
  end if;

  select batch.id into existing
  from app_private.import_batches as batch
  where batch.user_id = caller_id and batch.fingerprint_hmac = fingerprint;
  if existing is not null then
    return query select existing, false;
    return;
  end if;

  requested := coalesce(requested, gen_random_uuid());
  insert into app_private.import_batches (
    id, user_id, kind, fingerprint_hmac, sensitive_payload, encryption_nonce, encryption_key_version, period_start, period_end
  ) values (
    requested, caller_id, payload ->> 'kind', fingerprint,
    decode(payload ->> 'sensitive_payload_b64', 'base64'),
    decode(payload ->> 'encryption_nonce_b64', 'base64'),
    (payload ->> 'encryption_key_version')::smallint,
    nullif(payload ->> 'period_start', '')::date,
    nullif(payload ->> 'period_end', '')::date
  );
  return query select requested, true;
end;
$$;

-- A purchase split in N installments is N invoice-month facts, not one row the
-- reader has to expand. Each installment balances on its own.
create or replace function api.write_card_transaction(p_command jsonb)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  caller_id uuid := auth.uid();
  event_data jsonb := p_command -> 'event';
  target_card_id uuid := nullif(p_command ->> 'card_id', '')::uuid;
  transaction_kind text := coalesce(p_command ->> 'kind', 'purchase');
  total_amount numeric := nullif(p_command ->> 'amount', '')::numeric;
  installments smallint := coalesce(nullif(p_command ->> 'installments', '')::smallint, 1);
  occurred_at timestamptz := coalesce(nullif(p_command ->> 'occurred_at', '')::timestamptz, now());
  source_text text := coalesce(event_data ->> 'source', 'manual');
  first_invoice_month date := nullif(p_command ->> 'first_invoice_month', '')::date;
  installment_events jsonb := coalesce(p_command -> 'installment_events', '[]'::jsonb);
  installment_event jsonb;
  card record;
  expense_ledger uuid;
  installment_amount numeric;
  allocated numeric := 0;
  signed_amount numeric;
  event_id uuid;
  created_ids uuid[] := array[]::uuid[];
begin
  if caller_id is null then raise exception 'Sessão inválida.' using errcode = '42501'; end if;
  if transaction_kind not in ('purchase', 'refund', 'fee', 'interest') then
    raise exception 'Tipo de lançamento de cartão inválido.' using errcode = '22023';
  end if;
  if total_amount is null or total_amount <= 0 then
    raise exception 'Valor do lançamento do cartão deve ser maior que zero.' using errcode = '22023';
  end if;
  if installments < 1 or installments > 360 then
    raise exception 'Número de parcelas inválido.' using errcode = '22023';
  end if;
  -- Each installment is its own row, so each needs its own envelope bound to
  -- its own id. A short list would silently reuse one nonce.
  if jsonb_array_length(installment_events) <> installments then
    raise exception 'Cada parcela exige o próprio envelope cifrado.' using errcode = '22023';
  end if;
  if source_text not in ('manual', 'import', 'planned') then
    raise exception 'Origem de lançamento não permitida ao cliente.' using errcode = '42501';
  end if;

  select cards.id, cards.currency_code, cards.kind, terms.liability_ledger_account_id, terms.closing_day
    into card
  from app_private.cards as cards
  left join app_private.credit_card_terms as terms
    on terms.card_id = cards.id and terms.user_id = cards.user_id
  where cards.id = target_card_id and cards.user_id = caller_id and cards.archived_at is null;
  if not found then raise exception 'Cartão inexistente ou arquivado.' using errcode = '23503'; end if;
  if card.liability_ledger_account_id is null then
    raise exception 'Somente cartão de crédito acumula fatura.' using errcode = '22023';
  end if;

  if first_invoice_month is null then
    first_invoice_month := date_trunc('month',
      case when extract(day from occurred_at)::smallint > coalesce(card.closing_day, 1)
        then occurred_at + interval '1 month'
        else occurred_at
      end)::date;
  end if;

  expense_ledger := app_private.system_ledger_account(caller_id, 'expense', card.currency_code);

  for installment_index in 1..installments loop
    if installment_index = installments then
      installment_amount := total_amount - allocated;
    else
      installment_amount := round(total_amount / installments, 2);
      allocated := allocated + installment_amount;
    end if;
    if installment_amount <= 0 then continue; end if;

    installment_event := installment_events -> (installment_index - 1);
    event_id := coalesce(nullif(installment_event ->> 'id', '')::uuid, gen_random_uuid());

    insert into app_private.financial_events (
      id, user_id, kind, category_id, import_batch_id, occurred_at,
      sensitive_payload, encryption_nonce, encryption_key_version, source
    ) values (
      event_id, caller_id, 'card_transaction', nullif(event_data ->> 'category_id', '')::uuid,
      nullif(event_data ->> 'import_batch_id', '')::uuid, occurred_at,
      decode(installment_event ->> 'sensitive_payload_b64', 'base64'),
      decode(installment_event ->> 'encryption_nonce_b64', 'base64'),
      (installment_event ->> 'encryption_key_version')::smallint,
      source_text
    );

    insert into app_private.card_transactions (
      event_id, user_id, card_id, kind, installment_number, total_installments, first_invoice_month
    ) values (
      event_id, caller_id, card.id, transaction_kind::app_private.card_transaction_kind,
      installment_index, installments, first_invoice_month
    );

    -- A refund gives limit back, so it reverses the sign of a purchase.
    signed_amount := case when transaction_kind = 'refund' then -installment_amount else installment_amount end;
    insert into app_private.ledger_postings (user_id, event_id, ledger_account_id, amount, currency_code)
    values (caller_id, event_id, expense_ledger, signed_amount, card.currency_code),
           (caller_id, event_id, card.liability_ledger_account_id, -signed_amount, card.currency_code);

    created_ids := created_ids || event_id;
  end loop;

  return jsonb_build_object('event_ids', to_jsonb(created_ids), 'first_invoice_month', first_invoice_month);
end;
$$;

-- Paying the invoice moves cash to the liability. It never touches the
-- purchases, so a reopened invoice stays auditable.
create or replace function api.pay_card_invoice(p_command jsonb)
returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  caller_id uuid := auth.uid();
  event_data jsonb := p_command -> 'event';
  target_card_id uuid := nullif(p_command ->> 'card_id', '')::uuid;
  settlement_account_id uuid := nullif(p_command ->> 'account_id', '')::uuid;
  amount numeric := nullif(p_command ->> 'amount', '')::numeric;
  occurred_at timestamptz := coalesce(nullif(p_command ->> 'occurred_at', '')::timestamptz, now());
  card record;
  cash_ledger uuid;
  cash_currency text;
  event_id uuid;
begin
  if caller_id is null then raise exception 'Sessão inválida.' using errcode = '42501'; end if;
  if amount is null or amount <= 0 then
    raise exception 'Valor da fatura deve ser maior que zero.' using errcode = '22023';
  end if;

  select cards.currency_code, terms.liability_ledger_account_id into card
  from app_private.cards as cards
  join app_private.credit_card_terms as terms
    on terms.card_id = cards.id and terms.user_id = cards.user_id
  where cards.id = target_card_id and cards.user_id = caller_id;
  if not found then raise exception 'Cartão de crédito inexistente.' using errcode = '23503'; end if;

  select accounts.ledger_account_id, accounts.currency_code into cash_ledger, cash_currency
  from app_private.accounts as accounts
  where accounts.id = settlement_account_id and accounts.user_id = caller_id and accounts.archived_at is null;
  if not found then raise exception 'Conta pagadora inexistente ou arquivada.' using errcode = '23503'; end if;
  if cash_currency <> card.currency_code then
    raise exception 'Pagamento em moeda diferente da fatura exige câmbio explícito.' using errcode = '22023';
  end if;

  event_id := coalesce(nullif(p_command ->> 'event_id', '')::uuid, gen_random_uuid());
  insert into app_private.financial_events (
    id, user_id, kind, occurred_at, sensitive_payload, encryption_nonce, encryption_key_version, source
  ) values (
    event_id, caller_id, 'credit_card_payment', occurred_at,
    decode(event_data ->> 'sensitive_payload_b64', 'base64'),
    decode(event_data ->> 'encryption_nonce_b64', 'base64'),
    (event_data ->> 'encryption_key_version')::smallint,
    coalesce(event_data ->> 'source', 'manual')
  );

  insert into app_private.ledger_postings (user_id, event_id, ledger_account_id, amount, currency_code)
  values (caller_id, event_id, card.liability_ledger_account_id, amount, card.currency_code),
         (caller_id, event_id, cash_ledger, -amount, card.currency_code);

  return event_id;
end;
$$;

create or replace function api.write_planned_occurrence(p_command jsonb)
returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  caller_id uuid := auth.uid();
  operation text := p_command ->> 'operation';
  payload jsonb := p_command -> 'occurrence';
  rule_id uuid := nullif(payload ->> 'recurrence_rule_id', '')::uuid;
  target_scheduled_for date := nullif(payload ->> 'scheduled_for', '')::date;
  occurrence_id uuid;
begin
  if caller_id is null then raise exception 'Sessão inválida.' using errcode = '42501'; end if;
  if operation not in ('upsert', 'delete') then
    raise exception 'Operação de ocorrência inválida.' using errcode = '22023';
  end if;

  if operation = 'delete' then
    delete from app_private.planned_occurrences
    where user_id = caller_id and recurrence_rule_id = rule_id and planned_occurrences.scheduled_for = target_scheduled_for
    returning id into occurrence_id;
    if occurrence_id is null then raise exception 'Ocorrência inexistente.' using errcode = 'P0002'; end if;
    return occurrence_id;
  end if;

  insert into app_private.planned_occurrences (
    user_id, recurrence_rule_id, scheduled_for, status, settled_event_id, effective_at, effective_amount,
    sensitive_payload, encryption_nonce, encryption_key_version
  ) values (
    caller_id, rule_id, target_scheduled_for,
    coalesce(payload ->> 'status', 'scheduled')::app_private.planned_occurrence_status,
    nullif(payload ->> 'settled_event_id', '')::uuid,
    nullif(payload ->> 'effective_at', '')::timestamptz,
    nullif(payload ->> 'effective_amount', '')::numeric,
    decode(nullif(payload ->> 'sensitive_payload_b64', ''), 'base64'),
    decode(nullif(payload ->> 'encryption_nonce_b64', ''), 'base64'),
    nullif(payload ->> 'encryption_key_version', '')::smallint
  )
  on conflict (recurrence_rule_id, scheduled_for) do update
  set status = excluded.status,
      settled_event_id = excluded.settled_event_id,
      effective_at = excluded.effective_at,
      effective_amount = excluded.effective_amount,
      sensitive_payload = excluded.sensitive_payload,
      encryption_nonce = excluded.encryption_nonce,
      encryption_key_version = excluded.encryption_key_version
  returning id into occurrence_id;

  return occurrence_id;
end;
$$;

-- Invoice totals belong to the ledger, not to a mutable "invoice" row.
create or replace function api.card_invoices()
returns table (
  card_id uuid,
  invoice_month date,
  currency_code text,
  total numeric,
  transaction_count bigint
)
language sql security invoker set search_path = '' stable as $$
  select card_transaction.card_id,
         (card_transaction.first_invoice_month + ((card_transaction.installment_number - 1) * interval '1 month'))::date,
         posting.currency_code,
         sum(posting.amount),
         count(*)
  from app_private.card_transactions as card_transaction
  join app_private.ledger_postings as posting
    on posting.event_id = card_transaction.event_id and posting.user_id = card_transaction.user_id
  join app_private.credit_card_terms as terms
    on terms.card_id = card_transaction.card_id and terms.user_id = card_transaction.user_id
   and terms.liability_ledger_account_id = posting.ledger_account_id
  where card_transaction.user_id = (select auth.uid())
  group by card_transaction.card_id,
           (card_transaction.first_invoice_month + ((card_transaction.installment_number - 1) * interval '1 month'))::date,
           posting.currency_code
  order by 1, 2;
$$;

do $$
declare routine text;
begin
  foreach routine in array array[
    'api.write_import_batch(jsonb)', 'api.write_card_transaction(jsonb)',
    'api.pay_card_invoice(jsonb)', 'api.write_planned_occurrence(jsonb)',
    'api.card_invoices()'
  ] loop
    execute format('revoke all on function %s from public, anon', routine);
    execute format('grant execute on function %s to authenticated', routine);
  end loop;
end;
$$;
