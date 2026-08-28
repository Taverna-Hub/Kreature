import type { KeyboardEvent } from "react";

export function Tabs({ value, onChange, items, label }: { value: string; onChange: (value: string) => void; items: ReadonlyArray<readonly [string, string]>; label?: string }) {
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = items.findIndex(([id]) => id === value);
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + items.length) % items.length;
    onChange(items[next][0]);
    (event.currentTarget.querySelectorAll<HTMLButtonElement>("button")[next]).focus();
  };

  return <div className="section-tabs" role="tablist" aria-label={label} onKeyDown={move}>{items.map(([id, itemLabel]) => <button type="button" role="tab" aria-selected={value === id} tabIndex={value === id ? 0 : -1} className={value === id ? "active" : ""} onClick={() => onChange(id)} key={id}>{itemLabel}</button>)}</div>;
}
