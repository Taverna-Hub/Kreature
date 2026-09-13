-- User-authorized cleanup: January 2026 movements for exactly one profile.
do $$
declare
  v_user_id uuid;
  v_user_count integer;
  v_deleted integer;
begin
  select count(*)::integer
  into v_user_count
  from app_private.profiles
  where lower(display_name) = lower('thomazrlima');

  if v_user_count <> 1 then
    raise exception 'Expected exactly one Thomazrlima profile, found %.', v_user_count;
  end if;

  select user_id
  into v_user_id
  from app_private.profiles
  where lower(display_name) = lower('thomazrlima');

  delete from app_private.financial_events
  where user_id = v_user_id
    and occurred_at >= date '2026-01-01'
    and occurred_at < date '2026-02-01';

  get diagnostics v_deleted = row_count;
  raise notice 'Deleted % January 2026 financial events.', v_deleted;
end
$$;
