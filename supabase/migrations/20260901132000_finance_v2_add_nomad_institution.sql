-- Nomad is global reference data: it is readable by every user and contains
-- no user-owned financial information.
insert into catalog.organizations (kind, legal_name, trade_name, active)
values ('financial_institution', 'Nomad', 'Nomad', true)
on conflict (kind, legal_name) do update
  set trade_name = excluded.trade_name,
      active = excluded.active,
      updated_at = now();

insert into catalog.financial_institutions (
  organization_id,
  slug,
  bank_code,
  logo_key,
  primary_color,
  secondary_color,
  foreground_color
)
select organization.id, 'nomad', null, 'nomad', '#FFDE21', '#FFDE21', '#1A1A13'
from catalog.organizations as organization
where organization.kind = 'financial_institution'
  and organization.legal_name = 'Nomad'
on conflict (slug) do update
  set organization_id = excluded.organization_id,
      bank_code = excluded.bank_code,
      logo_key = excluded.logo_key,
      primary_color = excluded.primary_color,
      secondary_color = excluded.secondary_color,
      foreground_color = excluded.foreground_color;
