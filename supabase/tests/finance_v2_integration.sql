-- Integration checks for the Finance v2 surface, run against a real database
-- with RLS forced. Two synthetic users prove tenant isolation; every financial
-- fact is written through the api schema exactly as the Edge Function does.
\set ON_ERROR_STOP on
\timing off
\set QUIET on

begin;

create extension if not exists pgcrypto;

-- Deterministic identities so failures are readable, and a clean slate so the
-- suite can be run repeatedly against the same database.
delete from auth.users where email in ('ana@example.test', 'bruno@example.test');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('11111111-1111-4111-8111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ana@example.test', '', now(), '{}'::jsonb, '{"display_name":"Ana"}'::jsonb, now(), now()),
  ('22222222-2222-4222-8222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bruno@example.test', '', now(), '{}'::jsonb, '{"display_name":"Bruno"}'::jsonb, now(), now())
on conflict (id) do nothing;

commit;

-- ---------------------------------------------------------------------------
create or replace function pg_temp.expect(condition boolean, label text)
returns void language plpgsql as $$
begin
  if condition then
    raise notice 'ok   %', label;
  else
    raise exception 'FAIL %', label;
  end if;
end;
$$;

create or replace function pg_temp.expect_eq(actual numeric, expected numeric, label text)
returns void language plpgsql as $$
begin
  if actual is not distinct from expected or (actual is not null and expected is not null and abs(actual - expected) < 0.0000001) then
    raise notice 'ok   % (%)', label, actual;
  else
    raise exception 'FAIL % expected % got %', label, expected, actual;
  end if;
end;
$$;

create or replace function pg_temp.become(who uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, false);
  execute 'set role authenticated';
end;
$$;

create or replace function pg_temp.become_owner()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- The v2 trigger must have seeded a profile and the 17 default categories.
do $$
declare ana uuid := '11111111-1111-4111-8111-111111111111';
begin
  perform pg_temp.expect(exists (select 1 from app_private.profiles where user_id = ana), 'v2 profile seeded by trigger');
  perform pg_temp.expect_eq((select count(*) from app_private.categories where user_id = ana), 17, 'v2 seeded 17 default categories');
  perform pg_temp.expect_eq((select count(*) from app_private.categories where user_id = ana and flow = 'income'), 8, 'v2 seeded 8 income categories');
end;
$$;

-- The legacy catalog reached the v2 catalog schema.
do $$
begin
  perform pg_temp.expect(
    (select count(*) from catalog.financial_institutions) >= 16,
    'legacy institutions migrated into catalog');
  perform pg_temp.expect(
    exists (select 1 from catalog.financial_institutions where slug = 'nubank'),
    'nubank present in v2 catalog');
end;
$$;

-- ---------------------------------------------------------------------------
-- Ana builds accounts, a card and an investment through the api surface only.
do $$
declare
  ana uuid := '11111111-1111-4111-8111-111111111111';
  checking uuid;
  broker uuid;
  card uuid;
  asset uuid;
  holding uuid;
  category uuid;
  written jsonb;
  ids record;
begin
  perform pg_temp.become(ana);

  select (api.write_account(jsonb_build_object(
    'operation', 'create',
    'account', jsonb_build_object(
      'kind', 'bank', 'currency_code', 'BRL',
      'sensitive_payload_b64', encode('conta-corrente-cifrada', 'base64'),
      'encryption_nonce_b64', encode(gen_random_bytes(12), 'base64'),
      'encryption_key_version', 1)))).account_id into checking;
  perform pg_temp.expect(checking is not null, 'account created through api.write_account');

  select (api.write_account(jsonb_build_object(
    'operation', 'create',
    'account', jsonb_build_object(
      'kind', 'brokerage', 'currency_code', 'BRL',
      'sensitive_payload_b64', encode('corretora-cifrada', 'base64'),
      'encryption_nonce_b64', encode(gen_random_bytes(12), 'base64'),
      'encryption_key_version', 1)))).account_id into broker;

  -- Optimistic locking has to accept the version the api itself reported.
  perform api.write_account(jsonb_build_object(
    'operation', 'update', 'id', checking, 'expected_version', 1,
    'account', jsonb_build_object(
      'kind', 'bank', 'currency_code', 'BRL',
      'sensitive_payload_b64', encode('conta-corrente-renomeada', 'base64'),
      'encryption_nonce_b64', encode(gen_random_bytes(12), 'base64'),
      'encryption_key_version', 1)));
  perform pg_temp.expect_eq((select version from app_private.accounts where id = checking), 2, 'account update bumped the version');

  begin
    perform api.write_account(jsonb_build_object(
      'operation', 'update', 'id', checking, 'expected_version', 1,
      'account', jsonb_build_object('kind', 'bank', 'currency_code', 'BRL',
        'sensitive_payload_b64', encode('stale', 'base64'),
        'encryption_nonce_b64', encode(gen_random_bytes(12), 'base64'),
        'encryption_key_version', 1)));
    raise exception 'FAIL stale account update was accepted';
  exception when sqlstate '40001' then
    raise notice 'ok   stale account update rejected';
  end;

  select (api.write_card(jsonb_build_object(
    'operation', 'create',
    'card', jsonb_build_object(
      'kind', 'credit', 'network', 'visa', 'currency_code', 'BRL',
      'credit_limit', '5000', 'closing_day', 20, 'due_day', 28,
      'payer_account_id', checking,
      'sensitive_payload_b64', encode('cartao-cifrado', 'base64'),
      'encryption_nonce_b64', encode(gen_random_bytes(12), 'base64'),
      'encryption_key_version', 1)))).card_id into card;
  perform pg_temp.expect(
    exists (select 1 from app_private.credit_card_terms t
            join app_private.ledger_accounts l on l.id = t.liability_ledger_account_id
            where t.card_id = card and l.kind = 'credit_card_liability'),
    'credit card created its liability ledger account');

  -- The update path of a card must be reachable, not only its creation.
  perform api.write_card(jsonb_build_object(
    'operation', 'update', 'id', card, 'expected_version', 1,
    'card', jsonb_build_object(
      'kind', 'credit', 'network', 'mastercard', 'currency_code', 'BRL',
      'credit_limit', '7000', 'closing_day', 20, 'due_day', 28,
      'payer_account_id', checking,
      'sensitive_payload_b64', encode('cartao-cifrado-2', 'base64'),
      'encryption_nonce_b64', encode(gen_random_bytes(12), 'base64'),
      'encryption_key_version', 1)));
  perform pg_temp.expect_eq((select version from app_private.cards where id = card), 2, 'card update bumped the version');
  perform pg_temp.expect_eq((select credit_limit from app_private.credit_card_terms where card_id = card), 7000, 'card update reached the credit terms');

  select asset_id, holding_id into ids from api.write_investment_asset(jsonb_build_object(
    'operation', 'create',
    'asset', jsonb_build_object(
      'asset_type_code', 'stock', 'currency_code', 'BRL', 'custody_account_id', broker,
      'sensitive_payload_b64', encode('ativo-cifrado', 'base64'),
      'encryption_nonce_b64', encode(gen_random_bytes(12), 'base64'),
      'encryption_key_version', 1)));
  asset := ids.asset_id; holding := ids.holding_id;
  perform pg_temp.expect(holding is not null, 'investment asset created its holding');

  perform api.write_investment_asset(jsonb_build_object(
    'operation', 'update', 'id', asset, 'expected_version', 1,
    'asset', jsonb_build_object(
      'asset_type_code', 'stock', 'currency_code', 'BRL', 'custody_account_id', broker,
      'sensitive_payload_b64', encode('ativo-cifrado-2', 'base64'),
      'encryption_nonce_b64', encode(gen_random_bytes(12), 'base64'),
      'encryption_key_version', 1)));
  perform pg_temp.expect_eq((select version from app_private.investment_assets where id = asset), 2, 'investment asset update bumped the version');

  select id into category from app_private.categories where user_id = ana and flow = 'expense' and name = 'Alimentação';

  -- Cash events resolve their own ledger legs.
  perform api.write_cash_event(jsonb_build_object(
    'operation', 'create',
    'event', jsonb_build_object(
      'kind', 'opening_balance', 'source', 'manual', 'occurred_at', '2026-01-01T12:00:00Z',
      'amount', '10000', 'account_id', checking, 'increases_balance', true,
      'sensitive_payload_b64', encode('saldo-inicial', 'base64'),
      'encryption_nonce_b64', encode(gen_random_bytes(12), 'base64'),
      'encryption_key_version', 1)));

  perform api.write_cash_event(jsonb_build_object(
    'operation', 'create',
    'event', jsonb_build_object(
      'kind', 'expense', 'source', 'manual', 'occurred_at', '2026-01-05T12:00:00Z',
      'amount', '250.50', 'account_id', checking, 'category_id', category,
      'sensitive_payload_b64', encode('mercado', 'base64'),
      'encryption_nonce_b64', encode(gen_random_bytes(12), 'base64'),
      'encryption_key_version', 1)));

  perform api.write_cash_event(jsonb_build_object(
    'operation', 'create',
    'event', jsonb_build_object(
      'kind', 'internal_transfer', 'source', 'manual', 'occurred_at', '2026-01-06T12:00:00Z',
      'amount', '2000', 'account_id', checking, 'counterpart_account_id', broker,
      'sensitive_payload_b64', encode('transferencia', 'base64'),
      'encryption_nonce_b64', encode(gen_random_bytes(12), 'base64'),
      'encryption_key_version', 1)));

  set constraints all immediate;

  perform pg_temp.expect_eq(
    (select balance from api.account_balances() where account_id = checking), 7749.50,
    'checking balance derived from the ledger');
  perform pg_temp.expect_eq(
    (select balance from api.account_balances() where account_id = broker), 2000,
    'brokerage balance derived from the ledger');

  perform pg_temp.become_owner();
end;
$$;

-- ---------------------------------------------------------------------------
-- Investment operations: every number below is replayed from the operations,
-- never read from a stored position column.
do $$
declare
  ana uuid := '11111111-1111-4111-8111-111111111111';
  broker uuid;
  second_broker uuid;
  asset uuid;
  holding uuid;
  destination uuid;
  position record;
begin
  perform pg_temp.become(ana);
  select id into broker from app_private.accounts where user_id = ana and kind = 'brokerage' order by created_at limit 1;
  select id into asset from app_private.investment_assets where user_id = ana order by created_at limit 1;
  select id into holding from app_private.investment_holdings where user_id = ana and asset_id = asset limit 1;

  -- Opening position: 100 units costing 1000.
  perform api.write_investment_operation(jsonb_build_object(
    'operation', 'opening', 'holding_id', holding,
    'traded_at', '2026-01-02T12:00:00Z', 'quantity', '100', 'principal_amount', '1000',
    'event', jsonb_build_object('source', 'manual',
      'sensitive_payload_b64', encode('posicao-inicial', 'base64'),
      'encryption_nonce_b64', encode(gen_random_bytes(12), 'base64'),
      'encryption_key_version', 1)));

  select * into position from api.investment_positions() where holding_id = holding;
  perform pg_temp.expect_eq(position.quantity, 100, 'opening quantity replayed');
  perform pg_temp.expect_eq(position.cost_basis, 1000, 'opening cost basis replayed');
  perform pg_temp.expect_eq(position.average_price, 10, 'opening average price replayed');

  -- Buy 50 at 12 with 5 of brokerage. Charges belong to the cost basis.
  perform api.write_investment_operation(jsonb_build_object(
    'operation', 'buy', 'holding_id', holding, 'cash_account_id', broker,
    'traded_at', '2026-01-07T12:00:00Z', 'quantity', '50', 'unit_price', '12',
    'charges', jsonb_build_array(jsonb_build_object('kind', 'brokerage', 'amount', '5')),
    'event', jsonb_build_object('source', 'manual',
      'sensitive_payload_b64', encode('compra', 'base64'),
      'encryption_nonce_b64', encode(gen_random_bytes(12), 'base64'),
      'encryption_key_version', 1)));

  select * into position from api.investment_positions() where holding_id = holding;
  perform pg_temp.expect_eq(position.quantity, 150, 'quantity after buy');
  perform pg_temp.expect_eq(position.cost_basis, 1605, 'cost basis after buy includes charges');
  perform pg_temp.expect_eq(position.average_price, 10.7, 'average price after buy');

  -- Sell 30 at 15 with 2 of brokerage.
  perform api.write_investment_operation(jsonb_build_object(
    'operation', 'sell', 'holding_id', holding, 'cash_account_id', broker,
    'traded_at', '2026-01-09T12:00:00Z', 'quantity', '30', 'unit_price', '15',
    'charges', jsonb_build_array(jsonb_build_object('kind', 'brokerage', 'amount', '2')),
    'event', jsonb_build_object('source', 'manual',
      'sensitive_payload_b64', encode('venda', 'base64'),
      'encryption_nonce_b64', encode(gen_random_bytes(12), 'base64'),
      'encryption_key_version', 1)));

  select * into position from api.investment_positions() where holding_id = holding;
  perform pg_temp.expect_eq(position.quantity, 120, 'quantity after sale');
  perform pg_temp.expect_eq(position.cost_basis, 1284, 'cost basis after sale removes average cost');
  perform pg_temp.expect_eq(position.realized_result, 127, 'realized result after sale');

  -- A dividend with withholding pays the net into the brokerage account.
  perform api.write_investment_operation(jsonb_build_object(
    'operation', 'income', 'holding_id', holding, 'cash_account_id', broker,
    'traded_at', '2026-01-15T12:00:00Z', 'gross_amount', '100', 'withheld_tax', '15',
    'income_kind', 'dividend', 'payment_date', '2026-01-15',
    'event', jsonb_build_object('source', 'manual',
      'sensitive_payload_b64', encode('dividendo', 'base64'),
      'encryption_nonce_b64', encode(gen_random_bytes(12), 'base64'),
      'encryption_key_version', 1)));

  select * into position from api.investment_positions() where holding_id = holding;
  perform pg_temp.expect_eq(position.income_gross, 100, 'gross income recorded');
  perform pg_temp.expect_eq(position.income_withheld, 15, 'withheld tax recorded');
  perform pg_temp.expect_eq(position.cost_basis, 1284, 'a cash dividend leaves the cost basis alone');

  -- Custody transfer of 20 units to a second broker.
  select (api.write_account(jsonb_build_object(
    'operation', 'create',
    'account', jsonb_build_object('kind', 'brokerage', 'currency_code', 'BRL',
      'sensitive_payload_b64', encode('corretora-2', 'base64'),
      'encryption_nonce_b64', encode(gen_random_bytes(12), 'base64'),
      'encryption_key_version', 1)))).account_id into second_broker;
  select api.write_investment_holding(jsonb_build_object(
    'asset_id', asset, 'custody_account_id', second_broker)) into destination;

  perform api.write_investment_operation(jsonb_build_object(
    'operation', 'transfer', 'holding_id', holding, 'destination_holding_id', destination,
    'traded_at', '2026-01-20T12:00:00Z', 'quantity', '20',
    'event', jsonb_build_object('source', 'manual',
      'sensitive_payload_b64', encode('transferencia-custodia', 'base64'),
      'encryption_nonce_b64', encode(gen_random_bytes(12), 'base64'),
      'encryption_key_version', 1),
    'paired_event', jsonb_build_object(
      'sensitive_payload_b64', encode('transferencia-custodia-destino', 'base64'),
      'encryption_nonce_b64', encode(gen_random_bytes(12), 'base64'),
      'encryption_key_version', 1)));

  set constraints all immediate;

  select * into position from api.investment_positions() where holding_id = holding;
  perform pg_temp.expect_eq(position.quantity, 100, 'quantity after custody transfer out');
  perform pg_temp.expect_eq(position.cost_basis, 1070, 'cost basis after custody transfer out');
  perform pg_temp.expect_eq(position.custody_balance, 1070, 'custody ledger agrees with the replayed cost basis');
  perform pg_temp.expect_eq(position.realized_result, 127, 'a custody transfer realizes nothing');

  select * into position from api.investment_positions() where holding_id = destination;
  perform pg_temp.expect_eq(position.quantity, 20, 'quantity arrived at the destination custody');
  perform pg_temp.expect_eq(position.cost_basis, 214, 'cost basis travelled with the units');

  perform pg_temp.expect_eq(
    (select balance from api.account_balances() where account_id = broker), 1928,
    'brokerage cash after buy, sale and dividend');

  -- A sale larger than the position must be impossible.
  begin
    perform api.write_investment_operation(jsonb_build_object(
      'operation', 'sell', 'holding_id', holding, 'cash_account_id', broker,
      'traded_at', '2026-01-25T12:00:00Z', 'quantity', '5000', 'unit_price', '15',
      'event', jsonb_build_object('source', 'manual',
        'sensitive_payload_b64', encode('venda-invalida', 'base64'),
        'encryption_nonce_b64', encode(gen_random_bytes(12), 'base64'),
        'encryption_key_version', 1)));
    raise exception 'FAIL oversized sale was accepted';
  exception when sqlstate '22023' then
    raise notice 'ok   oversized sale rejected';
  end;

  -- A quote only changes market value; it never touches the cost basis.
  perform api.write_asset_quote(jsonb_build_object('asset_id', asset, 'unit_price', '18', 'observed_at', '2026-01-31T12:00:00Z'));
  select * into position from api.investment_positions() where holding_id = holding;
  perform pg_temp.expect_eq(position.market_value, 1800, 'market value uses the latest quote');
  perform pg_temp.expect_eq(position.cost_basis, 1070, 'a quote does not disturb the cost basis');

  perform pg_temp.become_owner();
end;
$$;

-- ---------------------------------------------------------------------------
-- Deleting an operation must correct the position with no compensating row.
do $$
declare
  ana uuid := '11111111-1111-4111-8111-111111111111';
  holding uuid;
  target uuid;
  position record;
begin
  perform pg_temp.become(ana);
  select h.id into holding
  from app_private.investment_holdings h
  join app_private.investment_transactions t on t.holding_id = h.id
  where h.user_id = ana and t.operation = 'buy' limit 1;

  select t.event_id into target
  from app_private.investment_transactions t
  where t.holding_id = holding and t.operation = 'buy' limit 1;

  perform api.delete_investment_operation(target);
  set constraints all immediate;

  select * into position from api.investment_positions() where holding_id = holding;
  perform pg_temp.expect_eq(position.quantity, 50, 'deleting the purchase replays a smaller position');
  perform pg_temp.expect(
    not exists (select 1 from app_private.ledger_postings where event_id = target),
    'deleting the event cascaded its postings');

  perform pg_temp.become_owner();
end;
$$;

-- ---------------------------------------------------------------------------
-- Card purchases split into invoice months, and paying one settles the liability.
do $$
declare
  ana uuid := '11111111-1111-4111-8111-111111111111';
  card uuid;
  checking uuid;
  written jsonb;
  invoice record;
begin
  perform pg_temp.become(ana);
  select id into card from app_private.cards where user_id = ana limit 1;
  select id into checking from app_private.accounts where user_id = ana and kind = 'bank' limit 1;

  select api.write_card_transaction(jsonb_build_object(
    'card_id', card, 'kind', 'purchase', 'amount', '300', 'installments', 3,
    'occurred_at', '2026-01-10T12:00:00Z',
    'installment_events', jsonb_build_array(
      jsonb_build_object('id', gen_random_uuid(), 'sensitive_payload_b64', encode('parcela-1', 'base64'), 'encryption_nonce_b64', encode(gen_random_bytes(12), 'base64'), 'encryption_key_version', 1),
      jsonb_build_object('id', gen_random_uuid(), 'sensitive_payload_b64', encode('parcela-2', 'base64'), 'encryption_nonce_b64', encode(gen_random_bytes(12), 'base64'), 'encryption_key_version', 1),
      jsonb_build_object('id', gen_random_uuid(), 'sensitive_payload_b64', encode('parcela-3', 'base64'), 'encryption_nonce_b64', encode(gen_random_bytes(12), 'base64'), 'encryption_key_version', 1)),
    'event', jsonb_build_object('source', 'manual'))) into written;

  set constraints all immediate;

  perform pg_temp.expect_eq(jsonb_array_length(written -> 'event_ids'), 3, 'three installments produced three events');
  perform pg_temp.expect(
    (written ->> 'first_invoice_month') = '2026-01-01',
    'a purchase before the closing day lands in the current invoice');
  perform pg_temp.expect_eq((select count(*) from api.card_invoices() where card_id = card), 3, 'three invoice months opened');
  perform pg_temp.expect_eq((select balance from api.card_balances() where card_id = card), -300, 'card liability owes the full purchase');

  select * into invoice from api.card_invoices() where card_id = card order by invoice_month limit 1;
  perform pg_temp.expect_eq(invoice.total, -100, 'the first invoice carries one installment');

  perform api.pay_card_invoice(jsonb_build_object(
    'card_id', card, 'account_id', checking, 'amount', '100', 'occurred_at', '2026-02-28T12:00:00Z',
    'event', jsonb_build_object('source', 'manual',
      'sensitive_payload_b64', encode('pagamento-fatura', 'base64'),
      'encryption_nonce_b64', encode(gen_random_bytes(12), 'base64'),
      'encryption_key_version', 1)));
  set constraints all immediate;

  perform pg_temp.expect_eq((select balance from api.card_balances() where card_id = card), -200, 'paying the invoice reduced the liability');
  perform pg_temp.expect_eq((select balance from api.account_balances() where account_id = checking), 7649.50, 'paying the invoice left the paying account');

  -- A debit card has no invoice to accumulate.
  perform pg_temp.become_owner();
end;
$$;

-- ---------------------------------------------------------------------------
-- Imports keep a batch, a period and a keyed fingerprint. Nothing else.
do $$
declare
  ana uuid := '11111111-1111-4111-8111-111111111111';
  first_batch record;
  second_batch record;
begin
  perform pg_temp.become(ana);
  select * into first_batch from api.write_import_batch(jsonb_build_object(
    'operation', 'create',
    'batch', jsonb_build_object(
      'kind', 'account_statement',
      'fingerprint_hmac_b64', encode(gen_random_bytes(32) || 'fixo'::bytea, 'base64'),
      'period_start', '2026-01-01', 'period_end', '2026-01-31',
      'sensitive_payload_b64', encode('metadados-importacao', 'base64'),
      'encryption_nonce_b64', encode(gen_random_bytes(12), 'base64'),
      'encryption_key_version', 1)));
  perform pg_temp.expect(first_batch.created, 'the first import created a batch');

  select * into second_batch from api.write_import_batch(jsonb_build_object(
    'operation', 'create',
    'batch', jsonb_build_object(
      'kind', 'account_statement',
      'fingerprint_hmac_b64', (select encode(fingerprint_hmac, 'base64') from app_private.import_batches where id = first_batch.batch_id),
      'period_start', '2026-01-01', 'period_end', '2026-01-31',
      'sensitive_payload_b64', encode('metadados-importacao', 'base64'),
      'encryption_nonce_b64', encode(gen_random_bytes(12), 'base64'),
      'encryption_key_version', 1)));
  perform pg_temp.expect(not second_batch.created, 're-importing the same file created nothing');
  perform pg_temp.expect(second_batch.batch_id = first_batch.batch_id, 'the duplicate import resolved to the first batch');

  -- The batch table itself must not be able to hold a document or its text.
  perform pg_temp.expect(
    not exists (
      select 1 from information_schema.columns
      where table_schema = 'app_private' and table_name = 'import_batches'
        and column_name in ('raw_text', 'content', 'file', 'document', 'extracted_text')),
    'import batches have nowhere to store the original document');

  perform pg_temp.become_owner();
end;
$$;

-- ---------------------------------------------------------------------------
-- Tenant isolation. Bruno must see nothing of Ana's, through any door.
do $$
declare
  ana uuid := '11111111-1111-4111-8111-111111111111';
  bruno uuid := '22222222-2222-4222-8222-222222222222';
  ana_account uuid;
  ana_holding uuid;
begin
  perform pg_temp.become(ana);
  select id into ana_account from app_private.accounts where user_id = ana and kind = 'bank' limit 1;
  select id into ana_holding from app_private.investment_holdings where user_id = ana limit 1;

  perform pg_temp.become(bruno);
  perform pg_temp.expect_eq((select count(*) from api.list_accounts()), 0, 'another user lists no accounts');
  perform pg_temp.expect_eq((select count(*) from api.list_cards()), 0, 'another user lists no cards');
  perform pg_temp.expect_eq((select count(*) from api.list_financial_events()), 0, 'another user lists no events');
  perform pg_temp.expect_eq((select count(*) from api.investment_positions()), 0, 'another user sees no positions');
  perform pg_temp.expect_eq((select count(*) from api.account_balances()), 0, 'another user sees no balances');
  perform pg_temp.expect_eq((select count(*) from app_private.accounts), 0, 'row level security hides the private table itself');
  perform pg_temp.expect_eq((select count(*) from app_private.ledger_postings), 0, 'row level security hides the postings');

  -- Naming another tenant's row must not reach it either.
  begin
    perform api.write_account(jsonb_build_object(
      'operation', 'update', 'id', ana_account, 'expected_version', 2,
      'account', jsonb_build_object('kind', 'bank', 'currency_code', 'BRL',
        'sensitive_payload_b64', encode('invasao', 'base64'),
        'encryption_nonce_b64', encode(gen_random_bytes(12), 'base64'),
        'encryption_key_version', 1)));
    raise exception 'FAIL another user updated a foreign account';
  exception when sqlstate '40001' then
    raise notice 'ok   updating a foreign account was refused';
  end;

  begin
    perform api.write_investment_operation(jsonb_build_object(
      'operation', 'opening', 'holding_id', ana_holding,
      'traded_at', '2026-02-01T12:00:00Z', 'principal_amount', '10',
      'event', jsonb_build_object('source', 'manual',
        'sensitive_payload_b64', encode('invasao', 'base64'),
        'encryption_nonce_b64', encode(gen_random_bytes(12), 'base64'),
        'encryption_key_version', 1)));
    raise exception 'FAIL another user wrote into a foreign holding';
  exception when sqlstate '23503' then
    raise notice 'ok   writing into a foreign holding was refused';
  end;

  perform pg_temp.become_owner();
end;
$$;

-- ---------------------------------------------------------------------------
-- An event that does not balance must never reach a commit.
do $$
declare
  ana uuid := '11111111-1111-4111-8111-111111111111';
  checking uuid;
  ledger uuid;
  event_id uuid := gen_random_uuid();
begin
  perform pg_temp.become(ana);
  select id, ledger_account_id into checking, ledger from app_private.accounts where user_id = ana and kind = 'bank' limit 1;
  begin
    insert into app_private.financial_events (id, user_id, kind, occurred_at, sensitive_payload, encryption_nonce, encryption_key_version, source)
    values (event_id, ana, 'expense', now(), 'x'::bytea, gen_random_bytes(12), 1, 'manual');
    insert into app_private.ledger_postings (user_id, event_id, ledger_account_id, amount, currency_code)
    values (ana, event_id, ledger, -10, 'BRL');
    set constraints all immediate;
    raise exception 'FAIL an unbalanced event was accepted';
  exception when sqlstate '23514' then
    raise notice 'ok   unbalanced event rejected by the ledger';
  end;
  perform pg_temp.become_owner();
end;
$$;

-- ---------------------------------------------------------------------------
-- The private schemas must stay unreachable to an unauthenticated caller.
do $$
declare forbidden text;
begin
  perform pg_temp.become_owner();
  select string_agg(format('%s.%s', n.nspname, p.proname), ', ') into forbidden
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'api'
    and has_function_privilege('anon', p.oid, 'execute');
  perform pg_temp.expect(forbidden is null, coalesce('anon cannot execute api routines', 'anon reached: ' || forbidden));

  perform pg_temp.expect(
    not has_schema_privilege('anon', 'app_private', 'usage'),
    'anon has no usage on app_private');
  perform pg_temp.expect(
    not has_schema_privilege('anon', 'catalog', 'usage'),
    'anon has no usage on catalog');
  perform pg_temp.expect(
    (select bool_and(relrowsecurity and relforcerowsecurity)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'app_private' and c.relkind = 'r'),
    'every private table forces row level security');
  perform pg_temp.expect(
    not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('api', 'app_private')
        and p.prokind = 'f'
        and not exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) as c where c like 'search\_path=%')),
    'every api and app_private routine pins its search_path');
end;
$$;

-- ---------------------------------------------------------------------------
-- The delete paths are as much a contract as the writes.
do $$
declare
  ana uuid := '11111111-1111-4111-8111-111111111111';
  throwaway_account uuid;
  throwaway_card uuid;
  throwaway record;
begin
  perform pg_temp.become(ana);

  select (api.write_account(jsonb_build_object(
    'operation', 'create',
    'account', jsonb_build_object('kind', 'wallet', 'currency_code', 'BRL',
      'sensitive_payload_b64', encode('carteira', 'base64'),
      'encryption_nonce_b64', encode(gen_random_bytes(12), 'base64'),
      'encryption_key_version', 1)))).account_id into throwaway_account;
  perform api.write_account(jsonb_build_object('operation', 'delete', 'id', throwaway_account, 'expected_version', 1));
  perform pg_temp.expect_eq((select count(*) from app_private.accounts where id = throwaway_account), 0, 'an account can be deleted');

  select (api.write_card(jsonb_build_object(
    'operation', 'create',
    'card', jsonb_build_object('kind', 'debit', 'network', 'elo', 'currency_code', 'BRL',
      'sensitive_payload_b64', encode('cartao-debito', 'base64'),
      'encryption_nonce_b64', encode(gen_random_bytes(12), 'base64'),
      'encryption_key_version', 1)))).card_id into throwaway_card;
  perform api.write_card(jsonb_build_object('operation', 'delete', 'id', throwaway_card, 'expected_version', 1));
  perform pg_temp.expect_eq((select count(*) from app_private.cards where id = throwaway_card), 0, 'a card can be deleted');

  select asset_id, holding_id into throwaway from api.write_investment_asset(jsonb_build_object(
    'operation', 'create',
    'asset', jsonb_build_object('asset_type_code', 'crypto', 'currency_code', 'BRL',
      'custody_account_id', (select id from app_private.accounts where user_id = ana and kind = 'brokerage' order by created_at limit 1),
      'sensitive_payload_b64', encode('cripto', 'base64'),
      'encryption_nonce_b64', encode(gen_random_bytes(12), 'base64'),
      'encryption_key_version', 1)));
  perform api.write_investment_asset(jsonb_build_object('operation', 'delete', 'id', throwaway.asset_id, 'expected_version', 1));
  perform pg_temp.expect_eq((select count(*) from app_private.investment_assets where id = throwaway.asset_id), 0, 'an investment asset can be deleted');

  perform pg_temp.become_owner();
end;
$$;

-- ---------------------------------------------------------------------------
-- Removing an account has to remove everything it owns, in one transaction.
-- This is the shape the destructive cutover depends on.
do $$
declare
  bruno uuid := '22222222-2222-4222-8222-222222222222';
  ana uuid := '11111111-1111-4111-8111-111111111111';
  before_rows integer;
begin
  perform pg_temp.become_owner();
  select count(*) into before_rows from app_private.ledger_accounts where user_id = ana;
  perform pg_temp.expect(before_rows > 0, 'the tenant about to be removed owns ledger accounts');

  delete from auth.users where id = ana;

  perform pg_temp.expect_eq((select count(*) from app_private.profiles where user_id = ana), 0, 'deleting the user removed the profile');
  perform pg_temp.expect_eq((select count(*) from app_private.ledger_accounts where user_id = ana), 0, 'deleting the user removed the ledger accounts');
  perform pg_temp.expect_eq((select count(*) from app_private.ledger_postings where user_id = ana), 0, 'deleting the user removed the postings');
  perform pg_temp.expect_eq((select count(*) from app_private.credit_card_terms where user_id = ana), 0, 'deleting the user removed the credit terms');
  perform pg_temp.expect_eq((select count(*) from app_private.investment_transactions where user_id = ana), 0, 'deleting the user removed the investment operations');
  perform pg_temp.expect(
    exists (select 1 from auth.users where id = bruno),
    'removing one tenant leaves the other untouched');
end;
$$;

do $$ begin raise notice 'Finance v2 integration suite passed.'; end; $$;
