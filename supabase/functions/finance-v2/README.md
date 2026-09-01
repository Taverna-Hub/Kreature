# Finance v2 Edge Function

Required Supabase Edge Function Secrets:

- `DATA_ROOT_KEY_ACTIVE_VERSION=1`
- `DATA_ROOT_KEY_V1=<base64 de 32 bytes aleatórios>`

The key must be generated with a cryptographically secure generator, configured
through Supabase Secrets, and copied once into the offline recovery package.
Never add it to `.env`, browser code, migrations, database rows, logs, or git.

The function accepts only a caller JWT and invokes `api.*` routines with that
same JWT. It never uses `service_role` for user-owned data.
