import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";

type SelectItem = readonly [string, string];

export function CustomSelect({ value, onChange, items, label }: {
  value: string;
  onChange: (value: string) => void;
  items: readonly SelectItem[];
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const options = useRef<Array<HTMLButtonElement | null>>([]);
  const listId = useId();
  const selectedIndex = Math.max(0, items.findIndex(([id]) => id === value));
  const selected = items[selectedIndex];

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, [open]);

  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  const focusOption = (index: number) => {
    const next = (index + items.length) % items.length;
    options.current[next]?.focus();
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape") return setOpen(false);
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    setOpen(true);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : selectedIndex + (event.key === "ArrowDown" ? 1 : -1);
    requestAnimationFrame(() => focusOption(next));
  };

  const onOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    focusOption(event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : index + (event.key === "ArrowDown" ? 1 : -1));
  };

  return <div className="custom-select" ref={root}>
    <button type="button" className="custom-select-trigger" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((current) => !current)} onKeyDown={onTriggerKeyDown}>
      <span>{selected?.[1]}</span>
      <ChevronDown aria-hidden="true" size={18} />
    </button>
    {open ? <div id={listId} className="custom-select-list" role="listbox" aria-label={label}>
      {items.map(([id, itemLabel], index) => {
        const active = id === value;
        return <button type="button" role="option" aria-selected={active} className={active ? "selected" : ""} key={id} ref={(element) => { options.current[index] = element; }} onClick={() => choose(id)} onKeyDown={(event) => onOptionKeyDown(event, index)}>
          <span>{itemLabel}</span>{active ? <Check size={16} aria-hidden="true" /> : null}
        </button>;
      })}
    </div> : null}
  </div>;
}
