export type LocalSession = { name: string };

const sessionKey = "kreature.local-session";

function storage() {
  return typeof window === "undefined" ? undefined : window.sessionStorage;
}

export function getLocalSession(): LocalSession | undefined {
  const value = storage()?.getItem(sessionKey);
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<LocalSession>;
    return typeof parsed.name === "string" && parsed.name.trim() ? { name: parsed.name.trim() } : undefined;
  } catch {
    return undefined;
  }
}

export const hasLocalSession = () => Boolean(getLocalSession());

export function startLocalSession(name: string) {
  const session = { name: name.trim() };
  if (!session.name) throw new Error("Informe como quer ser chamado.");
  storage()?.setItem(sessionKey, JSON.stringify(session));
  return session;
}

export function endLocalSession() {
  storage()?.removeItem(sessionKey);
}
