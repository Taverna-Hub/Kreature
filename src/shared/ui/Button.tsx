import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "link";
export type ButtonSize = "sm" | "md" | "lg";

type ButtonStyleProps = {
  /** Peso visual da ação: primária, de apoio, discreta, destrutiva ou textual. */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Botão quadrado, apenas com ícone. Exige `aria-label`. */
  iconOnly?: boolean;
  /** Ocupa toda a largura disponível. */
  block?: boolean;
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & ButtonStyleProps & {
  /** Desabilita e sinaliza carregamento sem trocar o rótulo. */
  loading?: boolean;
};

/**
 * Classe compartilhada com elementos que precisam parecer botão sem ser `<button>`
 * — `<label>` de upload e `<Link>` de navegação, por exemplo.
 */
export function buttonClassName({ variant = "primary", size = "md", iconOnly, block, className = "" }: ButtonStyleProps & { className?: string } = {}) {
  return ["button", variant, size !== "md" && size, iconOnly && "icon-only", block && "block", className]
    .filter(Boolean)
    .join(" ");
}

export function Button({
  children,
  className,
  variant,
  size,
  iconOnly,
  block,
  loading = false,
  disabled,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClassName({ variant, size, iconOnly, block, className })}
    >
      {loading ? <span className="button-spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

/** Ação compacta e quadrada usada em listas, tabelas e cabeçalhos de card. */
export function IconButton({ label, children, variant = "secondary", size = "sm", ...props }: Omit<ButtonProps, "iconOnly" | "children" | "aria-label"> & { label: string; children: ReactNode }) {
  return <Button {...props} variant={variant} size={size} iconOnly aria-label={label} title={label}>{children}</Button>;
}
