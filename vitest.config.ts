import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // tsconfig sets jsx:"preserve" for the Next build, which leaves JSX untransformed.
  // Vite 8 transforms with oxc (rolldown); tell it to emit the automatic JSX runtime
  // so .tsx components (e.g. Brand.tsx) can be imported and invoked in tests.
  // Affects test transforms only, not the app build.
  oxc: {
    jsx: { runtime: "automatic", importSource: "react" },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
  },
});
