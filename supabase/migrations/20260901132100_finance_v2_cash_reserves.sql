-- A cash reserve has its own investment ledger but may live outside any bank account.
alter table app_private.investment_holdings
  alter column custody_account_id drop not null;

create unique index if not exists investment_holdings_unassigned_asset_key
  on app_private.investment_holdings (asset_id)
  where custody_account_id is null;

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
  custody_id uuid := nullif(payload ->> 'custody_account_id', '')::uuid;
  ledger_id uuid;
  persisted integer;
  doomed_ledgers uuid[];
begin
  if caller_id is null then raise exception 'Sessão inválida.' using errcode = '42501'; end if;
  if op not in ('create', 'update', 'delete') then raise exception 'Operação de ativo inválida.' using errcode = '22023'; end if;
  if op in ('update', 'delete') and (requested_id is null or expected is null) then
    raise exception 'ID e versão esperada são obrigatórios.' using errcode = '22023';
  end if;
  if op <> 'delete' and custody_id is null and payload ->> 'asset_type_code' <> 'cash_box' then
    raise exception 'Somente reservas em dinheiro podem ficar sem conta de custódia.' using errcode = '22023';
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
    values (requested_holding, caller_id, requested_id, custody_id, ledger_id);
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
    update app_private.investment_holdings as holdings
    set custody_account_id = custody_id,
        updated_at = now()
    where holdings.id = requested_holding and holdings.user_id = caller_id;
  else
    if not exists (
      select 1 from app_private.investment_assets as assets
      where assets.id = requested_id and assets.user_id = caller_id and assets.version = expected
    ) then
      raise exception 'Ativo inexistente ou alterado.' using errcode = '40001';
    end if;
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
