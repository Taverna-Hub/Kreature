-- Civil dates stay DATE; instant-to-calendar conversions always name the business zone.
-- No historical records are rewritten. Existing argument names remain compatible.
begin;
drop function if exists api.list_financial_events(integer, timestamptz, timestamptz);
create or replace function api.list_financial_events(
  p_limit integer default 200,
  p_before timestamptz default null,
  p_since timestamptz default null,
  p_before_id uuid default null
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
    and (p_before is null or event.occurred_at < p_before
      or (p_before_id is not null and event.occurred_at = p_before and event.id < p_before_id))
    and (p_since is null or event.occurred_at >= p_since)
  order by event.occurred_at desc, event.id desc
  limit greatest(1, least(coalesce(p_limit, 200), 1000));
$$;
revoke all on function api.list_financial_events(integer,timestamptz,timestamptz,uuid) from public, anon;
grant execute on function api.list_financial_events(integer,timestamptz,timestamptz,uuid) to authenticated;
create index if not exists financial_events_user_cursor_idx
  on app_private.financial_events(user_id, occurred_at desc, id desc);

create or replace function api.write_card_transaction(p_command jsonb)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  caller_id uuid := auth.uid();
  event_data jsonb := p_command -> 'event';
  target_card_id uuid := nullif(p_command ->> 'card_id', '')::uuid;
  transaction_kind text := coalesce(p_command ->> 'kind', 'purchase');
  total_amount numeric := nullif(p_command ->> 'amount', '')::numeric;
  installments smallint := coalesce(nullif(p_command ->> 'installments', '')::smallint, 1);
  occurred_at timestamptz := coalesce(nullif(p_command ->> 'occurred_at', '')::timestamptz, now());
  source_text text := coalesce(event_data ->> 'source', 'manual');
  first_invoice_month date := nullif(p_command ->> 'first_invoice_month', '')::date;
  installment_events jsonb := coalesce(p_command -> 'installment_events', '[]'::jsonb);
  installment_event jsonb;
  card record;
  expense_ledger uuid;
  installment_amount numeric;
  allocated numeric := 0;
  signed_amount numeric;
  event_id uuid;
  created_ids uuid[] := array[]::uuid[];
begin
  if caller_id is null then raise exception 'Sessão inválida.' using errcode = '42501'; end if;
  if transaction_kind not in ('purchase', 'refund', 'fee', 'interest') then
    raise exception 'Tipo de lançamento de cartão inválido.' using errcode = '22023';
  end if;
  if total_amount is null or total_amount <= 0 then
    raise exception 'Valor do lançamento do cartão deve ser maior que zero.' using errcode = '22023';
  end if;
  if installments < 1 or installments > 360 then
    raise exception 'Número de parcelas inválido.' using errcode = '22023';
  end if;
  -- Each installment is its own row, so each needs its own envelope bound to
  -- its own id. A short list would silently reuse one nonce.
  if jsonb_array_length(installment_events) <> installments then
    raise exception 'Cada parcela exige o próprio envelope cifrado.' using errcode = '22023';
  end if;
  if source_text not in ('manual', 'import', 'planned') then
    raise exception 'Origem de lançamento não permitida ao cliente.' using errcode = '42501';
  end if;

  select cards.id, cards.currency_code, cards.kind, terms.liability_ledger_account_id, terms.closing_day
    into card
  from app_private.cards as cards
  left join app_private.credit_card_terms as terms
    on terms.card_id = cards.id and terms.user_id = cards.user_id
  where cards.id = target_card_id and cards.user_id = caller_id and cards.archived_at is null;
  if not found then raise exception 'Cartão inexistente ou arquivado.' using errcode = '23503'; end if;
  if card.liability_ledger_account_id is null then
    raise exception 'Somente cartão de crédito acumula fatura.' using errcode = '22023';
  end if;

  if first_invoice_month is null then
    first_invoice_month := date_trunc('month',
      case when extract(day from occurred_at at time zone 'America/Recife')::smallint > coalesce(card.closing_day, 1)
        then (occurred_at at time zone 'America/Recife') + interval '1 month'
        else occurred_at at time zone 'America/Recife'
      end)::date;
  end if;

  expense_ledger := app_private.system_ledger_account(caller_id, 'expense', card.currency_code);

  for installment_index in 1..installments loop
    if installment_index = installments then
      installment_amount := total_amount - allocated;
    else
      installment_amount := round(total_amount / installments, 2);
      allocated := allocated + installment_amount;
    end if;
    if installment_amount <= 0 then continue; end if;

    installment_event := installment_events -> (installment_index - 1);
    event_id := coalesce(nullif(installment_event ->> 'id', '')::uuid, gen_random_uuid());

    insert into app_private.financial_events (
      id, user_id, kind, category_id, import_batch_id, occurred_at,
      sensitive_payload, encryption_nonce, encryption_key_version, source
    ) values (
      event_id, caller_id, 'card_transaction', nullif(event_data ->> 'category_id', '')::uuid,
      nullif(event_data ->> 'import_batch_id', '')::uuid, occurred_at,
      decode(installment_event ->> 'sensitive_payload_b64', 'base64'),
      decode(installment_event ->> 'encryption_nonce_b64', 'base64'),
      (installment_event ->> 'encryption_key_version')::smallint,
      source_text
    );

    insert into app_private.card_transactions (
      event_id, user_id, card_id, kind, installment_number, total_installments, first_invoice_month
    ) values (
      event_id, caller_id, card.id, transaction_kind::app_private.card_transaction_kind,
      installment_index, installments, first_invoice_month
    );

    -- A refund gives limit back, so it reverses the sign of a purchase.
    signed_amount := case when transaction_kind = 'refund' then -installment_amount else installment_amount end;
    insert into app_private.ledger_postings (user_id, event_id, ledger_account_id, amount, currency_code)
    values (caller_id, event_id, expense_ledger, signed_amount, card.currency_code),
           (caller_id, event_id, card.liability_ledger_account_id, -signed_amount, card.currency_code);

    created_ids := created_ids || event_id;
  end loop;

  return jsonb_build_object('event_ids', to_jsonb(created_ids), 'first_invoice_month', first_invoice_month);
end;
$$;

-- Preserve the reconciliation wrapper; update only its settlement implementation.
create or replace function api.pay_card_invoice_legacy(p_command jsonb)
returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  caller_id uuid := auth.uid();
  event_data jsonb := p_command -> 'event';
  target_card_id uuid := nullif(p_command ->> 'card_id', '')::uuid;
  settlement_account_id uuid := nullif(p_command ->> 'account_id', '')::uuid;
  amount numeric := nullif(p_command ->> 'amount', '')::numeric;
  occurred_at timestamptz := coalesce(nullif(p_command ->> 'occurred_at', '')::timestamptz, now());
  target_invoice_month date := date_trunc('month', coalesce(nullif(p_command ->> 'invoice_month', '')::date, (occurred_at at time zone 'America/Recife')::date)::timestamp)::date;
  card record;
  cash_ledger uuid;
  cash_currency text;
  event_id uuid;
begin
  if caller_id is null then raise exception 'Sessão inválida.' using errcode = '42501'; end if;
  if amount is null or amount <= 0 then
    raise exception 'Valor da fatura deve ser maior que zero.' using errcode = '22023';
  end if;

  select cards.currency_code, terms.liability_ledger_account_id, terms.payer_account_id into card
  from app_private.cards as cards
  join app_private.credit_card_terms as terms
    on terms.card_id = cards.id and terms.user_id = cards.user_id
  where cards.id = target_card_id and cards.user_id = caller_id;
  if not found then raise exception 'Cartão de crédito inexistente.' using errcode = '23503'; end if;
  settlement_account_id := coalesce(settlement_account_id, card.payer_account_id);
  if settlement_account_id is null then
    raise exception 'Defina a conta pagadora deste cartão.' using errcode = '22023';
  end if;

  -- Serializes concurrent statement/invoice imports for this exact invoice.
  perform pg_advisory_xact_lock(hashtextextended(concat_ws(':', caller_id::text, target_card_id::text, target_invoice_month::text), 0));
  select settlement.event_id into event_id
  from app_private.card_invoice_settlements as settlement
  where settlement.user_id = caller_id
    and settlement.card_id = target_card_id
    and settlement.invoice_month = target_invoice_month;
  if found then return event_id; end if;

  select accounts.ledger_account_id, accounts.currency_code into cash_ledger, cash_currency
  from app_private.accounts as accounts
  where accounts.id = settlement_account_id and accounts.user_id = caller_id and accounts.archived_at is null;
  if not found then raise exception 'Conta pagadora inexistente ou arquivada.' using errcode = '23503'; end if;
  if cash_currency <> card.currency_code then
    raise exception 'Pagamento em moeda diferente da fatura exige câmbio explícito.' using errcode = '22023';
  end if;

  event_id := coalesce(nullif(p_command ->> 'event_id', '')::uuid, gen_random_uuid());
  insert into app_private.financial_events (
    id, user_id, kind, occurred_at, sensitive_payload, encryption_nonce, encryption_key_version, source
  ) values (
    event_id, caller_id, 'credit_card_payment', occurred_at,
    decode(event_data ->> 'sensitive_payload_b64', 'base64'),
    decode(event_data ->> 'encryption_nonce_b64', 'base64'),
    (event_data ->> 'encryption_key_version')::smallint,
    coalesce(event_data ->> 'source', 'manual')
  );
  insert into app_private.ledger_postings (user_id, event_id, ledger_account_id, amount, currency_code)
  values (caller_id, event_id, card.liability_ledger_account_id, amount, card.currency_code),
         (caller_id, event_id, cash_ledger, -amount, card.currency_code);
  insert into app_private.card_invoice_settlements (event_id, user_id, card_id, account_id, invoice_month)
  values (event_id, caller_id, target_card_id, settlement_account_id, target_invoice_month);
  return event_id;
end;
$$;

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
  payment_date date := coalesce(nullif(p_command ->> 'payment_date', '')::date, (traded_at at time zone 'America/Recife')::date);
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
commit;
