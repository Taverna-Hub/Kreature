import type { ReactNode } from "react";
import { motion as motionElement, useReducedMotion } from "framer-motion";
import { enterFromBelow, motion, motionTransition } from "@/shared/motion";

export type KpiTone = "income" | "expense" | "available" | "invested";
export type KpiSupportingTone = "up" | "down" | "stable" | "muted" | "favorable" | "unfavorable";

export interface KpiCardProps {
  label: ReactNode;
  value: ReactNode;
  tone?: KpiTone;
  supporting?: ReactNode;
  supportingTone?: KpiSupportingTone;
  supportingLabel?: string;
  className?: string;
  /** A very short, capped stagger for small KPI groups only. */
  index?: number;
}

export function KpiCard({
  label,
  value,
  tone,
  supporting,
  supportingTone = "muted",
  supportingLabel,
  className,
  index = 0,
}: KpiCardProps) {
  const classes = ["metric", tone, className].filter(Boolean).join(" ");
  const reducedMotion = useReducedMotion();
  const valueKey = typeof value === "string" || typeof value === "number" ? String(value) : undefined;

  return (
    <motionElement.article className={classes} {...enterFromBelow(Boolean(reducedMotion), Math.min(index, 3) * 0.035)}>
      <span>{label}</span>
      <motionElement.strong key={valueKey} initial={reducedMotion ? false : { opacity: 0.7, y: 2 }} animate={{ opacity: 1, y: 0 }} transition={motionTransition(motion.fast)}>{value}</motionElement.strong>
      {supporting !== undefined && supporting !== null ? (
        <small className={`metric-comparison ${supportingTone}`} aria-label={supportingLabel}>
          {supporting}
        </small>
      ) : null}
    </motionElement.article>
  );
}