// The design-token gate: @shadcn/lint's rules, pinned at 0.1.5, swappable via
// one registry entry (docs/gates/gate-registry.json, transport "ci").
// Works on any Tailwind v4 project; shadcn/ui itself is NOT required.
import { plugin as shadcn } from "@shadcn/lint";
import tsParser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";

export default defineConfig([
  {
    files: ["**/*.{js,mjs,jsx,ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { shadcn },
    rules: {
      // The design-token register: raw values the theme should own.
      "shadcn/no-raw-colors": "error",
      "shadcn/no-arbitrary-values": "error",
      "shadcn/no-inline-styles": "error",
      // Component contracts activate when components.json / settings.shadcn
      // recognize components; harness code has none, so these stay quiet here.
      "shadcn/no-restyle": "error",
      "shadcn/no-unknown-classes": "error",
      "shadcn/require-static-classes": "error",
    },
  },
]);
