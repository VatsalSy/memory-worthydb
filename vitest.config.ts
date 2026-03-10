import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["do-not-commit/**", "node_modules/**", "dist/**", "coverage/**"],
    environment: "node",
  },
});
