import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist", "node_modules", "rayfin/.temp"],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
  {
    // The finance component library under src/finance is first-class template
    // source and is linted for correctness (TypeScript + react-hooks) like the
    // rest of the app. react-refresh/only-export-components is a Vite fast-refresh
    // DX rule aimed at route components; these library modules intentionally
    // co-locate hooks and helpers with their components (e.g. a context provider
    // exported alongside its hook), so that one HMR-only rule is relaxed here.
    files: ["src/finance/**/*.{ts,tsx}"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
);
