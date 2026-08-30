-- Planned charges now carry the payment route used when they are realized.
alter table public.planned_entries
  add column if not exists payment_method text not null default 'pix'
    check (payment_method in ('pix', 'automatic_debit', 'credit_card')),
  add column if not exists credit_card_id uuid;

alter table public.planned_entries
  drop constraint if exists planned_entries_credit_card_fkey;
alter table public.planned_entries
  add constraint planned_entries_credit_card_fkey
  foreign key (credit_card_id, user_id) references public.credit_cards(id, user_id) on delete set null;

alter table public.ledger_entries
  add column if not exists system_generated boolean not null default false;

alter table public.financial_movements
  add column if not exists system_generated boolean not null default false;

create index if not exists planned_credit_card_idx on public.planned_entries (credit_card_id)
  where credit_card_id is not null;
create index if not exists ledger_system_generated_idx on public.ledger_entries (user_id, system_generated)
  where system_generated;
