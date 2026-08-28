import Dexie, { type EntityTable } from "dexie";
import { emptyFinanceState } from "@/domain/defaults";
import type { FinanceState } from "@/domain/types";
import { normalizeFinanceState } from "@/domain/patrimony";

export interface FinanceRepository {
  load(): Promise<FinanceState>;
  transact(change: (draft: FinanceState) => unknown | Promise<unknown>): Promise<FinanceState>;
}

type StateRecord = { id: "current"; value: FinanceState; version: number };

class FinanceDatabase extends Dexie {
  states!: EntityTable<StateRecord, "id">;
  constructor(name = "controle-financeiro") {
    super(name);
    this.version(1).stores({ states: "&id" });
    this.version(2).stores({ states: "&id" });
  }
}

const clone = <T>(value: T): T => structuredClone(value);

export class DexieFinanceRepository implements FinanceRepository {
  private readonly db: FinanceDatabase;
  constructor(name?: string) {
    this.db = new FinanceDatabase(name);
  }
  async load() {
    const record = await this.db.states.get("current");
    if (record) {
      const value = normalizeFinanceState(record.value);
      if (record.version !== 2) await this.db.states.put({ id: "current", value, version: 2 });
      return clone(value);
    }
    const value = emptyFinanceState();
    await this.db.states.put({ id: "current", value, version: 2 });
    return clone(value);
  }
  async transact(change: (draft: FinanceState) => unknown | Promise<unknown>) {
    return this.db.transaction("rw", this.db.states, async () => {
      const record = await this.db.states.get("current");
      const current = record ? normalizeFinanceState(record.value) : emptyFinanceState();
      const draft = clone(current);
      await change(draft);
      await this.db.states.put({ id: "current", value: draft, version: 2 });
      return clone(draft);
    });
  }
}

export class MemoryFinanceRepository implements FinanceRepository {
  private state: FinanceState;
  constructor(initial = emptyFinanceState()) {
    this.state = normalizeFinanceState(clone(initial));
  }
  async load() {
    return clone(this.state);
  }
  async transact(change: (draft: FinanceState) => unknown | Promise<unknown>) {
    const draft = clone(this.state);
    await change(draft);
    this.state = draft;
    return clone(this.state);
  }
}
