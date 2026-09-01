-- Plaintext resources remain private. These routines deliberately use the
-- caller identity from auth.uid(), never a client-supplied user_id.
create or replace function api.write_profile(p_profile jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception 'Sessão inválida.' using errcode = '42501';
  end if;

  update app_private.profiles
  set display_name = coalesce(p_profile ->> 'display_name', display_name),
      mascot = coalesce(p_profile -> 'mascot', mascot),
      theme = coalesce(p_profile ->> 'theme', theme),
      reporting_currency_code = coalesce(p_profile ->> 'reporting_currency_code', reporting_currency_code)
  where user_id = caller_id;

  if not found then
    raise exception 'Perfil v2 inexistente para o usuário.' using errcode = '23503';
  end if;
end;
$$;

create or replace function api.write_category(p_command jsonb)
returns table (category_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  operation text := p_command ->> 'operation';
  requested_id uuid := nullif(p_command ->> 'id', '')::uuid;
  payload jsonb := p_command -> 'category';
begin
  if caller_id is null then
    raise exception 'Sessão inválida.' using errcode = '42501';
  end if;
  if operation not in ('create', 'update', 'delete') then
    raise exception 'Operação de categoria inválida.' using errcode = '22023';
  end if;
  if operation in ('update', 'delete') and requested_id is null then
    raise exception 'ID da categoria obrigatório.' using errcode = '22023';
  end if;

  if operation = 'create' then
    insert into app_private.categories (user_id, name, icon, color, flow, image_path, is_default)
    values (
      caller_id,
      payload ->> 'name',
      payload ->> 'icon',
      payload ->> 'color',
      payload ->> 'flow',
      nullif(payload ->> 'image_path', ''),
      coalesce((payload ->> 'is_default')::boolean, false)
    ) returning id into requested_id;
  elsif operation = 'update' then
    update app_private.categories
    set name = coalesce(payload ->> 'name', name),
        icon = coalesce(payload ->> 'icon', icon),
        color = coalesce(payload ->> 'color', color),
        flow = coalesce(payload ->> 'flow', flow),
        image_path = case when payload ? 'image_path' then nullif(payload ->> 'image_path', '') else image_path end,
        archived_at = case when payload ? 'archived_at' then nullif(payload ->> 'archived_at', '')::timestamptz else archived_at end
    where id = requested_id and user_id = caller_id;
    if not found then raise exception 'Categoria inexistente.' using errcode = 'P0002'; end if;
  else
    delete from app_private.categories where id = requested_id and user_id = caller_id;
    if not found then raise exception 'Categoria inexistente.' using errcode = 'P0002'; end if;
  end if;

  return query select requested_id;
end;
$$;

revoke all on function api.write_profile(jsonb), api.write_category(jsonb) from public, anon;
grant execute on function api.write_profile(jsonb), api.write_category(jsonb) to authenticated;
grant update on app_private.profiles to authenticated;
grant select, insert, update, delete on app_private.categories to authenticated;
