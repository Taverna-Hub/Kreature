import { describe, expect, it } from "vitest";
import { nativeTextScore } from "./pdf-pipeline";

describe("análise de texto nativo do PDF", () => {
  it("não aceita cabeçalho pesquisável sem movimentações", () => {
    const header = "Banco Exemplo Conta corrente Extrato bancário Agência Conta Período Cliente";
    expect(nativeTextScore(header)).toBeLessThan(.58);
  });

  it("aceita uma página com âncoras financeiras suficientes", () => {
    const transactions = "15/08/2026 PIX REALIZADO JOAO DA SILVA R$ 123,50 D\n16/08/2026 PIX RECEBIDO MARIA R$ 1.234,56 C";
    expect(nativeTextScore(transactions)).toBeGreaterThanOrEqual(.58);
  });
});
