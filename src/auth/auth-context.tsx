import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import type { AuthChangeEvent, Session, User } from "@supabase/supabase-js";
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
/** Deploys must declare their canonical public URL; local development keeps its own origin. */
export const appUrl = () => import.meta.env.VITE_APP_URL?.replace(/\/$/, "") || window.location.origin;

const publicMessage = (fallback: string, cause?: { message?: string }) =>
  cause?.message && /failed to fetch|network|fetch failed|load failed/i.test(cause.message)
    ? "Não foi possível conectar ao Supabase. Tente novamente quando sua conexão voltar."
    : fallback;

/** Development-only observability; never logs a session, email, access token or refresh token. */
function authDebug(event: string, details: Record<string, boolean | string | undefined> = {}) {
  if (import.meta.env.DEV) console.info(`[kreature-auth] ${event}`, details);
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session>();
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [error, setError] = useState<string>();

  const applySession = useCallback((event: AuthChangeEvent | "INITIAL_RESTORE", nextSession: Session | null) => {
    authDebug(event, { hasSession: Boolean(nextSession) });
    setSession(nextSession ?? undefined);
    setStatus(nextSession?.user ? "authenticated" : "anonymous");
  }, []);

  useEffect(() => {
    let active = true;
    let initialResolved = false;
    let supabase;
    try {
      supabase = getSupabase();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível configurar o acesso seguro.");
      setStatus("anonymous");
      return undefined;
    }

    const resolveInitial = (nextSession: Session | null, cause?: { message?: string } | null) => {
      if (!active || initialResolved) return;
      initialResolved = true;
      // getSession reads Supabase's persisted session. It must not be replaced by a
      // network-only getUser() request during startup.
      if (cause) setError(publicMessage("Não foi possível restaurar sua sessão.", cause));
      else setError(undefined);
      applySession("INITIAL_RESTORE", nextSession);
    };

    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      if (!initialResolved) initialResolved = true;
      // SIGNED_OUT is the only event that changes an established authenticated
      // state to anonymous. Refresh and transient API failures never do.
      if (!nextSession && event !== "SIGNED_OUT" && event !== "INITIAL_SESSION") {
        authDebug("ignored-empty-auth-event", { event });
        return;
      }
      setError(undefined);
      applySession(event, nextSession);
    });

    void supabase.auth.getSession().then(({ data, error: cause }) => resolveInitial(data.session, cause)).catch((cause: unknown) => {
      resolveInitial(null, cause instanceof Error ? cause : undefined);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [applySession]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { data, error: cause } = await getSupabase().auth.signInWithPassword({ email, password });
    if (cause) throw new Error("E-mail ou senha inválidos.");
    // The auth listener also receives SIGNED_IN. Applying it here avoids a route
    // transition racing that asynchronous event.
    applySession("SIGNED_IN", data.session);
  }, [applySession]);

  const signUp = useCallback(async (displayName: string, email: string, password: string) => {
    const { error: cause } = await getSupabase().auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName }, emailRedirectTo: `${appUrl()}/auth/callback` },
    });
    if (cause) throw new Error("Não foi possível criar sua conta. Revise os dados e tente novamente.");
  }, []);

  const signOut = useCallback(async () => {
    const { error: cause } = await getSupabase().auth.signOut();
    if (cause) throw new Error("Não foi possível encerrar sua sessão.");
    // Explicit logout is the sole local operation allowed to clear auth state.
    applySession("SIGNED_OUT", null);
  }, [applySession]);

  const sendPasswordReset = useCallback(async (email: string) => {
    const { error: cause } = await getSupabase().auth.resetPasswordForEmail(email, {
      redirectTo: `${appUrl()}/auth/callback?next=/redefinir-senha`,
    });
    if (cause) throw new Error("Não foi possível enviar o e-mail de recuperação.");
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    const { error: cause } = await getSupabase().auth.updateUser({ password });
    if (cause) throw new Error("Não foi possível atualizar sua senha.");
  }, []);

  const value = useMemo(() => ({
    user: session?.user,
    status,
    error,
    signIn,
    signUp,
    signOut,
    sendPasswordReset,
    updatePassword,
  }), [session, status, error, signIn, signUp, signOut, sendPasswordReset, updatePassword]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth deve ser usado dentro de AuthProvider.");
  return value;
}
