import type { ReactNode } from "react";

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
  return (
    <main className="page">
      <header className="page-header">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        {actions ? <div className="page-actions">{actions}</div> : null}
      </header>
      {children}
    </main>
  );
}
