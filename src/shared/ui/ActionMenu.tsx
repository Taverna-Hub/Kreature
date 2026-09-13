import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { MoreVertical } from "lucide-react";

export interface ActionMenuItem {
  label: string;
  icon?: ReactNode;
  tone?: "default" | "danger";
  onSelect: () => void;
}

export function ActionMenu({ label, items }: { label: string; items: ActionMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const [above, setAbove] = useState(false);
  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      const trigger = root.current?.getBoundingClientRect();
      const menu = popover.current?.getBoundingClientRect();
      const nav = document.querySelector(".mobile-nav")?.getBoundingClientRect();
      const bottom = nav?.height ? nav.top - 8 : window.innerHeight - 8;
      if (trigger && menu) setAbove(trigger.bottom + menu.height + 4 > bottom);
    };
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => { window.removeEventListener("resize", position); window.removeEventListener("scroll", position, true); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, [open]);

  if (!items.length) return null;

  return (
    <div className="action-menu" ref={root}>
      <button
        type="button"
        className="action-menu-trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreVertical aria-hidden="true" />
      </button>
      {open ? (
        <div ref={popover} className="action-menu-popover" data-placement={above ? "above" : "below"} role="menu">
          {items.map((item, index) => (
            <button
              type="button"
              role="menuitem"
              className={item.tone === "danger" ? "danger" : undefined}
              key={`${item.label}-${index}`}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.icon ? <span className="action-menu-icon" aria-hidden="true">{item.icon}</span> : null}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
