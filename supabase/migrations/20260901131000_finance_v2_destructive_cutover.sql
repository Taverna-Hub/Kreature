-- IRREVERSIBLE COORDINATED CUTOVER
--
-- Preconditions confirmed by the operator on 2026-09-01:
--   * PITR/backup is available;
--   * DATA_ROOT_KEY_V1 was tested and is stored offline;
--   * maintenance mode is enabled and signup is disabled.
--
-- This migration deliberately removes every auth user and all Finance v1 data.
-- It preserves the v2 schemas: api, app_private and catalog.

begin;

do $$
declare
  public_extensions text;
begin
  if not exists (select 1 from pg_namespace where nspname = 'api')
     or not exists (select 1 from pg_namespace where nspname = 'app_private')
     or not exists (select 1 from pg_namespace where nspname = 'catalog') then
    raise exception 'Finance v2 schemas are missing; refusing destructive cutover';
  end if;

  select string_agg(extension.extname, ', ' order by extension.extname)
    into public_extensions
  from pg_extension extension
  join pg_namespace namespace on namespace.oid = extension.extnamespace
  where namespace.nspname = 'public';

  if public_extensions is not null then
    raise exception
      'Extensions installed in public must be relocated before the cutover: %',
      public_extensions;
  end if;

end;
$$;

-- Prevent any concurrent signup from invoking the legacy bootstrap while the
-- v1 schema is removed. The v2 trigger stays in place.
drop trigger if exists on_auth_user_created on auth.users;

-- The legacy category-images bucket is retained by explicit operator decision.
-- Remove its v1 policies so it is not accessible to future application users.
drop policy if exists category_images_select_own on storage.objects;
drop policy if exists category_images_insert_own on storage.objects;
drop policy if exists category_images_update_own on storage.objects;
drop policy if exists category_images_delete_own on storage.objects;

-- auth.users is the tenant root. Its cascading/deferrable foreign keys erase
-- all private v1 and v2 rows, including profiles, categories and sessions.
delete from auth.users;

do $$
begin
  if exists (select 1 from auth.users) then
    raise exception 'auth.users still contains rows; refusing to remove public';
  end if;

end;
$$;

-- The public schema contained only the Finance v1 model. Recreate it empty so
-- PostgreSQL/Supabase retain their conventional schema while the Data API is
-- restricted to api after this cutover.
drop schema public cascade;
create schema public;
revoke all on schema public from public;
comment on schema public is 'Intentionally empty after the Finance v2 cutover.';

-- Pin the Data API to the deliberately narrow v2 surface. This avoids a
-- Dashboard-only setting and makes the cutover reproducible from migrations.
alter role authenticator set pgrst.db_schemas = 'api';
notify pgrst, 'reload config';
notify pgrst, 'reload schema';

commit;
