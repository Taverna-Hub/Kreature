import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
export default defineConfig({
  plugins: [react(), { name: "fixture-entry", transformIndexHtml: (html) => html.replace("/src/main.tsx", "/e2e/main.tsx") }],
  envDir: false,
  resolve: { alias: [
    { find: "@/auth/auth-context", replacement: fileURLToPath(new URL("./auth.tsx", import.meta.url)) },
    { find: "@", replacement: fileURLToPath(new URL("../src", import.meta.url)) },
  ] },
});
