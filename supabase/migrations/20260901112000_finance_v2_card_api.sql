create or replace function api.write_card(p_command jsonb)
returns table (card_id uuid, card_version integer)
language plpgsql security invoker set search_path = '' as $$
declare caller_id uuid := auth.uid(); op text := p_command ->> 'operation'; card_data jsonb := p_command -> 'card'; requested_id uuid := nullif(p_command ->> 'id','')::uuid; expected integer := nullif(p_command ->> 'expected_version','')::integer; liability_id uuid; persisted integer;
begin
  if caller_id is null then raise exception 'Sessão inválida.' using errcode='42501'; end if;
  if op not in ('create','update','delete') then raise exception 'Operação de cartão inválida.' using errcode='22023'; end if;
  if op in ('update','delete') and (requested_id is null or expected is null) then raise exception 'ID e versão esperada são obrigatórios.' using errcode='22023'; end if;
  if op='create' then
    requested_id:=coalesce(requested_id,gen_random_uuid());
    if card_data->>'kind'='credit' then insert into app_private.ledger_accounts(user_id,kind,currency_code) values(caller_id,'credit_card_liability',card_data->>'currency_code') returning id into liability_id; end if;
    insert into app_private.cards(id,user_id,institution_id,linked_account_id,kind,network,currency_code,sensitive_payload,encryption_nonce,encryption_key_version) values(requested_id,caller_id,nullif(card_data->>'institution_id','')::uuid,nullif(card_data->>'linked_account_id','')::uuid,(card_data->>'kind')::app_private.card_kind,(card_data->>'network')::text,card_data->>'currency_code',decode(card_data->>'sensitive_payload_b64','base64'),decode(card_data->>'encryption_nonce_b64','base64'),(card_data->>'encryption_key_version')::smallint) returning version into persisted;
    if card_data->>'kind'='credit' then insert into app_private.credit_card_terms(card_id,user_id,liability_ledger_account_id,payer_account_id,credit_limit,closing_day,due_day) values(requested_id,caller_id,liability_id,nullif(card_data->>'payer_account_id','')::uuid,(card_data->>'credit_limit')::numeric,(card_data->>'closing_day')::smallint,(card_data->>'due_day')::smallint); end if;
  elsif op='update' then
    update app_private.cards set institution_id=nullif(card_data->>'institution_id','')::uuid,linked_account_id=nullif(card_data->>'linked_account_id','')::uuid,network=card_data->>'network',sensitive_payload=decode(card_data->>'sensitive_payload_b64','base64'),encryption_nonce=decode(card_data->>'encryption_nonce_b64','base64'),encryption_key_version=(card_data->>'encryption_key_version')::smallint,archived_at=case when card_data?'archived_at' then nullif(card_data->>'archived_at','')::timestamptz else archived_at end,version=version+1 where id=requested_id and user_id=caller_id and version=expected and currency_code=card_data->>'currency_code' returning version into persisted;
    if not found then raise exception 'Cartão inexistente, alterado ou com moeda incompatível.' using errcode='40001'; end if;
    update app_private.credit_card_terms set payer_account_id=nullif(card_data->>'payer_account_id','')::uuid,credit_limit=(card_data->>'credit_limit')::numeric,closing_day=(card_data->>'closing_day')::smallint,due_day=(card_data->>'due_day')::smallint where card_id=requested_id and user_id=caller_id;
  else delete from app_private.cards where id=requested_id and user_id=caller_id and version=expected; if not found then raise exception 'Cartão inexistente ou alterado.' using errcode='40001'; end if; return query select requested_id,expected+1; return; end if;
  return query select requested_id,persisted;
end; $$;
revoke all on function api.write_card(jsonb) from public,anon;
grant execute on function api.write_card(jsonb) to authenticated;
grant select,insert,update,delete on app_private.cards,app_private.credit_card_terms to authenticated;
