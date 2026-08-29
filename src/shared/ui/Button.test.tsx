import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button, IconButton, buttonClassName } from "./Button";

describe("Button", () => {
  it("não envia formulários por acidente", () => {
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(<form onSubmit={submit}><Button>Ação</Button></form>);
    fireEvent.click(screen.getByRole("button", { name: "Ação" }));
    expect(submit).not.toHaveBeenCalled();
  });

  it("compõe variante, tamanho e modificadores em classes", () => {
    render(<Button variant="danger" size="sm" block className="extra">Excluir</Button>);
    expect(screen.getByRole("button", { name: "Excluir" }).className).toBe("button danger sm block extra");
    expect(buttonClassName({ variant: "secondary", iconOnly: true })).toBe("button secondary icon-only");
  });

  it("bloqueia a ação enquanto carrega", () => {
    const click = vi.fn();
    render(<Button loading onClick={click}>Salvar</Button>);
    const button = screen.getByRole("button", { name: "Salvar" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    fireEvent.click(button);
    expect(click).not.toHaveBeenCalled();
  });

  it("dá nome acessível ao botão só de ícone", () => {
    render(<IconButton label="Excluir lançamento"><span aria-hidden="true">x</span></IconButton>);
    expect(screen.getByRole("button", { name: "Excluir lançamento" }).className).toContain("icon-only");
  });
});
