# Finance v2 test suites

Both suites run against a local Supabase stack and never touch a hosted project.

```bash
supabase start
supabase db reset

# 1. Database surface: RLS, tenant isolation, ledger balance, derived positions
psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" \
  -f supabase/tests/finance_v2_integration.sql

# 2. Edge Function boundary: CORS, AES-256-GCM round trip, every contract
printf 'DATA_ROOT_KEY_ACTIVE_VERSION=1\nDATA_ROOT_KEY_V1=%s\n' \
  "$(head -c 32 /dev/urandom | base64 -w0)" > /tmp/finance-v2.env
supabase functions serve finance-v2 --env-file /tmp/finance-v2.env &
python3 supabase/tests/finance_v2_edge_function.py
```

The Edge Function suite expects two confirmed local users, created once with the
local `service_role` key:

```bash
for email in edge-test edge-other; do
  curl -s -X POST "http://127.0.0.1:54321/auth/v1/admin/users" \
    -H "apikey: $SERVICE_ROLE_KEY" -H "authorization: Bearer $SERVICE_ROLE_KEY" \
    -H "content-type: application/json" \
    -d "{\"email\":\"$email@example.test\",\"password\":\"Kreature-Test-2026\",\"email_confirm\":true}"
done
```

The root key in `/tmp/finance-v2.env` is throwaway local material. The real key
lives only in Supabase Edge Function Secrets and never in the repository.
