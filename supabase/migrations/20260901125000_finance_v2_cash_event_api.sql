-- Day-to-day money movements should not require the client to know the ledger
-- layout. The caller states the economic fact; the api resolves the accounts,
-- signs the legs and keeps the event balanced.
create or replace function api.write_cash_event(p_command jsonb)
returns table (event_id uuid, event_version integer)
language plpgsql security invoker set search_path = '' as $$
declare
  caller_id uuid := auth.uid();
  operation text := p_command ->> 'operation';
  requested_id uuid := nullif(p_command ->> 'id', '')::uuid;
  expected_version integer := nullif(p_command ->> 'expected_version', '')::integer;
  event_data jsonb := p_command -> 'event';
  event_kind text := event_data ->> 'kind';
  source_text text := coalesce(event_data ->> 'source', 'manual');
  event_occurred_at timestamptz := nullif(event_data ->> 'occurred_at', '')::timestamptz;
  amount numeric := nullif(event_data ->> 'amount', '')::numeric;
  account_id uuid := nullif(event_data ->> 'account_id', '')::uuid;
  counterpart_account_id uuid := nullif(event_data ->> 'counterpart_account_id', '')::uuid;
  account_ledger uuid;
  account_currency text;
  counterpart_ledger uuid;
  counterpart_currency text;
  counterpart_kind app_private.ledger_account_kind;
  persisted_version integer;
begin
  if caller_id is null then raise exception 'Sessão inválida.' using errcode = '42501'; end if;
  if operation not in ('create', 'update', 'delete') then
    raise exception 'Operação inválida.' using errcode = '22023';
  end if;
  if operation <> 'create' and (requested_id is null or expected_version is null) then
    raise exception 'ID e versão esperada são obrigatórios.' using errcode = '22023';
  end if;

  if operation = 'delete' then
    delete from app_private.financial_events
    where id = requested_id and user_id = caller_id and version = expected_version;
    if not found then
      raise exception 'Lançamento inexistente ou alterado por outra sessão.' using errcode = '40001';
    end if;
    return query select requested_id, expected_version + 1;
    return;
  end if;

  if event_kind not in ('income', 'expense', 'internal_transfer', 'adjustment', 'opening_balance') then
    raise exception 'Natureza de lançamento inválida.' using errcode = '22023';
  end if;
  if source_text not in ('manual', 'import', 'planned') then
    raise exception 'Origem de lançamento não permitida ao cliente.' using errcode = '42501';
  end if;
  if amount is null or amount <= 0 then
    raise exception 'O valor do lançamento deve ser maior que zero.' using errcode = '22023';
  end if;
  if event_occurred_at is null then
    raise exception 'A data do lançamento é obrigatória.' using errcode = '22023';
  end if;

  select account.ledger_account_id, account.currency_code into account_ledger, account_currency
  from app_private.accounts as account
  where account.id = account_id and account.user_id = caller_id and account.archived_at is null;
  if not found then
    raise exception 'Conta inexistente ou arquivada.' using errcode = '23503';
  end if;

  if event_kind = 'internal_transfer' then
    select account.ledger_account_id, account.currency_code into counterpart_ledger, counterpart_currency
    from app_private.accounts as account
    where account.id = counterpart_account_id and account.user_id = caller_id and account.archived_at is null;
    if not found then
      raise exception 'Conta de destino inexistente ou arquivada.' using errcode = '23503';
    end if;
    if counterpart_account_id = account_id then
      raise exception 'A transferência exige contas diferentes.' using errcode = '22023';
    end if;
    if counterpart_currency <> account_currency then
      raise exception 'Transferência entre moedas diferentes exige câmbio explícito.' using errcode = '22023';
    end if;
  else
    counterpart_kind := case
      when event_kind = 'income' then 'income'
      when event_kind = 'expense' then 'expense'
      else 'equity'
    end::app_private.ledger_account_kind;
    counterpart_ledger := app_private.system_ledger_account(caller_id, counterpart_kind, account_currency);
  end if;

  if operation = 'create' then
    requested_id := coalesce(requested_id, gen_random_uuid());
    insert into app_private.financial_events (
      id, user_id, kind, category_id, import_batch_id, occurred_at,
      sensitive_payload, encryption_nonce, encryption_key_version, source
    ) values (
      requested_id, caller_id, event_kind::app_private.financial_event_kind,
      nullif(event_data ->> 'category_id', '')::uuid,
      nullif(event_data ->> 'import_batch_id', '')::uuid,
      event_occurred_at,
      decode(event_data ->> 'sensitive_payload_b64', 'base64'),
      decode(event_data ->> 'encryption_nonce_b64', 'base64'),
      (event_data ->> 'encryption_key_version')::smallint,
      source_text
    ) returning version into persisted_version;
  else
    update app_private.financial_events
    set kind = event_kind::app_private.financial_event_kind,
        category_id = nullif(event_data ->> 'category_id', '')::uuid,
        import_batch_id = nullif(event_data ->> 'import_batch_id', '')::uuid,
        occurred_at = event_occurred_at,
        sensitive_payload = decode(event_data ->> 'sensitive_payload_b64', 'base64'),
        encryption_nonce = decode(event_data ->> 'encryption_nonce_b64', 'base64'),
        encryption_key_version = (event_data ->> 'encryption_key_version')::smallint,
        source = source_text,
        version = version + 1
    where id = requested_id and user_id = caller_id and version = expected_version
    returning version into persisted_version;
    if not found then
      raise exception 'Lançamento inexistente ou alterado por outra sessão.' using errcode = '40001';
    end if;
    delete from app_private.ledger_postings where ledger_postings.event_id = requested_id and ledger_postings.user_id = caller_id;
  end if;

  -- Assets are debits: money arriving is positive, money leaving is negative.
  if event_kind = 'income' then
    insert into app_private.ledger_postings (user_id, event_id, ledger_account_id, amount, currency_code)
    values (caller_id, requested_id, account_ledger, amount, account_currency),
           (caller_id, requested_id, counterpart_ledger, -amount, account_currency);
  elsif event_kind = 'expense' then
    insert into app_private.ledger_postings (user_id, event_id, ledger_account_id, amount, currency_code)
    values (caller_id, requested_id, account_ledger, -amount, account_currency),
           (caller_id, requested_id, counterpart_ledger, amount, account_currency);
  elsif event_kind = 'internal_transfer' then
    insert into app_private.ledger_postings (user_id, event_id, ledger_account_id, amount, currency_code)
    values (caller_id, requested_id, account_ledger, -amount, account_currency),
           (caller_id, requested_id, counterpart_ledger, amount, account_currency);
  else
    -- An adjustment can move a balance in either direction.
    if coalesce((event_data ->> 'increases_balance')::boolean, true) then
      insert into app_private.ledger_postings (user_id, event_id, ledger_account_id, amount, currency_code)
      values (caller_id, requested_id, account_ledger, amount, account_currency),
             (caller_id, requested_id, counterpart_ledger, -amount, account_currency);
    else
      insert into app_private.ledger_postings (user_id, event_id, ledger_account_id, amount, currency_code)
      values (caller_id, requested_id, account_ledger, -amount, account_currency),
             (caller_id, requested_id, counterpart_ledger, amount, account_currency);
    end if;
  end if;

  return query select requested_id, persisted_version;
end;
$$;

-- Balances are the ledger's answer, not a stored column.
create or replace function api.account_balances()
returns table (account_id uuid, currency_code text, balance numeric)
language sql security invoker set search_path = '' stable as $$
  select account.id, account.currency_code,
         coalesce((
           select sum(posting.amount)
           from app_private.ledger_postings as posting
           where posting.ledger_account_id = account.ledger_account_id
             and posting.user_id = account.user_id
         ), 0)::numeric
  from app_private.accounts as account
  where account.user_id = (select auth.uid());
$$;

create or replace function api.card_balances()
returns table (card_id uuid, currency_code text, balance numeric)
language sql security invoker set search_path = '' stable as $$
  select terms.card_id, card.currency_code,
         coalesce((
           select sum(posting.amount)
           from app_private.ledger_postings as posting
           where posting.ledger_account_id = terms.liability_ledger_account_id
             and posting.user_id = terms.user_id
         ), 0)::numeric
  from app_private.credit_card_terms as terms
  join app_private.cards as card on card.id = terms.card_id and card.user_id = terms.user_id
  where terms.user_id = (select auth.uid());
$$;

do $$
declare routine text;
begin
  foreach routine in array array[
    'api.write_cash_event(jsonb)', 'api.account_balances()', 'api.card_balances()'
  ] loop
    execute format('revoke all on function %s from public, anon', routine);
    execute format('grant execute on function %s to authenticated', routine);
  end loop;
end;
$$;

-- The generic writer let the database mint the id, so the ciphertext the Edge
-- Function had already bound to its own generated id could never be decrypted
-- again. The caller now owns the id for every create.
create or replace function api.write_financial_event(p_command jsonb)
returns table (event_id uuid, event_version integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  operation text := p_command ->> 'operation';
  requested_id uuid := nullif(p_command ->> 'id', '')::uuid;
  expected_version integer;
  event_data jsonb := p_command -> 'event';
  posting_data jsonb := p_command -> 'postings';
  audit_data jsonb := p_command -> 'audit';
  persisted_version integer;
  posting jsonb;
begin
  if caller_id is null then
    raise exception 'Sessão inválida.' using errcode = '42501';
  end if;
  if operation not in ('create', 'update', 'delete') then
    raise exception 'Operação inválida.' using errcode = '22023';
  end if;

  if operation <> 'create' then
    expected_version := nullif(p_command ->> 'expected_version', '')::integer;
    if requested_id is null or expected_version is null then
      raise exception 'ID e versão esperada são obrigatórios.' using errcode = '22023';
    end if;
  end if;

  if operation in ('create', 'update') then
    if event_data is null or jsonb_typeof(event_data) <> 'object'
      or posting_data is null or jsonb_typeof(posting_data) <> 'array'
      or jsonb_array_length(posting_data) < 2 then
      raise exception 'Evento e ao menos duas partidas são obrigatórios.' using errcode = '22023';
    end if;
    if event_data ->> 'source' not in ('manual', 'import', 'planned') then
      raise exception 'Origem de evento não permitida ao cliente.' using errcode = '42501';
    end if;
  end if;

  if operation = 'create' then
    requested_id := coalesce(requested_id, gen_random_uuid());
    insert into app_private.financial_events (
      id, user_id, kind, category_id, import_batch_id, occurred_at,
      sensitive_payload, encryption_nonce, encryption_key_version, source
    ) values (
      requested_id,
      caller_id,
      (event_data ->> 'kind')::app_private.financial_event_kind,
      nullif(event_data ->> 'category_id', '')::uuid,
      nullif(event_data ->> 'import_batch_id', '')::uuid,
      (event_data ->> 'occurred_at')::timestamptz,
      decode(event_data ->> 'sensitive_payload_b64', 'base64'),
      decode(event_data ->> 'encryption_nonce_b64', 'base64'),
      (event_data ->> 'encryption_key_version')::smallint,
      event_data ->> 'source'
    ) returning version into persisted_version;
  elsif operation = 'update' then
    update app_private.financial_events
    set kind = (event_data ->> 'kind')::app_private.financial_event_kind,
        category_id = nullif(event_data ->> 'category_id', '')::uuid,
        import_batch_id = nullif(event_data ->> 'import_batch_id', '')::uuid,
        occurred_at = (event_data ->> 'occurred_at')::timestamptz,
        sensitive_payload = decode(event_data ->> 'sensitive_payload_b64', 'base64'),
        encryption_nonce = decode(event_data ->> 'encryption_nonce_b64', 'base64'),
        encryption_key_version = (event_data ->> 'encryption_key_version')::smallint,
        source = event_data ->> 'source',
        version = version + 1
    where id = requested_id and user_id = caller_id and version = expected_version
    returning version into persisted_version;
    if not found then
      raise exception 'Evento inexistente ou alterado por outra sessão.' using errcode = '40001';
    end if;
    delete from app_private.ledger_postings where ledger_postings.event_id = requested_id and ledger_postings.user_id = caller_id;
  else
    if audit_data is not null then
      insert into app_private.audit_revisions (
        user_id, entity_type, entity_id, operation, sensitive_payload, encryption_nonce, encryption_key_version
      ) values (
        caller_id, 'financial_event', requested_id, 'delete',
        decode(audit_data ->> 'sensitive_payload_b64', 'base64'),
        decode(audit_data ->> 'encryption_nonce_b64', 'base64'),
        (audit_data ->> 'encryption_key_version')::smallint
      );
    end if;
    delete from app_private.financial_events
    where id = requested_id and user_id = caller_id and version = expected_version;
    if not found then
      raise exception 'Evento inexistente ou alterado por outra sessão.' using errcode = '40001';
    end if;
    return query select requested_id, expected_version + 1;
    return;
  end if;

  for posting in select value from jsonb_array_elements(posting_data)
  loop
    if not exists (
      select 1
      from app_private.ledger_accounts account
      where account.id = nullif(posting ->> 'ledger_account_id', '')::uuid
        and account.user_id = caller_id
        and account.currency_code = posting ->> 'currency_code'
    ) then
      raise exception 'Conta contábil inválida para a moeda informada.' using errcode = '23503';
    end if;

    insert into app_private.ledger_postings (
      user_id, event_id, ledger_account_id, amount, currency_code, operation_fx_rate_id
    ) values (
      caller_id,
      requested_id,
      (posting ->> 'ledger_account_id')::uuid,
      (posting ->> 'amount')::numeric,
      posting ->> 'currency_code',
      nullif(posting ->> 'operation_fx_rate_id', '')::uuid
    );
  end loop;

  if audit_data is not null and operation = 'update' then
    insert into app_private.audit_revisions (
      user_id, entity_type, entity_id, operation, sensitive_payload, encryption_nonce, encryption_key_version
    ) values (
      caller_id, 'financial_event', requested_id, 'update',
      decode(audit_data ->> 'sensitive_payload_b64', 'base64'),
      decode(audit_data ->> 'encryption_nonce_b64', 'base64'),
      (audit_data ->> 'encryption_key_version')::smallint
    );
  end if;

  return query select requested_id, persisted_version;
end;
$$;

revoke all on function api.write_financial_event(jsonb) from public, anon;
grant execute on function api.write_financial_event(jsonb) to authenticated;
