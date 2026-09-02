create or replace function api.write_recurrence_rule(p_command jsonb)
returns table (rule_id uuid, rule_version integer)
language plpgsql security invoker set search_path = '' as $$
declare caller_id uuid:=auth.uid(); op text:=p_command->>'operation'; payload jsonb:=p_command->'rule'; requested uuid:=nullif(p_command->>'id','')::uuid; expected integer:=nullif(p_command->>'expected_version','')::integer; persisted integer;
begin
 if caller_id is null then raise exception 'Sessão inválida.' using errcode='42501'; end if;
 if op not in ('create','update','delete') then raise exception 'Operação de planejamento inválida.' using errcode='22023'; end if;
 if op in ('update','delete') and (requested is null or expected is null) then raise exception 'ID e versão esperada são obrigatórios.' using errcode='22023'; end if;
 if op='create' then
  requested:=coalesce(requested,gen_random_uuid());
  insert into app_private.recurrence_rules(id,user_id,category_id,account_id,card_id,flow,frequency,start_date,end_date,occurrence_count,amount,currency_code,payment_method,sensitive_payload,encryption_nonce,encryption_key_version) values(requested,caller_id,nullif(payload->>'category_id','')::uuid,nullif(payload->>'account_id','')::uuid,nullif(payload->>'card_id','')::uuid,payload->>'flow',payload->>'frequency',(payload->>'start_date')::date,nullif(payload->>'end_date','')::date,nullif(payload->>'occurrence_count','')::integer,(payload->>'amount')::numeric,payload->>'currency_code',payload->>'payment_method',decode(payload->>'sensitive_payload_b64','base64'),decode(payload->>'encryption_nonce_b64','base64'),(payload->>'encryption_key_version')::smallint) returning version into persisted;
 elsif op='update' then
  update app_private.recurrence_rules set category_id=nullif(payload->>'category_id','')::uuid,account_id=nullif(payload->>'account_id','')::uuid,card_id=nullif(payload->>'card_id','')::uuid,flow=payload->>'flow',frequency=payload->>'frequency',start_date=(payload->>'start_date')::date,end_date=nullif(payload->>'end_date','')::date,occurrence_count=nullif(payload->>'occurrence_count','')::integer,amount=(payload->>'amount')::numeric,payment_method=payload->>'payment_method',sensitive_payload=decode(payload->>'sensitive_payload_b64','base64'),encryption_nonce=decode(payload->>'encryption_nonce_b64','base64'),encryption_key_version=(payload->>'encryption_key_version')::smallint,version=version+1 where id=requested and user_id=caller_id and version=expected and currency_code=payload->>'currency_code' returning version into persisted;
  if not found then raise exception 'Planejamento inexistente, alterado ou com moeda incompatível.' using errcode='40001'; end if;
 else delete from app_private.recurrence_rules where id=requested and user_id=caller_id and version=expected; if not found then raise exception 'Planejamento inexistente ou alterado.' using errcode='40001'; end if; return query select requested,expected+1; return; end if;
 return query select requested,persisted;
end; $$;
revoke all on function api.write_recurrence_rule(jsonb) from public,anon;
grant execute on function api.write_recurrence_rule(jsonb) to authenticated;
grant select,insert,update,delete on app_private.recurrence_rules,app_private.planned_occurrences to authenticated;
