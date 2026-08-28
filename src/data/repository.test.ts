import { describe, expect, it } from "vitest";
import { MemoryFinanceRepository } from "./repository";

describe("FinanceRepository", () => {
  it("não publica uma transação que falha", async () => {
    const repository = new MemoryFinanceRepository();
    await expect(
      repository.transact((draft) => {
        draft.categories = [];
        throw new Error("falhou");
      }),
    ).rejects.toThrow("falhou");
    expect((await repository.load()).categories.length).toBeGreaterThan(0);
  });
});
