import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, Search } from "lucide-react";

type SelectItem = readonly [string, string];

const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");

export function CustomSelect({ value, defaultValue, onChange, items, label, name, required, disabled, className, searchable }: {
  /** Define o modo controlado. Sem ele o componente guarda a própria seleção. */
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  items: readonly SelectItem[];
  label: string;
  /** Publica a seleção para `FormData`, como um `<select>` nativo faria. */
  name?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  /** Campo de busca dentro da lista. Ligado sozinho quando há opções demais para varrer com os olhos. */
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [uncontrolled, setUncontrolled] = useState(() => defaultValue ?? items[0]?.[0] ?? "");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const options = useRef<Array<HTMLButtonElement | null>>([]);
  const listId = useId();
  const requested = value ?? uncontrolled;
  const selectedIndex = Math.max(0, items.findIndex(([id]) => id === requested));
  const selected = items[selectedIndex];
  const withSearch = searchable ?? items.length > 8;
  const term = normalize(query.trim());
  // A busca só muda o que aparece: o valor continua ancorado na lista completa.
  const visible = term ? items.filter(([, itemLabel]) => normalize(itemLabel).includes(term)) : items;
  // Uma opção que sai da lista (categorias mudam junto com o tipo, por exemplo) não pode
  // continuar viva no valor enviado ao formulário.
  const current = selected?.[0] ?? "";

  useEffect(() => {
    if (!open) setQuery("");
    if (!open) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, [open]);

  const choose = (next: string) => {
    if (value === undefined) setUncontrolled(next);
    onChange?.(next);
    setOpen(false);
    trigger.current?.focus();
  };

  const focusOption = (index: number) => {
    if (!visible.length) return;
    const next = (index + visible.length) % visible.length;
    options.current[next]?.focus();
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape") return setOpen(false);
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    setOpen(true);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : selectedIndex + (event.key === "ArrowDown" ? 1 : -1);
    if (withSearch) return requestAnimationFrame(() => search.current?.focus());
    requestAnimationFrame(() => focusOption(next));
  };

  const onOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (withSearch && event.key === "ArrowUp" && index === 0) return search.current?.focus();
    focusOption(event.key === "Home" ? 0 : event.key === "End" ? visible.length - 1 : index + (event.key === "ArrowDown" ? 1 : -1));
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
      return;
    }
    if (event.key === "Enter" && visible.length) {
      event.preventDefault();
      choose(visible[0][0]);
      return;
    }
    if (event.key !== "ArrowDown") return;
    event.preventDefault();
    focusOption(0);
  };

  return <div className={`custom-select${className ? ` ${className}` : ""}`} ref={root}>
    <button type="button" ref={trigger} className="custom-select-trigger" disabled={disabled} aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((state) => !state)} onKeyDown={onTriggerKeyDown}>
      <span>{selected?.[1]}</span>
      <ChevronDown aria-hidden="true" size={18} />
    </button>
    {/* Espelha a seleção para a validação nativa e para o `FormData` do formulário. */}
    <input className="custom-select-value" tabIndex={-1} aria-hidden="true" name={name} required={required} disabled={disabled} value={current} onChange={() => undefined} onFocus={() => trigger.current?.focus()} />
    {open ? <div id={listId} className="custom-select-list">
      {withSearch ? <div className="custom-select-search">
        <Search aria-hidden="true" size={15} />
        <input ref={search} autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={onSearchKeyDown} placeholder="Buscar…" aria-label={`Buscar em ${label}`} />
      </div> : null}
      <div className="custom-select-options" role="listbox" aria-label={label}>
      {visible.length === 0 ? <p className="custom-select-empty">Nenhum resultado para “{query.trim()}”.</p> : null}
      {visible.map(([id, itemLabel], index) => {
        const active = id === current;
        return <button type="button" role="option" aria-selected={active} className={active ? "selected" : ""} key={id} ref={(element) => { options.current[index] = element; }} onClick={() => choose(id)} onKeyDown={(event) => onOptionKeyDown(event, index)}>
          <span>{itemLabel}</span>{active ? <Check size={16} aria-hidden="true" /> : null}
        </button>;
      })}
      </div>
    </div> : null}
  </div>;
}
