import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Summary } from "@/domain/types";
import { money, monthLabel } from "@/lib/format";
import { EmptyState } from "@/shared/ui/EmptyState";

type HistoryPoint = { month: string; balance: string };

const chartValue = (value: number | string) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  if (Math.abs(amount) >= 1000) return `${(amount / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k`;
  return Math.round(amount).toLocaleString("pt-BR");
};

export function DashboardCharts({ categoryTotals, history }: { categoryTotals: Summary["categoryTotals"]; history: HistoryPoint[] }) {
  const largestCategory = categoryTotals.reduce((largest, item) => Math.max(largest, Number(item.amount)), 0);
  const chartData = history.map((item) => ({ ...item, balance: Number(item.balance) }));
  return <section className="dashboard-grid">
    <article className="panel">
      <div className="panel-heading"><div><span className="eyebrow">Distribuição</span><h2>Gastos por categoria</h2></div></div>
      {categoryTotals.length ? <div className="category-breakdown" role="list" aria-label="Gastos por categoria">{categoryTotals.map((item) => <div className="category-bar" key={item.name} role="listitem"><span className="category-bar-label"><i style={{ background: item.color }} />{item.name}</span><span className="category-bar-track" aria-hidden="true"><b style={{ width: `${largestCategory ? Math.max((Number(item.amount) / largestCategory) * 100, 3) : 0}%`, background: item.color }} /></span><strong>{money(item.amount)}</strong></div>)}</div> : <EmptyState title="Sem gastos no período" description="Registre uma despesa para visualizar a distribuição." />}
    </article>
    <article className="panel">
      <div className="panel-heading"><div><span className="eyebrow">Evolução</span><h2>Saldo mensal</h2></div></div>
      {history.length ? <ResponsiveContainer width="100%" height={310}><AreaChart data={chartData}><defs><linearGradient id="balanceFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0d9488" stopOpacity={0.35} /><stop offset="1" stopColor="#0d9488" stopOpacity={0} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="month" tickFormatter={(value) => value.slice(5)} /><YAxis tickFormatter={chartValue} /><Tooltip formatter={(value) => money(String(value))} labelFormatter={monthLabel} /><Area dataKey="balance" type="monotone" stroke="#0d9488" strokeWidth={3} fill="url(#balanceFill)" /></AreaChart></ResponsiveContainer> : <EmptyState title="Histórico vazio" description="Os saldos mensais aparecerão aqui." />}
    </article>
  </section>;
}
