-- A settlement is a fact about one card invoice. Keeping the invoice month in
-- a relational key makes repeated imports idempotent without searching
-- encrypted descriptions or storing the raw file.
create table app_private.card_invoice_settlements (
  event_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id uuid not null,
  account_id uuid not null,
  invoice_month date not null,
  created_at timestamptz not null default now(),
  unique (event_id, user_id),
  unique (user_id, card_id, invoice_month),
  foreign key (event_id, user_id) references app_private.financial_events(id, user_id) on delete cascade,
  foreign key (card_id, user_id) references app_private.cards(id, user_id) on delete restrict,
  foreign key (account_id, user_id) references app_private.accounts(id, user_id) on delete restrict
);

alter table app_private.card_invoice_settlements enable row level security;
alter table app_private.card_invoice_settlements force row level security;
create policy card_invoice_settlements_select_own on app_private.card_invoice_settlements
  for select to authenticated using ((select auth.uid()) = user_id);
create policy card_invoice_settlements_insert_own on app_private.card_invoice_settlements
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy card_invoice_settlements_update_own on app_private.card_invoice_settlements
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy card_invoice_settlements_delete_own on app_private.card_invoice_settlements
  for delete to authenticated using ((select auth.uid()) = user_id);
create index card_invoice_settlements_user_id_idx on app_private.card_invoice_settlements (user_id);
grant select, insert, update, delete on app_private.card_invoice_settlements to authenticated;

create or replace function api.pay_card_invoice(p_command jsonb)
returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  caller_id uuid := auth.uid();
  event_data jsonb := p_command -> 'event';
  target_card_id uuid := nullif(p_command ->> 'card_id', '')::uuid;
  settlement_account_id uuid := nullif(p_command ->> 'account_id', '')::uuid;
  amount numeric := nullif(p_command ->> 'amount', '')::numeric;
  occurred_at timestamptz := coalesce(nullif(p_command ->> 'occurred_at', '')::timestamptz, now());
  invoice_month date := date_trunc('month', coalesce(nullif(p_command ->> 'invoice_month', '')::date, occurred_at::date)::timestamp)::date;
  card record;
  cash_ledger uuid;
  cash_currency text;
  event_id uuid;
begin
  if caller_id is null then raise exception 'Sessão inválida.' using errcode = '42501'; end if;
  if amount is null or amount <= 0 then
    raise exception 'Valor da fatura deve ser maior que zero.' using errcode = '22023';
  end if;

  select cards.currency_code, terms.liability_ledger_account_id, terms.payer_account_id into card
  from app_private.cards as cards
  join app_private.credit_card_terms as terms
    on terms.card_id = cards.id and terms.user_id = cards.user_id
  where cards.id = target_card_id and cards.user_id = caller_id;
  if not found then raise exception 'Cartão de crédito inexistente.' using errcode = '23503'; end if;
  settlement_account_id := coalesce(settlement_account_id, card.payer_account_id);
  if settlement_account_id is null then
    raise exception 'Defina a conta pagadora deste cartão.' using errcode = '22023';
  end if;

  -- Serializes concurrent statement/invoice imports for this exact invoice.
  perform pg_advisory_xact_lock(hashtextextended(concat_ws(':', caller_id::text, target_card_id::text, invoice_month::text), 0));
  select settlement.event_id into event_id
  from app_private.card_invoice_settlements as settlement
  where settlement.user_id = caller_id
    and settlement.card_id = target_card_id
    and settlement.invoice_month = invoice_month;
  if found then return event_id; end if;

  select accounts.ledger_account_id, accounts.currency_code into cash_ledger, cash_currency
  from app_private.accounts as accounts
  where accounts.id = settlement_account_id and accounts.user_id = caller_id and accounts.archived_at is null;
  if not found then raise exception 'Conta pagadora inexistente ou arquivada.' using errcode = '23503'; end if;
  if cash_currency <> card.currency_code then
    raise exception 'Pagamento em moeda diferente da fatura exige câmbio explícito.' using errcode = '22023';
  end if;

  event_id := coalesce(nullif(p_command ->> 'event_id', '')::uuid, gen_random_uuid());
  insert into app_private.financial_events (
    id, user_id, kind, occurred_at, sensitive_payload, encryption_nonce, encryption_key_version, source
  ) values (
    event_id, caller_id, 'credit_card_payment', occurred_at,
    decode(event_data ->> 'sensitive_payload_b64', 'base64'),
    decode(event_data ->> 'encryption_nonce_b64', 'base64'),
    (event_data ->> 'encryption_key_version')::smallint,
    coalesce(event_data ->> 'source', 'manual')
  );
  insert into app_private.ledger_postings (user_id, event_id, ledger_account_id, amount, currency_code)
  values (caller_id, event_id, card.liability_ledger_account_id, amount, card.currency_code),
         (caller_id, event_id, cash_ledger, -amount, card.currency_code);
  insert into app_private.card_invoice_settlements (event_id, user_id, card_id, account_id, invoice_month)
  values (event_id, caller_id, target_card_id, settlement_account_id, invoice_month);
  return event_id;
end;
$$;

revoke all on function api.pay_card_invoice(jsonb) from public, anon;
grant execute on function api.pay_card_invoice(jsonb) to authenticated;
