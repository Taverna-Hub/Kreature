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

  it("obriga a revisão antes de persistir e salva as correções confirmadas", async () => {
    const { container } = render(<FeedbackProvider><ImportView /></FeedbackProvider>);
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).not.toBeNull();
    fireEvent.change(fileInput!, { target: { files: [new File(["pdf"], "extrato.pdf", { type: "application/pdf" })] } });
    const description = await screen.findByLabelText("Descrição");
    fireEvent.change(description, { target: { value: "Compra corrigida" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar importação" }));
    await waitFor(() => expect(screen.getByText(/1 movimentação\(ões\) importada/)).toBeInTheDocument());
    const state = financeMock.useFinance.mock.results.at(-1)?.value.state;
    expect(state.entries[0]).toMatchObject({ description: "Compra corrigida", fingerprint: "edited-fingerprint", source: "import" });
  });
});
