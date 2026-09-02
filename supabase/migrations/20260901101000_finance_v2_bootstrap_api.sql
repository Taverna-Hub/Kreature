-- Read-only bootstrap for the v2 client. Private rows stay behind RLS and
-- catalog data is projected explicitly; app_private and catalog remain hidden
-- from the Data API.
create or replace function api.finance_bootstrap()
returns jsonb
language sql
security invoker
set search_path = ''
stable
as $$
  select jsonb_build_object(
    'profile', coalesce((
      select jsonb_build_object(
        'display_name', profile.display_name,
        'mascot', profile.mascot,
        'theme', profile.theme,
        'reporting_currency_code', profile.reporting_currency_code,
        'created_at', profile.created_at,
        'updated_at', profile.updated_at
      )
      from app_private.profiles as profile
      where profile.user_id = (select auth.uid())
    ), '{}'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', category.id,
        'name', category.name,
        'icon', category.icon,
        'color', category.color,
        'flow', category.flow,
        'image_path', category.image_path,
        'is_default', category.is_default,
        'archived_at', category.archived_at,
        'created_at', category.created_at,
        'updated_at', category.updated_at
      ) order by category.flow, category.name)
      from app_private.categories as category
      where category.user_id = (select auth.uid())
    ), '[]'::jsonb),
    'financial_institutions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', organization.id,
        'slug', institution.slug,
        'name', organization.legal_name,
        'bank_code', institution.bank_code,
        'logo_key', institution.logo_key,
        'primary_color', institution.primary_color,
        'secondary_color', institution.secondary_color,
        'foreground_color', institution.foreground_color
      ) order by organization.legal_name)
      from catalog.financial_institutions as institution
      join catalog.organizations as organization on organization.id = institution.organization_id
      where organization.active
    ), '[]'::jsonb)
  );
$$;

revoke all on function api.finance_bootstrap() from public, anon;
grant execute on function api.finance_bootstrap() to authenticated;
grant select on app_private.profiles, app_private.categories to authenticated;
grant select on catalog.organizations, catalog.financial_institutions to authenticated;
