import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Pencil } from "lucide-react";
import { ActionMenu } from "@/shared/ui/ActionMenu";

describe("ActionMenu", () => {
  it("abre, executa a ação e fecha o menu", () => {
    const onSelect = vi.fn();
    render(<ActionMenu label="Ações do item" items={[{ label: "Editar", icon: <Pencil />, onSelect }]} />);

    const trigger = screen.getByRole("button", { name: "Ações do item" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "Editar" }));

    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("fecha com Escape e ao clicar fora", () => {
    render(<div><ActionMenu label="Ações do item" items={[{ label: "Editar", onSelect: vi.fn() }]} /><button>Fora</button></div>);
    const trigger = screen.getByRole("button", { name: "Ações do item" });

    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.click(trigger);
    fireEvent.mouseDown(screen.getByRole("button", { name: "Fora" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
