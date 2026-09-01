import json, urllib.request, urllib.error, sys, uuid

BASE = "http://127.0.0.1:54321"
# Local-only demo keys, identical on every machine that runs `supabase start`.
ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"
FAILURES = []
# Each run works with its own pair of tenants, so the suite is repeatable
# without needing to tear anything down.
RUN = uuid.uuid4().hex[:12]
ACCOUNTS = [f"edge-{name}-{RUN}@example.test" for name in ("one", "two")]


def create_accounts():
    for email in ACCOUNTS:
        req = urllib.request.Request(
            f"{BASE}/auth/v1/admin/users",
            data=json.dumps({"email": email, "password": "Kreature-Test-2026", "email_confirm": True}).encode(),
            headers={"apikey": SERVICE, "authorization": f"Bearer {SERVICE}", "content-type": "application/json"},
            method="POST")
        urllib.request.urlopen(req).read()


create_accounts()


def token(email):
    req = urllib.request.Request(f"{BASE}/auth/v1/token?grant_type=password",
        data=json.dumps({"email": email, "password": "Kreature-Test-2026"}).encode(),
        headers={"apikey": ANON, "content-type": "application/json"}, method="POST")
    return json.load(urllib.request.urlopen(req))["access_token"]

def call(tok, action, **payload):
    body = dict(action=action, **payload)
    req = urllib.request.Request(f"{BASE}/functions/v1/finance-v2",
        data=json.dumps(body).encode(),
        headers={"authorization": f"Bearer {tok}", "apikey": ANON, "content-type": "application/json"},
        method="POST")
    try:
        with urllib.request.urlopen(req) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        raw = error.read().decode()
        try:
            return error.code, json.loads(raw)
        except json.JSONDecodeError:
            return error.code, {"error": raw[:300]}

def data(tok, action, **payload):
    status, body = call(tok, action, **payload)
    if status != 200 or "data" not in body:
        raise AssertionError(f"{action} -> {status} {json.dumps(body)[:400]}")
    return body["data"]

def expect(condition, label, detail=""):
    if condition:
        print(f"ok   {label}")
    else:
        FAILURES.append(label)
        print(f"FAIL {label} {detail}")

# --- CORS preflight -------------------------------------------------------
req = urllib.request.Request(f"{BASE}/functions/v1/finance-v2", method="OPTIONS",
    headers={"origin": "http://localhost:5173", "access-control-request-method": "POST",
             "access-control-request-headers": "authorization, content-type"})
with urllib.request.urlopen(req) as response:
    allow_origin = response.headers.get("access-control-allow-origin")
    allow_headers = (response.headers.get("access-control-allow-headers") or "").lower()
expect(allow_origin == "*", "preflight allows the browser origin", allow_origin)
expect("authorization" in allow_headers, "preflight allows the authorization header", allow_headers)

ana = token(ACCOUNTS[0])
bruno = token(ACCOUNTS[1])

# --- unauthenticated ------------------------------------------------------
status, body = call("not-a-token", "bootstrap")
expect(status == 401, "an invalid session is refused", f"{status} {body}")

# --- bootstrap ------------------------------------------------------------
boot = data(ana, "bootstrap")
expect(len(boot["categories"]) == 17, "bootstrap returns the 17 seeded categories", len(boot["categories"]))
expect(len(boot["financial_institutions"]) >= 16, "bootstrap returns the institution catalog")
expect("sensitive_payload" not in json.dumps(boot), "bootstrap never carries ciphertext")

# --- accounts: encrypt on write, decrypt on read --------------------------
written = data(ana, "write-account", command={
    "operation": "create",
    "account": {"kind": "bank", "currencyCode": "BRL",
                "sensitive": {"name": "Conta Corrente", "agency": "0001", "accountNumber": "12345-6"}}})
checking = written["account_id"]
expect(written["account_version"] == 1, "the new account reports version 1")

accounts = data(ana, "list-accounts")
mine = next(a for a in accounts if a["id"] == checking)
expect(mine["sensitive"]["name"] == "Conta Corrente", "the account payload survived the AES-GCM round trip",
       json.dumps(mine)[:200])
expect(not mine.get("sensitiveUnavailable"), "the account payload opened cleanly")
expect("sensitive_payload_b64" not in json.dumps(accounts), "the account list carries no ciphertext")

# The camelCase expected version has to reach the database as expected_version.
updated = data(ana, "write-account", command={
    "operation": "update", "id": checking, "expectedVersion": 1,
    "account": {"kind": "bank", "currencyCode": "BRL",
                "sensitive": {"name": "Conta Corrente Renomeada", "agency": "0001"}}})
expect(updated["account_version"] == 2, "optimistic locking accepted the reported version", updated)

status, body = call(ana, "write-account", command={
    "operation": "update", "id": checking, "expectedVersion": 1,
    "account": {"kind": "bank", "currencyCode": "BRL", "sensitive": {"name": "x"}}})
expect(status == 409, "a stale write is reported as a conflict", f"{status} {body}")

broker = data(ana, "write-account", command={
    "operation": "create",
    "account": {"kind": "brokerage", "currencyCode": "BRL", "sensitive": {"name": "Corretora"}}})["account_id"]

# --- cash events: the create id must match the id the AAD was bound to ----
category = next(c for c in boot["categories"] if c["flow"] == "expense")
data(ana, "write-cash-event", command={
    "operation": "create",
    "event": {"kind": "opening_balance", "occurredAt": "2026-01-01T12:00:00Z", "amount": "10000",
              "accountId": checking, "sensitive": {"description": "Saldo inicial"}}})
expense = data(ana, "write-cash-event", command={
    "operation": "create",
    "event": {"kind": "expense", "occurredAt": "2026-01-05T12:00:00Z", "amount": "250.50",
              "accountId": checking, "categoryId": category["id"],
              "sensitive": {"description": "Mercado da esquina", "notes": "compra semanal"}}})

events = data(ana, "list-events")
opened = next(e for e in events if e["id"] == expense["event_id"])
expect(opened["sensitive"]["description"] == "Mercado da esquina",
       "a created event decrypts on the next read", json.dumps(opened)[:250])
expect(not any(e.get("sensitiveUnavailable") for e in events), "every event payload opened cleanly")
expect(len(opened["postings"]) == 2, "the event came back with both ledger legs")
expect(sum(float(p["amount"]) for p in opened["postings"]) == 0, "the returned legs balance")

balances = data(ana, "account-balances")
checking_balance = next(b for b in balances if b["account_id"] == checking)
expect(abs(float(checking_balance["balance"]) - 9749.50) < 0.001,
       "the account balance is derived from the ledger", checking_balance)

# --- update then re-read: the AAD follows the same row --------------------
data(ana, "write-cash-event", command={
    "operation": "update", "id": expense["event_id"], "expectedVersion": 1,
    "event": {"kind": "expense", "occurredAt": "2026-01-05T12:00:00Z", "amount": "300",
              "accountId": checking, "categoryId": category["id"],
              "sensitive": {"description": "Mercado da esquina (corrigido)"}}})
events = data(ana, "list-events")
opened = next(e for e in events if e["id"] == expense["event_id"])
expect(opened["sensitive"]["description"] == "Mercado da esquina (corrigido)",
       "an updated event decrypts with the new payload")

# --- cards ----------------------------------------------------------------
card = data(ana, "write-card", command={
    "operation": "create",
    "card": {"kind": "credit", "network": "visa", "currencyCode": "BRL", "creditLimit": "5000",
             "closingDay": 20, "dueDay": 28, "payerAccountId": checking,
             "sensitive": {"name": "Cartão Principal", "lastFour": "4321", "cardholderName": "ANA SOUZA"}}})
cards = data(ana, "list-cards")
mine_card = next(c for c in cards if c["id"] == card["card_id"])
expect(mine_card["sensitive"]["lastFour"] == "4321", "the card payload survived the round trip")
expect(mine_card["liability_ledger_account_id"] is not None, "the credit card has a liability account")

purchase = data(ana, "write-card-transaction", command={
    "cardId": card["card_id"], "kind": "purchase", "amount": "300", "installments": 3,
    "occurredAt": "2026-01-10T12:00:00Z",
    "event": {"categoryId": category["id"], "sensitive": {"description": "Tênis", "purchaseId": "p-1"}}})
expect(len(purchase["event_ids"]) == 3, "a purchase in three installments wrote three events")

events = data(ana, "list-events")
installments = [e for e in events if e["id"] in purchase["event_ids"]]
expect(len(installments) == 3, "all three installments came back")
expect(all(i["sensitive"]["description"] == "Tênis" for i in installments),
       "each installment decrypts under its own nonce and its own id")
expect(len({i["postings"][0]["id"] for i in installments}) == 3, "each installment has its own postings")
card_balance = next(b for b in data(ana, "card-balances") if b["card_id"] == card["card_id"])
expect(abs(float(card_balance["balance"]) + 300) < 0.001, "the card liability owes the purchase", card_balance)
expect(len(data(ana, "card-invoices")) == 3, "three invoice months opened")

# --- investments ----------------------------------------------------------
asset = data(ana, "write-investment-asset", command={
    "operation": "create",
    "asset": {"assetTypeCode": "stock", "currencyCode": "BRL", "custodyAccountId": broker,
              "sensitive": {"name": "Petrobras PN", "ticker": "PETR4"}}})
assets = data(ana, "list-investment-assets")
mine_asset = next(a for a in assets if a["id"] == asset["asset_id"])
expect(mine_asset["sensitive"]["ticker"] == "PETR4", "the asset payload survived the round trip")

data(ana, "write-investment-operation", command={
    "operation": "opening", "holdingId": asset["holding_id"], "tradedAt": "2026-01-02T12:00:00Z",
    "quantity": "100", "principalAmount": "1000",
    "event": {"sensitive": {"description": "Posição inicial"}}})
data(ana, "write-cash-event", command={
    "operation": "create",
    "event": {"kind": "internal_transfer", "occurredAt": "2026-01-03T12:00:00Z", "amount": "2000",
              "accountId": checking, "counterpartAccountId": broker,
              "sensitive": {"description": "Aporte na corretora"}}})
data(ana, "write-investment-operation", command={
    "operation": "buy", "holdingId": asset["holding_id"], "cashAccountId": broker,
    "tradedAt": "2026-01-07T12:00:00Z", "quantity": "50", "unitPrice": "12",
    "charges": [{"kind": "brokerage", "amount": "5"}],
    "event": {"sensitive": {"description": "Compra PETR4"}}})
data(ana, "write-investment-operation", command={
    "operation": "sell", "holdingId": asset["holding_id"], "cashAccountId": broker,
    "tradedAt": "2026-01-09T12:00:00Z", "quantity": "30", "unitPrice": "15",
    "charges": [{"kind": "brokerage", "amount": "2"}],
    "event": {"sensitive": {"description": "Venda PETR4"}}})
data(ana, "write-investment-operation", command={
    "operation": "income", "holdingId": asset["holding_id"], "cashAccountId": broker,
    "tradedAt": "2026-01-15T12:00:00Z", "grossAmount": "100", "withheldTax": "15",
    "incomeKind": "dividend", "paymentDate": "2026-01-15",
    "event": {"sensitive": {"description": "Dividendo PETR4"}}})

position = next(p for p in data(ana, "investment-positions") if p["holding_id"] == asset["holding_id"])
expect(abs(float(position["quantity"]) - 120) < 1e-9, "position quantity replayed through the boundary", position["quantity"])
expect(abs(float(position["cost_basis"]) - 1284) < 1e-9, "cost basis replayed", position["cost_basis"])
expect(abs(float(position["average_price"]) - 10.7) < 1e-9, "average price replayed", position["average_price"])
expect(abs(float(position["realized_result"]) - 127) < 1e-9, "realized result replayed", position["realized_result"])
expect(abs(float(position["income_gross"]) - 100) < 1e-9, "gross income replayed", position["income_gross"])

data(ana, "write-asset-quote", command={"assetId": asset["asset_id"], "unitPrice": "18"})
position = next(p for p in data(ana, "investment-positions") if p["holding_id"] == asset["holding_id"])
expect(abs(float(position["market_value"]) - 2160) < 1e-9, "market value follows the quote", position["market_value"])

# --- classification rules: HMAC dedup, text encrypted ---------------------
data(ana, "write-classification-rule", command={
    "operation": "create", "rule": {"match": "  FARMÁCIA  ", "categoryId": category["id"], "flow": "expense"}})
status, body = call(ana, "write-classification-rule", command={
    "operation": "create", "rule": {"match": "farmácia", "categoryId": category["id"], "flow": "expense"}})
expect(status == 409, "the same rule text is refused twice", f"{status} {json.dumps(body)[:160]}")
expect("constraint" not in json.dumps(body) and "violates" not in json.dumps(body),
       "the refusal names no database internals", json.dumps(body)[:160])
rules = data(ana, "list-classification-rules")
expect(any(r["sensitive"].get("match") == "farmácia" for r in rules),
       "the rule text is normalized and decrypts", json.dumps(rules)[:200])

# --- planning: rules and occurrences round trip ---------------------------
rule = data(ana, "write-recurrence-rule", command={
    "operation": "create",
    "rule": {"flow": "expense", "frequency": "monthly", "startDate": "2026-01-05", "amount": "89.90",
             "currencyCode": "BRL", "paymentMethod": "pix", "accountId": checking,
             "categoryId": category["id"], "sensitive": {"description": "Academia"}}})
rules_back = data(ana, "list-recurrence-rules")
mine_rule = next(r for r in rules_back if r["id"] == rule["rule_id"])
expect(mine_rule["sensitive"]["description"] == "Academia", "the plan payload survived the round trip")

data(ana, "write-planned-occurrence", command={
    "occurrence": {"recurrenceRuleId": rule["rule_id"], "scheduledFor": "2026-03-05",
                   "status": "cancelled", "sensitive": {"description": "Pulado em março", "deleted": True}}})
occurrences = data(ana, "list-planned-occurrences")
skipped = next(o for o in occurrences if o["scheduled_for"] == "2026-03-05")
expect(skipped["sensitive"]["description"] == "Pulado em março",
       "the occurrence payload decrypts under its natural key", json.dumps(skipped)[:200])

# Re-upserting the same occurrence must stay readable.
data(ana, "write-planned-occurrence", command={
    "occurrence": {"recurrenceRuleId": rule["rule_id"], "scheduledFor": "2026-03-05",
                   "status": "cancelled", "sensitive": {"description": "Pulado em março (revisado)"}}})
occurrences = data(ana, "list-planned-occurrences")
skipped = next(o for o in occurrences if o["scheduled_for"] == "2026-03-05")
expect(skipped["sensitive"]["description"] == "Pulado em março (revisado)",
       "an upserted occurrence still decrypts")

# --- fx rates -------------------------------------------------------------
data(ana, "write-fx-rate", command={"baseCurrencyCode": "USD", "quoteCurrencyCode": "BRL", "rate": "5.42"})
fx = data(ana, "list-fx-rates")
expect(any(abs(float(r["rate"]) - 5.42) < 1e-9 for r in fx), "the conversion rate stayed relational", fx)

# --- imports: idempotent by fingerprint ----------------------------------
first = data(ana, "write-import-batch", command={
    "operation": "create",
    "batch": {"kind": "account_statement", "fingerprint": "sha256:abc123",
              "periodStart": "2026-01-01", "periodEnd": "2026-01-31",
              "sensitive": {"source": "extrato.ofx", "contentHash": "sha256:abc123"}}})
expect(first["created"], "the first import created a batch")
again = data(ana, "write-import-batch", command={
    "operation": "create",
    "batch": {"kind": "account_statement", "fingerprint": "sha256:abc123",
              "sensitive": {"source": "extrato.ofx"}}})
expect(not again["created"] and again["batch_id"] == first["batch_id"],
       "re-importing the same file resolves to the first batch", again)
found = data(ana, "import-batch-exists", fingerprint="sha256:abc123")
expect(found["batchId"] == first["batch_id"], "the fingerprint lookup finds the batch")
missing = data(ana, "import-batch-exists", fingerprint="sha256:never-seen")
expect(missing["batchId"] is None, "an unknown fingerprint finds nothing")

# --- isolation ------------------------------------------------------------
expect(data(bruno, "list-accounts") == [], "another user lists no accounts")
expect(data(bruno, "list-events") == [], "another user lists no events")
expect(data(bruno, "investment-positions") == [], "another user sees no positions")
status, body = call(bruno, "write-account", command={
    "operation": "update", "id": checking, "expectedVersion": 2,
    "account": {"kind": "bank", "currencyCode": "BRL", "sensitive": {"name": "invadido"}}})
expect(status == 409, "another user cannot update a foreign account", f"{status} {body}")

# Bruno's own payload must not be readable with Ana's key derivation either:
# every user derives a different key from the same root.
bruno_account = data(bruno, "write-account", command={
    "operation": "create",
    "account": {"kind": "bank", "currencyCode": "BRL", "sensitive": {"name": "Conta do Bruno"}}})
expect(all(a["id"] != bruno_account["account_id"] for a in data(ana, "list-accounts")),
       "one user never sees another user's row")

# --- snapshot -------------------------------------------------------------
snap = data(ana, "snapshot")
expect(set(["profile", "categories", "accounts", "cards", "events", "investment_positions"]).issubset(snap.keys()),
       "the snapshot fans out over every named contract", sorted(snap.keys()))
expect("sensitive_payload_b64" not in json.dumps(snap), "the snapshot carries no ciphertext")
expect(len(snap["accounts"]) == 2, "the snapshot lists only this user's accounts", len(snap["accounts"]))

print()
if FAILURES:
    print(f"{len(FAILURES)} FAILURES: {FAILURES}")
    sys.exit(1)
print("Edge Function end-to-end suite passed.")
