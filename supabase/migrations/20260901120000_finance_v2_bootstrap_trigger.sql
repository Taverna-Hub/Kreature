-- The v2 seed routine existed but was never attached to a trigger, so no user
-- ever received an app_private profile or taxonomy. v1 keeps its own trigger
-- until the cutover, so v2 gets a second, independent one.
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
  )
  on conflict (user_id) do nothing;

  insert into app_private.categories (user_id, name, icon, color, flow, is_default)
  select new.id, seed.name, seed.icon, seed.color, seed.flow, true
  from (values
    ('Moradia', 'Home', '#f97316', 'expense'),
    ('Alimentação', 'Utensils', '#0d9488', 'expense'),
    ('Transporte', 'Car', '#0ea5e9', 'expense'),
    ('Saúde', 'HeartPulse', '#ec4899', 'expense'),
    ('Educação', 'GraduationCap', '#8b5cf6', 'expense'),
    ('Lazer', 'Sparkles', '#eab308', 'expense'),
    ('Assinaturas', 'Repeat2', '#6366f1', 'expense'),
    ('Compras', 'ShoppingBag', '#f43f5e', 'expense'),
    ('Outros', 'CircleEllipsis', '#64748b', 'expense'),
    ('Salário', 'Wallet', '#34d399', 'income'),
    ('Aluguel recebido', 'House', '#14b8a6', 'income'),
    ('Freela e serviços', 'BriefcaseBusiness', '#8b5cf6', 'income'),
    ('Vendas', 'Store', '#f59e0b', 'income'),
    ('Rendimentos', 'ChartNoAxesCombined', '#0ea5e9', 'income'),
    ('Benefícios', 'Gift', '#ec4899', 'income'),
    ('Reembolsos', 'RotateCcw', '#22c55e', 'income'),
    ('Outras receitas', 'CircleEllipsis', '#64748b', 'income')
  ) as seed(name, icon, color, flow)
  on conflict do nothing;

  return new;
end;
$$;

revoke execute on function app_private.seed_v2_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_v2 on auth.users;
create trigger on_auth_user_created_v2
after insert on auth.users
for each row execute procedure app_private.seed_v2_user();

-- Existing accounts predate the trigger. Backfill so they can already read the
-- v2 bootstrap while v1 is still the live application.
insert into app_private.profiles (user_id, display_name, mascot, theme, reporting_currency_code)
select account.id,
       coalesce(nullif(account.raw_user_meta_data ->> 'display_name', ''), split_part(account.email, '@', 1), ''),
       jsonb_build_object('body', 'round', 'color', 'orange', 'expression', 'happy', 'accessories', jsonb_build_array('headphones'), 'frame', 'neon', 'background', 'gradient', 'nickname', '', 'title', '', 'bio', ''),
       'light',
       'BRL'
from auth.users as account
on conflict (user_id) do nothing;

insert into app_private.categories (user_id, name, icon, color, flow, is_default)
select account.id, seed.name, seed.icon, seed.color, seed.flow, true
from auth.users as account
cross join (values
  ('Moradia', 'Home', '#f97316', 'expense'),
  ('Alimentação', 'Utensils', '#0d9488', 'expense'),
  ('Transporte', 'Car', '#0ea5e9', 'expense'),
  ('Saúde', 'HeartPulse', '#ec4899', 'expense'),
  ('Educação', 'GraduationCap', '#8b5cf6', 'expense'),
  ('Lazer', 'Sparkles', '#eab308', 'expense'),
  ('Assinaturas', 'Repeat2', '#6366f1', 'expense'),
  ('Compras', 'ShoppingBag', '#f43f5e', 'expense'),
  ('Outros', 'CircleEllipsis', '#64748b', 'expense'),
  ('Salário', 'Wallet', '#34d399', 'income'),
  ('Aluguel recebido', 'House', '#14b8a6', 'income'),
  ('Freela e serviços', 'BriefcaseBusiness', '#8b5cf6', 'income'),
  ('Vendas', 'Store', '#f59e0b', 'income'),
  ('Rendimentos', 'ChartNoAxesCombined', '#0ea5e9', 'income'),
  ('Benefícios', 'Gift', '#ec4899', 'income'),
  ('Reembolsos', 'RotateCcw', '#22c55e', 'income'),
  ('Outras receitas', 'CircleEllipsis', '#64748b', 'income')
) as seed(name, icon, color, flow)
on conflict do nothing;
