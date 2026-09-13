-- Removes only the orphaned card import marker so the authenticated UI can retry it.
do $$
declare
  v_user_id uuid;
  v_profile_count integer;
  v_orphan_count integer;
begin
  select count(*)::integer
  into v_profile_count
  from app_private.profiles
  where lower(display_name) = lower('thomazrlima');

  if v_profile_count <> 1 then
    raise exception 'Expected exactly one Thomazrlima profile, found %.', v_profile_count;
  end if;

  select user_id
  into v_user_id
  from app_private.profiles
  where lower(display_name) = lower('thomazrlima');

  select count(*)::integer
  into v_orphan_count
  from app_private.import_batches b
  where b.user_id = v_user_id
    and b.kind = 'card_statement'
    and not exists (select 1 from app_private.financial_events e where e.import_batch_id = b.id);

  if v_orphan_count <> 1 then
    raise exception 'Expected exactly one orphaned card import batch, found %.', v_orphan_count;
  end if;

  delete from app_private.import_batches b
  where b.user_id = v_user_id and b.kind = 'card_statement'
    and not exists (select 1 from app_private.financial_events e where e.import_batch_id = b.id);
end
$$;
