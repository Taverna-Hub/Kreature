-- `returns table (...)` declares output variables, so a bare column of the same
-- name is ambiguous inside the body. Both routines below were unusable on their
-- update path for exactly that reason.
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
    delete from app_private.cards
    where cards.id = requested_id and cards.user_id = caller_id and cards.version = expected;
    if not found then raise exception 'Cartão inexistente ou alterado.' using errcode = '40001'; end if;
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
    delete from app_private.investment_assets as assets
    where assets.id = requested_id and assets.user_id = caller_id and assets.version = expected;
    if not found then raise exception 'Ativo inexistente ou alterado.' using errcode = '40001'; end if;
    return query select requested_id, null::uuid, expected + 1;
    return;
  end if;

  return query select requested_id, requested_holding, persisted;
end;
$$;

do $$
declare routine text;
begin
  foreach routine in array array['api.write_card(jsonb)', 'api.write_investment_asset(jsonb)'] loop
    execute format('revoke all on function %s from public, anon', routine);
    execute format('grant execute on function %s to authenticated', routine);
  end loop;
end;
$$;

-- The classification writer discarded the caller's id and let the database mint
-- its own, so the associated data the Edge Function had already bound to the
-- caller's id could never open the row again.
create or replace function api.write_classification_rule(p_command jsonb)
returns table (rule_id uuid)
language plpgsql security invoker set search_path = '' as $$
declare
  caller_id uuid := auth.uid();
  op text := p_command ->> 'operation';
  payload jsonb := p_command -> 'rule';
  requested uuid := nullif(p_command ->> 'id', '')::uuid;
begin
  if caller_id is null then raise exception 'Sessão inválida.' using errcode = '42501'; end if;
  if op not in ('create', 'update', 'delete') then
    raise exception 'Operação de regra inválida.' using errcode = '22023';
  end if;
  if op in ('update', 'delete') and requested is null then
    raise exception 'ID da regra é obrigatório.' using errcode = '22023';
  end if;

  if op = 'create' then
    requested := coalesce(requested, gen_random_uuid());
    insert into app_private.classification_rules (
      id, user_id, category_id, flow, match_hmac, sensitive_payload, encryption_nonce, encryption_key_version
    ) values (
      requested, caller_id,
      (payload ->> 'category_id')::uuid,
      payload ->> 'flow',
      decode(payload ->> 'match_hmac_b64', 'base64'),
      decode(payload ->> 'sensitive_payload_b64', 'base64'),
      decode(payload ->> 'encryption_nonce_b64', 'base64'),
      (payload ->> 'encryption_key_version')::smallint
    );
  elsif op = 'update' then
    update app_private.classification_rules as rules
    set category_id = (payload ->> 'category_id')::uuid,
        flow = payload ->> 'flow',
        match_hmac = decode(payload ->> 'match_hmac_b64', 'base64'),
        sensitive_payload = decode(payload ->> 'sensitive_payload_b64', 'base64'),
        encryption_nonce = decode(payload ->> 'encryption_nonce_b64', 'base64'),
        encryption_key_version = (payload ->> 'encryption_key_version')::smallint
    where rules.id = requested and rules.user_id = caller_id;
    if not found then raise exception 'Regra inexistente.' using errcode = 'P0002'; end if;
  else
    delete from app_private.classification_rules as rules
    where rules.id = requested and rules.user_id = caller_id;
    if not found then raise exception 'Regra inexistente.' using errcode = 'P0002'; end if;
  end if;

  return query select requested;
end;
$$;

revoke all on function api.write_classification_rule(jsonb) from public, anon;
grant execute on function api.write_classification_rule(jsonb) to authenticated;
