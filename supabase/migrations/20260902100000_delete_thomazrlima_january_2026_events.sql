-- Authorized one-off data correction.
-- Target resolved from the Thomazrlima account in the linked Supabase project.
-- The event table is the source of truth: dependent ledger postings, card
-- transactions and investment operation rows are removed by their FK cascades.
do $$
declare
  target_user_id constant uuid := '1d1d2b96-24d5-4984-bcac-2ce40f4ce894';
  expected_events constant integer := 58;
  matching_events integer;
  deleted_events integer;
begin
  if not exists (
    select 1
    from app_private.profiles
    where user_id = target_user_id
      and lower(display_name) = 'thomazrlima'
  ) then
    raise exception 'Target profile for the authorized January 2026 correction was not found.';
  end if;

  select count(*)
    into matching_events
  from app_private.financial_events
  where user_id = target_user_id
    and occurred_at >= date '2026-01-01'
    and occurred_at < date '2026-02-01';

  if matching_events <> expected_events then
    raise exception
      'Refusing January 2026 deletion: expected % events for target user, found %.',
      expected_events,
      matching_events;
  end if;

  delete from app_private.financial_events
  where user_id = target_user_id
    and occurred_at >= date '2026-01-01'
    and occurred_at < date '2026-02-01';

  get diagnostics deleted_events = row_count;
  if deleted_events <> expected_events then
    raise exception
      'January 2026 deletion was incomplete: expected %, deleted %.',
      expected_events,
      deleted_events;
  end if;
end;
$$;
