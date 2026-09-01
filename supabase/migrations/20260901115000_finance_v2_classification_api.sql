create or replace function api.write_classification_rule(p_command jsonb)
returns table (rule_id uuid)
language plpgsql security invoker set search_path = '' as $$
declare caller_id uuid:=auth.uid(); op text:=p_command->>'operation'; payload jsonb:=p_command->'rule'; requested uuid:=nullif(p_command->>'id','')::uuid;
begin
 if caller_id is null then raise exception 'Sessão inválida.' using errcode='42501'; end if;
 if op not in ('create','update','delete') then raise exception 'Operação de regra inválida.' using errcode='22023'; end if;
 if op='create' then insert into app_private.classification_rules(user_id,category_id,flow,match_hmac,sensitive_payload,encryption_nonce,encryption_key_version) values(caller_id,(payload->>'category_id')::uuid,payload->>'flow',decode(payload->>'match_hmac_b64','base64'),decode(payload->>'sensitive_payload_b64','base64'),decode(payload->>'encryption_nonce_b64','base64'),(payload->>'encryption_key_version')::smallint) returning id into requested;
 elsif op='update' then update app_private.classification_rules set category_id=(payload->>'category_id')::uuid,flow=payload->>'flow',match_hmac=decode(payload->>'match_hmac_b64','base64'),sensitive_payload=decode(payload->>'sensitive_payload_b64','base64'),encryption_nonce=decode(payload->>'encryption_nonce_b64','base64'),encryption_key_version=(payload->>'encryption_key_version')::smallint where id=requested and user_id=caller_id; if not found then raise exception 'Regra inexistente.' using errcode='P0002'; end if;
 else delete from app_private.classification_rules where id=requested and user_id=caller_id; if not found then raise exception 'Regra inexistente.' using errcode='P0002'; end if; end if;
 return query select requested;
end; $$;
revoke all on function api.write_classification_rule(jsonb) from public,anon;
grant execute on function api.write_classification_rule(jsonb) to authenticated;
grant select,insert,update,delete on app_private.classification_rules to authenticated;
