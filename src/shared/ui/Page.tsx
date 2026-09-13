import type { ReactNode } from "react";
import { motion as motionElement, useReducedMotion } from "framer-motion";
import { enterFromBelow } from "@/shared/motion";

export function Page({
  eyebrow,
  title,
  description,
  actions,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const reducedMotion = useReducedMotion();

  return (
    <motionElement.main className="page" {...enterFromBelow(Boolean(reducedMotion))}>
      <header className="page-header">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        {actions ? <div className="page-actions">{actions}</div> : null}
      </header>
      {children}
    </motionElement.main>
  );
}
