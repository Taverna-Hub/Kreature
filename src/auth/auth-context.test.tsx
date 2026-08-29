import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();
const getUser = vi.fn();
const unsubscribe = vi.fn();
let listenerCallback: ((event: "TOKEN_REFRESHED" | "SIGNED_OUT", session: { user: { id: string } } | null) => void) | undefined;
const onAuthStateChange = vi.fn((callback) => {
  listenerCallback = callback;
  return { data: { subscription: { unsubscribe } } };
});

vi.mock("@/data/supabase/client", () => ({
  getSupabase: () => ({ auth: { getSession, getUser, onAuthStateChange } }),
}));

import { AuthProvider, useAuth } from "./auth-context";

function Probe() {
  const { status } = useAuth();
  return <output>{status}</output>;
}

describe("AuthProvider", () => {
  afterEach(() => {
    getSession.mockReset();
    getUser.mockReset();
    onAuthStateChange.mockClear();
    unsubscribe.mockClear();
    listenerCallback = undefined;
  });

  it("mantÃ©m a sessÃ£o local vÃ¡lida quando a validaÃ§Ã£o de rede falha", async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: "user-1" } } }, error: null });
    getUser.mockResolvedValue({ data: { user: null }, error: { message: "Failed to fetch" } });
    render(<AuthProvider><Probe /></AuthProvider>);
    await vi.waitFor(() => expect(screen.getByText("authenticated")).toBeInTheDocument());
    expect(getSession).toHaveBeenCalledOnce();
    expect(getUser).not.toHaveBeenCalled();
  });

  it("permanece autenticado durante TOKEN_REFRESHED e sÃ³ sai em SIGNED_OUT", async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: "user-1" } } }, error: null });
    render(<AuthProvider><Probe /></AuthProvider>);
    await vi.waitFor(() => expect(screen.getByText("authenticated")).toBeInTheDocument());
    listenerCallback?.("TOKEN_REFRESHED", { user: { id: "user-1" } });
    expect(screen.getByText("authenticated")).toBeInTheDocument();
    listenerCallback?.("SIGNED_OUT", null);
    await vi.waitFor(() => expect(screen.getByText("anonymous")).toBeInTheDocument());
  });
});
