import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

type DatePickerProps = {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  disabled?: boolean;
};

type FormDatePickerProps = {
  name: string;
  defaultValue?: string;
  label?: string;
  required?: boolean;
};

const iso = (date: Date) => date.toISOString().slice(0, 10);

export function DatePicker({ value, onChange, label = "Selecionar data", disabled }: DatePickerProps) {
  const selected = value ? new Date(`${value}T12:00:00`) : undefined;
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => new Date(selected ?? new Date()).setDate(1));
  const days = useMemo(() => {
    const start = new Date(month);
    const first = new Date(start);
    first.setDate(1 - first.getDay());
    return Array.from({ length: 42 }, (_, index) => {
      const day = new Date(first);
      day.setDate(first.getDate() + index);
      return day;
    });
  }, [month]);
  const moveMonth = (amount: number) => setMonth((current) => new Date(current).setMonth(new Date(current).getMonth() + amount));
  return (
    <div className="date-picker">
      <button type="button" className="date-trigger" aria-label={label} aria-expanded={open} onClick={() => setOpen((current) => !current)} disabled={disabled}>
        <CalendarDays size={16} aria-hidden="true" />
        <span>{selected ? new Intl.DateTimeFormat("pt-BR").format(selected) : "Selecionar data"}</span>
      </button>
      {open && (
        <div className="date-popover" role="dialog" aria-label={label}>
          <div className="date-picker-header">
            <button type="button" aria-label="Mês anterior" onClick={() => moveMonth(-1)}><ChevronLeft size={16} /></button>
            <strong>{new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(new Date(month))}</strong>
            <button type="button" aria-label="Próximo mês" onClick={() => moveMonth(1)}><ChevronRight size={16} /></button>
          </div>
          <div className="date-weekdays">{["D", "S", "T", "Q", "Q", "S", "S"].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div>
          <div className="date-days">
            {days.map((day) => {
              const dayIso = iso(day);
              const inMonth = day.getMonth() === new Date(month).getMonth();
              return <button type="button" key={dayIso} className={`${inMonth ? "" : "muted"} ${dayIso === value ? "selected" : ""}`} onClick={() => { onChange(dayIso); setOpen(false); }}>{day.getDate()}</button>;
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function MonthPicker({ value, onChange, label = "Selecionar mês", disabled }: DatePickerProps) {
  const initial = /^\d{4}-\d{2}$/.test(value) ? new Date(`${value}-01T12:00:00`) : new Date();
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(initial.getFullYear());
  const selected = /^\d{4}-\d{2}$/.test(value) ? new Date(`${value}-01T12:00:00`) : undefined;
  const months = Array.from({ length: 12 }, (_, month) => new Date(year, month, 1));

  useEffect(() => {
    if (/^\d{4}-\d{2}$/.test(value)) setYear(Number(value.slice(0, 4)));
  }, [value]);

  return (
    <div className="date-picker month-picker">
      <button type="button" className="date-trigger" aria-label={label} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((current) => !current)} disabled={disabled}>
        <CalendarDays size={16} aria-hidden="true" />
        <span>{selected ? new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(selected) : "Selecionar mês"}</span>
      </button>
      {open && (
        <div className="date-popover month-popover" role="dialog" aria-label={label}>
          <div className="date-picker-header">
            <button type="button" aria-label="Ano anterior" onClick={() => setYear((current) => current - 1)}><ChevronLeft size={16} /></button>
            <strong>{year}</strong>
            <button type="button" aria-label="Próximo ano" onClick={() => setYear((current) => current + 1)}><ChevronRight size={16} /></button>
          </div>
          <div className="month-grid" role="group" aria-label={`Meses de ${year}`}>
            {months.map((month) => {
              const monthValue = `${year}-${String(month.getMonth() + 1).padStart(2, "0")}`;
              const isSelected = monthValue === value;
              return <button type="button" key={monthValue} className={isSelected ? "selected" : ""} aria-pressed={isSelected} onClick={() => { onChange(monthValue); setOpen(false); }}>{new Intl.DateTimeFormat("pt-BR", { month: "short" }).format(month).replace(".", "")}</button>;
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** A controlled-looking date picker that still participates in a native FormData submission. */
export function FormDatePicker({ name, defaultValue = "", label, required }: FormDatePickerProps) {
  const [value, setValue] = useState(defaultValue);
  return <>
    <input type="hidden" name={name} value={value} required={required} />
    <DatePicker value={value} onChange={setValue} label={label ?? "Selecionar data"} />
  </>;
}
