import { defineConfig } from "vitest/config";

// The model layer runs in plain Node. Suites that touch the DOM (reconcile, portrait views) opt
// into jsdom with a `// @vitest-environment jsdom` pragma. `setupFiles` installs the Foundry
// globals before any test's imports resolve.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.mjs"],
    setupFiles: ["test/helpers/foundry-shims.mjs"]
  }
});
