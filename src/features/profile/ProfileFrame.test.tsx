import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CharacterCustomizer } from "./CharacterCustomizer";
import { DEFAULT_PROFILE } from "./types";

describe("Character frame preview", () => {
  it("renders the selected frame in the editor preview", () => {
    render(<CharacterCustomizer value={DEFAULT_PROFILE} onSave={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Moldura" }));
    fireEvent.click(screen.getByRole("button", { name: "Dourada" }));
    expect(document.querySelector(".profile-frame-gold")).toBeInTheDocument();
  });
});
