import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Sem `globals: true` a limpeza automática da Testing Library não roda, e arquivos
// com mais de um teste acabam consultando o DOM renderizado pelo teste anterior.
afterEach(cleanup);
