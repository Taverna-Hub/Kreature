import { emptyFinanceState } from "@/domain/defaults";
import type { FinanceState } from "@/domain/types";

/** The application's persistence seam. Production uses Supabase; memory is test-only. */
export interface FinanceRepository {
  load(): Promise<FinanceState>;
  transact(change: (draft: FinanceState) => unknown | Promise<unknown>): Promise<FinanceState>;
}

const clone = <T,>(value: T): T => structuredClone(value);

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
