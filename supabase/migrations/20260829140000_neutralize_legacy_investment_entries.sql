-- Legacy versions stored applications/reserves as one negative ledger entry.
-- They reduced the source-account balance correctly, but their old kind could be
-- interpreted as an expense.  Preserve every original row while promoting the
-- event to the neutral, canonical contribution/withdrawal model.

-- Some installations may have received legacy rows after the first financial
-- movements migration. Give each remaining row a canonical header first.
insert into public.financial_movements (
  id, user_id, kind, occurred_on, description, amount, currency, brl_amount,
  category_id, investment_id, credit_card_id, imported_document_id,
  planned_occurrence_key, source, notes, fingerprint, legacy_unbalanced,
  created_at, updated_at
)
select
  e.id,
  e.user_id,
  case when e.amount < 0
    then 'investment_contribution'::public.financial_movement_kind
    else 'investment_withdrawal'::public.financial_movement_kind
  end,
  e.occurred_on,
  e.description,
  abs(e.amount),
  e.currency,
  abs(e.brl_amount),
  e.category_id,
  e.investment_id,
  e.credit_card_id,
  e.imported_document_id,
  e.planned_occurrence_key,
  e.source,
  e.notes,
  e.fingerprint,
  e.investment_id is null,
  e.created_at,
  e.updated_at
from public.ledger_entries e
where e.kind in ('investment', 'reserve')
  and e.financial_movement_id is null
on conflict (id) do nothing;

update public.ledger_entries
set financial_movement_id = id
where kind in ('investment', 'reserve')
  and financial_movement_id is null;

-- Keep the original debit as the account leg, but give it the unambiguous
-- neutral kind. `ignored_from_analytics` also protects any older client that
-- still reads ledger rows directly instead of financial_movements.
update public.ledger_entries
set kind = case when amount < 0 then 'investment_contribution'::public.entry_kind else 'investment_withdrawal'::public.entry_kind end,
    ignored_from_analytics = true
where kind in ('investment', 'reserve');

-- Headers created by the previous migration are upgraded too. An explicitly
-- linked investment is safe to carry to the movement; an absent link stays
-- marked as legacy_unbalanced rather than guessing an asset destination.
update public.financial_movements movement
set kind = case legacy.kind::text
      when 'investment_contribution' then 'investment_contribution'::public.financial_movement_kind
      when 'investment_withdrawal' then 'investment_withdrawal'::public.financial_movement_kind
      else movement.kind
    end,
    investment_id = coalesce(movement.investment_id, legacy.investment_id),
    legacy_unbalanced = coalesce(movement.investment_id, legacy.investment_id) is null,
    updated_at = now()
from (
  select distinct on (e.financial_movement_id)
    e.financial_movement_id,
    e.investment_id,
    e.kind
  from public.ledger_entries e
  where e.kind in ('investment_contribution', 'investment_withdrawal')
    and e.financial_movement_id is not null
  order by e.financial_movement_id, e.created_at
) legacy
where movement.id = legacy.financial_movement_id
  and movement.kind in ('investment_contribution', 'investment_withdrawal');

-- If the legacy record explicitly named an investment, add its missing asset
-- leg. This is an audit/balance leg only: it does not change the persisted
-- investment value and cannot change the user's total patrimony.
insert into public.ledger_entries (
  id, user_id, account_id, category_id, investment_id, credit_card_id,
  transfer_group_id, financial_movement_id, occurred_on, occurred_at,
  description, amount, currency, brl_amount, kind, invoice_key,
  planned_occurrence_key, source, ignored_from_analytics, notes, fingerprint,
  pending_reconciliation, created_at, updated_at
)
select
  gen_random_uuid(),
  e.user_id,
  null,
  null,
  e.investment_id,
  null,
  null,
  e.financial_movement_id,
  e.occurred_on,
  e.occurred_at,
  e.description,
  case when e.kind = 'investment_contribution' then abs(e.amount) else -abs(e.amount) end,
  e.currency,
  case when e.kind = 'investment_contribution' then abs(e.brl_amount) else -abs(e.brl_amount) end,
  e.kind,
  null,
  e.planned_occurrence_key,
  'reconciliation',
  true,
  'Perna do investimento criada pela migração de legado.',
  e.fingerprint,
  false,
  e.created_at,
  now()
from public.ledger_entries e
where e.kind in ('investment_contribution', 'investment_withdrawal')
  and e.investment_id is not null
  and ((e.kind = 'investment_contribution' and e.amount < 0) or (e.kind = 'investment_withdrawal' and e.amount > 0))
  and e.financial_movement_id is not null
  and not exists (
    select 1
    from public.ledger_entries asset_leg
    where asset_leg.financial_movement_id = e.financial_movement_id
      and asset_leg.investment_id = e.investment_id
      and ((e.kind = 'investment_contribution' and asset_leg.amount > 0) or (e.kind = 'investment_withdrawal' and asset_leg.amount < 0))
  );

-- Once both known legs exist, this is no longer an unbalanced legacy event.
update public.financial_movements movement
set legacy_unbalanced = false,
    updated_at = now()
where movement.kind in ('investment_contribution', 'investment_withdrawal')
  and exists (
    select 1
    from public.ledger_entries account_leg
    where account_leg.financial_movement_id = movement.id
      and ((movement.kind = 'investment_contribution' and account_leg.amount < 0) or (movement.kind = 'investment_withdrawal' and account_leg.amount > 0))
      and account_leg.account_id is not null
  )
  and exists (
    select 1
    from public.ledger_entries asset_leg
    where asset_leg.financial_movement_id = movement.id
      and ((movement.kind = 'investment_contribution' and asset_leg.amount > 0) or (movement.kind = 'investment_withdrawal' and asset_leg.amount < 0))
      and asset_leg.investment_id is not null
  );
