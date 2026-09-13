import { useId, type KeyboardEvent } from "react";
import { motion as motionElement, useReducedMotion } from "framer-motion";
import { motion, motionTransition } from "@/shared/motion";

export function Tabs({ value, onChange, items, label, className }: { value: string; onChange: (value: string) => void; items: ReadonlyArray<readonly [string, string]>; label?: string; className?: string }) {
  const layoutId = useId();
  const reducedMotion = useReducedMotion();
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = items.findIndex(([id]) => id === value);
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + items.length) % items.length;
    onChange(items[next][0]);
    (event.currentTarget.querySelectorAll<HTMLButtonElement>("button")[next]).focus();
  };

  return <div className={`section-tabs${className ? ` ${className}` : ""}`} role="tablist" aria-label={label} onKeyDown={move}>{items.map(([id, itemLabel]) => {
    const active = value === id;
    return <button type="button" role="tab" aria-selected={active} tabIndex={active ? 0 : -1} className={active ? "active" : ""} onClick={() => onChange(id)} key={id}>
      {active && (reducedMotion
        ? <span className="tab-active-indicator" aria-hidden="true" />
        : <motionElement.span className="tab-active-indicator" aria-hidden="true" layoutId={`tab-indicator-${layoutId}`} transition={motionTransition(motion.normal)} />)}
      <span className="tab-label">{itemLabel}</span>
    </button>;
  })}</div>;
}