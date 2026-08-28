import { afterEach, describe, expect, it } from "vitest";
import { endLocalSession, startLocalSession } from "@/auth/session";
import { router } from "@/router";

afterEach(() => endLocalSession());

describe("proteção de rotas", () => {
  it("redireciona a área financeira para o login quando não há sessão", async () => {
    await router.navigate({ to: "/resumo" });
    expect(router.state.location.pathname).toBe("/login");
  });

  it("permite abrir o resumo depois de entrar", async () => {
    startLocalSession("Thomaz");
    await router.navigate({ to: "/resumo" });
    expect(router.state.location.pathname).toBe("/resumo");
  });
});
