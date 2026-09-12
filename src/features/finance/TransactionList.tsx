import { useEffect, useRef, useState } from "react";
import { MoreVertical } from "lucide-react";
import Decimal from "decimal.js";
import type { Category } from "@/domain/types";
import { money, transactionDayLabel } from "@/lib/format";
import { categoryIcon } from "@/features/finance/category-icons";
import { useObjectUrl } from "@/shared/hooks/useObjectUrl";

export type TransactionTone = "income" | "expense" | "neutral";

export interface TransactionDisplay {
  id: string;
  date: string;
  description: string;
  amount: string;
  currency?: string;
  category?: Pick<Category, "name" | "icon" | "image" | "color">;
  context: string[];
  tone: TransactionTone;
  onEdit?: () => void;
  onDelete?: () => void;
}

function CategoryImage({ image, name }: { image: Blob; name: string }) {
  const source = useObjectUrl(image);
  return source ? <img src={source} alt={`Imagem de ${name}`} /> : null;
}

/** O avatar de categoria é a âncora visual comum a todos os lançamentos. */
function categoryIconForeground(color?: string) {
  const match = color && /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(color);
  if (!match) return "var(--ink)";
  const [red, green, blue] = match.slice(1).map((value) => Number.parseInt(value, 16) / 255).map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return red * 0.2126 + green * 0.7152 + blue * 0.0722 > 0.42 ? "#18181b" : "#fff";
}
export function CategoryAvatar({ category }: { category?: TransactionDisplay["category"] }) {
  const Icon = category ? categoryIcon(category.icon) : undefined;
  const background = category?.color ?? "var(--soft)";
  return <span className="transaction-avatar" style={{ background, color: categoryIconForeground(category?.color) }} aria-hidden={category?.image ? undefined : true}>
    {category?.image ? <CategoryImage image={category.image} name={category.name} /> : Icon ? <Icon /> : <span>{category?.name.slice(0, 1) ?? "?"}</span>}
  </span>;
}

function TransactionActionsMenu({ item }: { item: TransactionDisplay }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, [open]);
  if (!item.onEdit && !item.onDelete) return null;
  return <div className="transaction-menu" ref={root}>
    <button type="button" className="transaction-menu-trigger" aria-label={`Ações de ${item.description}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}><MoreVertical /></button>
    {open && <div className="transaction-menu-popover" role="menu">
      {item.onEdit && <button type="button" role="menuitem" onClick={() => { setOpen(false); item.onEdit?.(); }}>Editar</button>}
      {item.onDelete && <button type="button" role="menuitem" className="danger" onClick={() => { setOpen(false); item.onDelete?.(); }}>Excluir</button>}
    </div>}
  </div>;
}

export function TransactionItem({ item }: { item: TransactionDisplay }) {
  return <article className="transaction-item">
    <CategoryAvatar category={item.category} />
    <div className="transaction-copy">
      <strong title={item.description}>{item.description}</strong>
      {item.context.length > 0 && <small>{item.context.filter(Boolean).join(" · ")}</small>}
    </div>
    <strong className={`transaction-amount ${item.tone}`}>{money(item.amount, item.currency)}</strong>
    <TransactionActionsMenu item={item} />
  </article>;
}

export function TransactionDayList({ items, empty }: { items: TransactionDisplay[]; empty?: React.ReactNode }) {
  const groups = items.reduce<Map<string, TransactionDisplay[]>>((result, item) => {
    const group = result.get(item.date) ?? [];
    group.push(item);
    result.set(item.date, group);
    return result;
  }, new Map());
  if (!items.length) return <>{empty}</>;
  return <div className="transaction-day-list">
    {[...groups.entries()].map(([date, dayItems]) => {
      const total = dayItems.reduce((sum, item) => sum.plus(item.amount), new Decimal(0));
      return <section className="transaction-day" key={date}>
        <header><strong>{transactionDayLabel(date)}</strong><span className={total.isPositive() ? "income" : total.isNegative() ? "expense" : "neutral"}>{money(total.toString())}</span></header>
        <div>{dayItems.map((item) => <TransactionItem item={item} key={item.id} />)}</div>
      </section>;
    })}
  </div>;
}
