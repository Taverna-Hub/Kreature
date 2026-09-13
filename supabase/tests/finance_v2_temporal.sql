-- Included by finance_v2_integration.sql, using its isolated fixture tenants.
do $$
declare
  ana uuid := '11111111-1111-4111-8111-111111111111';
  checking uuid;
  target_card uuid;
  holding uuid;
  zone text;
  envelope jsonb;
  written jsonb;
  cursor_row record;
  first_ids uuid[];
  next_ids uuid[];
begin
  perform pg_temp.become(ana);
  select id into checking from app_private.accounts where user_id = ana and kind = 'bank' limit 1;
  select id into holding from app_private.investment_holdings where user_id = ana limit 1;
  foreach zone in array array['UTC', 'America/Recife', 'Pacific/Kiritimati'] loop
    perform set_config('TimeZone', zone, true);
    envelope := jsonb_build_object('source', 'manual', 'sensitive_payload_b64', encode('temporal-test', 'base64'),
      'encryption_nonce_b64', encode(gen_random_bytes(12), 'base64'), 'encryption_key_version', 1);
    select (api.write_card(jsonb_build_object('operation', 'create', 'card', envelope || jsonb_build_object(
      'kind', 'credit', 'network', 'visa', 'currency_code', 'BRL', 'credit_limit', '5000',
      'closing_day', 13, 'due_day', 20, 'payer_account_id', checking)))).card_id into target_card;
    written := api.write_card_transaction(jsonb_build_object(
      'card_id', target_card, 'kind', 'purchase', 'amount', '300', 'installments', 3,
      'occurred_at', '2026-09-14T02:30:00Z', 'event', jsonb_build_object('source', 'manual'),
      'installment_events', jsonb_build_array(envelope, envelope || jsonb_build_object('encryption_nonce_b64', encode(gen_random_bytes(12), 'base64')), envelope || jsonb_build_object('encryption_nonce_b64', encode(gen_random_bytes(12), 'base64')))));
    perform pg_temp.expect((select min(first_invoice_month) = date '2026-09-01' from app_private.card_transactions where card_id = target_card), 'closing day is still September 13 in Recife: ' || zone);
    perform pg_temp.expect((select array_agg(invoice_month order by invoice_month) = array[date '2026-09-01', date '2026-10-01', date '2026-11-01'] from api.card_invoices() where card_id = target_card), 'installment invoice DATE months remain stable: ' || zone);
    perform api.pay_card_invoice(jsonb_build_object('card_id', target_card, 'account_id', checking,
      'amount', '100', 'occurred_at', '2026-10-01T02:30:00Z', 'event', envelope));
    perform pg_temp.expect(exists(select 1 from app_private.card_invoice_settlements where card_id = target_card and invoice_month = date '2026-09-01'), 'payment defaults to Recife September: ' || zone);
    perform api.write_investment_operation(jsonb_build_object('operation', 'income', 'holding_id', holding,
      'cash_account_id', checking, 'traded_at', '2027-01-01T02:30:00Z', 'gross_amount', '10',
      'withheld_tax', '0', 'income_kind', 'dividend', 'event', envelope));
    perform pg_temp.expect(exists(select 1 from app_private.investment_income_events where user_id = ana and payment_date = date '2026-12-31'), 'income date uses Recife year: ' || zone);
  end loop;
  perform set_config('TimeZone', 'UTC', true);
  for i in 1..1005 loop
    perform api.write_cash_event(jsonb_build_object('operation', 'create', 'event', envelope || jsonb_build_object(
      'kind', 'expense', 'amount', '1', 'account_id', checking, 'occurred_at', '2030-01-01T15:00:00Z')));
  end loop;
  select array_agg(id order by occurred_at desc, id desc) into first_ids from api.list_financial_events(1000, null, '2030-01-01T15:00:00Z');
  select id, occurred_at into cursor_row from api.list_financial_events(1000, null, '2030-01-01T15:00:00Z') order by occurred_at, id limit 1;
  select array_agg(id) into next_ids from api.list_financial_events(1000, cursor_row.occurred_at, '2030-01-01T15:00:00Z', cursor_row.id);
  perform pg_temp.expect(cardinality(first_ids) = 1000 and cardinality(next_ids) = 5 and not first_ids && next_ids, 'compound cursor retains all 1005 equal-timestamp events');
  perform pg_temp.become_owner();
end;
$$;
