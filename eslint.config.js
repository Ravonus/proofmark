import path from "node:path";
import { FlatCompat } from "@eslint/eslintrc";
import tseslint from "typescript-eslint";

const compat = new FlatCompat({
  baseDirectory: path.resolve(import.meta.dirname),
});

const sharedTsRules = {
  "@typescript-eslint/array-type": "off",
  "@typescript-eslint/consistent-type-definitions": "off",
  "@typescript-eslint/consistent-type-imports": [
    "warn",
    { prefer: "type-imports", fixStyle: "inline-type-imports" },
  ],
  "@typescript-eslint/no-empty-function": "warn",
  "@typescript-eslint/no-inferrable-types": "off",
  "@typescript-eslint/no-require-imports": "off",
  "@typescript-eslint/no-unused-vars": [
    "warn",
    { argsIgnorePattern: "^_" },
  ],
  "@typescript-eslint/require-await": "off",
  "prefer-const": "warn",
};

const typedTsRules = {
  ...sharedTsRules,
  "@typescript-eslint/ban-ts-comment": ["warn", { "ts-nocheck": "allow-with-description" }],
  "@typescript-eslint/no-unnecessary-type-assertion": "warn",
  "@typescript-eslint/prefer-optional-chain": "warn",
  "@typescript-eslint/prefer-regexp-exec": "warn",
  "@typescript-eslint/restrict-plus-operands": "warn",
  "@typescript-eslint/no-unused-expressions": "warn",
  "@typescript-eslint/no-misused-promises": [
    "error",
    { checksVoidReturn: { attributes: false } },
  ],
  "@typescript-eslint/no-explicit-any": "warn",
  "@typescript-eslint/no-floating-promises": "warn",
  "@typescript-eslint/prefer-nullish-coalescing": "off",
  "@typescript-eslint/no-unsafe-member-access": "warn",
  "@typescript-eslint/no-unsafe-assignment": "warn",
  "@typescript-eslint/no-unsafe-call": "warn",
  "@typescript-eslint/no-unsafe-argument": "warn",
  "@typescript-eslint/no-unsafe-return": "warn",
  "@typescript-eslint/no-redundant-type-constituents": "warn",
  "@typescript-eslint/no-implied-eval": "warn",
  "@typescript-eslint/no-base-to-string": "warn",
  "@typescript-eslint/restrict-template-expressions": "warn",
  "@typescript-eslint/prefer-promise-reject-errors": "warn",
  "@typescript-eslint/await-thenable": "warn",
  "no-console": ["warn", { allow: ["warn", "error"] }],
  "@typescript-eslint/naming-convention": [
    "warn",
    {
      selector: "variable",
      format: ["camelCase", "PascalCase", "UPPER_CASE"],
      leadingUnderscore: "allow",
    },
    {
      selector: "function",
      format: ["camelCase", "PascalCase"],
    },
    {
      selector: "typeLike",
      format: ["PascalCase"],
    },
  ],
};

export default tseslint.config(
  {
    ignores: [".next", "node_modules", "coverage", "src/lib/forensic/generated"],
  },
  ...compat.extends("next/core-web-vitals"),
  {
    files: ["**/*.ts", "**/*.tsx"],
    extends: [
      ...tseslint.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    rules: typedTsRules,
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
  },
);
