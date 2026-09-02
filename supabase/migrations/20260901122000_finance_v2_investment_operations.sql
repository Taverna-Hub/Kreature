-- Investment operations are written as one atomic ledger fact. Position,
-- quantity, average price, equity and return are never stored: they are walked
-- back from the operations, so an edit or a deletion cannot leave a stale
-- snapshot behind.

alter table app_private.investment_cash_details
  add column if not exists income_amount numeric(38, 18) not null default 0 check (income_amount >= 0);

alter table app_private.investment_cash_details
  drop constraint if exists investment_cash_details_principal_amount_check;
alter table app_private.investment_cash_details
  add constraint investment_cash_details_principal_amount_check check (principal_amount >= 0);

-- Income, expense and clearing legs are per user and per currency, not per
-- entity, so they are created once and reused.
create unique index if not exists ledger_accounts_system_unique_idx
  on app_private.ledger_accounts (user_id, kind, currency_code)
  where kind in ('income', 'expense', 'equity', 'fx_clearing');

create or replace function app_private.system_ledger_account(
  p_user uuid,
  p_kind app_private.ledger_account_kind,
  p_currency text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  found_id uuid;
begin
  if p_kind not in ('income', 'expense', 'equity', 'fx_clearing') then
    raise exception 'Conta contábil de sistema inválida.' using errcode = '22023';
  end if;

  select account.id into found_id
  from app_private.ledger_accounts as account
  where account.user_id = p_user and account.kind = p_kind and account.currency_code = p_currency;
  if found_id is not null then return found_id; end if;

  insert into app_private.ledger_accounts (user_id, kind, currency_code)
  values (p_user, p_kind, p_currency)
  on conflict (user_id, kind, currency_code) where kind in ('income', 'expense', 'equity', 'fx_clearing')
  do nothing
  returning id into found_id;

  if found_id is null then
    select account.id into found_id
    from app_private.ledger_accounts as account
    where account.user_id = p_user and account.kind = p_kind and account.currency_code = p_currency;
  end if;
  return found_id;
end;
$$;

-- Walks a holding's operations in order and replays average cost. Passing a
-- cursor answers "what was the position immediately before this operation",
-- which is what a sale needs to know to price the basis it is removing.
create or replace function app_private.investment_position_at(
  p_user uuid,
  p_holding uuid,
  p_before timestamptz default null,
  p_before_id uuid default null
)
returns table (position_quantity numeric, position_cost_basis numeric, position_realized numeric)
language plpgsql
security invoker
set search_path = ''
stable
as $$
declare
  operation_row record;
  running_quantity numeric := 0;
  running_cost numeric := 0;
  running_realized numeric := 0;
  removed_cost numeric;
  proceeds numeric;
begin
  for operation_row in
    select movement.id,
           movement.operation,
           coalesce(trade.quantity, 0) as quantity,
           coalesce(trade.quantity * trade.unit_price, cash.principal_amount, 0) as principal,
           coalesce(cash.income_amount, 0) as income,
           coalesce((
             select sum(charge.amount)
             from app_private.investment_charges as charge
             where charge.transaction_id = movement.id and charge.user_id = movement.user_id
           ), 0) as charges
    from app_private.investment_transactions as movement
    left join app_private.investment_trade_details as trade
      on trade.transaction_id = movement.id and trade.user_id = movement.user_id
    left join app_private.investment_cash_details as cash
      on cash.transaction_id = movement.id and cash.user_id = movement.user_id
    where movement.user_id = p_user
      and movement.holding_id = p_holding
      and (
        p_before is null
        or movement.traded_at < p_before
        or (movement.traded_at = p_before and (p_before_id is null or movement.id < p_before_id))
      )
    order by movement.traded_at, movement.id
  loop
    if operation_row.operation in ('buy', 'contribution', 'transfer_in', 'reinvestment', 'opening_position') then
      running_quantity := running_quantity + operation_row.quantity;
      running_cost := running_cost + operation_row.principal + operation_row.charges;
    else
      if operation_row.quantity > 0 then
        if running_quantity <= 0 then
          removed_cost := 0;
        else
          removed_cost := running_cost * least(operation_row.quantity, running_quantity) / running_quantity;
        end if;
        running_quantity := running_quantity - operation_row.quantity;
        proceeds := operation_row.principal - operation_row.charges;
      else
        removed_cost := least(operation_row.principal, running_cost);
        proceeds := operation_row.principal + operation_row.income - operation_row.charges;
      end if;
      running_cost := running_cost - removed_cost;
      if operation_row.operation <> 'transfer_out' then
        running_realized := running_realized + proceeds - removed_cost;
      end if;
    end if;
  end loop;

  position_quantity := running_quantity;
  position_cost_basis := running_cost;
  position_realized := running_realized;
  return next;
end;
$$;

-- One call, one transaction: event, postings, operation, details and charges.
-- A partial investment operation is never observable.
create or replace function api.write_investment_operation(p_command jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  operation text := p_command ->> 'operation';
  event_data jsonb := p_command -> 'event';
  paired_event_data jsonb := p_command -> 'paired_event';
  charges_data jsonb := coalesce(p_command -> 'charges', '[]'::jsonb);
  source_text text := coalesce(event_data ->> 'source', 'manual');
  traded_at timestamptz := coalesce(nullif(p_command ->> 'traded_at', '')::timestamptz, now());
  settled_at timestamptz := nullif(p_command ->> 'settled_at', '')::timestamptz;
  holding_id uuid := nullif(p_command ->> 'holding_id', '')::uuid;
  destination_holding_id uuid := nullif(p_command ->> 'destination_holding_id', '')::uuid;
  cash_account_id uuid := nullif(p_command ->> 'cash_account_id', '')::uuid;
  quantity numeric := nullif(p_command ->> 'quantity', '')::numeric;
  unit_price numeric := nullif(p_command ->> 'unit_price', '')::numeric;
  principal_amount numeric := nullif(p_command ->> 'principal_amount', '')::numeric;
  income_amount numeric := coalesce(nullif(p_command ->> 'income_amount', '')::numeric, 0);
  gross_amount numeric := nullif(p_command ->> 'gross_amount', '')::numeric;
  withheld_tax numeric := coalesce(nullif(p_command ->> 'withheld_tax', '')::numeric, 0);
  income_kind text := coalesce(p_command ->> 'income_kind', 'yield');
  payment_date date := coalesce(nullif(p_command ->> 'payment_date', '')::date, traded_at::date);
  reinvest boolean := coalesce((p_command ->> 'reinvest')::boolean, false);
  holding record;
  destination record;
  cash_ledger uuid;
  cash_currency text;
  charge jsonb;
  charges_total numeric := 0;
  event_id uuid := coalesce(nullif(p_command ->> 'event_id', '')::uuid, gen_random_uuid());
  paired_event_id uuid;
  transaction_id uuid;
  paired_transaction_id uuid;
  income_event_id uuid;
  before_quantity numeric;
  before_cost numeric;
  removed_cost numeric;
  gross numeric;
  net_cash numeric;
  result_amount numeric;
  clearing_ledger uuid;
  result_ledger uuid;
  tax_ledger uuid;
  income_ledger uuid;
begin
  if caller_id is null then
    raise exception 'Sessão inválida.' using errcode = '42501';
  end if;
  if operation not in ('buy', 'sell', 'contribution', 'redemption', 'transfer', 'income', 'opening') then
    raise exception 'Operação de investimento inválida.' using errcode = '22023';
  end if;
  if source_text not in ('manual', 'import', 'planned') then
    raise exception 'Origem de operação não permitida ao cliente.' using errcode = '42501';
  end if;
  if event_data is null or jsonb_typeof(event_data) <> 'object' then
    raise exception 'Dados cifrados da operação são obrigatórios.' using errcode = '22023';
  end if;

  select position.id, position.ledger_account_id, position.asset_id, asset.currency_code
    into holding
  from app_private.investment_holdings as position
  join app_private.investment_assets as asset
    on asset.id = position.asset_id and asset.user_id = position.user_id
  where position.id = holding_id and position.user_id = caller_id;
  if not found then
    raise exception 'Posição de investimento inexistente.' using errcode = '23503';
  end if;

  if operation not in ('transfer', 'opening') and not (operation = 'income' and reinvest) then
    select account.ledger_account_id, account.currency_code into cash_ledger, cash_currency
    from app_private.accounts as account
    where account.id = cash_account_id and account.user_id = caller_id and account.archived_at is null;
    if not found then
      raise exception 'Conta de liquidação inexistente ou arquivada.' using errcode = '23503';
    end if;
    if cash_currency <> holding.currency_code then
      raise exception 'Liquidação em moeda diferente do ativo exige câmbio explícito.' using errcode = '22023';
    end if;
  end if;

  for charge in select value from jsonb_array_elements(charges_data)
  loop
    charges_total := charges_total + coalesce((charge ->> 'amount')::numeric, 0);
  end loop;
  if charges_total < 0 then
    raise exception 'Custos da operação não podem ser negativos.' using errcode = '22023';
  end if;

  insert into app_private.financial_events (
    id, user_id, kind, category_id, import_batch_id, occurred_at,
    sensitive_payload, encryption_nonce, encryption_key_version, source
  ) values (
    event_id,
    caller_id,
    case when operation = 'income' then 'investment_income' else 'investment_transaction' end::app_private.financial_event_kind,
    nullif(event_data ->> 'category_id', '')::uuid,
    nullif(event_data ->> 'import_batch_id', '')::uuid,
    traded_at,
    decode(event_data ->> 'sensitive_payload_b64', 'base64'),
    decode(event_data ->> 'encryption_nonce_b64', 'base64'),
    (event_data ->> 'encryption_key_version')::smallint,
    source_text
  );

  if operation = 'opening' then
    -- An opening position states what was already held. It is an operation like
    -- any other, so the replayed position stays derived instead of becoming a
    -- column somebody can edit behind the ledger's back.
    if principal_amount is null or principal_amount < 0 then
      raise exception 'Custo de aquisição da posição inicial é obrigatório.' using errcode = '22023';
    end if;
    if quantity is not null and quantity < 0 then
      raise exception 'Quantidade da posição inicial não pode ser negativa.' using errcode = '22023';
    end if;

    insert into app_private.investment_transactions (user_id, event_id, asset_id, holding_id, operation, traded_at, settled_at)
    values (caller_id, event_id, holding.asset_id, holding.id, 'opening_position', traded_at, settled_at)
    returning id into transaction_id;

    if quantity is not null and quantity > 0 then
      insert into app_private.investment_trade_details (transaction_id, user_id, quantity, unit_price)
      values (transaction_id, caller_id, quantity, principal_amount / quantity);
    else
      insert into app_private.investment_cash_details (transaction_id, user_id, principal_amount, income_amount)
      values (transaction_id, caller_id, principal_amount, 0);
    end if;

    result_ledger := app_private.system_ledger_account(caller_id, 'equity', holding.currency_code);
    insert into app_private.ledger_postings (user_id, event_id, ledger_account_id, amount, currency_code)
    select caller_id, event_id, leg.ledger_account_id, leg.amount, holding.currency_code
    from (values
      (holding.ledger_account_id, principal_amount),
      (result_ledger, -principal_amount)
    ) as leg(ledger_account_id, amount)
    where leg.amount <> 0;

  elsif operation in ('buy', 'contribution') then
    if operation = 'buy' then
      if quantity is null or quantity <= 0 or unit_price is null or unit_price < 0 then
        raise exception 'Quantidade e preço unitário são obrigatórios na compra.' using errcode = '22023';
      end if;
      gross := quantity * unit_price;
    else
      if principal_amount is null or principal_amount <= 0 then
        raise exception 'Valor do aporte é obrigatório.' using errcode = '22023';
      end if;
      gross := principal_amount;
    end if;
    net_cash := gross + charges_total;

    insert into app_private.investment_transactions (user_id, event_id, asset_id, holding_id, operation, traded_at, settled_at)
    values (caller_id, event_id, holding.asset_id, holding.id,
            case when operation = 'buy' then 'buy' else 'contribution' end::app_private.investment_operation_kind,
            traded_at, settled_at)
    returning id into transaction_id;

    if operation = 'buy' then
      insert into app_private.investment_trade_details (transaction_id, user_id, quantity, unit_price)
      values (transaction_id, caller_id, quantity, unit_price);
    else
      insert into app_private.investment_cash_details (transaction_id, user_id, principal_amount, income_amount)
      values (transaction_id, caller_id, principal_amount, 0);
    end if;

    insert into app_private.ledger_postings (user_id, event_id, ledger_account_id, amount, currency_code)
    values (caller_id, event_id, holding.ledger_account_id, net_cash, holding.currency_code),
           (caller_id, event_id, cash_ledger, -net_cash, holding.currency_code);

  elsif operation in ('sell', 'redemption') then
    select position_quantity, position_cost_basis
      into before_quantity, before_cost
    from app_private.investment_position_at(caller_id, holding.id, traded_at, null);

    if operation = 'sell' then
      if quantity is null or quantity <= 0 or unit_price is null or unit_price < 0 then
        raise exception 'Quantidade e preço unitário são obrigatórios na venda.' using errcode = '22023';
      end if;
      if quantity > before_quantity then
        raise exception 'Quantidade vendida excede a posição disponível.' using errcode = '22023';
      end if;
      gross := quantity * unit_price;
      removed_cost := case when before_quantity = 0 then 0 else before_cost * quantity / before_quantity end;
      net_cash := gross - charges_total;
    else
      if principal_amount is null or principal_amount <= 0 then
        raise exception 'Valor resgatado é obrigatório.' using errcode = '22023';
      end if;
      if principal_amount > before_cost then
        raise exception 'Resgate excede o valor aplicado disponível.' using errcode = '22023';
      end if;
      removed_cost := principal_amount;
      net_cash := principal_amount + income_amount - charges_total;
    end if;
    result_amount := net_cash - removed_cost;

    insert into app_private.investment_transactions (user_id, event_id, asset_id, holding_id, operation, traded_at, settled_at)
    values (caller_id, event_id, holding.asset_id, holding.id,
            case when operation = 'sell' then 'sell' else 'redemption' end::app_private.investment_operation_kind,
            traded_at, settled_at)
    returning id into transaction_id;

    if operation = 'sell' then
      insert into app_private.investment_trade_details (transaction_id, user_id, quantity, unit_price)
      values (transaction_id, caller_id, quantity, unit_price);
    else
      insert into app_private.investment_cash_details (transaction_id, user_id, principal_amount, income_amount)
      values (transaction_id, caller_id, principal_amount, income_amount);
    end if;

    result_ledger := app_private.system_ledger_account(caller_id, 'income', holding.currency_code);
    insert into app_private.ledger_postings (user_id, event_id, ledger_account_id, amount, currency_code)
    select caller_id, event_id, leg.ledger_account_id, leg.amount, holding.currency_code
    from (values
      (cash_ledger, net_cash),
      (holding.ledger_account_id, -removed_cost),
      (result_ledger, -result_amount)
    ) as leg(ledger_account_id, amount)
    where leg.amount <> 0;

  elsif operation = 'transfer' then
    if destination_holding_id is null or destination_holding_id = holding.id then
      raise exception 'Destino da transferência de custódia é obrigatório e deve ser diferente da origem.' using errcode = '22023';
    end if;
    select position.id, position.ledger_account_id, position.asset_id into destination
    from app_private.investment_holdings as position
    where position.id = destination_holding_id and position.user_id = caller_id;
    if not found then
      raise exception 'Posição de destino inexistente.' using errcode = '23503';
    end if;
    if destination.asset_id <> holding.asset_id then
      raise exception 'Transferência de custódia exige o mesmo ativo na origem e no destino.' using errcode = '22023';
    end if;

    select position_quantity, position_cost_basis
      into before_quantity, before_cost
    from app_private.investment_position_at(caller_id, holding.id, traded_at, null);

    if quantity is not null and quantity > 0 then
      if quantity > before_quantity then
        raise exception 'Quantidade transferida excede a posição disponível.' using errcode = '22023';
      end if;
      removed_cost := case when before_quantity = 0 then 0 else before_cost * quantity / before_quantity end;
    else
      if principal_amount is null or principal_amount <= 0 then
        raise exception 'Valor transferido é obrigatório.' using errcode = '22023';
      end if;
      if principal_amount > before_cost then
        raise exception 'Transferência excede o valor aplicado disponível.' using errcode = '22023';
      end if;
      removed_cost := principal_amount;
    end if;
    if removed_cost <= 0 then
      raise exception 'Transferência sem custo de aquisição associado.' using errcode = '22023';
    end if;

    -- Each event balances on its own, so the two legs meet on a clearing
    -- account instead of sharing one unbalanced event.
    clearing_ledger := app_private.system_ledger_account(caller_id, 'fx_clearing', holding.currency_code);

    insert into app_private.investment_transactions (user_id, event_id, asset_id, holding_id, operation, traded_at, settled_at)
    values (caller_id, event_id, holding.asset_id, holding.id, 'transfer_out', traded_at, settled_at)
    returning id into transaction_id;

    if paired_event_data is null or jsonb_typeof(paired_event_data) <> 'object' then
      raise exception 'A perna de destino da transferência precisa do próprio envelope cifrado.' using errcode = '22023';
    end if;
    paired_event_id := coalesce(nullif(p_command ->> 'paired_event_id', '')::uuid, gen_random_uuid());
    insert into app_private.financial_events (
      id, user_id, kind, category_id, occurred_at,
      sensitive_payload, encryption_nonce, encryption_key_version, source
    ) values (
      paired_event_id, caller_id, 'investment_transaction', nullif(event_data ->> 'category_id', '')::uuid, traded_at,
      decode(paired_event_data ->> 'sensitive_payload_b64', 'base64'),
      decode(paired_event_data ->> 'encryption_nonce_b64', 'base64'),
      (paired_event_data ->> 'encryption_key_version')::smallint,
      source_text
    );

    insert into app_private.investment_transactions (user_id, event_id, asset_id, holding_id, operation, traded_at, settled_at)
    values (caller_id, paired_event_id, destination.asset_id, destination.id, 'transfer_in', traded_at, settled_at)
    returning id into paired_transaction_id;

    if quantity is not null and quantity > 0 then
      insert into app_private.investment_trade_details (transaction_id, user_id, quantity, unit_price)
      values (transaction_id, caller_id, quantity, removed_cost / quantity),
             (paired_transaction_id, caller_id, quantity, removed_cost / quantity);
    else
      insert into app_private.investment_cash_details (transaction_id, user_id, principal_amount, income_amount)
      values (transaction_id, caller_id, removed_cost, 0),
             (paired_transaction_id, caller_id, removed_cost, 0);
    end if;

    insert into app_private.investment_transfers (user_id, outbound_transaction_id, inbound_transaction_id)
    values (caller_id, transaction_id, paired_transaction_id);

    insert into app_private.ledger_postings (user_id, event_id, ledger_account_id, amount, currency_code)
    values (caller_id, event_id, holding.ledger_account_id, -removed_cost, holding.currency_code),
           (caller_id, event_id, clearing_ledger, removed_cost, holding.currency_code),
           (caller_id, paired_event_id, destination.ledger_account_id, removed_cost, holding.currency_code),
           (caller_id, paired_event_id, clearing_ledger, -removed_cost, holding.currency_code);

  else
    if gross_amount is null or gross_amount <= 0 then
      raise exception 'Valor bruto do provento é obrigatório.' using errcode = '22023';
    end if;
    if withheld_tax < 0 or withheld_tax > gross_amount then
      raise exception 'Imposto retido inválido para o provento.' using errcode = '22023';
    end if;
    net_cash := gross_amount - withheld_tax;
    income_ledger := app_private.system_ledger_account(caller_id, 'income', holding.currency_code);
    tax_ledger := app_private.system_ledger_account(caller_id, 'expense', holding.currency_code);

    if reinvest then
      insert into app_private.investment_transactions (user_id, event_id, asset_id, holding_id, operation, traded_at, settled_at)
      values (caller_id, event_id, holding.asset_id, holding.id, 'reinvestment', traded_at, settled_at)
      returning id into transaction_id;

      if quantity is not null and quantity > 0 then
        insert into app_private.investment_trade_details (transaction_id, user_id, quantity, unit_price)
        values (transaction_id, caller_id, quantity, net_cash / quantity);
      else
        insert into app_private.investment_cash_details (transaction_id, user_id, principal_amount, income_amount)
        values (transaction_id, caller_id, net_cash, 0);
      end if;
    end if;

    insert into app_private.investment_income_events (
      user_id, event_id, asset_id, holding_id, kind, ex_date, record_date, payment_date,
      gross_amount, withheld_tax, currency_code, reinvestment_transaction_id
    ) values (
      caller_id, event_id, holding.asset_id, holding.id, income_kind::app_private.investment_income_kind,
      nullif(p_command ->> 'ex_date', '')::date, nullif(p_command ->> 'record_date', '')::date, payment_date,
      gross_amount, withheld_tax, holding.currency_code, transaction_id
    ) returning id into income_event_id;

    insert into app_private.ledger_postings (user_id, event_id, ledger_account_id, amount, currency_code)
    select caller_id, event_id, leg.ledger_account_id, leg.amount, holding.currency_code
    from (values
      (case when reinvest then holding.ledger_account_id else cash_ledger end, net_cash),
      (income_ledger, -gross_amount),
      (tax_ledger, withheld_tax)
    ) as leg(ledger_account_id, amount)
    where leg.amount <> 0;
  end if;

  if operation <> 'opening' and transaction_id is not null and jsonb_array_length(charges_data) > 0 then
    insert into app_private.investment_charges (user_id, transaction_id, kind, amount, currency_code)
    select caller_id, transaction_id,
           coalesce(item ->> 'kind', 'other')::app_private.investment_charge_kind,
           (item ->> 'amount')::numeric,
           holding.currency_code
    from jsonb_array_elements(charges_data) as item
    where coalesce((item ->> 'amount')::numeric, 0) > 0;
  end if;

  return jsonb_build_object(
    'event_id', event_id,
    'paired_event_id', paired_event_id,
    'transaction_id', transaction_id,
    'paired_transaction_id', paired_transaction_id,
    'income_event_id', income_event_id
  );
end;
$$;

-- Deleting the event cascades to the operation, its details and its postings,
-- so the replayed position corrects itself with no compensating snapshot.
create or replace function api.delete_investment_operation(p_event_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  removed integer := 0;
  paired uuid;
begin
  if caller_id is null then
    raise exception 'Sessão inválida.' using errcode = '42501';
  end if;

  select paired_movement.event_id into paired
  from app_private.investment_transactions as movement
  join app_private.investment_transfers as link
    on (link.outbound_transaction_id = movement.id or link.inbound_transaction_id = movement.id)
   and link.user_id = movement.user_id
  join app_private.investment_transactions as paired_movement
    on paired_movement.id = case when link.outbound_transaction_id = movement.id then link.inbound_transaction_id else link.outbound_transaction_id end
   and paired_movement.user_id = movement.user_id
  where movement.event_id = p_event_id and movement.user_id = caller_id;

  delete from app_private.financial_events
  where user_id = caller_id and id in (p_event_id, paired);
  get diagnostics removed = row_count;
  if removed = 0 then
    raise exception 'Operação de investimento inexistente.' using errcode = 'P0002';
  end if;
  return removed;
end;
$$;

-- Everything a portfolio screen needs, replayed from the operations.
create or replace function api.investment_positions()
returns table (
  holding_id uuid,
  asset_id uuid,
  custody_account_id uuid,
  ledger_account_id uuid,
  asset_type_code text,
  currency_code text,
  quantity numeric,
  cost_basis numeric,
  average_price numeric,
  realized_result numeric,
  income_gross numeric,
  income_withheld numeric,
  custody_balance numeric,
  unit_price numeric,
  price_observed_at timestamptz,
  market_value numeric
)
language sql
security invoker
set search_path = ''
stable
as $$
  with holding_row as (
    select position.id, position.asset_id, position.custody_account_id, position.ledger_account_id,
           asset.asset_type_code, asset.currency_code, asset.instrument_id
    from app_private.investment_holdings as position
    join app_private.investment_assets as asset
      on asset.id = position.asset_id and asset.user_id = position.user_id
    where position.user_id = (select auth.uid()) and position.archived_at is null
  ),
  replayed as (
    select holding_row.*, walked.position_quantity, walked.position_cost_basis, walked.position_realized
    from holding_row
    cross join lateral app_private.investment_position_at((select auth.uid()), holding_row.id) as walked
  ),
  income_total as (
    select income.holding_id,
           sum(income.gross_amount) as gross_amount,
           sum(income.withheld_tax) as withheld_tax
    from app_private.investment_income_events as income
    where income.user_id = (select auth.uid())
    group by income.holding_id
  ),
  custody_total as (
    select posting.ledger_account_id, sum(posting.amount) as balance
    from app_private.ledger_postings as posting
    where posting.user_id = (select auth.uid())
    group by posting.ledger_account_id
  ),
  latest_price as (
    select distinct on (quote.asset_id) quote.asset_id, quote.unit_price, quote.observed_at
    from (
      select manual.asset_id, manual.unit_price, manual.observed_at
      from app_private.manual_asset_quotes as manual
      where manual.user_id = (select auth.uid())
      union all
      select replayed.asset_id, observation.value, observation.observed_at
      from replayed
      join catalog.asset_price_series as series
        on series.instrument_id = replayed.instrument_id and series.quote_currency_code = replayed.currency_code
      join catalog.market_observations as observation on observation.series_id = series.series_id
    ) as quote
    order by quote.asset_id, quote.observed_at desc
  )
  select replayed.id, replayed.asset_id, replayed.custody_account_id, replayed.ledger_account_id,
         replayed.asset_type_code, replayed.currency_code,
         replayed.position_quantity,
         replayed.position_cost_basis,
         case when replayed.position_quantity > 0 then replayed.position_cost_basis / replayed.position_quantity end,
         replayed.position_realized,
         coalesce(income_total.gross_amount, 0),
         coalesce(income_total.withheld_tax, 0),
         coalesce(custody_total.balance, 0),
         latest_price.unit_price,
         latest_price.observed_at,
         case
           when replayed.position_quantity > 0 and latest_price.unit_price is not null
             then replayed.position_quantity * latest_price.unit_price
           else replayed.position_cost_basis
         end
  from replayed
  left join income_total on income_total.holding_id = replayed.id
  left join custody_total on custody_total.ledger_account_id = replayed.ledger_account_id
  left join latest_price on latest_price.asset_id = replayed.asset_id;
$$;

-- A custody transfer needs the same asset held in a second custody account, so
-- a holding has to be creatable independently of the asset it tracks.
create or replace function api.write_investment_holding(p_command jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  operation text := coalesce(p_command ->> 'operation', 'create');
  requested uuid := nullif(p_command ->> 'id', '')::uuid;
  asset_id uuid := nullif(p_command ->> 'asset_id', '')::uuid;
  custody_account_id uuid := nullif(p_command ->> 'custody_account_id', '')::uuid;
  asset_currency text;
  ledger_id uuid;
begin
  if caller_id is null then raise exception 'Sessão inválida.' using errcode = '42501'; end if;
  if operation not in ('create', 'archive') then
    raise exception 'Operação de custódia inválida.' using errcode = '22023';
  end if;

  if operation = 'archive' then
    update app_private.investment_holdings
    set archived_at = coalesce(nullif(p_command ->> 'archived_at', '')::timestamptz, now())
    where id = requested and user_id = caller_id
    returning id into requested;
    if requested is null then raise exception 'Custódia inexistente.' using errcode = 'P0002'; end if;
    return requested;
  end if;

  select asset.currency_code into asset_currency
  from app_private.investment_assets as asset
  where asset.id = asset_id and asset.user_id = caller_id;
  if asset_currency is null then
    raise exception 'Ativo inexistente para a custódia informada.' using errcode = '23503';
  end if;
  if not exists (
    select 1 from app_private.accounts as account
    where account.id = custody_account_id and account.user_id = caller_id and account.archived_at is null
  ) then
    raise exception 'Conta de custódia inexistente ou arquivada.' using errcode = '23503';
  end if;

  insert into app_private.ledger_accounts (user_id, kind, currency_code)
  values (caller_id, 'investment_custody', asset_currency)
  returning id into ledger_id;

  insert into app_private.investment_holdings (id, user_id, asset_id, custody_account_id, ledger_account_id)
  values (coalesce(requested, gen_random_uuid()), caller_id, asset_id, custody_account_id, ledger_id)
  returning id into requested;
  return requested;
end;
$$;

create or replace function api.write_asset_quote(p_command jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  quote_id uuid;
begin
  if caller_id is null then
    raise exception 'Sessão inválida.' using errcode = '42501';
  end if;
  insert into app_private.manual_asset_quotes (user_id, asset_id, observed_at, unit_price, currency_code, source)
  select caller_id,
         (p_command ->> 'asset_id')::uuid,
         coalesce(nullif(p_command ->> 'observed_at', '')::timestamptz, now()),
         (p_command ->> 'unit_price')::numeric,
         asset.currency_code,
         coalesce(p_command ->> 'source', 'manual')
  from app_private.investment_assets as asset
  where asset.id = (p_command ->> 'asset_id')::uuid and asset.user_id = caller_id
  returning id into quote_id;
  if quote_id is null then
    raise exception 'Ativo inexistente para a cotação informada.' using errcode = '23503';
  end if;
  return quote_id;
end;
$$;

drop view if exists api.portfolio_positions;

grant insert, update, delete on app_private.investment_transactions,
  app_private.investment_trade_details, app_private.investment_cash_details,
  app_private.investment_charges, app_private.investment_transfers,
  app_private.investment_income_events, app_private.manual_asset_quotes,
  app_private.card_transactions, app_private.operation_fx_rates
to authenticated;

grant select on catalog.asset_price_series, catalog.market_observations,
  catalog.market_instruments, catalog.currencies, catalog.asset_types,
  catalog.indexers to authenticated;

do $$
declare routine text;
begin
  foreach routine in array array[
    'api.write_investment_operation(jsonb)', 'api.delete_investment_operation(uuid)',
    'api.investment_positions()', 'api.write_asset_quote(jsonb)',
    'api.write_investment_holding(jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon', routine);
    execute format('grant execute on function %s to authenticated', routine);
  end loop;
end;
$$;

revoke execute on function app_private.system_ledger_account(uuid, app_private.ledger_account_kind, text) from public, anon;
revoke execute on function app_private.investment_position_at(uuid, uuid, timestamptz, uuid) from public, anon;
grant execute on function app_private.system_ledger_account(uuid, app_private.ledger_account_kind, text) to authenticated;
grant execute on function app_private.investment_position_at(uuid, uuid, timestamptz, uuid) to authenticated;
