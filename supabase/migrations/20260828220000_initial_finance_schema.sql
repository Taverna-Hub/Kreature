create extension if not exists pgcrypto;

create type public.institution_type as enum ('bank', 'broker', 'wallet', 'other');
create type public.category_flow as enum ('income', 'expense');
create type public.entry_kind as enum ('income', 'expense', 'investment', 'reserve', 'transfer', 'pix', 'card_purchase', 'credit_payment', 'adjustment');
create type public.entry_source as enum ('manual', 'import', 'planned', 'reconciliation');
create type public.investment_type as enum ('cash_box', 'cdb', 'cri', 'cra', 'fixed_income', 'stock', 'fii', 'etf', 'bdr', 'crypto', 'fund', 'pension', 'other');
create type public.quote_status as enum ('manual', 'ok', 'error');
create type public.recurrence_frequency as enum ('once', 'daily', 'weekly', 'biweekly', 'monthly', 'yearly');
create type public.theme_mode as enum ('light', 'dark', 'system');

create table public.financial_institutions (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name text not null,
  type public.institution_type not null,
  bank_code text,
  logo_key text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  mascot jsonb not null,
  theme public.theme_mode not null default 'light',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  icon text not null check (char_length(icon) between 1 and 80),
  color text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  flow public.category_flow not null,
  image_path text,
  is_default boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique nulls not distinct (user_id, name, flow)
);

create table public.financial_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  financial_institution_id uuid references public.financial_institutions(id) on delete set null,
  name text not null check (char_length(name) between 1 and 120),
  type public.institution_type not null,
  bank_code text,
  agency text,
  account_number text,
  identifier text,
  notes text,
  currency char(3) not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  opening_balance numeric(20, 8) not null default 0,
  exchange_rate numeric(20, 8) not null default 1 check (exchange_rate > 0),
  exchange_rate_as_of date,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create table public.investments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  account_id uuid,
  type public.investment_type not null,
  application_type text,
  name text not null check (char_length(name) between 1 and 180),
  ticker text,
  quantity numeric(24, 8) not null check (quantity >= 0),
  average_price numeric(24, 8) not null check (average_price >= 0),
  invested_amount numeric(24, 8) not null check (invested_amount >= 0),
  current_price numeric(24, 8) not null check (current_price >= 0),
  current_value numeric(24, 8) not null check (current_value >= 0),
  dividends numeric(24, 8) not null default 0 check (dividends >= 0),
  currency char(3) not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  contracted_yield text,
  maturity_date date,
  quote_status public.quote_status not null default 'manual',
  quote_message text,
  quote_as_of date,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (account_id, user_id) references public.financial_accounts(id, user_id) on delete set null
);

create table public.credit_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  issuer_institution_id uuid references public.financial_institutions(id) on delete set null,
  issuer_name text,
  payer_account_id uuid,
  credit_limit numeric(20, 8) not null check (credit_limit >= 0),
  closing_day smallint not null check (closing_day between 1 and 31),
  due_day smallint not null check (due_day between 1 and 31),
  currency char(3) not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (payer_account_id, user_id) references public.financial_accounts(id, user_id) on delete set null
);

create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  account_id uuid,
  category_id uuid,
  investment_id uuid,
  credit_card_id uuid,
  transfer_group_id uuid,
  occurred_on date not null,
  occurred_at timestamptz,
  description text not null check (char_length(description) between 1 and 500),
  amount numeric(20, 8) not null check (amount <> 0),
  currency char(3) not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  brl_amount numeric(20, 8) not null,
  kind public.entry_kind not null,
  invoice_key text,
  planned_occurrence_key text,
  source public.entry_source not null default 'manual',
  ignored_from_analytics boolean not null default false,
  notes text,
  fingerprint text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (account_id, user_id) references public.financial_accounts(id, user_id) on delete restrict,
  foreign key (category_id, user_id) references public.categories(id, user_id) on delete set null,
  foreign key (investment_id, user_id) references public.investments(id, user_id) on delete set null,
  foreign key (credit_card_id, user_id) references public.credit_cards(id, user_id) on delete set null
);

create table public.card_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  card_id uuid not null,
  ledger_entry_id uuid not null,
  description text not null check (char_length(description) between 1 and 500),
  amount numeric(20, 8) not null check (amount > 0),
  currency char(3) not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  occurred_on date not null,
  category_id uuid,
  installments smallint not null check (installments between 1 and 999),
  first_invoice_key text not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (ledger_entry_id, user_id),
  foreign key (card_id, user_id) references public.credit_cards(id, user_id) on delete restrict,
  foreign key (ledger_entry_id, user_id) references public.ledger_entries(id, user_id) on delete cascade,
  foreign key (category_id, user_id) references public.categories(id, user_id) on delete set null
);

create table public.classification_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  match text not null check (char_length(match) between 1 and 500),
  category_id uuid not null,
  flow public.category_flow not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, match, flow),
  foreign key (category_id, user_id) references public.categories(id, user_id) on delete cascade
);

create table public.planned_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  start_date date not null,
  description text not null check (char_length(description) between 1 and 500),
  amount numeric(20, 8) not null check (amount > 0),
  kind public.category_flow not null,
  category_id uuid,
  account_id uuid,
  frequency public.recurrence_frequency not null,
  end_date date,
  occurrence_count integer check (occurrence_count is null or occurrence_count > 0),
  exceptions jsonb not null default '[]'::jsonb check (jsonb_typeof(exceptions) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (category_id, user_id) references public.categories(id, user_id) on delete set null,
  foreign key (account_id, user_id) references public.financial_accounts(id, user_id) on delete set null,
  check (end_date is null or end_date >= start_date)
);

create index categories_user_flow_idx on public.categories (user_id, flow) where archived_at is null;
create index accounts_user_active_idx on public.financial_accounts (user_id) where archived_at is null;
create index entries_user_date_idx on public.ledger_entries (user_id, occurred_on desc, created_at desc);
create index entries_account_date_idx on public.ledger_entries (account_id, occurred_on desc);
create index entries_category_date_idx on public.ledger_entries (category_id, occurred_on desc);
create index entries_transfer_group_idx on public.ledger_entries (user_id, transfer_group_id) where transfer_group_id is not null;
-- Fingerprints are used as a duplicate hint during import review. They are
-- intentionally not unique: a statement can contain legitimate repeated
-- movements with the same date, amount and description.
create index investments_user_active_idx on public.investments (user_id) where archived_at is null;
create index cards_user_active_idx on public.credit_cards (user_id) where archived_at is null;
create index purchases_card_date_idx on public.card_purchases (card_id, occurred_on desc);
create index planned_user_start_idx on public.planned_entries (user_id, start_date);

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.seed_user_profile_and_categories()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, display_name, mascot, theme)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1), ''),
    jsonb_build_object('body', 'round', 'color', 'orange', 'expression', 'happy', 'accessories', jsonb_build_array('headphones'), 'frame', 'neon', 'background', 'gradient', 'nickname', '', 'title', '', 'bio', ''),
    'light'
  );

  insert into public.categories (user_id, name, icon, color, flow, is_default)
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
    (new.id, 'Aluguel recebido', 'House', '#14b8a6', 'income', true),
    (new.id, 'Freela e serviços', 'BriefcaseBusiness', '#8b5cf6', 'income', true),
    (new.id, 'Vendas', 'Store', '#f59e0b', 'income', true),
    (new.id, 'Rendimentos', 'ChartNoAxesCombined', '#0ea5e9', 'income', true),
    (new.id, 'Benefícios', 'Gift', '#ec4899', 'income', true),
    (new.id, 'Reembolsos', 'RotateCcw', '#22c55e', 'income', true),
    (new.id, 'Outras receitas', 'CircleEllipsis', '#64748b', 'income', true);
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.seed_user_profile_and_categories();

do $$
declare target text;
begin
  foreach target in array array['financial_institutions', 'profiles', 'categories', 'financial_accounts', 'investments', 'credit_cards', 'ledger_entries', 'card_purchases', 'classification_rules', 'planned_entries'] loop
    execute format('create trigger touch_%1$s_updated_at before update on public.%1$s for each row execute procedure public.touch_updated_at()', target);
  end loop;
end;
$$;

insert into public.financial_institutions (slug, name, type, bank_code, logo_key) values
  ('nubank', 'Nubank', 'bank', '260', 'nubank'),
  ('itau', 'Itaú', 'bank', '341', 'itau'),
  ('inter', 'Inter', 'bank', '077', 'inter'),
  ('bradesco', 'Bradesco', 'bank', '237', 'bradesco'),
  ('santander', 'Santander', 'bank', '033', 'santander'),
  ('banco-do-brasil', 'Banco do Brasil', 'bank', '001', 'banco-do-brasil'),
  ('caixa', 'Caixa', 'bank', '104', 'caixa'),
  ('c6', 'C6 Bank', 'bank', '336', 'c6'),
  ('btg-pactual', 'BTG Pactual', 'broker', '208', 'btg-pactual'),
  ('xp', 'XP Investimentos', 'broker', null, 'xp'),
  ('rico', 'Rico', 'broker', null, 'rico'),
  ('clear', 'Clear', 'broker', null, 'clear'),
  ('mercado-pago', 'Mercado Pago', 'wallet', null, 'mercado-pago'),
  ('picpay', 'PicPay', 'wallet', null, 'picpay'),
  ('neon', 'Neon', 'bank', '536', 'neon'),
  ('wise', 'Wise', 'wallet', null, 'wise')
on conflict (slug) do update set name = excluded.name, type = excluded.type, bank_code = excluded.bank_code, logo_key = excluded.logo_key, active = true;

alter table public.financial_institutions enable row level security;
create policy financial_institutions_read on public.financial_institutions for select to authenticated using (active);

do $$
declare target text;
begin
  foreach target in array array['profiles', 'categories', 'financial_accounts', 'investments', 'credit_cards', 'ledger_entries', 'card_purchases', 'classification_rules', 'planned_entries'] loop
    execute format('alter table public.%I enable row level security', target);
    execute format('create policy %1$I_select_own on public.%1$I for select to authenticated using (auth.uid() = user_id)', target);
    execute format('create policy %1$I_insert_own on public.%1$I for insert to authenticated with check (auth.uid() = user_id)', target);
    execute format('create policy %1$I_update_own on public.%1$I for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)', target);
    execute format('create policy %1$I_delete_own on public.%1$I for delete to authenticated using (auth.uid() = user_id)', target);
  end loop;
end;
$$;

revoke all on all tables in schema public from anon;
grant select on public.financial_institutions to authenticated;
grant select, insert, update, delete on public.profiles, public.categories, public.financial_accounts, public.investments, public.credit_cards, public.ledger_entries, public.card_purchases, public.classification_rules, public.planned_entries to authenticated;

insert into storage.buckets (id, name, public) values ('category-images', 'category-images', false)
on conflict (id) do update set public = false;

create policy category_images_select_own on storage.objects for select to authenticated using (bucket_id = 'category-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy category_images_insert_own on storage.objects for insert to authenticated with check (bucket_id = 'category-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy category_images_update_own on storage.objects for update to authenticated using (bucket_id = 'category-images' and (storage.foldername(name))[1] = auth.uid()::text) with check (bucket_id = 'category-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy category_images_delete_own on storage.objects for delete to authenticated using (bucket_id = 'category-images' and (storage.foldername(name))[1] = auth.uid()::text);
