import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * The server never executes remote JavaScript (roadmap D7/C5). ESLint's core
 * `no-eval`, `no-implied-eval` and `no-new-func` cover the direct forms; these
 * selectors add the aliased ones they miss (`globalThis.Function(...)`,
 * `x.eval(...)`, `(0, eval)(...)`, `x.constructor(...)`, any value reference
 * to `Function`, `new Worker(..., { eval: true })`), every way to reach
 * `node:vm`, and a dynamic `import()` of a non-literal specifier.
 */
const UNTRUSTED_EVAL_MESSAGE =
  "Do not evaluate code in-process. The server never executes remote JavaScript (roadmap C5, D7).";
const VM_MODULE = "/^(node:)?vm$/";
const noInProcessEval = [
  { selector: "NewExpression[callee.name='Function']", message: UNTRUSTED_EVAL_MESSAGE },
  { selector: "CallExpression[callee.name='Function']", message: UNTRUSTED_EVAL_MESSAGE },
  { selector: "NewExpression[callee.property.name='Function']", message: UNTRUSTED_EVAL_MESSAGE },
  { selector: "CallExpression[callee.property.name='Function']", message: UNTRUSTED_EVAL_MESSAGE },
  { selector: "CallExpression[callee.name='eval']", message: UNTRUSTED_EVAL_MESSAGE },
  { selector: "CallExpression[callee.property.name='eval']", message: UNTRUSTED_EVAL_MESSAGE },
  { selector: "SequenceExpression > Identifier[name='eval']", message: UNTRUSTED_EVAL_MESSAGE },
  { selector: "CallExpression[callee.name='runInThisContext']", message: UNTRUSTED_EVAL_MESSAGE },
  { selector: "CallExpression[callee.property.name='runInThisContext']", message: UNTRUSTED_EVAL_MESSAGE },
  { selector: `ImportExpression[source.value=${VM_MODULE}]`, message: UNTRUSTED_EVAL_MESSAGE },
  {
    selector: `CallExpression[callee.name='require'][arguments.0.value=${VM_MODULE}]`,
    message: UNTRUSTED_EVAL_MESSAGE,
  },
  {
    selector: `CallExpression[callee.property.name='getBuiltinModule'][arguments.0.value=${VM_MODULE}]`,
    message: UNTRUSTED_EVAL_MESSAGE,
  },
  {
    // Any value reference to Function (alias, Reflect.construct, destructure). The
    // TS type, `o.Function` and a `{ Function: 1 }` key are not references.
    selector:
      "Identifier[name='Function']:not(TSTypeReference > Identifier, MemberExpression[computed=false] > Identifier.property, Property[computed=false] > Identifier.key:not(ObjectPattern > Property > Identifier.key))",
    message: `Do not reference the Function constructor. ${UNTRUSTED_EVAL_MESSAGE}`,
  },
  {
    selector: "MemberExpression[computed=true][property.value='Function']",
    message: `Do not reach the Function constructor through a computed key. ${UNTRUSTED_EVAL_MESSAGE}`,
  },
  {
    selector: "MemberExpression[computed=true] > TemplateLiteral.property[quasis.0.value.cooked='Function']",
    message: `Do not reach the Function constructor through a template key. ${UNTRUSTED_EVAL_MESSAGE}`,
  },
  {
    selector: "CallExpression[callee.property.name='constructor']",
    message: `Do not call .constructor(...): a function's constructor is Function. ${UNTRUSTED_EVAL_MESSAGE}`,
  },
  {
    selector: "NewExpression[callee.property.name='constructor']",
    message: `Do not construct via .constructor: a function's constructor is Function. ${UNTRUSTED_EVAL_MESSAGE}`,
  },
  {
    selector: `CallExpression[arguments.0.value=${VM_MODULE}]`,
    message: `Do not load node:vm by any loader (createRequire, require aliases). ${UNTRUSTED_EVAL_MESSAGE}`,
  },
  {
    selector: "ImportExpression[source.type!='Literal']",
    message: `Dynamic import() takes a string literal only, so the module is known at lint time. ${UNTRUSTED_EVAL_MESSAGE}`,
  },
  {
    selector: "NewExpression[callee.name='Worker'] Property[key.name='eval']",
    message: `Do not start a Worker from a code string (eval: true). ${UNTRUSTED_EVAL_MESSAGE}`,
  },
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
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-restricted-syntax": ["error", ...noInProcessEval],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "vm", message: UNTRUSTED_EVAL_MESSAGE },
            { name: "node:vm", message: UNTRUSTED_EVAL_MESSAGE },
          ],
        },
      ],
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
