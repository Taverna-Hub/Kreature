import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Dialog } from "./Dialog";

function DialogProbe() {
  const [open, setOpen] = useState(false);
  return <><button type="button" onClick={() => setOpen(true)}>Abrir</button>{open ? <Dialog title="Confirmar ação" onClose={() => setOpen(false)}><button type="button">Continuar</button></Dialog> : null}</>;
}

describe("Dialog", () => {
  it("fecha com Escape e devolve o foco ao acionador", () => {
    render(<DialogProbe />);
    const trigger = screen.getByRole("button", { name: "Abrir" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Confirmar ação" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
