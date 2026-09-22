// The fenced layer, wired for real:
//  - @shadcn/lint (pinned 0.1.5): the design-token register + no-restyle contracts.
//  - typescript-eslint strictTypeChecked: the mattpocock rigor as an eslint fence.
import { plugin as shadcn } from "@shadcn/lint";
import tsParser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  {
    files: ["**/*.{js,mjs,jsx,ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { shadcn },
    rules: {
      "shadcn/no-raw-colors": "error",
      "shadcn/no-arbitrary-values": "error",
      "shadcn/no-inline-styles": "error",
      // The component contract: appearance belongs to variants; callers may
      // place (layout), never restyle.
      "shadcn/no-restyle": ["error", { allow: ["layout"] }],
      "shadcn/no-unknown-classes": "error",
      "shadcn/require-static-classes": "error",
    },
  },
  // Type-checked strictness on TS sources only (mjs tooling files stay under
  // the parser-only config above — they are not part of the app project).
  ...tseslint.configs.strictTypeChecked.map(c => ({ ...c, files: ["**/*.{ts,tsx}"] })),
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
]);
