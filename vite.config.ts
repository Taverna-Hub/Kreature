import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Keep compatibility with the existing local `.env` while new setups use
  // the Vite-standard VITE_ prefix documented in `.env.example`.
  envPrefix: ["VITE_", "NEXT_PUBLIC_"],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { environment: "jsdom", setupFiles: ["./src/test/setup.ts"] },
});
