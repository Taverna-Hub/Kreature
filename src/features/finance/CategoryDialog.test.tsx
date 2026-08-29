import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultCategories, emptyFinanceState } from "@/domain/defaults";
import { FeedbackProvider } from "@/shared/ui/FeedbackProvider";

const financeMock = vi.hoisted(() => ({ useFinance: vi.fn() }));
vi.mock("@/data/finance-context", () => ({ useFinance: financeMock.useFinance }));

import { LaunchesPage } from "./FinancePages";

const openCategoryEditor = (name: string) => {
  fireEvent.click(screen.getByRole("tab", { name: "Categorias" }));
  fireEvent.click(screen.getByRole("button", { name: `Editar categoria ${name}` }));
};

describe("ícone da categoria", () => {
  let state: ReturnType<typeof emptyFinanceState>;

  beforeEach(() => {
    state = emptyFinanceState();
    financeMock.useFinance.mockReturnValue({
      state,
      commit: vi.fn(async (change: (draft: typeof state) => void) => change(state)),
    });
    render(<FeedbackProvider><LaunchesPage /></FeedbackProvider>);
  });

  it("mostra o ícone da categoria no card, não a inicial", () => {
    fireEvent.click(screen.getByRole("tab", { name: "Categorias" }));
    const card = screen.getByText("Moradia").closest(".category-card");
    expect(card?.querySelector(".category-icon svg")).not.toBeNull();
  });

  it("guarda o ícone escolhido em vez de sobrescrever com um padrão", async () => {
    openCategoryEditor("Alimentação");
    fireEvent.click(screen.getByRole("button", { name: "Pizza" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar categoria" }));
    await waitFor(() => expect(state.categories.find((item) => item.name === "Alimentação")?.icon).toBe("Pizza"));
  });

  it("oferece imagem como alternativa ao ícone", () => {
    openCategoryEditor("Lazer");
    expect(screen.getByRole("button", { name: "Sparkles" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("tab", { name: "Imagem" }));
    expect(screen.queryByRole("button", { name: "Sparkles" })).toBeNull();
    expect(screen.getByText("Escolher imagem")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Ícone" }));
    expect(screen.getByRole("button", { name: "Sparkles" })).toBeInTheDocument();
  });

  it("preserva o ícone das categorias padrão ao editar", async () => {
    const before = defaultCategories().find((item) => item.name === "Transporte")!.icon;
    openCategoryEditor("Transporte");
    fireEvent.click(screen.getByRole("button", { name: "Salvar categoria" }));
    await waitFor(() => expect(state.categories.find((item) => item.name === "Transporte")?.icon).toBe(before));
  });
});
