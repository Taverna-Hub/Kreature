import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyFinanceState } from "@/domain/defaults";
import { FeedbackProvider } from "@/shared/ui/FeedbackProvider";

const financeMock = vi.hoisted(() => ({ useFinance: vi.fn() }));
const importerMock = vi.hoisted(() => ({ analyzeFile: vi.fn() }));

vi.mock("@/data/finance-context", () => ({ useFinance: financeMock.useFinance }));
vi.mock("@/lib/importers", () => ({
  analyzeFile: importerMock.analyzeFile,
  cleanTransactionDescription: (value: string) => value,
  importFingerprint: () => "edited-fingerprint",
}));

import { ImportView } from "./FinancePages";

describe("revisão da importação", () => {
  beforeEach(() => {
    const state = emptyFinanceState();
    const commit = vi.fn(async (change: (draft: typeof state) => void) => change(state));
    financeMock.useFinance.mockReturnValue({ state, commit });
    importerMock.analyzeFile.mockResolvedValue({
      source: "pdf-hibrido",
      currency: "BRL",
      warnings: [],
      candidates: [{
        id: "candidate", date: "2026-08-15", description: "Compra original", amount: "-10", currency: "BRL",
        parser: "pdf-hibrido", kind: "expense", suggestedKind: "expense", confidence: .9, reason: "Regra local",
        source: "pdf-hibrido", include: true, createInvestment: false, fingerprint: "original", duplicate: false,
        page: 1, extractionSource: "native",
      }],
    });
  });

  const analyze = async () => {
    const view = render(<FeedbackProvider><ImportView /></FeedbackProvider>);
    const fileInput = view.container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).not.toBeNull();
    fireEvent.change(fileInput!, { target: { files: [new File(["pdf"], "extrato.pdf", { type: "application/pdf" })] } });
    await screen.findByLabelText("Descrição");
    return view;
  };

  const choose = (selectLabel: string, option: string) => {
    fireEvent.click(screen.getByRole("button", { name: selectLabel }));
    fireEvent.click(screen.getByRole("option", { name: option }));
  };

  it("obriga a revisão antes de persistir e salva as correções confirmadas", async () => {
    await analyze();
    fireEvent.change(screen.getByLabelText("Descrição"), { target: { value: "Compra corrigida" } });
    expect(screen.queryByRole("button", { name: "Confirmar importação" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Revisar e importar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar importação" }));
    await waitFor(() => expect(screen.getByText(/1 movimentação\(ões\) importada/)).toBeInTheDocument());
    const state = financeMock.useFinance.mock.results.at(-1)?.value.state;
    expect(state.entries[0]).toMatchObject({ description: "Compra corrigida", fingerprint: "edited-fingerprint", source: "import" });
  });

  it("volta da confirmação para a edição sem gravar nada", async () => {
    await analyze();
    fireEvent.click(screen.getByRole("button", { name: "Revisar e importar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Voltar e editar" }));
    expect(await screen.findByLabelText("Descrição")).toBeInTheDocument();
    expect(financeMock.useFinance.mock.results.at(-1)?.value.state.entries).toHaveLength(0);
  });

  it("aplica a edição em lote às movimentações selecionadas", async () => {
    await analyze();
    expect(screen.getByLabelText("Valor")).toHaveValue("-10");
    choose("Aplicar tipo às selecionadas", "Entrada");
    fireEvent.click(screen.getByRole("button", { name: "Aplicar às selecionadas" }));
    await waitFor(() => expect(screen.getByLabelText("Valor")).toHaveValue("10"));
    expect(screen.getByRole("button", { name: "Tipo de movimentação" })).toHaveTextContent("Entrada");
  });

  it("explica por que não avança quando nada está selecionado", async () => {
    await analyze();
    fireEvent.click(screen.getByRole("button", { name: "Limpar seleção" }));
    fireEvent.click(screen.getByRole("button", { name: "Revisar e importar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Selecione ao menos uma movimentação");
    expect(screen.queryByRole("button", { name: "Confirmar importação" })).toBeNull();
  });

  it("solta a categoria quando o valor inverte o sentido de um Pix", async () => {
    const state = emptyFinanceState();
    const expense = state.categories.find((item) => item.flow === "expense")!;
    financeMock.useFinance.mockReturnValue({
      state,
      commit: vi.fn(async (change: (draft: typeof state) => void) => change(state)),
    });
    await analyze();
    choose("Tipo de movimentação", "Pix");
    choose("Categoria", expense.name);
    expect(screen.getByRole("button", { name: "Categoria" })).toHaveTextContent(expense.name);
    fireEvent.change(screen.getByLabelText("Valor"), { target: { value: "10" } });
    expect(screen.getByRole("button", { name: "Categoria" })).toHaveTextContent("Sem categoria");
  });

  it("mostra na confirmação o valor negativo que a despesa vai gravar", async () => {
    await analyze();
    fireEvent.change(screen.getByLabelText("Valor"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar e importar" }));
    const row = (await screen.findByRole("table")).querySelector("tbody tr");
    expect(row?.querySelector(".negative")).toHaveTextContent("10,00");
  });

  it("aponta a linha incompleta e libera a passagem depois da correção", async () => {
    await analyze();
    fireEvent.change(screen.getByLabelText("Valor"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar e importar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("sem data, descrição ou valor: “Compra original”");
    fireEvent.change(screen.getByLabelText("Valor"), { target: { value: "-25" } });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Revisar e importar" }));
    expect(await screen.findByRole("button", { name: "Confirmar importação" })).toBeInTheDocument();
  });
});
