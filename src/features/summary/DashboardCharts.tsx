import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Summary } from "@/domain/types";
import { money, monthLabel } from "@/lib/format";
import { EmptyState } from "@/shared/ui/EmptyState";

type HistoryPoint = { month: string; balance: string };

export function DashboardCharts({ categoryTotals, history }: { categoryTotals: Summary["categoryTotals"]; history: HistoryPoint[] }) {
  return <section className="dashboard-grid">
    <article className="panel">
      <div className="panel-heading"><div><span className="eyebrow">Distribuição</span><h2>Gastos por categoria</h2></div></div>
      {categoryTotals.length ? <div className="chart-with-legend"><div className="donut"><ResponsiveContainer width="100%" height={260}><PieChart><Pie data={categoryTotals} dataKey="amount" nameKey="name" innerRadius={65} outerRadius={100} paddingAngle={3}>{categoryTotals.map((item) => <Cell key={item.name} fill={item.color} />)}</Pie><Tooltip formatter={(value) => money(String(value))} /></PieChart></ResponsiveContainer></div><ul className="legend">{categoryTotals.map((item) => <li key={item.name}><i style={{ background: item.color }} /><span>{item.name}</span><strong>{money(item.amount)}</strong></li>)}</ul></div> : <EmptyState title="Sem gastos no período" description="Registre uma despesa para visualizar a distribuição." />}
    </article>
    <article className="panel">
      <div className="panel-heading"><div><span className="eyebrow">Evolução</span><h2>Saldo mensal</h2></div></div>
      {history.length ? <ResponsiveContainer width="100%" height={310}><AreaChart data={history}><defs><linearGradient id="balanceFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0d9488" stopOpacity={0.35} /><stop offset="1" stopColor="#0d9488" stopOpacity={0} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="month" tickFormatter={(value) => value.slice(5)} /><YAxis tickFormatter={(value) => `${Math.round(value / 1000)}k`} /><Tooltip formatter={(value) => money(String(value))} labelFormatter={monthLabel} /><Area dataKey="balance" type="monotone" stroke="#0d9488" strokeWidth={3} fill="url(#balanceFill)" /></AreaChart></ResponsiveContainer> : <EmptyState title="Histórico vazio" description="Os saldos mensais aparecerão aqui." />}
    </article>
  </section>;
}
