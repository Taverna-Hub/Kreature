import type { ButtonHTMLAttributes } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
};

export function Button({ children, className = "", variant = "primary", ...props }: ButtonProps) {
  return <button {...props} className={`button ${variant} ${className}`}>{children}</button>;
}
