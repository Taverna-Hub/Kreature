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
  if operation not in ('create', 'update', 'delete') then raise exception 'Operação de conta inválida.' using errcode = '22023'; end if;
  if operation in ('update', 'delete') and (requested_id is null or expected_version is null) then raise exception 'ID e versão esperada são obrigatórios.' using errcode = '22023'; end if;

  if operation = 'create' then
    requested_id := coalesce(requested_id, gen_random_uuid());
    insert into app_private.ledger_accounts (user_id, kind, currency_code)
    values (caller_id, 'cash', payload ->> 'currency_code') returning id into ledger_id;
    insert into app_private.accounts (id, user_id, institution_id, ledger_account_id, kind, currency_code, sensitive_payload, encryption_nonce, encryption_key_version)
    values (requested_id, caller_id, nullif(payload ->> 'institution_id', '')::uuid, ledger_id, (payload ->> 'kind')::app_private.account_kind, payload ->> 'currency_code', decode(payload ->> 'sensitive_payload_b64', 'base64'), decode(payload ->> 'encryption_nonce_b64', 'base64'), (payload ->> 'encryption_key_version')::smallint)
    returning version into persisted_version;
  elsif operation = 'update' then
    update app_private.accounts
    set institution_id = nullif(payload ->> 'institution_id', '')::uuid,
        kind = (payload ->> 'kind')::app_private.account_kind,
        sensitive_payload = decode(payload ->> 'sensitive_payload_b64', 'base64'),
        encryption_nonce = decode(payload ->> 'encryption_nonce_b64', 'base64'),
        encryption_key_version = (payload ->> 'encryption_key_version')::smallint,
        archived_at = case when payload ? 'archived_at' then nullif(payload ->> 'archived_at', '')::timestamptz else archived_at end,
        version = version + 1
    where id = requested_id and user_id = caller_id and version = expected_version
      and currency_code = payload ->> 'currency_code'
    returning version into persisted_version;
    if not found then raise exception 'Conta inexistente, alterada ou com moeda incompatível.' using errcode = '40001'; end if;
  else
    delete from app_private.accounts where id = requested_id and user_id = caller_id and version = expected_version;
    if not found then raise exception 'Conta inexistente ou alterada.' using errcode = '40001'; end if;
    return query select requested_id, expected_version + 1;
    return;
  end if;
  return query select requested_id, persisted_version;
end;
$$;

create or replace function api.list_accounts()
returns table (id uuid, version integer, institution_id uuid, ledger_account_id uuid, kind app_private.account_kind, currency_code text, sensitive_payload_b64 text, encryption_nonce_b64 text, encryption_key_version smallint, archived_at timestamptz, created_at timestamptz, updated_at timestamptz)
language sql security invoker set search_path = '' stable as $$
  select account.id, account.version, account.institution_id, account.ledger_account_id, account.kind, account.currency_code,
         encode(account.sensitive_payload, 'base64'), encode(account.encryption_nonce, 'base64'), account.encryption_key_version,
         account.archived_at, account.created_at, account.updated_at
  from app_private.accounts account where account.user_id = (select auth.uid()) order by account.created_at;
$$;

revoke all on function api.write_account(jsonb), api.list_accounts() from public, anon;
grant execute on function api.write_account(jsonb), api.list_accounts() to authenticated;
grant select, insert, update, delete on app_private.accounts, app_private.ledger_accounts to authenticated;
