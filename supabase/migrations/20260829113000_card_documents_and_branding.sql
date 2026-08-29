-- Card statement imports are auditable without retaining the original financial document.
alter type public.entry_kind add value if not exists 'card_refund';
alter type public.entry_kind add value if not exists 'card_fee';
alter type public.entry_kind add value if not exists 'card_interest';

alter table public.financial_institutions
  add column if not exists primary_color text,
  add column if not exists secondary_color text,
  add column if not exists foreground_color text;

update public.financial_institutions set primary_color = case slug
  when 'nubank' then '#820ad1' when 'itau' then '#ec7000' when 'caixa' then '#005ca9'
  when 'wise' then '#9fe870' when 'santander' then '#ec0000' when 'inter' then '#ff7a00'
  when 'mercado-pago' then '#009ee3' else primary_color end,
  secondary_color = coalesce(secondary_color, primary_color), foreground_color = coalesce(foreground_color, '#ffffff');

alter table public.credit_cards
  add column if not exists last_four char(4) check (last_four is null or last_four ~ '^[0-9]{4}$'),
  add column if not exists network text check (network is null or char_length(network) <= 40),
  add column if not exists cardholder_name text check (cardholder_name is null or char_length(cardholder_name) <= 120);

create table if not exists public.imported_documents (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('account_statement', 'card_statement', 'card_invoice')),
  content_hash text not null, source text not null, credit_card_id uuid, period_start date, period_end date, closing_date date, due_date date, total numeric(20,8),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (user_id, content_hash), unique (id, user_id),
  foreign key (credit_card_id, user_id) references public.credit_cards(id, user_id) on delete set null
);
alter table public.ledger_entries add column if not exists imported_document_id uuid;
alter table public.ledger_entries drop constraint if exists ledger_entries_imported_document_id_fkey;
alter table public.ledger_entries add constraint ledger_entries_imported_document_id_fkey foreign key (imported_document_id) references public.imported_documents(id) on delete set null;
alter table public.card_purchases
  add column if not exists transaction_kind text not null default 'purchase' check (transaction_kind in ('purchase','refund','fee','interest')),
  add column if not exists installment_number smallint check (installment_number is null or installment_number > 0),
  add column if not exists total_installments smallint check (total_installments is null or total_installments > 0),
  add column if not exists imported_document_id uuid references public.imported_documents(id) on delete set null;
create index if not exists imported_documents_user_hash_idx on public.imported_documents(user_id, content_hash);
create index if not exists entries_imported_document_idx on public.ledger_entries(imported_document_id);

alter table public.imported_documents enable row level security;
create policy imported_documents_select_own on public.imported_documents for select to authenticated using (auth.uid() = user_id);
create policy imported_documents_insert_own on public.imported_documents for insert to authenticated with check (auth.uid() = user_id);
create policy imported_documents_update_own on public.imported_documents for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy imported_documents_delete_own on public.imported_documents for delete to authenticated using (auth.uid() = user_id);
grant select, insert, update, delete on public.imported_documents to authenticated;
create trigger touch_imported_documents before update on public.imported_documents for each row execute procedure public.touch_updated_at();
