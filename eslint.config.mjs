import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Nested build output (e.g. worktree copies under .tmp/): the bare
    // patterns above match only top-level directories (#116).
    "**/.next/**",
    "**/out/**",
    "**/build/**",
    // Runtime/test artifacts (all gitignored, see .gitignore):
    ".tmp/**",
    "test-results/**",
    "playwright-report/**",
    "state/**",
    "coverage/**",
    ".eslintcache",
  ]),
]);

export default eslintConfig;
