-- The api routines are SECURITY INVOKER, so reading global reference data needs
-- usage on the catalog schema. The schema is still not exposed through
-- PostgREST: only `api` is, and every catalog table stays read-only.
grant usage on schema catalog to authenticated;

revoke insert, update, delete, truncate on all tables in schema catalog from authenticated;

grant select on catalog.currencies, catalog.asset_types, catalog.organizations,
  catalog.financial_institutions, catalog.indexers, catalog.market_instruments,
  catalog.market_data_providers, catalog.market_series, catalog.asset_price_series,
  catalog.fx_series, catalog.index_series, catalog.market_observations
to authenticated;
