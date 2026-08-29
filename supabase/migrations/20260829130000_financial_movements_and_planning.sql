-- Canonical financial event. Ledger rows remain the balance-impacting legs.
alter type public.entry_kind add value if not exists 'internal_transfer';
alter type public.entry_kind add value if not exists 'investment_contribution';
alter type public.entry_kind add value if not exists 'investment_withdrawal';
alter type public.entry_kind add value if not exists 'investment_income';

do $$ begin
  create type public.financial_movement_kind as enum (
    'income', 'expense', 'internal_transfer', 'investment_contribution',
    'investment_withdrawal', 'investment_income', 'card_purchase', 'card_refund',
    'card_fee', 'card_interest', 'credit_payment', 'adjustment'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.financial_movements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind public.financial_movement_kind not null,
  occurred_on date not null,
  description text not null check (char_length(description) between 1 and 500),
  amount numeric(20,8) not null check (amount > 0),
  currency char(3) not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  brl_amount numeric(20,8) not null check (brl_amount >= 0),
  category_id uuid,
  investment_id uuid,
  credit_card_id uuid,
  imported_document_id uuid references public.imported_documents(id) on delete set null,
  planned_occurrence_key text,
  related_movement_id uuid references public.financial_movements(id) on delete restrict,
  source public.entry_source not null default 'manual',
  notes text,
  fingerprint text,
  legacy_unbalanced boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (category_id, user_id) references public.categories(id, user_id) on delete set null,
  foreign key (investment_id, user_id) references public.investments(id, user_id) on delete set null,
  foreign key (credit_card_id, user_id) references public.credit_cards(id, user_id) on delete set null
);

alter table public.ledger_entries add column if not exists financial_movement_id uuid;
alter table public.ledger_entries add column if not exists pending_reconciliation boolean not null default false;
alter table public.ledger_entries drop constraint if exists ledger_entries_financial_movement_id_fkey;
alter table public.ledger_entries add constraint ledger_entries_financial_movement_id_fkey
  foreign key (financial_movement_id) references public.financial_movements(id) on delete cascade;

-- Preserve all existing rows. A prior transfer group becomes one movement;
-- old one-sided investments intentionally remain flagged instead of receiving
-- an invented destination leg.
insert into public.financial_movements (
  id, user_id, kind, occurred_on, description, amount, currency, brl_amount,
  category_id, investment_id, credit_card_id, imported_document_id,
  planned_occurrence_key, source, notes, fingerprint, legacy_unbalanced,
  created_at, updated_at
)
select distinct on (coalesce(e.transfer_group_id, e.id))
  coalesce(e.transfer_group_id, e.id), e.user_id,
  case e.kind::text
    when 'transfer' then 'internal_transfer'::public.financial_movement_kind
    when 'investment' then 'investment_contribution'::public.financial_movement_kind
    when 'reserve' then 'investment_contribution'::public.financial_movement_kind
    when 'pix' then case when e.amount < 0 then 'expense'::public.financial_movement_kind else 'income'::public.financial_movement_kind end
    else e.kind::text::public.financial_movement_kind
  end,
  e.occurred_on, e.description, abs(e.amount), e.currency, abs(e.brl_amount),
  e.category_id, e.investment_id, e.credit_card_id, e.imported_document_id,
  e.planned_occurrence_key, e.source, e.notes, e.fingerprint,
  (e.kind::text in ('investment', 'reserve')),
  e.created_at, e.updated_at
from public.ledger_entries e
where e.financial_movement_id is null
order by coalesce(e.transfer_group_id, e.id), e.created_at
on conflict (id) do nothing;

update public.ledger_entries
set financial_movement_id = coalesce(transfer_group_id, id)
where financial_movement_id is null;

create index if not exists financial_movements_user_date_idx on public.financial_movements (user_id, occurred_on desc, created_at desc);
create index if not exists financial_movements_investment_idx on public.financial_movements (investment_id, occurred_on desc) where investment_id is not null;
create index if not exists ledger_entries_financial_movement_idx on public.ledger_entries (financial_movement_id);

alter table public.financial_movements enable row level security;
create policy financial_movements_select_own on public.financial_movements for select to authenticated using (auth.uid() = user_id);
create policy financial_movements_insert_own on public.financial_movements for insert to authenticated with check (auth.uid() = user_id);
create policy financial_movements_update_own on public.financial_movements for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy financial_movements_delete_own on public.financial_movements for delete to authenticated using (auth.uid() = user_id);
grant select, insert, update, delete on public.financial_movements to authenticated;
create trigger touch_financial_movements before update on public.financial_movements for each row execute procedure public.touch_updated_at();
