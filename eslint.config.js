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
    "error",
    { prefer: "type-imports", fixStyle: "inline-type-imports" },
  ],
  "@typescript-eslint/no-empty-function": "error",
  "@typescript-eslint/no-inferrable-types": "off",
  "@typescript-eslint/no-require-imports": "off",
  "@typescript-eslint/no-unused-vars": [
    "error",
    { argsIgnorePattern: "^_" },
  ],
  "@typescript-eslint/require-await": "off",
  "prefer-const": "error",
};

const typedTsRules = {
  ...sharedTsRules,
  "@typescript-eslint/ban-ts-comment": ["error", { "ts-nocheck": "allow-with-description" }],
  "@typescript-eslint/no-unnecessary-type-assertion": "error",
  "@typescript-eslint/prefer-optional-chain": "error",
  "@typescript-eslint/prefer-regexp-exec": "error",
  "@typescript-eslint/restrict-plus-operands": "error",
  "@typescript-eslint/no-unused-expressions": "error",
  "@typescript-eslint/no-misused-promises": [
    "error",
    { checksVoidReturn: { attributes: false } },
  ],
  "@typescript-eslint/no-explicit-any": "error",
  "@typescript-eslint/no-floating-promises": "error",
  "@typescript-eslint/prefer-nullish-coalescing": "off",
  "@typescript-eslint/no-unsafe-member-access": "error",
  "@typescript-eslint/no-unsafe-assignment": "error",
  "@typescript-eslint/no-unsafe-call": "error",
  "@typescript-eslint/no-unsafe-argument": "error",
  "@typescript-eslint/no-unsafe-return": "error",
  "@typescript-eslint/no-redundant-type-constituents": "error",
  "@typescript-eslint/no-implied-eval": "error",
  "@typescript-eslint/no-base-to-string": "error",
  "@typescript-eslint/restrict-template-expressions": "error",
  "@typescript-eslint/prefer-promise-reject-errors": "error",
  "@typescript-eslint/await-thenable": "error",
  "no-console": ["error", { allow: ["warn", "error"] }],
  "@typescript-eslint/naming-convention": [
    "error",
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
  "no-restricted-imports": [
    "error",
    {
      patterns: [
        {
          group: ["~/premium/*", "../premium/*", "../../premium/*"],
          message: "Premium modules must be loaded dynamically via loadPremium*() helpers, not imported directly in src/.",
        },
      ],
    },
  ],
};

export default tseslint.config(
  {
    ignores: [".next", "node_modules", "coverage", "src/lib/forensic/generated", "scripts"],
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
