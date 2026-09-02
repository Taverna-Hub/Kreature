-- Deleting a catalog row used to leave its ledger account, its holding and its
-- postings behind: the balance vanished from the application while the double
-- entry stayed in the book. A delete now either removes the whole structure or
-- explains why it cannot.
create or replace function api.write_account(p_command jsonb)
returns table (account_id uuid, account_version integer)
language plpgsql security invoker set search_path = '' as $$
declare
  caller_id uuid := auth.uid();
  operation text := p_command ->> 'operation';
  requested_id uuid := nullif(p_command ->> 'id', '')::uuid;
  expected_version integer := nullif(p_command ->> 'expected_version', '')::integer;
  payload jsonb := p_command -> 'account';
  ledger_id uuid;
  persisted_version integer;
begin
  if caller_id is null then raise exception 'Sessão inválida.' using errcode = '42501'; end if;
  if operation not in ('create', 'update', 'delete') then
    raise exception 'Operação de conta inválida.' using errcode = '22023';
  end if;
  if operation in ('update', 'delete') and (requested_id is null or expected_version is null) then
    raise exception 'ID e versão esperada são obrigatórios.' using errcode = '22023';
  end if;

  if operation = 'create' then
    requested_id := coalesce(requested_id, gen_random_uuid());
    insert into app_private.ledger_accounts (user_id, kind, currency_code)
    values (caller_id, 'cash', payload ->> 'currency_code')
    returning id into ledger_id;
    insert into app_private.accounts (
      id, user_id, institution_id, ledger_account_id, kind, currency_code,
      sensitive_payload, encryption_nonce, encryption_key_version
    ) values (
      requested_id, caller_id,
      nullif(payload ->> 'institution_id', '')::uuid,
      ledger_id,
      (payload ->> 'kind')::app_private.account_kind,
      payload ->> 'currency_code',
      decode(payload ->> 'sensitive_payload_b64', 'base64'),
      decode(payload ->> 'encryption_nonce_b64', 'base64'),
      (payload ->> 'encryption_key_version')::smallint
    ) returning version into persisted_version;
  elsif operation = 'update' then
    update app_private.accounts
    set institution_id = nullif(payload ->> 'institution_id', '')::uuid,
        kind = (payload ->> 'kind')::app_private.account_kind,
        sensitive_payload = decode(payload ->> 'sensitive_payload_b64', 'base64'),
        encryption_nonce = decode(payload ->> 'encryption_nonce_b64', 'base64'),
        encryption_key_version = (payload ->> 'encryption_key_version')::smallint,
        archived_at = case when payload ? 'archived_at' then nullif(payload ->> 'archived_at', '')::timestamptz else accounts.archived_at end,
        version = accounts.version + 1
    where accounts.id = requested_id and accounts.user_id = caller_id and accounts.version = expected_version
      and accounts.currency_code = payload ->> 'currency_code'
    returning accounts.version into persisted_version;
    if not found then
      raise exception 'Conta inexistente, alterada ou com moeda incompatível.' using errcode = '40001';
    end if;
  else
    select accounts.ledger_account_id into ledger_id
    from app_private.accounts
    where accounts.id = requested_id and accounts.user_id = caller_id and accounts.version = expected_version;
    if ledger_id is null then
      raise exception 'Conta inexistente ou alterada.' using errcode = '40001';
    end if;
    if exists (
      select 1 from app_private.ledger_postings as posting
      where posting.ledger_account_id = ledger_id and posting.user_id = caller_id
    ) then
      raise exception 'Arquive a conta: ela ainda possui lançamentos no livro.' using errcode = '23503';
    end if;

    delete from app_private.accounts where accounts.id = requested_id and accounts.user_id = caller_id;
    delete from app_private.ledger_accounts as ledger where ledger.id = ledger_id and ledger.user_id = caller_id;
    return query select requested_id, expected_version + 1;
    return;
  end if;

  return query select requested_id, persisted_version;
end;
$$;

create or replace function api.write_card(p_command jsonb)
returns table (card_id uuid, card_version integer)
language plpgsql security invoker set search_path = '' as $$
declare
  caller_id uuid := auth.uid();
  op text := p_command ->> 'operation';
  card_data jsonb := p_command -> 'card';
  requested_id uuid := nullif(p_command ->> 'id', '')::uuid;
  expected integer := nullif(p_command ->> 'expected_version', '')::integer;
  liability_id uuid;
  persisted integer;
begin
  if caller_id is null then raise exception 'Sessão inválida.' using errcode = '42501'; end if;
  if op not in ('create', 'update', 'delete') then raise exception 'Operação de cartão inválida.' using errcode = '22023'; end if;
  if op in ('update', 'delete') and (requested_id is null or expected is null) then
    raise exception 'ID e versão esperada são obrigatórios.' using errcode = '22023';
  end if;

  if op = 'create' then
    requested_id := coalesce(requested_id, gen_random_uuid());
    if card_data ->> 'kind' = 'credit' then
      insert into app_private.ledger_accounts (user_id, kind, currency_code)
      values (caller_id, 'credit_card_liability', card_data ->> 'currency_code')
      returning id into liability_id;
    end if;
    insert into app_private.cards (
      id, user_id, institution_id, linked_account_id, kind, network, currency_code,
      sensitive_payload, encryption_nonce, encryption_key_version
    ) values (
      requested_id, caller_id,
      nullif(card_data ->> 'institution_id', '')::uuid,
      nullif(card_data ->> 'linked_account_id', '')::uuid,
      (card_data ->> 'kind')::app_private.card_kind,
      card_data ->> 'network',
      card_data ->> 'currency_code',
      decode(card_data ->> 'sensitive_payload_b64', 'base64'),
      decode(card_data ->> 'encryption_nonce_b64', 'base64'),
      (card_data ->> 'encryption_key_version')::smallint
    ) returning version into persisted;
    if card_data ->> 'kind' = 'credit' then
      insert into app_private.credit_card_terms (
        card_id, user_id, liability_ledger_account_id, payer_account_id, credit_limit, closing_day, due_day
      ) values (
        requested_id, caller_id, liability_id,
        nullif(card_data ->> 'payer_account_id', '')::uuid,
        (card_data ->> 'credit_limit')::numeric,
        (card_data ->> 'closing_day')::smallint,
        (card_data ->> 'due_day')::smallint
      );
    end if;
  elsif op = 'update' then
    update app_private.cards
    set institution_id = nullif(card_data ->> 'institution_id', '')::uuid,
        linked_account_id = nullif(card_data ->> 'linked_account_id', '')::uuid,
        network = card_data ->> 'network',
        sensitive_payload = decode(card_data ->> 'sensitive_payload_b64', 'base64'),
        encryption_nonce = decode(card_data ->> 'encryption_nonce_b64', 'base64'),
        encryption_key_version = (card_data ->> 'encryption_key_version')::smallint,
        archived_at = case when card_data ? 'archived_at' then nullif(card_data ->> 'archived_at', '')::timestamptz else cards.archived_at end,
        version = cards.version + 1
    where cards.id = requested_id and cards.user_id = caller_id and cards.version = expected
      and cards.currency_code = card_data ->> 'currency_code'
    returning cards.version into persisted;
    if not found then raise exception 'Cartão inexistente, alterado ou com moeda incompatível.' using errcode = '40001'; end if;

    update app_private.credit_card_terms as terms
    set payer_account_id = nullif(card_data ->> 'payer_account_id', '')::uuid,
        credit_limit = (card_data ->> 'credit_limit')::numeric,
        closing_day = (card_data ->> 'closing_day')::smallint,
        due_day = (card_data ->> 'due_day')::smallint
    where terms.card_id = requested_id and terms.user_id = caller_id;
  else
    if not exists (
      select 1 from app_private.cards
      where cards.id = requested_id and cards.user_id = caller_id and cards.version = expected
    ) then
      raise exception 'Cartão inexistente ou alterado.' using errcode = '40001';
    end if;
    if exists (
      select 1 from app_private.card_transactions as movement
      where movement.card_id = requested_id and movement.user_id = caller_id
    ) then
      raise exception 'Arquive o cartão: ele ainda possui lançamentos.' using errcode = '23503';
    end if;

    select terms.liability_ledger_account_id into liability_id
    from app_private.credit_card_terms as terms
    where terms.card_id = requested_id and terms.user_id = caller_id;

    delete from app_private.cards where cards.id = requested_id and cards.user_id = caller_id;
    if liability_id is not null then
      delete from app_private.ledger_accounts as ledger where ledger.id = liability_id and ledger.user_id = caller_id;
    end if;
    return query select requested_id, expected + 1;
    return;
  end if;

  return query select requested_id, persisted;
end;
$$;

create or replace function api.write_investment_asset(p_command jsonb)
returns table (asset_id uuid, holding_id uuid, asset_version integer)
language plpgsql security invoker set search_path = '' as $$
declare
  caller_id uuid := auth.uid();
  op text := p_command ->> 'operation';
  payload jsonb := p_command -> 'asset';
  requested_id uuid := nullif(p_command ->> 'id', '')::uuid;
  expected integer := nullif(p_command ->> 'expected_version', '')::integer;
  requested_holding uuid := nullif(p_command ->> 'holding_id', '')::uuid;
  ledger_id uuid;
  persisted integer;
  doomed_ledgers uuid[];
begin
  if caller_id is null then raise exception 'Sessão inválida.' using errcode = '42501'; end if;
  if op not in ('create', 'update', 'delete') then raise exception 'Operação de ativo inválida.' using errcode = '22023'; end if;
  if op in ('update', 'delete') and (requested_id is null or expected is null) then
    raise exception 'ID e versão esperada são obrigatórios.' using errcode = '22023';
  end if;

  if op = 'create' then
    requested_id := coalesce(requested_id, gen_random_uuid());
    requested_holding := coalesce(requested_holding, gen_random_uuid());
    insert into app_private.ledger_accounts (user_id, kind, currency_code)
    values (caller_id, 'investment_custody', payload ->> 'currency_code')
    returning id into ledger_id;
    insert into app_private.investment_assets (
      id, user_id, instrument_id, asset_type_code, currency_code,
      sensitive_payload, encryption_nonce, encryption_key_version
    ) values (
      requested_id, caller_id,
      nullif(payload ->> 'instrument_id', '')::uuid,
      payload ->> 'asset_type_code',
      payload ->> 'currency_code',
      decode(payload ->> 'sensitive_payload_b64', 'base64'),
      decode(payload ->> 'encryption_nonce_b64', 'base64'),
      (payload ->> 'encryption_key_version')::smallint
    ) returning version into persisted;
    insert into app_private.investment_holdings (id, user_id, asset_id, custody_account_id, ledger_account_id)
    values (requested_holding, caller_id, requested_id, (payload ->> 'custody_account_id')::uuid, ledger_id);
  elsif op = 'update' then
    update app_private.investment_assets as assets
    set instrument_id = nullif(payload ->> 'instrument_id', '')::uuid,
        sensitive_payload = decode(payload ->> 'sensitive_payload_b64', 'base64'),
        encryption_nonce = decode(payload ->> 'encryption_nonce_b64', 'base64'),
        encryption_key_version = (payload ->> 'encryption_key_version')::smallint,
        archived_at = case when payload ? 'archived_at' then nullif(payload ->> 'archived_at', '')::timestamptz else assets.archived_at end,
        version = assets.version + 1
    where assets.id = requested_id and assets.user_id = caller_id and assets.version = expected
      and assets.asset_type_code = payload ->> 'asset_type_code'
      and assets.currency_code = payload ->> 'currency_code'
    returning assets.version into persisted;
    if not found then raise exception 'Ativo inexistente, alterado ou com tipo/moeda incompatível.' using errcode = '40001'; end if;

    select holdings.id into requested_holding
    from app_private.investment_holdings as holdings
    where holdings.asset_id = requested_id and holdings.user_id = caller_id
    order by holdings.created_at
    limit 1;
  else
    if not exists (
      select 1 from app_private.investment_assets as assets
      where assets.id = requested_id and assets.user_id = caller_id and assets.version = expected
    ) then
      raise exception 'Ativo inexistente ou alterado.' using errcode = '40001';
    end if;
    -- The position is replayed from the operations, so an asset that has any is
    -- history, not a mistake to erase.
    if exists (
      select 1 from app_private.investment_transactions as movement
      where movement.asset_id = requested_id and movement.user_id = caller_id
    ) or exists (
      select 1 from app_private.investment_income_events as income
      where income.asset_id = requested_id and income.user_id = caller_id
    ) then
      raise exception 'Arquive o investimento: ele ainda possui operações registradas.' using errcode = '23503';
    end if;

    select array_agg(holdings.ledger_account_id) into doomed_ledgers
    from app_private.investment_holdings as holdings
    where holdings.asset_id = requested_id and holdings.user_id = caller_id;

    delete from app_private.investment_holdings as holdings
    where holdings.asset_id = requested_id and holdings.user_id = caller_id;
    delete from app_private.investment_assets as assets
    where assets.id = requested_id and assets.user_id = caller_id;
    if doomed_ledgers is not null then
      delete from app_private.ledger_accounts as ledger
      where ledger.id = any(doomed_ledgers) and ledger.user_id = caller_id;
    end if;
    return query select requested_id, null::uuid, expected + 1;
    return;
  end if;

  return query select requested_id, requested_holding, persisted;
end;
$$;

do $$
declare routine text;
begin
  foreach routine in array array[
    'api.write_account(jsonb)', 'api.write_card(jsonb)', 'api.write_investment_asset(jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon', routine);
    execute format('grant execute on function %s to authenticated', routine);
  end loop;
end;
$$;
