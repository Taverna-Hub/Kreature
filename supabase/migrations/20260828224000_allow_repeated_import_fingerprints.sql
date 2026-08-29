-- A fingerprint is a review hint, not a financial identity. Repeated charges
-- (for example multiple identical fees on the same day) must be persisted.
drop index if exists public.entries_user_fingerprint_unique_idx;
