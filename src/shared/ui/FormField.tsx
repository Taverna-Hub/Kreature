import type { ReactNode } from "react";

export function FormField({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return <label className={`field ${className}`}><span>{label}</span>{children}</label>;
}

export function SelectOptions({ values }: { values: ReadonlyArray<readonly [string, string]> }) {
  return <>{values.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</>;
}
