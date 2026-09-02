-- Reuses a statement debit as the invoice settlement instead of creating a second debit.
alter function api.pay_card_invoice(jsonb) rename to pay_card_invoice_legacy;

create function api.pay_card_invoice(p_command jsonb)
returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  caller_id uuid := auth.uid();
  requested_event_id uuid := nullif(p_command ->> 'event_id', '')::uuid;
  previous_import_batch_id uuid;
  existing_kind app_private.financial_event_kind;
  reused boolean := false;
  settled_event_id uuid;
begin
  if requested_event_id is not null then
    select import_batch_id, kind
    into previous_import_batch_id, existing_kind
    from app_private.financial_events
    where id = requested_event_id and user_id = caller_id;
    if found then
      if existing_kind <> 'expense' then
        raise exception 'Only an imported expense can be reconciled as an invoice payment.' using errcode = '22023';
      end if;
      delete from app_private.financial_events where id = requested_event_id and user_id = caller_id;
      reused := true;
    end if;
  end if;

  settled_event_id := api.pay_card_invoice_legacy(p_command);

  if reused and previous_import_batch_id is not null then
    update app_private.financial_events
    set import_batch_id = previous_import_batch_id
    where id = settled_event_id and user_id = caller_id;
  end if;

  return settled_event_id;
end
$$;

revoke all on function api.pay_card_invoice(jsonb) from public, anon;
grant execute on function api.pay_card_invoice(jsonb) to authenticated;
