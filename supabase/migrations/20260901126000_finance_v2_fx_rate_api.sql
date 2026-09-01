-- A conversion rate is a number used in calculations, so it stays relational
-- and versioned by observation instead of living inside an encrypted blob or
-- being overwritten in place on the account.
create or replace function api.list_fx_rates()
returns table (
  id uuid,
  base_currency_code text,
  quote_currency_code text,
  rate numeric,
  observed_at timestamptz,
  source text
)
language sql security invoker set search_path = '' stable as $$
  select distinct on (fx.base_currency_code, fx.quote_currency_code)
         fx.id, fx.base_currency_code, fx.quote_currency_code, fx.rate, fx.observed_at, fx.source
  from app_private.operation_fx_rates as fx
  where fx.user_id = (select auth.uid())
  order by fx.base_currency_code, fx.quote_currency_code, fx.observed_at desc, fx.id desc;
$$;

create or replace function api.write_fx_rate(p_command jsonb)
returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  caller_id uuid := auth.uid();
  base_code text := p_command ->> 'base_currency_code';
  quote_code text := p_command ->> 'quote_currency_code';
  rate numeric := nullif(p_command ->> 'rate', '')::numeric;
  observed_at timestamptz := coalesce(nullif(p_command ->> 'observed_at', '')::timestamptz, now());
  rate_id uuid;
begin
  if caller_id is null then raise exception 'Sessão inválida.' using errcode = '42501'; end if;
  if base_code is null or quote_code is null or base_code = quote_code then
    raise exception 'Par de moedas inválido.' using errcode = '22023';
  end if;
  if rate is null or rate <= 0 then
    raise exception 'A cotação deve ser maior que zero.' using errcode = '22023';
  end if;

  insert into app_private.operation_fx_rates (user_id, base_currency_code, quote_currency_code, rate, observed_at, source)
  values (caller_id, base_code, quote_code, rate, observed_at, coalesce(p_command ->> 'source', 'manual'))
  returning id into rate_id;
  return rate_id;
end;
$$;

do $$
declare routine text;
begin
  foreach routine in array array['api.list_fx_rates()', 'api.write_fx_rate(jsonb)'] loop
    execute format('revoke all on function %s from public, anon', routine);
    execute format('grant execute on function %s to authenticated', routine);
  end loop;
end;
$$;
