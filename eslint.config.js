// =========================================================
// AEGIS HARNESS — ESLINT EPISTEMIC CONFIG v4
// =========================================================

// This file provides mechanically enforceable structural containment.
//
// It is NOT:
// - constitutional governance;
// - runtime orchestration;
// - mode cognition;
// - architectural truth.
//
// The goal is not stylistic purity.
//
// The goal is:
// - structural observability;
// - bounded operational complexity;
// - dependency containment;
// - redesign drift reduction;
// - execution transparency;
// - epistemic reliability.

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import boundaries from "eslint-plugin-boundaries";

export default [

  // =======================================================
  // GLOBAL IGNORE
  // =======================================================

  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "_next/**",
      "dist/**",
      "coverage/**",
      "build/**",

      ".harness/runtime/**",
      ".harness/artifacts/**",
      ".harness/worktrees/**",

      // Product unit tests (node:test + tsx); excluded from tsconfig project.
      "src/**/*.test.ts"
    ]
  },

  // =======================================================
  // BASE JAVASCRIPT CONFIG
  // =======================================================

  js.configs.recommended,

  // =======================================================
  // TYPESCRIPT STRUCTURAL CONTAINMENT
  // =======================================================

  {
    files: ["src/**/*.ts"],

    languageOptions: {
      parser: tseslint.parser,

      parserOptions: {
        project: "./tsconfig.json"
      }
    },

    plugins: {
      "@typescript-eslint": tseslint.plugin,
      boundaries
    },

    settings: {
      "boundaries/elements": [
        {
          type: "ui",
          pattern: "src/ui/**"
        },

        {
          type: "application",
          pattern: "src/application/**"
        },

        {
          type: "domain",
          pattern: "src/domain/**"
        },

        {
          type: "infrastructure",
          pattern: "src/infrastructure/**"
        }
      ]
    },

    rules: {

      // ---------------------------------------------------
      // STRUCTURAL BOUNDARIES
      // ---------------------------------------------------

      "boundaries/element-types": [
        "error",
        {
          default: "disallow",

          rules: [
            {
              from: "ui",
              allow: ["application"]
            },

            {
              from: "application",
              allow: ["domain"]
            },

            {
              from: "domain",
              allow: []
            },

            {
              from: "infrastructure",
              allow: ["application", "domain"]
            }
          ]
        }
      ],

      // ---------------------------------------------------
      // EXECUTION OBSERVABILITY
      // ---------------------------------------------------

      "no-console": [
        "warn",
        {
          allow: ["warn", "error"]
        }
      ],

      "no-debugger": "error",

      "@typescript-eslint/no-floating-promises": "error",

      // ---------------------------------------------------
      // OPERATIONAL COMPLEXITY
      // ---------------------------------------------------

      "max-depth": [
        "warn",
        4
      ],

      "complexity": [
        "warn",
        {
          max: 12
        }
      ],

      "max-lines-per-function": [
        "warn",
        {
          max: 80,
          skipBlankLines: true,
          skipComments: true
        }
      ],

      "max-params": [
        "warn",
        {
          max: 4
        }
      ],

      "no-nested-ternary": "warn",

      "max-classes-per-file": [
        "warn",
        1
      ],

      // ---------------------------------------------------
      // TYPE DISCIPLINE (mutation lint-gate consumes these)
      // Floor models invent any / @ts-ignore under pressure —
      // error severity so aider's --auto-lint loop rejects them.
      // ---------------------------------------------------

      "@typescript-eslint/no-explicit-any": "error",

      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-expect-error": "allow-with-description",
          "minimumDescriptionLength": 8,
          "ts-ignore": true,
          "ts-nocheck": true,
          "ts-check": false
        }
      ],

      "no-unused-vars": "off",

      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_"
        }
      ],

      "@typescript-eslint/consistent-type-imports": "warn"

      // ---------------------------------------------------
      // EPISTEMIC NOTES
      // ---------------------------------------------------

      // ESLint boundaries provide:
      // - dependency containment;
      // - execution visibility;
      // - bounded complexity enforcement;
      // - structural layering guarantees.
      //
      // Type discipline (no-explicit-any, ban-ts-comment, no-unused-vars)
      // is the mechanical floor for mutation quality under weak models.
      //
      // ESLint does NOT provide:
      // - runtime orchestration;
      // - constitutional governance;
      // - architectural certainty;
      // - correctness guarantees;
      // - cognition sequencing.
    }
  }
];
