import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * The server never executes remote JavaScript (roadmap D7/C5). These are the
 * in-process escape hatches; W4b deletes the remaining uses.
 */
const UNTRUSTED_EVAL_MESSAGE =
  "Do not evaluate code in-process. The server never executes remote JavaScript (roadmap C5, D7).";
const noInProcessEval = [
  { selector: "NewExpression[callee.name='Function']", message: UNTRUSTED_EVAL_MESSAGE },
  { selector: "CallExpression[callee.name='Function']", message: UNTRUSTED_EVAL_MESSAGE },
  { selector: "CallExpression[callee.name='eval']", message: UNTRUSTED_EVAL_MESSAGE },
  { selector: "CallExpression[callee.property.name='eval']", message: UNTRUSTED_EVAL_MESSAGE },
  { selector: "CallExpression[callee.name='runInThisContext']", message: UNTRUSTED_EVAL_MESSAGE },
  { selector: "CallExpression[callee.property.name='runInThisContext']", message: UNTRUSTED_EVAL_MESSAGE },
];

/** Flat ESLint config. Every rule is an error; `npm run lint` runs with --max-warnings 0. */
export default tseslint.config(
  {
    ignores: [
      "dist/**",
      ".output/**",
      ".vercel/**",
      ".nitro/**",
      "node_modules/**",
      "src/routeTree.gen.ts",
      // Tooling scratch dirs, not source. `.remember/tmp` holds bare timestamps
      // under a .ts name, which fails the parse and turns `npm run lint` red —
      // and `update:deps` uses lint as a gate, so it would roll back every
      // upgrade for a reason that has nothing to do with the upgrade.
      ".remember/**",
      ".grok/**",
      ".pi/**",
      ".tanstack/**",
    ],
  },
  { linterOptions: { reportUnusedDisableDirectives: "error" } },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node, ...globals.webextensions },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-hooks/exhaustive-deps": "error",
      "react-refresh/only-export-components": [
        "error",
        { allowConstantExport: true, allowExportNames: ["badgeVariants", "buttonVariants"] },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "no-restricted-syntax": ["error", ...noInProcessEval],
    },
  },
  {
    // Server code logs through `log` (src/lib/log.server.ts), which redacts secrets.
    // Server-only modules without the `.server` suffix are listed by name.
    files: ["src/**/*.server.ts", "src/routes/**", "src/lib/auth/server.ts", "src/lib/db.ts", "server/**"],
    rules: { "no-console": "error" },
  },
  // Disable rules that conflict with Prettier formatting.
  prettier,
);
