import Dexie, { type EntityTable } from "dexie";
import { emptyFinanceState } from "@/domain/defaults";
import { CATEGORY_TAXONOMY_VERSION, migrateCategoryTaxonomy } from "@/domain/migration";
import type { FinanceState } from "@/domain/types";

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
    this.version(3)
      .stores({ states: "&id" })
      .upgrade((transaction) => transaction.table("states").clear());
    this.version(4).stores({ states: "&id" });
  }
}

const clone = <T>(value: T): T => structuredClone(value);

export class DexieFinanceRepository implements FinanceRepository {
  private readonly db: FinanceDatabase;
  private migrationNotice?: string;
  constructor(name?: string) {
    this.db = new FinanceDatabase(name);
  }
  async load() {
    return this.db.transaction("rw", this.db.states, async () => {
      const record = await this.db.states.get("current");
      if (record) {
        const value = clone(record.value);
        if (record.version < CATEGORY_TAXONOMY_VERSION) {
          migrateCategoryTaxonomy(value);
          await this.db.states.put({ id: "current", value, version: CATEGORY_TAXONOMY_VERSION });
          this.migrationNotice = "Categorias atualizadas e histórico reclassificado localmente.";
        } else if (!value.classificationRules) {
          value.classificationRules = [];
          await this.db.states.put({ id: "current", value, version: record.version });
        }
        return clone(value);
      }
      const value = emptyFinanceState();
      await this.db.states.put({ id: "current", value, version: CATEGORY_TAXONOMY_VERSION });
      return clone(value);
    });
  }
  async transact(change: (draft: FinanceState) => unknown | Promise<unknown>) {
    return this.db.transaction("rw", this.db.states, async () => {
      const record = await this.db.states.get("current");
      const current = record?.value ?? emptyFinanceState();
      const draft = clone(current);
      await change(draft);
      await this.db.states.put({ id: "current", value: draft, version: CATEGORY_TAXONOMY_VERSION });
      return clone(draft);
    });
  }
  consumeMigrationNotice() {
    const message = this.migrationNotice;
    this.migrationNotice = undefined;
    return message;
  }
}

export class MemoryFinanceRepository implements FinanceRepository {
  private state: FinanceState;
  constructor(initial = emptyFinanceState()) {
    this.state = clone(initial);
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
