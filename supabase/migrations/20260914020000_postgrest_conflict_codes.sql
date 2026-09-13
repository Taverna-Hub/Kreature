-- PostgREST 14 treats SQLSTATE 40001 as a transient serialization failure and
-- retries it indefinitely. These are business optimistic-lock conflicts, so
-- surface them as the PostgREST-specific HTTP 409 code instead.
do $$
declare
  target regprocedure;
  original_definition text;
  patched_definition text;
begin
  foreach target in array array[
    'api.write_financial_event(jsonb)'::regprocedure,
    'api.write_cash_event(jsonb)'::regprocedure,
    'api.write_account(jsonb)'::regprocedure,
    'api.write_card(jsonb)'::regprocedure,
    'api.write_investment_asset(jsonb)'::regprocedure,
    'api.write_recurrence_rule(jsonb)'::regprocedure
  ] loop
    original_definition := pg_get_functiondef(target);
    patched_definition := regexp_replace(
      original_definition,
      'errcode\s*=\s*''40001''',
      'errcode = ''PT409''',
      'gi'
    );

    if patched_definition = original_definition then
      if original_definition ~ 'errcode\s*=\s*''PT409''' then
        continue;
      end if;
      raise exception 'Expected an optimistic-lock SQLSTATE 40001 in function %.', target;
    end if;

    execute patched_definition;
  end loop;
end;
$$;