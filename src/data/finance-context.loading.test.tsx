import { StrictMode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FinanceProvider, useFinance } from "./finance-context";

function LoadingProbe() {
  renderCount += 1;
  const { loading, error } = useFinance();
  return <span>{loading ? "loading" : error ? `error:${error}` : "ready"}</span>;
}

let renderCount = 0;

describe("FinanceProvider initialization", () => {
  it("leaves the loading state when mounted in React StrictMode", async () => {
    renderCount = 0;
    render(
      <StrictMode>
        <FinanceProvider>
          <LoadingProbe />
        </FinanceProvider>
      </StrictMode>,
    );

    expect(screen.getByText("loading")).toBeInTheDocument();
    expect(await screen.findByText("ready", {}, { timeout: 1_000 })).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(renderCount).toBeLessThanOrEqual(8);
    cleanup();
  });
});
