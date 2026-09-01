-- Preserve v1's global institution catalog in v2. These rows are public
-- reference data, not user-owned financial details, so they are deliberately
-- not encrypted.
insert into catalog.organizations (kind, legal_name, active)
select 'financial_institution'::catalog.organization_kind, source.name, source.active
from public.financial_institutions as source
on conflict (kind, legal_name) do update
  set active = excluded.active,
      updated_at = now();

insert into catalog.financial_institutions (organization_id, slug, bank_code, logo_key)
select organization.id, source.slug, source.bank_code, source.logo_key
from public.financial_institutions as source
join catalog.organizations as organization
  on organization.kind = 'financial_institution'
 and organization.legal_name = source.name
on conflict (slug) do update
  set organization_id = excluded.organization_id,
      bank_code = excluded.bank_code,
      logo_key = excluded.logo_key;

-- Categories remain plaintext by design, but private: the trigger creates one
-- independent copy for the authenticated user and RLS enforces ownership.
create or replace function app_private.seed_v2_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into app_private.profiles (user_id, display_name, mascot, theme, reporting_currency_code)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1), ''),
    jsonb_build_object('body', 'round', 'color', 'orange', 'expression', 'happy', 'accessories', jsonb_build_array('headphones'), 'frame', 'neon', 'background', 'gradient', 'nickname', '', 'title', '', 'bio', ''),
    'light',
    'BRL'
  );

  insert into app_private.categories (user_id, name, icon, color, flow, is_default)
  values
    (new.id, 'Moradia', 'Home', '#f97316', 'expense', true),
    (new.id, 'Alimentação', 'Utensils', '#0d9488', 'expense', true),
    (new.id, 'Transporte', 'Car', '#0ea5e9', 'expense', true),
    (new.id, 'Saúde', 'HeartPulse', '#ec4899', 'expense', true),
    (new.id, 'Educação', 'GraduationCap', '#8b5cf6', 'expense', true),
    (new.id, 'Lazer', 'Sparkles', '#eab308', 'expense', true),
    (new.id, 'Assinaturas', 'Repeat2', '#6366f1', 'expense', true),
    (new.id, 'Compras', 'ShoppingBag', '#f43f5e', 'expense', true),
    (new.id, 'Outros', 'CircleEllipsis', '#64748b', 'expense', true),
    (new.id, 'Salário', 'Wallet', '#34d399', 'income', true),
    (new.id, 'Aluguel recebido', 'House', '#14b8a6', 'income', true),
    (new.id, 'Freela e serviços', 'BriefcaseBusiness', '#8b5cf6', 'income', true),
    (new.id, 'Vendas', 'Store', '#f59e0b', 'income', true),
    (new.id, 'Rendimentos', 'ChartNoAxesCombined', '#0ea5e9', 'income', true),
    (new.id, 'Benefícios', 'Gift', '#ec4899', 'income', true),
    (new.id, 'Reembolsos', 'RotateCcw', '#22c55e', 'income', true),
    (new.id, 'Outras receitas', 'CircleEllipsis', '#64748b', 'income', true);
  return new;
end;
$$;
