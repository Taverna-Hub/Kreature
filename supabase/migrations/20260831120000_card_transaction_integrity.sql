-- Card purchases need one atomic write across movement, ledger and purchase.
-- This migration is intentionally idempotent so it can repair a remote schema
-- whose migration history was repaired without deleting existing financial rows.

alter table public.ledger_entries
  add column if not exists payment_method text,
  add column if not exists system_generated boolean not null default false;

alter table public.financial_movements
  add column if not exists payment_method text,
  add column if not exists system_generated boolean not null default false;

alter table public.ledger_entries
  drop constraint if exists ledger_entries_payment_method_check,
  drop constraint if exists ledger_entries_card_payment_consistency;

alter table public.financial_movements
  drop constraint if exists financial_movements_payment_method_check,
  drop constraint if exists financial_movements_card_payment_consistency;

alter table public.ledger_entries
  drop constraint if exists ledger_entries_financial_movement_id_fkey,
  drop constraint if exists ledger_entries_financial_movement_user_fkey;

-- Existing card purchases are the authoritative source for repairing the
-- relationship when a previous client save persisted only part of the data.
update public.ledger_entries entry
set credit_card_id = purchase.card_id,
    payment_method = 'credit_card',
    account_id = null
from public.card_purchases purchase
where purchase.ledger_entry_id = entry.id
  and purchase.user_id = entry.user_id;

update public.ledger_entries
set payment_method = 'credit_card'
where kind::text = 'card_purchase'
  and credit_card_id is not null;

update public.financial_movements movement
set credit_card_id = entry.credit_card_id,
    payment_method = 'credit_card'
from public.ledger_entries entry
where entry.financial_movement_id = movement.id
  and entry.user_id = movement.user_id
  and entry.kind::text = 'card_purchase';

do $$
begin
  if exists (
    select 1
    from public.ledger_entries
    where kind::text = 'card_purchase'
      and (credit_card_id is null or account_id is not null)
  ) then
    raise exception 'Há compras no cartão sem cartão vinculado ou com conta bancária vinculada; corrija os registros antes de aplicar a migration.';
  end if;

  if exists (
    select 1
    from public.financial_movements
    where kind::text = 'card_purchase'
      and credit_card_id is null
  ) then
    raise exception 'Há movimentos de cartão sem cartão vinculado; corrija os registros antes de aplicar a migration.';
  end if;

  if exists (
    select 1
    from public.ledger_entries
    where planned_occurrence_key is not null
    group by user_id, planned_occurrence_key
    having count(*) > 1
  ) then
    raise exception 'Há ocorrências planejadas duplicadas; a migration não remove os registros e exige conciliação antes do índice único.';
  end if;
  if exists (
    select 1
    from public.ledger_entries entry
    where entry.financial_movement_id is not null
      and not exists (
        select 1
        from public.financial_movements movement
        where movement.id = entry.financial_movement_id
          and movement.user_id = entry.user_id
      )
  ) then
    raise exception 'Movimento financeiro relacionado inexistente ou pertencente a outro usuário; corrija os dados antes da FK composta.';
  end if;
end;
$$;

alter table public.ledger_entries
  add constraint ledger_entries_financial_movement_user_fkey
    foreign key (financial_movement_id, user_id)
    references public.financial_movements(id, user_id)
    on delete cascade;

alter table public.ledger_entries
  add constraint ledger_entries_payment_method_check
    check (payment_method is null or payment_method in ('pix', 'automatic_debit', 'credit_card')),
  add constraint ledger_entries_card_payment_consistency
    check (
      (kind::text <> 'card_purchase' and payment_method is distinct from 'credit_card')
      or (kind::text = 'card_purchase' and payment_method = 'credit_card' and credit_card_id is not null and account_id is null)
    );

alter table public.financial_movements
  add constraint financial_movements_payment_method_check
    check (payment_method is null or payment_method in ('pix', 'automatic_debit', 'credit_card')),
  add constraint financial_movements_card_payment_consistency
    check (
      (kind::text <> 'card_purchase' and payment_method is distinct from 'credit_card')
      or (kind::text = 'card_purchase' and payment_method = 'credit_card' and credit_card_id is not null)
    );

create unique index if not exists ledger_entries_planned_occurrence_unique_idx
  on public.ledger_entries (user_id, planned_occurrence_key)
  where planned_occurrence_key is not null;

create index if not exists ledger_entries_credit_card_idx
  on public.ledger_entries (user_id, credit_card_id, occurred_on desc)
  where credit_card_id is not null;

create index if not exists financial_movements_credit_card_idx
  on public.financial_movements (user_id, credit_card_id, occurred_on desc)
  where credit_card_id is not null;

create or replace function public.persist_card_transaction(
  p_entry jsonb,
  p_movement jsonb,
  p_purchase jsonb,
  p_previous_entry_id uuid default null,
  p_previous_movement_id uuid default null,
  p_previous_purchase_id uuid default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  entry_id uuid;
  movement_id uuid;
  purchase_id uuid;
  card_id uuid;
  account_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sessão inválida.' using errcode = '42501';
  end if;

  entry_id := coalesce(nullif(p_entry ->> 'id', '')::uuid, p_previous_entry_id);
  movement_id := coalesce(nullif(p_movement ->> 'id', '')::uuid, p_previous_movement_id);
  purchase_id := nullif(p_purchase ->> 'id', '')::uuid;

  if p_entry is null then
    if p_previous_purchase_id is not null then
      delete from public.card_purchases where id = p_previous_purchase_id and user_id = auth.uid();
    end if;
    if entry_id is not null then
      delete from public.card_purchases where ledger_entry_id = entry_id and user_id = auth.uid();
      delete from public.ledger_entries where id = entry_id and user_id = auth.uid();
    end if;
    if movement_id is not null then
      delete from public.financial_movements where id = movement_id and user_id = auth.uid();
    end if;
    return;
  end if;

  if p_movement is null then
    raise exception 'Movimento financeiro ausente.' using errcode = '22023';
  end if;

  account_id := nullif(p_entry ->> 'account_id', '')::uuid;
  card_id := nullif(p_entry ->> 'credit_card_id', '')::uuid;
  if nullif(p_entry ->> 'financial_movement_id', '')::uuid is distinct from movement_id then
    raise exception 'O lançamento e o movimento não correspondem.' using errcode = '23514';
  end if;
  if nullif(p_movement ->> 'credit_card_id', '')::uuid is distinct from card_id then
    raise exception 'O movimento e o cartão não correspondem.' using errcode = '23514';
  end if;

  if account_id is not null and not exists (
    select 1 from public.financial_accounts
    where id = account_id and user_id = auth.uid() and archived_at is null
  ) then
    raise exception 'A conta selecionada não está disponível.' using errcode = '23503';
  end if;

  if card_id is not null and p_entry ->> 'kind' not in ('card_purchase', 'credit_payment') then
    raise exception 'Somente compras e pagamentos de fatura podem manter um cartão vinculado.' using errcode = '23514';
  end if;
  if card_id is not null and not exists (
    select 1
    from public.credit_cards
    where id = card_id and user_id = auth.uid() and archived_at is null
  ) then
    raise exception 'O cartão selecionado não está disponível.' using errcode = '23503';
  end if;
  if p_entry ->> 'payment_method' = 'credit_card' then
    if card_id is null or account_id is not null then
      raise exception 'Compra no cartão exige cartão ativo e não pode debitar conta.' using errcode = '23514';
    end if;
    if not exists (
      select 1 from public.credit_cards
      where id = card_id and user_id = auth.uid() and archived_at is null and card_type = 'credit'
    ) then
      raise exception 'O cartão selecionado não está disponível.' using errcode = '23503';
    end if;
  end if;

  insert into public.financial_movements
  select (jsonb_populate_record(null::public.financial_movements, p_movement || jsonb_build_object('user_id', auth.uid()))).*
  on conflict (id, user_id) do update set
    kind = excluded.kind, occurred_on = excluded.occurred_on, description = excluded.description,
    amount = excluded.amount, currency = excluded.currency, brl_amount = excluded.brl_amount,
    category_id = excluded.category_id, payment_method = excluded.payment_method, investment_id = excluded.investment_id,
    credit_card_id = excluded.credit_card_id, imported_document_id = excluded.imported_document_id,
    planned_occurrence_key = excluded.planned_occurrence_key, related_movement_id = excluded.related_movement_id,
    source = excluded.source, notes = excluded.notes, fingerprint = excluded.fingerprint,
    legacy_unbalanced = excluded.legacy_unbalanced, system_generated = excluded.system_generated;

  insert into public.ledger_entries
  select (jsonb_populate_record(null::public.ledger_entries, p_entry || jsonb_build_object('user_id', auth.uid()))).*
  on conflict (id, user_id) do update set
    account_id = excluded.account_id, category_id = excluded.category_id, payment_method = excluded.payment_method,
    investment_id = excluded.investment_id, credit_card_id = excluded.credit_card_id,
    transfer_group_id = excluded.transfer_group_id, financial_movement_id = excluded.financial_movement_id,
    imported_document_id = excluded.imported_document_id, occurred_on = excluded.occurred_on,
    occurred_at = excluded.occurred_at, description = excluded.description, amount = excluded.amount,
    currency = excluded.currency, brl_amount = excluded.brl_amount, kind = excluded.kind,
    invoice_key = excluded.invoice_key, planned_occurrence_key = excluded.planned_occurrence_key,
    source = excluded.source, ignored_from_analytics = excluded.ignored_from_analytics,
    system_generated = excluded.system_generated, notes = excluded.notes, fingerprint = excluded.fingerprint,
    pending_reconciliation = excluded.pending_reconciliation;

  -- Converting a card purchase back to an account removes only its card
  -- association; the ledger entry and movement keep their original IDs.
  delete from public.card_purchases
  where ledger_entry_id = entry_id
    and user_id = auth.uid()
    and (p_purchase is null or id is distinct from purchase_id);

  if p_purchase is not null then
    if (p_purchase ->> 'ledger_entry_id')::uuid is distinct from entry_id
      or (p_purchase ->> 'card_id')::uuid is distinct from card_id
      or p_entry ->> 'kind' <> 'card_purchase' then
      raise exception 'A compra e o lançamento do cartão não correspondem.' using errcode = '23514';
    end if;
    if not exists (
      select 1 from public.credit_cards
      where id = card_id and user_id = auth.uid() and archived_at is null and card_type = 'credit'
    ) then
      raise exception 'O cartão selecionado não está disponível.' using errcode = '23503';
    end if;
    if p_previous_purchase_id is not null and p_previous_purchase_id is distinct from purchase_id then
      delete from public.card_purchases where id = p_previous_purchase_id and user_id = auth.uid();
    end if;
    insert into public.card_purchases
    select (jsonb_populate_record(null::public.card_purchases, p_purchase || jsonb_build_object('user_id', auth.uid()))).*
    on conflict (id, user_id) do update set
      card_id = excluded.card_id, ledger_entry_id = excluded.ledger_entry_id, description = excluded.description,
      amount = excluded.amount, currency = excluded.currency, occurred_on = excluded.occurred_on,
      category_id = excluded.category_id, installments = excluded.installments,
      installment_number = excluded.installment_number, total_installments = excluded.total_installments,
      transaction_kind = excluded.transaction_kind, imported_document_id = excluded.imported_document_id,
      first_invoice_key = excluded.first_invoice_key, notes = excluded.notes;
  end if;
end;
$$;

grant execute on function public.persist_card_transaction(jsonb, jsonb, jsonb, uuid, uuid, uuid) to authenticated;
