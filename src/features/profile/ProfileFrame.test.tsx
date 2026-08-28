import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CharacterCustomizer } from "./CharacterCustomizer";
import { DEFAULT_PROFILE } from "./types";

describe("Character customizer", () => {
  it("não oferece título ou moldura no editor", () => {
    render(<CharacterCustomizer value={DEFAULT_PROFILE} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByRole("tab", { name: "Moldura" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Título")).not.toBeInTheDocument();
  });
});
