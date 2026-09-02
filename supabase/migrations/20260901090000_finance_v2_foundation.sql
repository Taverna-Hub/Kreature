-- Finance v2 is intentionally additive. The destructive reset lives in the
-- cutover runbook and must only be executed after the v2 application passes
-- its integration suite.

create schema if not exists catalog;
create schema if not exists app_private;
create schema if not exists api;

revoke all on schema catalog, app_private, api from public, anon, authenticated;
grant usage on schema api to authenticated;

alter default privileges in schema catalog revoke all on tables from public, anon, authenticated;
alter default privileges in schema catalog revoke all on sequences from public, anon, authenticated;
alter default privileges in schema catalog revoke execute on functions from public, anon, authenticated;
alter default privileges in schema app_private revoke all on tables from public, anon, authenticated;
alter default privileges in schema app_private revoke all on sequences from public, anon, authenticated;
alter default privileges in schema app_private revoke execute on functions from public, anon, authenticated;
alter default privileges in schema api revoke all on tables from public, anon, authenticated;
alter default privileges in schema api revoke execute on functions from public, anon, authenticated;

create type catalog.organization_kind as enum ('financial_institution', 'issuer', 'fund_administrator', 'exchange', 'other');
create type catalog.market_series_kind as enum ('asset_price', 'fx', 'index');
create type app_private.account_kind as enum ('bank', 'brokerage', 'wallet', 'exchange', 'crypto_wallet', 'other');
create type app_private.ledger_account_kind as enum ('cash', 'credit_card_liability', 'investment_custody', 'income', 'expense', 'equity', 'fx_clearing');
create type app_private.financial_event_kind as enum ('income', 'expense', 'internal_transfer', 'currency_exchange', 'investment_transaction', 'investment_income', 'card_transaction', 'credit_card_payment', 'adjustment', 'opening_balance');
create type app_private.card_kind as enum ('credit', 'debit');
create type app_private.card_transaction_kind as enum ('purchase', 'refund', 'fee', 'interest');
create type app_private.investment_operation_kind as enum ('buy', 'sell', 'contribution', 'redemption', 'transfer_in', 'transfer_out', 'reinvestment', 'opening_position');
create type app_private.investment_income_kind as enum ('dividend', 'jcp', 'interest', 'yield', 'distribution', 'amortization', 'staking_reward', 'other');
create type app_private.investment_charge_kind as enum ('brokerage', 'exchange_fee', 'custody_fee', 'tax', 'iof', 'other');
create type app_private.corporate_action_kind as enum ('split', 'reverse_split', 'bonus', 'amortization', 'incorporation', 'merger', 'other');
create type app_private.planned_occurrence_status as enum ('scheduled', 'cancelled', 'settled');
create type app_private.encryption_purpose as enum ('account', 'card', 'event', 'investment', 'classification', 'import', 'audit', 'plan');

create table catalog.currencies (
  code text primary key check (code ~ '^[A-Z0-9]{3,12}$'),
  name text not null,
  symbol text,
  decimal_places smallint not null default 2 check (decimal_places between 0 and 18),
  is_fiat boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table catalog.asset_types (
  code text primary key check (code ~ '^[a-z0-9_]{2,48}$'),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table catalog.organizations (
  id uuid primary key default gen_random_uuid(),
  kind catalog.organization_kind not null,
  legal_name text not null,
  trade_name text,
  cnpj char(14) check (cnpj is null or cnpj ~ '^[0-9]{14}$'),
  country_code char(2),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (kind, legal_name)
);
create unique index organizations_cnpj_unique_idx on catalog.organizations (cnpj) where cnpj is not null;

create table catalog.financial_institutions (
  organization_id uuid primary key references catalog.organizations(id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  bank_code text,
  logo_key text,
  primary_color text check (primary_color is null or primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  secondary_color text check (secondary_color is null or secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
  foreground_color text check (foreground_color is null or foreground_color ~ '^#[0-9A-Fa-f]{6}$')
);

create table catalog.indexers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9_]{2,32}$'),
  name text not null,
  unit text not null check (unit in ('percentage', 'index_level', 'currency_per_unit')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table catalog.market_instruments (
  id uuid primary key default gen_random_uuid(),
  asset_type_code text not null references catalog.asset_types(code),
  issuer_organization_id uuid references catalog.organizations(id) on delete set null,
  symbol text,
  isin text,
  cnpj char(14) check (cnpj is null or cnpj ~ '^[0-9]{14}$'),
  name text not null,
  trading_currency_code text references catalog.currencies(code),
  venue text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (symbol, venue)
);
create unique index market_instruments_isin_unique_idx on catalog.market_instruments (isin) where isin is not null;

create table catalog.market_data_providers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9_-]{2,48}$'),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table catalog.market_series (
  id uuid primary key default gen_random_uuid(),
  kind catalog.market_series_kind not null,
  code text not null unique check (code ~ '^[A-Z0-9_./-]{2,96}$'),
  name text not null,
  value_scale smallint not null default 8 check (value_scale between 0 and 18),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table catalog.asset_price_series (
  series_id uuid primary key references catalog.market_series(id) on delete cascade,
  instrument_id uuid not null references catalog.market_instruments(id) on delete cascade,
  quote_currency_code text not null references catalog.currencies(code),
  unique (instrument_id, quote_currency_code)
);

create table catalog.fx_series (
  series_id uuid primary key references catalog.market_series(id) on delete cascade,
  base_currency_code text not null references catalog.currencies(code),
  quote_currency_code text not null references catalog.currencies(code),
  check (base_currency_code <> quote_currency_code),
  unique (base_currency_code, quote_currency_code)
);

create table catalog.index_series (
  series_id uuid primary key references catalog.market_series(id) on delete cascade,
  indexer_id uuid not null references catalog.indexers(id) on delete cascade,
  unique (indexer_id)
);

create table catalog.market_observations (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references catalog.market_series(id) on delete cascade,
  provider_id uuid not null references catalog.market_data_providers(id) on delete restrict,
  observed_at timestamptz not null,
  value numeric(38, 18) not null check (value >= 0),
  fetched_at timestamptz not null default now(),
  unique (series_id, provider_id, observed_at)
);
create index market_observations_series_time_idx on catalog.market_observations (series_id, observed_at desc);

create table app_private.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  mascot jsonb not null default '{}'::jsonb check (jsonb_typeof(mascot) = 'object'),
  theme text not null default 'light' check (theme in ('light', 'dark', 'system')),
  reporting_currency_code text not null default 'BRL' references catalog.currencies(code),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table app_private.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  icon text not null check (char_length(icon) between 1 and 80),
  color text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  flow text not null check (flow in ('income', 'expense')),
  image_path text,
  is_default boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique nulls not distinct (user_id, name, flow, archived_at)
);

create table app_private.ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind app_private.ledger_account_kind not null,
  currency_code text not null references catalog.currencies(code),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create table app_private.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  institution_id uuid references catalog.organizations(id) on delete set null,
  ledger_account_id uuid not null,
  kind app_private.account_kind not null,
  currency_code text not null references catalog.currencies(code),
  sensitive_payload bytea not null,
  encryption_nonce bytea not null check (octet_length(encryption_nonce) = 12),
  encryption_key_version smallint not null check (encryption_key_version > 0),
  archived_at timestamptz,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (ledger_account_id, user_id),
  foreign key (ledger_account_id, user_id) references app_private.ledger_accounts(id, user_id) on delete restrict
);

create table app_private.cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  institution_id uuid references catalog.organizations(id) on delete set null,
  linked_account_id uuid,
  kind app_private.card_kind not null,
  network text not null check (network in ('visa', 'mastercard', 'elo', 'amex', 'hipercard', 'other')),
  currency_code text not null references catalog.currencies(code),
  sensitive_payload bytea not null,
  encryption_nonce bytea not null check (octet_length(encryption_nonce) = 12),
  encryption_key_version smallint not null check (encryption_key_version > 0),
  archived_at timestamptz,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (linked_account_id, user_id) references app_private.accounts(id, user_id) on delete restrict
);

create table app_private.credit_card_terms (
  card_id uuid primary key,
  user_id uuid not null,
  liability_ledger_account_id uuid not null,
  payer_account_id uuid,
  credit_limit numeric(38, 18) not null check (credit_limit >= 0),
  closing_day smallint not null check (closing_day between 1 and 31),
  due_day smallint not null check (due_day between 1 and 31),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (card_id, user_id),
  unique (liability_ledger_account_id, user_id),
  foreign key (card_id, user_id) references app_private.cards(id, user_id) on delete cascade,
  foreign key (liability_ledger_account_id, user_id) references app_private.ledger_accounts(id, user_id) on delete restrict,
  foreign key (payer_account_id, user_id) references app_private.accounts(id, user_id) on delete restrict
);

create table app_private.import_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('account_statement', 'card_statement', 'card_invoice')),
  fingerprint_hmac bytea not null,
  sensitive_payload bytea not null,
  encryption_nonce bytea not null check (octet_length(encryption_nonce) = 12),
  encryption_key_version smallint not null check (encryption_key_version > 0),
  period_start date,
  period_end date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, fingerprint_hmac)
);

create table app_private.financial_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind app_private.financial_event_kind not null,
  category_id uuid,
  import_batch_id uuid,
  occurred_at timestamptz not null,
  sensitive_payload bytea not null,
  encryption_nonce bytea not null check (octet_length(encryption_nonce) = 12),
  encryption_key_version smallint not null check (encryption_key_version > 0),
  source text not null check (source in ('manual', 'import', 'planned', 'system')),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (category_id, user_id) references app_private.categories(id, user_id) on delete restrict,
  foreign key (import_batch_id, user_id) references app_private.import_batches(id, user_id) on delete restrict
);

create table app_private.ledger_postings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null,
  ledger_account_id uuid not null,
  amount numeric(38, 18) not null check (amount <> 0),
  currency_code text not null references catalog.currencies(code),
  operation_fx_rate_id uuid,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (event_id, user_id) references app_private.financial_events(id, user_id) on delete cascade,
  foreign key (ledger_account_id, user_id) references app_private.ledger_accounts(id, user_id) on delete restrict
);
create index ledger_postings_event_idx on app_private.ledger_postings (user_id, event_id);
create index ledger_postings_account_time_idx on app_private.ledger_postings (user_id, ledger_account_id, created_at desc);

create table app_private.operation_fx_rates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  base_currency_code text not null references catalog.currencies(code),
  quote_currency_code text not null references catalog.currencies(code),
  rate numeric(38, 18) not null check (rate > 0),
  observed_at timestamptz not null,
  market_observation_id uuid references catalog.market_observations(id) on delete set null,
  source text not null check (source in ('manual', 'market', 'import')),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  check (base_currency_code <> quote_currency_code)
);
alter table app_private.ledger_postings add constraint ledger_postings_operation_fx_rate_fkey
  foreign key (operation_fx_rate_id, user_id) references app_private.operation_fx_rates(id, user_id) on delete restrict;

create table app_private.card_transactions (
  event_id uuid primary key,
  user_id uuid not null,
  card_id uuid not null,
  kind app_private.card_transaction_kind not null,
  installment_number smallint check (installment_number is null or installment_number > 0),
  total_installments smallint check (total_installments is null or total_installments > 0),
  first_invoice_month date,
  unique (event_id, user_id),
  check (installment_number is null or total_installments is null or installment_number <= total_installments),
  foreign key (event_id, user_id) references app_private.financial_events(id, user_id) on delete cascade,
  foreign key (card_id, user_id) references app_private.cards(id, user_id) on delete restrict
);

create table app_private.investment_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  instrument_id uuid references catalog.market_instruments(id) on delete restrict,
  asset_type_code text not null references catalog.asset_types(code),
  currency_code text not null references catalog.currencies(code),
  sensitive_payload bytea not null,
  encryption_nonce bytea not null check (octet_length(encryption_nonce) = 12),
  encryption_key_version smallint not null check (encryption_key_version > 0),
  archived_at timestamptz,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create table app_private.investment_holdings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  asset_id uuid not null,
  custody_account_id uuid not null,
  ledger_account_id uuid not null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (asset_id, custody_account_id),
  unique (ledger_account_id, user_id),
  foreign key (asset_id, user_id) references app_private.investment_assets(id, user_id) on delete restrict,
  foreign key (custody_account_id, user_id) references app_private.accounts(id, user_id) on delete restrict,
  foreign key (ledger_account_id, user_id) references app_private.ledger_accounts(id, user_id) on delete restrict
);

create table app_private.fixed_income_terms (
  asset_id uuid primary key,
  user_id uuid not null,
  issuer_organization_id uuid references catalog.organizations(id) on delete restrict,
  security_type text not null check (security_type in ('cdb', 'rdb', 'lci', 'lca', 'cri', 'cra', 'tesouro', 'debenture', 'other')),
  maturity_date date,
  indexer_id uuid references catalog.indexers(id) on delete restrict,
  indexer_percentage numeric(18, 10) check (indexer_percentage is null or indexer_percentage >= 0),
  fixed_rate numeric(18, 10) check (fixed_rate is null or fixed_rate >= 0),
  spread_rate numeric(18, 10),
  daily_liquidity boolean not null default false,
  grace_end_date date,
  tax_exempt boolean not null default false,
  check (maturity_date is null or grace_end_date is null or grace_end_date <= maturity_date),
  unique (asset_id, user_id),
  foreign key (asset_id, user_id) references app_private.investment_assets(id, user_id) on delete cascade
);

create table app_private.fund_terms (
  asset_id uuid primary key,
  user_id uuid not null,
  cnpj char(14) check (cnpj is null or cnpj ~ '^[0-9]{14}$'),
  administration_fee numeric(18, 10) check (administration_fee is null or administration_fee >= 0),
  grace_end_date date,
  redemption_quote_days integer check (redemption_quote_days is null or redemption_quote_days >= 0),
  redemption_settlement_days integer check (redemption_settlement_days is null or redemption_settlement_days >= 0),
  unique (asset_id, user_id),
  foreign key (asset_id, user_id) references app_private.investment_assets(id, user_id) on delete cascade
);

create table app_private.investment_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null,
  asset_id uuid not null,
  holding_id uuid not null,
  operation app_private.investment_operation_kind not null,
  traded_at timestamptz not null,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (event_id, user_id),
  foreign key (event_id, user_id) references app_private.financial_events(id, user_id) on delete cascade,
  foreign key (asset_id, user_id) references app_private.investment_assets(id, user_id) on delete restrict,
  foreign key (holding_id, user_id) references app_private.investment_holdings(id, user_id) on delete restrict
);
create index investment_transactions_asset_time_idx on app_private.investment_transactions (user_id, asset_id, traded_at, id);
create index investment_transactions_holding_time_idx on app_private.investment_transactions (user_id, holding_id, traded_at, id);

create table app_private.investment_trade_details (
  transaction_id uuid primary key,
  user_id uuid not null,
  quantity numeric(38, 18) not null check (quantity > 0),
  unit_price numeric(38, 18) not null check (unit_price >= 0),
  unique (transaction_id, user_id),
  foreign key (transaction_id, user_id) references app_private.investment_transactions(id, user_id) on delete cascade
);

create table app_private.investment_cash_details (
  transaction_id uuid primary key,
  user_id uuid not null,
  principal_amount numeric(38, 18) not null check (principal_amount > 0),
  unique (transaction_id, user_id),
  foreign key (transaction_id, user_id) references app_private.investment_transactions(id, user_id) on delete cascade
);

create table app_private.investment_charges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  transaction_id uuid not null,
  kind app_private.investment_charge_kind not null,
  amount numeric(38, 18) not null check (amount >= 0),
  currency_code text not null references catalog.currencies(code),
  created_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (transaction_id, user_id) references app_private.investment_transactions(id, user_id) on delete cascade
);

create table app_private.investment_transfers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  outbound_transaction_id uuid not null,
  inbound_transaction_id uuid not null,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  unique (outbound_transaction_id, user_id),
  unique (inbound_transaction_id, user_id),
  check (outbound_transaction_id <> inbound_transaction_id),
  foreign key (outbound_transaction_id, user_id) references app_private.investment_transactions(id, user_id) on delete cascade,
  foreign key (inbound_transaction_id, user_id) references app_private.investment_transactions(id, user_id) on delete cascade
);

create table app_private.investment_income_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null,
  asset_id uuid not null,
  holding_id uuid,
  kind app_private.investment_income_kind not null,
  ex_date date,
  record_date date,
  payment_date date not null,
  gross_amount numeric(38, 18) not null check (gross_amount >= 0),
  withheld_tax numeric(38, 18) not null default 0 check (withheld_tax >= 0 and withheld_tax <= gross_amount),
  currency_code text not null references catalog.currencies(code),
  reinvestment_transaction_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (event_id, user_id),
  foreign key (event_id, user_id) references app_private.financial_events(id, user_id) on delete cascade,
  foreign key (asset_id, user_id) references app_private.investment_assets(id, user_id) on delete restrict,
  foreign key (holding_id, user_id) references app_private.investment_holdings(id, user_id) on delete restrict,
  foreign key (reinvestment_transaction_id, user_id) references app_private.investment_transactions(id, user_id) on delete restrict
);

create table app_private.corporate_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  asset_id uuid not null,
  kind app_private.corporate_action_kind not null,
  effective_on date not null,
  numerator numeric(38, 18),
  denominator numeric(38, 18),
  cash_amount numeric(38, 18),
  currency_code text references catalog.currencies(code),
  sensitive_payload bytea not null,
  encryption_nonce bytea not null check (octet_length(encryption_nonce) = 12),
  encryption_key_version smallint not null check (encryption_key_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (asset_id, user_id) references app_private.investment_assets(id, user_id) on delete restrict,
  check ((numerator is null and denominator is null) or (numerator > 0 and denominator > 0)),
  check (cash_amount is null or cash_amount >= 0)
);

create table app_private.manual_asset_quotes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  asset_id uuid not null,
  observed_at timestamptz not null,
  unit_price numeric(38, 18) not null check (unit_price >= 0),
  currency_code text not null references catalog.currencies(code),
  source text not null check (source in ('manual', 'import')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (asset_id, user_id) references app_private.investment_assets(id, user_id) on delete cascade
);
create index manual_asset_quotes_latest_idx on app_private.manual_asset_quotes (user_id, asset_id, observed_at desc);

create table app_private.recurrence_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid,
  account_id uuid,
  card_id uuid,
  flow text not null check (flow in ('income', 'expense')),
  frequency text not null check (frequency in ('once', 'daily', 'weekly', 'biweekly', 'monthly', 'yearly')),
  start_date date not null,
  end_date date,
  occurrence_count integer check (occurrence_count is null or occurrence_count > 0),
  amount numeric(38, 18) not null check (amount > 0),
  currency_code text not null references catalog.currencies(code),
  payment_method text not null check (payment_method in ('pix', 'automatic_debit', 'credit_card')),
  sensitive_payload bytea not null,
  encryption_nonce bytea not null check (octet_length(encryption_nonce) = 12),
  encryption_key_version smallint not null check (encryption_key_version > 0),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (category_id, user_id) references app_private.categories(id, user_id) on delete restrict,
  foreign key (account_id, user_id) references app_private.accounts(id, user_id) on delete restrict,
  foreign key (card_id, user_id) references app_private.cards(id, user_id) on delete restrict,
  check (end_date is null or end_date >= start_date),
  check ((payment_method = 'credit_card' and card_id is not null and account_id is null) or (payment_method <> 'credit_card' and card_id is null))
);

create table app_private.planned_occurrences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  recurrence_rule_id uuid not null,
  scheduled_for date not null,
  status app_private.planned_occurrence_status not null default 'scheduled',
  settled_event_id uuid,
  effective_at timestamptz,
  effective_amount numeric(38, 18) check (effective_amount is null or effective_amount > 0),
  sensitive_payload bytea,
  encryption_nonce bytea check (encryption_nonce is null or octet_length(encryption_nonce) = 12),
  encryption_key_version smallint check (encryption_key_version is null or encryption_key_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (recurrence_rule_id, scheduled_for),
  foreign key (recurrence_rule_id, user_id) references app_private.recurrence_rules(id, user_id) on delete cascade,
  foreign key (settled_event_id, user_id) references app_private.financial_events(id, user_id) on delete restrict,
  check ((status = 'settled') = (settled_event_id is not null))
);

create table app_private.classification_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid not null,
  flow text not null check (flow in ('income', 'expense')),
  match_hmac bytea not null,
  sensitive_payload bytea not null,
  encryption_nonce bytea not null check (octet_length(encryption_nonce) = 12),
  encryption_key_version smallint not null check (encryption_key_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, flow, match_hmac),
  foreign key (category_id, user_id) references app_private.categories(id, user_id) on delete cascade
);

create table app_private.audit_revisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_type text not null check (entity_type ~ '^[a-z_]{2,64}$'),
  entity_id uuid not null,
  operation text not null check (operation in ('insert', 'update', 'delete')),
  sensitive_payload bytea not null,
  encryption_nonce bytea not null check (octet_length(encryption_nonce) = 12),
  encryption_key_version smallint not null check (encryption_key_version > 0),
  expires_at timestamptz not null default (now() + interval '90 days'),
  created_at timestamptz not null default now(),
  unique (id, user_id)
);
create index audit_revisions_expiry_idx on app_private.audit_revisions (expires_at);

create or replace function app_private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function app_private.assert_ledger_event_balanced()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  candidate_event uuid := coalesce(new.event_id, old.event_id);
  candidate_user uuid := coalesce(new.user_id, old.user_id);
begin
  if exists (
    select 1
    from app_private.ledger_postings posting
    where posting.event_id = candidate_event
      and posting.user_id = candidate_user
    group by posting.currency_code
    having sum(posting.amount) <> 0
  ) then
    raise exception 'Financial event % is not balanced.', candidate_event using errcode = '23514';
  end if;
  return null;
end;
$$;

create constraint trigger ledger_postings_must_balance
after insert or update or delete on app_private.ledger_postings
deferrable initially deferred
for each row execute procedure app_private.assert_ledger_event_balanced();

do $$
declare
  target text;
begin
  foreach target in array array[
    'profiles', 'categories', 'ledger_accounts', 'accounts', 'cards', 'credit_card_terms',
    'import_batches', 'financial_events', 'operation_fx_rates', 'investment_assets',
    'investment_holdings', 'investment_transactions', 'investment_income_events',
    'corporate_actions', 'manual_asset_quotes', 'recurrence_rules', 'planned_occurrences',
    'classification_rules'
  ] loop
    execute format('create trigger touch_%1$s before update on app_private.%1$I for each row execute procedure app_private.touch_updated_at()', target);
  end loop;
end;
$$;

do $$
declare
  target text;
begin
  foreach target in array array[
    'profiles', 'categories', 'ledger_accounts', 'accounts', 'cards', 'credit_card_terms',
    'import_batches', 'financial_events', 'ledger_postings', 'operation_fx_rates', 'card_transactions',
    'investment_assets', 'investment_holdings', 'fixed_income_terms', 'fund_terms',
    'investment_transactions', 'investment_trade_details', 'investment_cash_details', 'investment_charges',
    'investment_transfers', 'investment_income_events', 'corporate_actions', 'manual_asset_quotes',
    'recurrence_rules', 'planned_occurrences', 'classification_rules', 'audit_revisions'
  ] loop
    execute format('alter table app_private.%I enable row level security', target);
    execute format('alter table app_private.%I force row level security', target);
    execute format('create policy %1$I_select_own on app_private.%1$I for select to authenticated using ((select auth.uid()) = user_id)', target);
    execute format('create policy %1$I_insert_own on app_private.%1$I for insert to authenticated with check ((select auth.uid()) = user_id)', target);
    execute format('create policy %1$I_update_own on app_private.%1$I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', target);
    execute format('create policy %1$I_delete_own on app_private.%1$I for delete to authenticated using ((select auth.uid()) = user_id)', target);
    execute format('create index %1$I_user_id_idx on app_private.%1$I (user_id)', target);
  end loop;
end;
$$;

create or replace function app_private.seed_v2_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into app_private.profiles (user_id, display_name, mascot, theme, reporting_currency_code)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1), ''),
    jsonb_build_object('body', 'round', 'color', 'orange', 'expression', 'happy', 'accessories', jsonb_build_array('headphones'), 'frame', 'neon', 'background', 'gradient', 'nickname', '', 'title', '', 'bio', ''),
    'light',
    'BRL'
  );

  insert into app_private.categories (user_id, name, icon, color, flow, is_default)
  values
    (new.id, 'Moradia', 'Home', '#f97316', 'expense', true),
    (new.id, 'Alimentação', 'Utensils', '#0d9488', 'expense', true),
    (new.id, 'Transporte', 'Car', '#0ea5e9', 'expense', true),
    (new.id, 'Saúde', 'HeartPulse', '#ec4899', 'expense', true),
    (new.id, 'Educação', 'GraduationCap', '#8b5cf6', 'expense', true),
    (new.id, 'Lazer', 'Sparkles', '#eab308', 'expense', true),
    (new.id, 'Assinaturas', 'Repeat2', '#6366f1', 'expense', true),
    (new.id, 'Compras', 'ShoppingBag', '#f43f5e', 'expense', true),
    (new.id, 'Outros', 'CircleEllipsis', '#64748b', 'expense', true),
    (new.id, 'Salário', 'Wallet', '#34d399', 'income', true),
    (new.id, 'Rendimentos', 'ChartNoAxesCombined', '#0ea5e9', 'income', true),
    (new.id, 'Outras receitas', 'CircleEllipsis', '#64748b', 'income', true);
  return new;
end;
$$;

revoke all on all tables in schema catalog from public, anon, authenticated;
revoke all on all tables in schema app_private from public, anon, authenticated;
revoke all on all sequences in schema catalog from public, anon, authenticated;
revoke all on all sequences in schema app_private from public, anon, authenticated;
revoke execute on all functions in schema catalog from public, anon, authenticated;
revoke execute on all functions in schema app_private from public, anon, authenticated;

insert into catalog.currencies (code, name, symbol, decimal_places, is_fiat) values
  ('BRL', 'Real brasileiro', 'R$', 2, true),
  ('USD', 'Dólar americano', '$', 2, true),
  ('EUR', 'Euro', '€', 2, true),
  ('BTC', 'Bitcoin', '₿', 8, false),
  ('ETH', 'Ether', 'Ξ', 18, false)
on conflict (code) do update set name = excluded.name, symbol = excluded.symbol, decimal_places = excluded.decimal_places, is_fiat = excluded.is_fiat, active = true;

insert into catalog.asset_types (code, name) values
  ('stock', 'Ação'), ('fii', 'Fundo imobiliário'), ('etf', 'ETF'), ('bdr', 'BDR'),
  ('fund', 'Fundo de investimento'), ('crypto', 'Criptomoeda'), ('fixed_income', 'Renda fixa'),
  ('pension', 'Previdência'), ('cash_box', 'Reserva'), ('other', 'Outro')
on conflict (code) do update set name = excluded.name, active = true;

insert into catalog.indexers (code, name, unit) values
  ('CDI', 'CDI', 'percentage'), ('SELIC', 'SELIC', 'percentage'), ('IPCA', 'IPCA', 'percentage')
on conflict (code) do update set name = excluded.name, active = true;
