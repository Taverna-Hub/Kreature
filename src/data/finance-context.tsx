import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { useAuth } from "@/auth/auth-context";
import { emptyFinanceState } from "@/domain/defaults";
import type { FinanceState } from "@/domain/types";
import type { FinanceRepository } from "./repository";
import { SupabaseFinanceV2Repository } from "./supabase/finance-v2-repository";

type FinanceContextValue = {
  state: FinanceState;
  loading: boolean;
  error?: string;
  commit: (change: (draft: FinanceState) => unknown | Promise<unknown>) => Promise<void>;
  refresh: () => Promise<void>;
};

const FinanceContext = createContext<FinanceContextValue | null>(null);

/** A test repository can be injected; the running app is always backed by the v2 api. */
export function FinanceProvider({ children, repository }: PropsWithChildren<{ repository?: FinanceRepository }>) {
  if (repository) return <FinanceStateProvider repository={repository}>{children}</FinanceStateProvider>;
  return <AuthenticatedFinanceProvider>{children}</AuthenticatedFinanceProvider>;
}

function AuthenticatedFinanceProvider({ children }: PropsWithChildren) {
  const { user, status } = useAuth();
  const userId = user?.id;
  const repository = useMemo(() => userId ? new SupabaseFinanceV2Repository() : undefined, [userId]);
  return <FinanceStateProvider repository={repository} enabled={status === "authenticated"}>{children}</FinanceStateProvider>;
}

function FinanceStateProvider({
  children,
  repository,
  enabled = true,
}: PropsWithChildren<{ repository?: FinanceRepository; enabled?: boolean }>) {
  const [state, setState] = useState(emptyFinanceState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const refresh = useCallback(async () => {
    if (!repository || !enabled) {
      setState(emptyFinanceState());
      setError(undefined);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      setState(await repository.load());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar seus dados.");
    } finally {
      setLoading(false);
    }
  }, [repository, enabled]);
  useEffect(() => { void refresh(); }, [refresh]);
  const commit = useCallback(async (change: (draft: FinanceState) => unknown | Promise<unknown>) => {
    if (!repository || !enabled) throw new Error("Entre novamente para salvar suas informações.");
    setError(undefined);
    try {
      setState(await repository.transact(change));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Não foi possível salvar.";
      setError(message);
      throw cause;
    }
  }, [repository, enabled]);
  const value = useMemo(() => ({ state, loading, error, commit, refresh }), [state, loading, error, commit, refresh]);
  return <FinanceContext.Provider value={value}>{children}</FinanceContext.Provider>;
}

export function useFinance() {
  const value = useContext(FinanceContext);
  if (!value) throw new Error("useFinance deve ser usado dentro de FinanceProvider.");
  return value;
}
