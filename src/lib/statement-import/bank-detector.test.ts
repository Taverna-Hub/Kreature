import { describe, expect, it } from "vitest";
import { detectStatementInstitution } from "./bank-detector";

describe("detecção de instituição", () => {
  it.each([
    ["Nu Pagamentos S.A.", "nubank"],
    ["Banco Itaú Unibanco", "itau"],
    ["Banco BTG Pactual", "btg-pactual"],
    ["Mercado Pago - extrato", "mercado-pago"],
  ] as const)("detecta %s", (text, expected) => {
    expect(detectStatementInstitution(text)).toBe(expected);
  });

  it("permite fallback quando o banco é desconhecido", () => {
    expect(detectStatementInstitution("Cooperativa regional")).toBeUndefined();
  });
});
