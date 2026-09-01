-- The API schema is the only database schema intended for PostgREST exposure.
-- The Edge Function validates and encrypts payloads before calling these
-- SECURITY INVOKER routines with the caller's JWT.

create or replace function api.write_financial_event(p_command jsonb)
returns table (event_id uuid, event_version integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  operation text := p_command ->> 'operation';
  requested_id uuid;
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
    requested_id := nullif(p_command ->> 'id', '')::uuid;
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
    insert into app_private.financial_events (
      user_id, kind, category_id, import_batch_id, occurred_at,
      sensitive_payload, encryption_nonce, encryption_key_version, source
    ) values (
      caller_id,
      (event_data ->> 'kind')::app_private.financial_event_kind,
      nullif(event_data ->> 'category_id', '')::uuid,
      nullif(event_data ->> 'import_batch_id', '')::uuid,
      (event_data ->> 'occurred_at')::timestamptz,
      decode(event_data ->> 'sensitive_payload_b64', 'base64'),
      decode(event_data ->> 'encryption_nonce_b64', 'base64'),
      (event_data ->> 'encryption_key_version')::smallint,
      event_data ->> 'source'
    ) returning id, version into requested_id, persisted_version;
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
    delete from app_private.ledger_postings where event_id = requested_id and user_id = caller_id;
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

create or replace function api.list_financial_events(
  p_limit integer default 100,
  p_before timestamptz default null
)
returns table (
  id uuid,
  version integer,
  kind app_private.financial_event_kind,
  category_id uuid,
  occurred_at timestamptz,
  source text,
  sensitive_payload_b64 text,
  encryption_nonce_b64 text,
  encryption_key_version smallint,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security invoker
set search_path = ''
stable
as $$
  select event.id, event.version, event.kind, event.category_id, event.occurred_at, event.source,
         encode(event.sensitive_payload, 'base64'), encode(event.encryption_nonce, 'base64'), event.encryption_key_version,
         event.created_at, event.updated_at
  from app_private.financial_events event
  where event.user_id = (select auth.uid())
    and (p_before is null or event.occurred_at < p_before)
  order by event.occurred_at desc, event.id desc
  limit greatest(1, least(coalesce(p_limit, 100), 250));
$$;

create or replace function api.account_balances()
returns table (
  account_id uuid,
  currency_code text,
  balance numeric
)
language sql
security invoker
set search_path = ''
stable
as $$
  select account.id, account.currency_code, coalesce(sum(posting.amount), 0)::numeric as balance
  from app_private.accounts account
  join app_private.ledger_postings posting
    on posting.ledger_account_id = account.ledger_account_id
   and posting.user_id = account.user_id
  where account.user_id = (select auth.uid())
  group by account.id, account.currency_code;
$$;

create or replace view api.portfolio_positions
with (security_invoker = true)
as
select
  holding.user_id,
  holding.id as holding_id,
  asset.id as asset_id,
  asset.instrument_id,
  holding.custody_account_id,
  asset.currency_code,
  coalesce(sum(
    case transaction.operation
      when 'buy' then detail.quantity
      when 'contribution' then detail.quantity
      when 'reinvestment' then detail.quantity
      when 'transfer_in' then detail.quantity
      when 'sell' then -detail.quantity
      when 'redemption' then -detail.quantity
      when 'transfer_out' then -detail.quantity
      else 0
    end
  ), 0)::numeric as quantity
from app_private.investment_holdings holding
join app_private.investment_assets asset on asset.id = holding.asset_id and asset.user_id = holding.user_id
left join app_private.investment_transactions transaction on transaction.holding_id = holding.id and transaction.user_id = holding.user_id
left join app_private.investment_trade_details detail on detail.transaction_id = transaction.id and detail.user_id = transaction.user_id
group by holding.user_id, holding.id, asset.id, asset.instrument_id, holding.custody_account_id, asset.currency_code;

revoke all on function api.write_financial_event(jsonb) from public, anon;
revoke all on function api.list_financial_events(integer, timestamptz) from public, anon;
revoke all on function api.account_balances() from public, anon;
grant execute on function api.write_financial_event(jsonb) to authenticated;
grant execute on function api.list_financial_events(integer, timestamptz) to authenticated;
grant execute on function api.account_balances() to authenticated;
grant select on api.portfolio_positions to authenticated;

-- These grants are only useful through SECURITY INVOKER routines in the api
-- schema. app_private itself is deliberately not exposed through PostgREST.
grant usage on schema app_private to authenticated;
grant select, insert, update, delete on app_private.financial_events, app_private.ledger_postings, app_private.audit_revisions to authenticated;
grant select on app_private.accounts, app_private.ledger_accounts, app_private.investment_assets, app_private.investment_holdings, app_private.investment_transactions, app_private.investment_trade_details to authenticated;
