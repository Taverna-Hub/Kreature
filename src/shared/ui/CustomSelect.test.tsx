import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CustomSelect } from "./CustomSelect";

const items = [["", "Sem categoria"], ["food", "Alimentação"], ["home", "Casa"]] as const;

describe("CustomSelect", () => {
  it("publica a escolha no FormData como um select nativo", () => {
    const submit = vi.fn((event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      expect(new FormData(event.currentTarget).get("categoryId")).toBe("home");
    });
    render(<form onSubmit={submit}><CustomSelect label="Categoria" name="categoryId" items={items} /><button type="submit">Salvar</button></form>);
    fireEvent.click(screen.getByRole("button", { name: "Categoria" }));
    fireEvent.click(screen.getByRole("option", { name: "Casa" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("avisa a escolha no modo controlado sem mudar sozinho", () => {
    const onChange = vi.fn();
    render(<CustomSelect label="Categoria" value="food" onChange={onChange} items={items} />);
    const trigger = screen.getByRole("button", { name: "Categoria" });
    expect(trigger).toHaveTextContent("Alimentação");
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: "Casa" }));
    expect(onChange).toHaveBeenCalledWith("home");
    expect(trigger).toHaveTextContent("Alimentação");
  });

  it("descarta o valor quando a opção sai da lista", () => {
    const { rerender, container } = render(<CustomSelect label="Categoria" name="categoryId" defaultValue="food" items={items} />);
    expect(container.querySelector<HTMLInputElement>('input[name="categoryId"]')).toHaveValue("food");
    rerender(<CustomSelect label="Categoria" name="categoryId" defaultValue="food" items={[items[0], items[2]]} />);
    expect(container.querySelector<HTMLInputElement>('input[name="categoryId"]')).toHaveValue("");
    expect(screen.getByRole("button", { name: "Categoria" })).toHaveTextContent("Sem categoria");
  });

  it("filtra a lista pela busca sem perder o valor escolhido", () => {
    const long = Array.from({ length: 12 }, (_, index) => [`i${index}`, `Instituição ${index}`] as const);
    const onChange = vi.fn();
    render(<CustomSelect label="Instituição" value="i7" onChange={onChange} items={long} />);
    const trigger = screen.getByRole("button", { name: "Instituição" });
    expect(trigger).toHaveTextContent("Instituição 7");
    fireEvent.click(trigger);
    fireEvent.change(screen.getByLabelText("Buscar em Instituição"), { target: { value: "ção 3" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(trigger).toHaveTextContent("Instituição 7");
    fireEvent.click(screen.getByRole("option", { name: "Instituição 3" }));
    expect(onChange).toHaveBeenCalledWith("i3");
  });

  it("avisa quando a busca não encontra nada", () => {
    const long = Array.from({ length: 12 }, (_, index) => [`i${index}`, `Instituição ${index}`] as const);
    render(<CustomSelect label="Instituição" items={long} />);
    fireEvent.click(screen.getByRole("button", { name: "Instituição" }));
    fireEvent.change(screen.getByLabelText("Buscar em Instituição"), { target: { value: "banco xyz" } });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText(/Nenhum resultado/)).toBeInTheDocument();
  });

  it("não mostra busca em listas curtas", () => {
    render(<CustomSelect label="Categoria" items={items} />);
    fireEvent.click(screen.getByRole("button", { name: "Categoria" }));
    expect(screen.queryByLabelText("Buscar em Categoria")).toBeNull();
  });

  it("navega e fecha pelo teclado", () => {
    render(<CustomSelect label="Categoria" items={items} />);
    const trigger = screen.getByRole("button", { name: "Categoria" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("option", { name: "Alimentação" }), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
