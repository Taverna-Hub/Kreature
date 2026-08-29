-- Users created before the initial schema migration do not pass through the
-- auth.users trigger. Backfill their private profile and default taxonomy once.
insert into public.profiles (user_id, display_name, mascot, theme)
select
  user_row.id,
  coalesce(nullif(user_row.raw_user_meta_data ->> 'display_name', ''), split_part(user_row.email, '@', 1), ''),
  jsonb_build_object(
    'body', 'round', 'color', 'orange', 'expression', 'happy',
    'accessories', jsonb_build_array('headphones'), 'frame', 'neon',
    'background', 'gradient', 'nickname', '', 'title', '', 'bio', ''
  ),
  'light'
from auth.users as user_row
on conflict (user_id) do nothing;

insert into public.categories (user_id, name, icon, color, flow, is_default)
select user_row.id, seed.name, seed.icon, seed.color, seed.flow::public.category_flow, true
from auth.users as user_row
cross join (
  values
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
on conflict (user_id, name, flow) do nothing;
