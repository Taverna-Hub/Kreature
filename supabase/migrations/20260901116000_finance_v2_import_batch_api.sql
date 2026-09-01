create or replace function api.write_import_batch(p_command jsonb)
returns table (batch_id uuid)
language plpgsql security invoker set search_path = '' as $$
declare caller_id uuid:=auth.uid(); op text:=p_command->>'operation'; payload jsonb:=p_command->'batch'; requested uuid:=nullif(p_command->>'id','')::uuid;
begin
 if caller_id is null then raise exception 'Sessão inválida.' using errcode='42501'; end if;
 if op not in ('create','delete') then raise exception 'Operação de importação inválida.' using errcode='22023'; end if;
 if op='create' then
  requested:=coalesce(requested,gen_random_uuid());
  insert into app_private.import_batches(id,user_id,kind,fingerprint_hmac,sensitive_payload,encryption_nonce,encryption_key_version,period_start,period_end) values(requested,caller_id,payload->>'kind',decode(payload->>'fingerprint_hmac_b64','base64'),decode(payload->>'sensitive_payload_b64','base64'),decode(payload->>'encryption_nonce_b64','base64'),(payload->>'encryption_key_version')::smallint,nullif(payload->>'period_start','')::date,nullif(payload->>'period_end','')::date);
 else delete from app_private.import_batches where id=requested and user_id=caller_id; if not found then raise exception 'Lote inexistente.' using errcode='P0002'; end if; end if;
 return query select requested;
end; $$;
revoke all on function api.write_import_batch(jsonb) from public,anon;
grant execute on function api.write_import_batch(jsonb) to authenticated;
grant select,insert,delete on app_private.import_batches to authenticated;
