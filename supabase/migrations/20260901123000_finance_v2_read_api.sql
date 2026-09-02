-- v2 could write cards, assets, plans, rules and import batches but never read
-- them back. These projections close the loop and keep every list explicit:
-- no select *, no cross-entity monolith, ciphertext handed to the Edge Function
-- boundary as base64 and decrypted there.

grant select on app_private.card_transactions, app_private.credit_card_terms,
  app_private.fixed_income_terms, app_private.fund_terms,
  app_private.investment_cash_details, app_private.investment_charges,
  app_private.investment_transfers, app_private.investment_income_events,
  app_private.corporate_actions, app_private.manual_asset_quotes,
  app_private.operation_fx_rates
to authenticated;

create or replace function api.list_cards()
returns table (
  id uuid, version integer, institution_id uuid, linked_account_id uuid,
  kind app_private.card_kind, network text, currency_code text,
  sensitive_payload_b64 text, encryption_nonce_b64 text, encryption_key_version smallint,
  liability_ledger_account_id uuid, payer_account_id uuid, credit_limit numeric,
  closing_day smallint, due_day smallint,
  archived_at timestamptz, created_at timestamptz, updated_at timestamptz
)
language sql security invoker set search_path = '' stable as $$
  select card.id, card.version, card.institution_id, card.linked_account_id,
         card.kind, card.network, card.currency_code,
         encode(card.sensitive_payload, 'base64'), encode(card.encryption_nonce, 'base64'), card.encryption_key_version,
         terms.liability_ledger_account_id, terms.payer_account_id, terms.credit_limit,
         terms.closing_day, terms.due_day,
         card.archived_at, card.created_at, card.updated_at
  from app_private.cards as card
  left join app_private.credit_card_terms as terms
    on terms.card_id = card.id and terms.user_id = card.user_id
  where card.user_id = (select auth.uid())
  order by card.created_at;
$$;

create or replace function api.list_investment_assets()
returns table (
  id uuid, version integer, instrument_id uuid, asset_type_code text, currency_code text,
  sensitive_payload_b64 text, encryption_nonce_b64 text, encryption_key_version smallint,
  holding_id uuid, custody_account_id uuid, ledger_account_id uuid,
  archived_at timestamptz, created_at timestamptz, updated_at timestamptz
)
language sql security invoker set search_path = '' stable as $$
  select asset.id, asset.version, asset.instrument_id, asset.asset_type_code, asset.currency_code,
         encode(asset.sensitive_payload, 'base64'), encode(asset.encryption_nonce, 'base64'), asset.encryption_key_version,
         holding.id, holding.custody_account_id, holding.ledger_account_id,
         asset.archived_at, asset.created_at, asset.updated_at
  from app_private.investment_assets as asset
  left join app_private.investment_holdings as holding
    on holding.asset_id = asset.id and holding.user_id = asset.user_id and holding.archived_at is null
  where asset.user_id = (select auth.uid())
  order by asset.created_at;
$$;

create or replace function api.list_recurrence_rules()
returns table (
  id uuid, version integer, category_id uuid, account_id uuid, card_id uuid,
  flow text, frequency text, start_date date, end_date date, occurrence_count integer,
  amount numeric, currency_code text, payment_method text,
  sensitive_payload_b64 text, encryption_nonce_b64 text, encryption_key_version smallint,
  created_at timestamptz, updated_at timestamptz
)
language sql security invoker set search_path = '' stable as $$
  select rule.id, rule.version, rule.category_id, rule.account_id, rule.card_id,
         rule.flow, rule.frequency, rule.start_date, rule.end_date, rule.occurrence_count,
         rule.amount, rule.currency_code, rule.payment_method,
         encode(rule.sensitive_payload, 'base64'), encode(rule.encryption_nonce, 'base64'), rule.encryption_key_version,
         rule.created_at, rule.updated_at
  from app_private.recurrence_rules as rule
  where rule.user_id = (select auth.uid())
  order by rule.created_at;
$$;

create or replace function api.list_planned_occurrences()
returns table (
  id uuid, recurrence_rule_id uuid, scheduled_for date,
  status app_private.planned_occurrence_status, settled_event_id uuid,
  effective_at timestamptz, effective_amount numeric,
  sensitive_payload_b64 text, encryption_nonce_b64 text, encryption_key_version smallint,
  created_at timestamptz, updated_at timestamptz
)
language sql security invoker set search_path = '' stable as $$
  select occurrence.id, occurrence.recurrence_rule_id, occurrence.scheduled_for,
         occurrence.status, occurrence.settled_event_id,
         occurrence.effective_at, occurrence.effective_amount,
         encode(occurrence.sensitive_payload, 'base64'), encode(occurrence.encryption_nonce, 'base64'), occurrence.encryption_key_version,
         occurrence.created_at, occurrence.updated_at
  from app_private.planned_occurrences as occurrence
  where occurrence.user_id = (select auth.uid())
  order by occurrence.scheduled_for;
$$;

create or replace function api.list_classification_rules()
returns table (
  id uuid, category_id uuid, flow text,
  sensitive_payload_b64 text, encryption_nonce_b64 text, encryption_key_version smallint,
  created_at timestamptz, updated_at timestamptz
)
language sql security invoker set search_path = '' stable as $$
  select rule.id, rule.category_id, rule.flow,
         encode(rule.sensitive_payload, 'base64'), encode(rule.encryption_nonce, 'base64'), rule.encryption_key_version,
         rule.created_at, rule.updated_at
  from app_private.classification_rules as rule
  where rule.user_id = (select auth.uid())
  order by rule.created_at;
$$;

create or replace function api.list_import_batches()
returns table (
  id uuid, kind text, period_start date, period_end date,
  sensitive_payload_b64 text, encryption_nonce_b64 text, encryption_key_version smallint,
  created_at timestamptz, updated_at timestamptz
)
language sql security invoker set search_path = '' stable as $$
  select batch.id, batch.kind, batch.period_start, batch.period_end,
         encode(batch.sensitive_payload, 'base64'), encode(batch.encryption_nonce, 'base64'), batch.encryption_key_version,
         batch.created_at, batch.updated_at
  from app_private.import_batches as batch
  where batch.user_id = (select auth.uid())
  order by batch.created_at;
$$;

-- Deduplication asks a yes/no question. The stored fingerprint never travels
-- back to the client, so a stolen session cannot enumerate past imports.
create or replace function api.import_batch_exists(p_fingerprint_hmac_b64 text)
returns uuid
language sql security invoker set search_path = '' stable as $$
  select batch.id
  from app_private.import_batches as batch
  where batch.user_id = (select auth.uid())
    and batch.fingerprint_hmac = decode(p_fingerprint_hmac_b64, 'base64')
  limit 1;
$$;

-- An event and its legs are one atomic fact, so they travel together. Card and
-- investment specifics stay in their own typed columns rather than a blob.
drop function if exists api.list_financial_events(integer, timestamptz);

create or replace function api.list_financial_events(
  p_limit integer default 200,
  p_before timestamptz default null,
  p_since timestamptz default null
)
returns table (
  id uuid, version integer, kind app_private.financial_event_kind,
  category_id uuid, import_batch_id uuid, occurred_at timestamptz, source text,
  sensitive_payload_b64 text, encryption_nonce_b64 text, encryption_key_version smallint,
  postings jsonb, card jsonb, investment jsonb, investment_income jsonb,
  created_at timestamptz, updated_at timestamptz
)
language sql security invoker set search_path = '' stable as $$
  select event.id, event.version, event.kind,
         event.category_id, event.import_batch_id, event.occurred_at, event.source,
         encode(event.sensitive_payload, 'base64'), encode(event.encryption_nonce, 'base64'), event.encryption_key_version,
         coalesce((
           select jsonb_agg(jsonb_build_object(
             'id', posting.id,
             'ledger_account_id', posting.ledger_account_id,
             'amount', posting.amount::text,
             'currency_code', posting.currency_code,
             'operation_fx_rate_id', posting.operation_fx_rate_id
           ) order by posting.created_at, posting.id)
           from app_private.ledger_postings as posting
           where posting.event_id = event.id and posting.user_id = event.user_id
         ), '[]'::jsonb),
         (
           select jsonb_build_object(
             'card_id', card_transaction.card_id,
             'kind', card_transaction.kind,
             'installment_number', card_transaction.installment_number,
             'total_installments', card_transaction.total_installments,
             'first_invoice_month', card_transaction.first_invoice_month
           )
           from app_private.card_transactions as card_transaction
           where card_transaction.event_id = event.id and card_transaction.user_id = event.user_id
         ),
         (
           select jsonb_build_object(
             'transaction_id', investment_transaction.id,
             'asset_id', investment_transaction.asset_id,
             'holding_id', investment_transaction.holding_id,
             'operation', investment_transaction.operation,
             'traded_at', investment_transaction.traded_at,
             'settled_at', investment_transaction.settled_at,
             'quantity', trade.quantity::text,
             'unit_price', trade.unit_price::text,
             'principal_amount', cash.principal_amount::text,
             'income_amount', cash.income_amount::text
           )
           from app_private.investment_transactions as investment_transaction
           left join app_private.investment_trade_details as trade
             on trade.transaction_id = investment_transaction.id and trade.user_id = investment_transaction.user_id
           left join app_private.investment_cash_details as cash
             on cash.transaction_id = investment_transaction.id and cash.user_id = investment_transaction.user_id
           where investment_transaction.event_id = event.id and investment_transaction.user_id = event.user_id
         ),
         (
           select jsonb_build_object(
             'id', income.id,
             'asset_id', income.asset_id,
             'holding_id', income.holding_id,
             'kind', income.kind,
             'payment_date', income.payment_date,
             'gross_amount', income.gross_amount::text,
             'withheld_tax', income.withheld_tax::text,
             'currency_code', income.currency_code,
             'reinvestment_transaction_id', income.reinvestment_transaction_id
           )
           from app_private.investment_income_events as income
           where income.event_id = event.id and income.user_id = event.user_id
         ),
         event.created_at, event.updated_at
  from app_private.financial_events as event
  where event.user_id = (select auth.uid())
    and (p_before is null or event.occurred_at < p_before)
    and (p_since is null or event.occurred_at >= p_since)
  order by event.occurred_at desc, event.id desc
  limit greatest(1, least(coalesce(p_limit, 200), 1000));
$$;

do $$
declare routine text;
begin
  foreach routine in array array[
    'api.list_cards()', 'api.list_investment_assets()', 'api.list_recurrence_rules()',
    'api.list_planned_occurrences()', 'api.list_classification_rules()',
    'api.list_import_batches()', 'api.import_batch_exists(text)',
    'api.list_financial_events(integer, timestamptz, timestamptz)'
  ] loop
    execute format('revoke all on function %s from public, anon', routine);
    execute format('grant execute on function %s to authenticated', routine);
  end loop;
end;
$$;
