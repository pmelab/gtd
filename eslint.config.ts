import eslint from "@eslint/js"
import tseslint from "typescript-eslint"
import * as effect from "@effect/eslint-plugin"

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { "@effect": effect },
  },
  {
    files: ["**/*.test.ts"],
    rules: { "require-yield": "off" },
  },
  { ignores: ["dist", "node_modules"] },
)
