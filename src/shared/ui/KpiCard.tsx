import type { ReactNode } from "react";

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
}

export function KpiCard({
  label,
  value,
  tone,
  supporting,
  supportingTone = "muted",
  supportingLabel,
  className,
}: KpiCardProps) {
  const classes = ["metric", tone, className].filter(Boolean).join(" ");

  return (
    <article className={classes}>
      <span>{label}</span>
      <strong>{value}</strong>
      {supporting !== undefined && supporting !== null ? (
        <small className={`metric-comparison ${supportingTone}`} aria-label={supportingLabel}>
          {supporting}
        </small>
      ) : null}
    </article>
  );
}
