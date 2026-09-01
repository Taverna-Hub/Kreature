-- Deleting an account must remove everything that belongs to it. Every private
-- table cascades from auth.users, but PostgreSQL runs those cascades in no
-- particular order, so an intra-tenant ON DELETE RESTRICT fires against rows
-- that are themselves about to disappear. The planned destructive cutover would
-- have failed on exactly this.
--
-- NO ACTION DEFERRABLE keeps the same guarantee - no reference may dangle when
-- the transaction commits - while letting one transaction remove both sides.
do $$
declare
  constraint_row record;
  definition text;
begin
  for constraint_row in
    select connamespace::regnamespace as schema_name,
           conrelid::regclass as table_name,
           conname as constraint_name,
           pg_get_constraintdef(oid) as definition
    from pg_constraint
    where contype = 'f'
      and confdeltype = 'r'
      and connamespace = 'app_private'::regnamespace
    order by conname
  loop
    definition := replace(constraint_row.definition, 'ON DELETE RESTRICT', 'ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED');
    execute format('alter table %s drop constraint %I', constraint_row.table_name, constraint_row.constraint_name);
    execute format('alter table %s add constraint %I %s', constraint_row.table_name, constraint_row.constraint_name, definition);
  end loop;
end;
$$;

do $$
declare remaining integer;
begin
  select count(*) into remaining
  from pg_constraint
  where contype = 'f' and confdeltype = 'r' and connamespace = 'app_private'::regnamespace;
  if remaining > 0 then
    raise exception 'Ainda existem % chaves estrangeiras RESTRICT em app_private.', remaining;
  end if;
end;
$$;
