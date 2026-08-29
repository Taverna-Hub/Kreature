import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabase } from "@/data/supabase/client";

type AuthStatus = "loading" | "authenticated" | "anonymous";
type AuthContextValue = {
  user?: User;
  status: AuthStatus;
  error?: string;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (displayName: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
/** Deploys must declare their canonical public URL; local dev keeps its own origin. */
export const appUrl = () => (import.meta.env.VITE_APP_URL?.replace(/\/$/, "") || window.location.origin);
const publicMessage = (fallback: string, cause?: { message?: string; status?: number }) => {
  if (cause?.message && /failed to fetch|network|fetch failed|load failed/i.test(cause.message)) {
    return "Não foi possível conectar ao Supabase. Confira as variáveis públicas do deploy e tente novamente.";
  }
  if (cause?.status === 401) return "Sua sessão expirou. Entre novamente para continuar.";
  return fallback;
};

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<User>();
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [error, setError] = useState<string>();
  useEffect(() => {
    let supabase;
    try {
      supabase = getSupabase();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível configurar o acesso seguro.");
      setStatus("anonymous");
      return undefined;
    }
    let active = true;
    void supabase.auth.getUser().then(({ data, error: cause }) => {
      if (!active) return;
      setUser(data.user ?? undefined);
      setError(cause ? publicMessage("Não foi possível restaurar sua sessão.", cause) : undefined);
      setStatus(data.user ? "authenticated" : "anonymous");
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setUser(session?.user);
      setStatus(session?.user ? "authenticated" : "anonymous");
    });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, []);
  const signIn = useCallback(async (email: string, password: string) => {
    const { error: cause } = await getSupabase().auth.signInWithPassword({ email, password });
    if (cause) throw new Error("E-mail ou senha inválidos.");
  }, []);
  const signUp = useCallback(async (displayName: string, email: string, password: string) => {
    const { error: cause } = await getSupabase().auth.signUp({ email, password, options: { data: { display_name: displayName }, emailRedirectTo: `${appUrl()}/auth/callback` } });
    if (cause) throw new Error("Não foi possível criar sua conta. Revise os dados e tente novamente.");
  }, []);
  const signOut = useCallback(async () => {
    const { error: cause } = await getSupabase().auth.signOut();
    if (cause) throw new Error("Não foi possível encerrar sua sessão.");
  }, []);
  const sendPasswordReset = useCallback(async (email: string) => {
    const { error: cause } = await getSupabase().auth.resetPasswordForEmail(email, { redirectTo: `${appUrl()}/auth/callback?next=/redefinir-senha` });
    if (cause) throw new Error("Não foi possível enviar o e-mail de recuperação.");
  }, []);
  const updatePassword = useCallback(async (password: string) => {
    const { error: cause } = await getSupabase().auth.updateUser({ password });
    if (cause) throw new Error("Não foi possível atualizar sua senha.");
  }, []);
  const value = useMemo(() => ({ user, status, error, signIn, signUp, signOut, sendPasswordReset, updatePassword }), [user, status, error, signIn, signUp, signOut, sendPasswordReset, updatePassword]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth deve ser usado dentro de AuthProvider.");
  return value;
}
