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

  it("prefere o emissor do cabeçalho a uma contraparte citada no corpo", () => {
    const statement = [
      "XP Investimentos CCTVM S.A. — Extrato de conta",
      "01/08 TED recebida Banco Santander S.A. 1.200,00",
      "05/08 Transferência Santander 300,00",
    ].join("\n");
    expect(detectStatementInstitution(statement)).toBe("xp");
  });

  it("decide pela instituição mais citada quando nenhuma está no cabeçalho", () => {
    const body = `${"linha de extrato\n".repeat(120)}Pagamento Santander\nTarifa Santander\nCompra XP`;
    expect(detectStatementInstitution(body)).toBe("santander");
  });
});
