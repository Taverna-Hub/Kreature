import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CharacterCustomizer } from "./CharacterCustomizer";
import { DEFAULT_PROFILE } from "./types";

describe("CharacterProfile", () => {
  it("mantém o rascunho separado e só publica quando o usuário salva", () => {
    const save = vi.fn();
    render(<CharacterCustomizer value={DEFAULT_PROFILE} onSave={save} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Identidade" }));
    fireEvent.change(screen.getByLabelText("Apelido"), { target: { value: "Poupador" } });
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ nickname: "Poupador" }));
  });
});
