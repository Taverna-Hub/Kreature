import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import type { FinanceState } from "@/domain/types";
import { emptyFinanceState } from "@/domain/defaults";
import { DexieFinanceRepository, type FinanceRepository } from "./repository";

type FinanceContextValue = {
  state: FinanceState;
  loading: boolean;
  error?: string;
  migrationNotice?: string;
  commit: (change: (draft: FinanceState) => unknown | Promise<unknown>) => Promise<void>;
  refresh: () => Promise<void>;
};

const FinanceContext = createContext<FinanceContextValue | null>(null);
const defaultRepository = new DexieFinanceRepository();

export function FinanceProvider({
  children,
  repository = defaultRepository,
}: PropsWithChildren<{ repository?: FinanceRepository }>) {
  const [state, setState] = useState(emptyFinanceState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [migrationNotice, setMigrationNotice] = useState<string>();
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      setState(await repository.load());
      setMigrationNotice(repository instanceof DexieFinanceRepository ? repository.consumeMigrationNotice() : undefined);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Não foi possível abrir seus dados locais.",
      );
    } finally {
      setLoading(false);
    }
  }, [repository]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const commit = useCallback(
    async (change: (draft: FinanceState) => unknown | Promise<unknown>) => {
      setError(undefined);
      try {
        setState(await repository.transact(change));
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "Não foi possível salvar.";
        setError(message);
        throw cause;
      }
    },
    [repository],
  );
  const value = useMemo(
    () => ({ state, loading, error, migrationNotice, commit, refresh }),
    [state, loading, error, migrationNotice, commit, refresh],
  );
  return <FinanceContext.Provider value={value}>{children}</FinanceContext.Provider>;
}

export function useFinance() {
  const value = useContext(FinanceContext);
  if (!value) throw new Error("useFinance deve ser usado dentro de FinanceProvider.");
  return value;
}
