import type { EntryKind, FinanceState, InstitutionCatalogId } from "@/domain/types";
import { normalizeClassificationText } from "@/domain/classification";

type DuplicateProbe = {
  date: string;
  description: string;
  amount: string;
  kind: EntryKind;
  fingerprint: string;
  externalId?: string;
  institutionHint?: InstitutionCatalogId;
};

export function detectImportDuplicate(state: FinanceState, probe: DuplicateProbe) {
  const accountIds = new Set(
    state.institutions
      .filter((institution) => !institution.archivedAt && institution.catalogId === probe.institutionHint)
      .map((institution) => institution.id),
  );
  const sameAccount = (institutionId?: string) => accountIds.size === 0 || Boolean(institutionId && accountIds.has(institutionId));
  const normalizedDescription = normalizeClassificationText(probe.description).replace(/\s+/g, " ");
  const exact = state.entries.some((entry) =>
    (probe.externalId && entry.notes?.includes(`external:${probe.externalId}`)) ||
    entry.fingerprint === probe.fingerprint ||
    sameAccount(entry.institutionId) &&
      entry.date === probe.date &&
      entry.amount === probe.amount &&
      entry.kind === probe.kind &&
      normalizeClassificationText(entry.description).replace(/\s+/g, " ") === normalizedDescription,
  );
  const possible = !exact && state.entries.some((entry) =>
    sameAccount(entry.institutionId) && entry.date === probe.date && entry.amount === probe.amount,
  );
  return { exact, possible };
}
