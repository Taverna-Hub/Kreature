import { afterEach, describe, expect, it } from "vitest";
import { endLocalSession, getLocalSession, hasLocalSession, startLocalSession } from "./session";

afterEach(() => endLocalSession());

describe("sessão local", () => {
  it("persiste somente a identificação da aba e pode ser encerrada sem tocar nos dados", () => {
    expect(hasLocalSession()).toBe(false);

    startLocalSession("  PixelBuddy  ");
    expect(getLocalSession()).toEqual({ name: "PixelBuddy" });

    endLocalSession();
    expect(hasLocalSession()).toBe(false);
  });

  it("recusa uma identificação vazia", () => {
    expect(() => startLocalSession("   ")).toThrow("Informe como quer ser chamado.");
  });
});
