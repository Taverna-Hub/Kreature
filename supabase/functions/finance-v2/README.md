# Finance v2 Edge Function

The only writer and reader of encrypted financial data. The browser never sees a
ciphertext, a nonce, a key version, an RPC name or the private schema layout.

## Required Edge Function Secrets

- `DATA_ROOT_KEY_ACTIVE_VERSION=1`
- `DATA_ROOT_KEY_V1=<32 random bytes, base64>`

Generate with a cryptographically secure source, set through Supabase Secrets,
and copy once into the offline recovery package. Never put it in `.env`, in the
browser bundle, in a migration, in a database row, in a log or in git.

## How the encryption works

- One key per user, per purpose, per key version, derived with **HKDF-SHA256**
  from the root key: salt is the user id, info is
  `kreature:finance-v2:<purpose>:v<version>`. The root key never leaves this
  function and is never stored anywhere the database can reach.
- Payloads are sealed with **AES-256-GCM** under a fresh 12-byte nonce.
- The associated data binds each ciphertext to one row and one column:
  `<user>|<table>|<row id>|sensitive_payload|v<version>`. A payload lifted from
  one row cannot be replayed into another, into another user, or into another
  column. Planned occurrences bind to their natural key `<rule>:<date>`, because
  they are upserted and their row id is not stable.
- **Because the associated data contains the row id, every create sends the id
  it minted to the database.** A routine that lets the database mint its own id
  produces a row that can never be decrypted again.
- Deduplication uses a keyed **HMAC-SHA256** under the same derivation, so a
  classification rule and an import fingerprint can be compared without ever
  being readable.

## Rotating the root key

Add `DATA_ROOT_KEY_V2`, set `DATA_ROOT_KEY_ACTIVE_VERSION=2`, and keep V1
present. New writes use V2; existing rows keep decrypting under the version
stored on the row. Remove V1 only after every row has been rewritten.

## Contracts

| Action | Purpose |
| --- | --- |
| `snapshot` | One round trip over every projection below |
| `bootstrap` | Profile, categories, institution catalog |
| `write-profile`, `write-category` | Plaintext, private, user-scoped |
| `write-account`, `list-accounts` | Accounts and their sealed identifiers |
| `write-card`, `list-cards` | Cards; a credit card is a liability |
| `write-investment-asset`, `list-investment-assets` | Asset registry |
| `write-investment-operation` | Buy, sell, contribution, redemption, custody transfer, income, opening |
| `delete-investment-operation` | Removes the event; the position replays itself |
| `investment-positions` | Quantity, cost basis, average price, realized result, income, market value |
| `write-asset-quote` | A quote moves market value, never cost basis |
| `write-cash-event` | Income, expense, transfer, adjustment, opening balance |
| `write-event` | Escape hatch for a caller that supplies its own legs |
| `list-events` | Events with their legs, card, investment and income detail |
| `write-card-transaction`, `pay-card-invoice`, `card-invoices` | Installments and invoices |
| `write-recurrence-rule`, `write-planned-occurrence`, `list-*` | Planning |
| `write-classification-rule`, `list-classification-rules` | Rules, text sealed, HMAC for uniqueness |
| `write-import-batch`, `list-import-batches`, `import-batch-exists` | Import batches, idempotent by fingerprint |
| `write-fx-rate`, `list-fx-rates` | Conversion rates, relational and observed |
| `account-balances`, `card-balances` | Derived from the ledger |

## Guarantees

- Only the caller's JWT is used; `service_role` never touches user-owned data.
- Every `api` routine is `SECURITY INVOKER` with a pinned `search_path`, so RLS
  applies to every statement.
- Database messages that name a constraint, column or relation are replaced
  before they reach the browser.
- Import batches store a batch, a period, encrypted metadata and a keyed
  fingerprint. The file, the PDF, the spreadsheet, the OCR output and the
  extracted text are never sent here and have nowhere to be stored.
