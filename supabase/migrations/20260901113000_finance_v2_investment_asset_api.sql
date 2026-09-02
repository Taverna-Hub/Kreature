create or replace function api.write_investment_asset(p_command jsonb)
returns table (asset_id uuid, holding_id uuid, asset_version integer)
language plpgsql security invoker set search_path = '' as $$
declare caller_id uuid:=auth.uid(); op text:=p_command->>'operation'; payload jsonb:=p_command->'asset'; requested_id uuid:=nullif(p_command->>'id','')::uuid; expected integer:=nullif(p_command->>'expected_version','')::integer; requested_holding uuid:=nullif(p_command->>'holding_id','')::uuid; ledger_id uuid; persisted integer;
begin
 if caller_id is null then raise exception 'Sessão inválida.' using errcode='42501'; end if;
 if op not in ('create','update','delete') then raise exception 'Operação de ativo inválida.' using errcode='22023'; end if;
 if op in ('update','delete') and (requested_id is null or expected is null) then raise exception 'ID e versão esperada são obrigatórios.' using errcode='22023'; end if;
 if op='create' then
  requested_id:=coalesce(requested_id,gen_random_uuid()); requested_holding:=coalesce(requested_holding,gen_random_uuid());
  insert into app_private.ledger_accounts(user_id,kind,currency_code) values(caller_id,'investment_custody',payload->>'currency_code') returning id into ledger_id;
  insert into app_private.investment_assets(id,user_id,instrument_id,asset_type_code,currency_code,sensitive_payload,encryption_nonce,encryption_key_version) values(requested_id,caller_id,nullif(payload->>'instrument_id','')::uuid,payload->>'asset_type_code',payload->>'currency_code',decode(payload->>'sensitive_payload_b64','base64'),decode(payload->>'encryption_nonce_b64','base64'),(payload->>'encryption_key_version')::smallint) returning version into persisted;
  insert into app_private.investment_holdings(id,user_id,asset_id,custody_account_id,ledger_account_id) values(requested_holding,caller_id,requested_id,(payload->>'custody_account_id')::uuid,ledger_id);
 elsif op='update' then
  update app_private.investment_assets set instrument_id=nullif(payload->>'instrument_id','')::uuid,sensitive_payload=decode(payload->>'sensitive_payload_b64','base64'),encryption_nonce=decode(payload->>'encryption_nonce_b64','base64'),encryption_key_version=(payload->>'encryption_key_version')::smallint,archived_at=case when payload?'archived_at' then nullif(payload->>'archived_at','')::timestamptz else archived_at end,version=version+1 where id=requested_id and user_id=caller_id and version=expected and asset_type_code=payload->>'asset_type_code' and currency_code=payload->>'currency_code' returning version into persisted;
  if not found then raise exception 'Ativo inexistente, alterado ou com tipo/moeda incompatível.' using errcode='40001'; end if;
  select id into requested_holding from app_private.investment_holdings where asset_id=requested_id and user_id=caller_id order by created_at limit 1;
 else delete from app_private.investment_assets where id=requested_id and user_id=caller_id and version=expected; if not found then raise exception 'Ativo inexistente ou alterado.' using errcode='40001'; end if; return query select requested_id,null::uuid,expected+1; return; end if;
 return query select requested_id,requested_holding,persisted;
end; $$;
revoke all on function api.write_investment_asset(jsonb) from public,anon;
grant execute on function api.write_investment_asset(jsonb) to authenticated;
grant select,insert,update,delete on app_private.investment_assets,app_private.investment_holdings,app_private.ledger_accounts to authenticated;
