alter table public.credit_cards
  add column if not exists card_type text not null default 'credit';

alter table public.credit_cards
  drop constraint if exists credit_cards_card_type_check;

alter table public.credit_cards
  add constraint credit_cards_card_type_check
  check (card_type in ('credit', 'debit'));
