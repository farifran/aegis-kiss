// Aegis KISS — Mechanical ESLint Config (type-aware structural checks for product code)
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const srcDirs = (process.env.AEGIS_SRC_DIRS || 'src,app,lib')
  .split(',')
  .map((s) => s.trim().replace(/^\.\//u, '').replace(/\/+$/u, ''))
  .filter(Boolean);
const tsProductFiles = srcDirs.map((dir) => `${dir}/**/*.{ts,tsx}`);

const delegatedProjectIgnores = [];
try {
  const cfgPath = resolve(process.cwd(), '.harness/config/project.json');
  if (existsSync(cfgPath)) {
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    if (typeof cfg?.projectRoot === 'string' && cfg.projectRoot.trim() && cfg.lintCommand !== undefined) {
      const clean = cfg.projectRoot.trim().replace(/^\.\//u, '').replace(/\/+$/u, '');
      if (clean && clean !== '.') delegatedProjectIgnores.push(`${clean}/**`);
    }
  }
} catch {
  // Ignora config inválida aqui; product_checker validará explicitamente.
}

export default [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      '_next/**',
      'dist/**',
      'coverage/**',
      'build/**',
      'scratch/**',
      '.harness/runtime/**',
      '**/*.{test,spec}.{ts,tsx,mts,cts,js,jsx,mjs,cjs}',
      ...delegatedProjectIgnores,
    ],
  },

  js.configs.recommended,

  {
    files: tsProductFiles,

    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: './tsconfig.json',
      },
    },

    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },

    rules: {
      // Observability & async safety
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-debugger': 'error',
      'no-eval': 'error',
      'no-new-func': 'error',
      'no-duplicate-imports': 'error',
      'no-array-constructor': 'off',
      '@typescript-eslint/no-array-constructor': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/only-throw-error': 'error',

      // Bounded complexity (warnings)
      'max-depth': ['warn', 4],
      'complexity': ['warn', { max: 12 }],
      'max-lines-per-function': ['warn', { max: 80, skipBlankLines: true, skipComments: true }],
      'max-params': ['warn', { max: 4 }],
      'no-nested-ternary': 'warn',
      'max-classes-per-file': ['warn', 1],

      // Type discipline
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-expect-error': 'allow-with-description',
          minimumDescriptionLength: 8,
          'ts-ignore': true,
          'ts-nocheck': true,
          'ts-check': false,
        },
      ],
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/consistent-type-imports': 'warn',

      // Determinism & safety (migrated from ast-grep without false positives)
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Math.random() is predictable; use node:crypto or an explicit seed.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSAsExpression > TSAsExpression',
          message: 'Double type assertion (as ... as ...) bypasses TypeScript safety; use an explicit type guard.',
        },
        {
          selector: 'UnaryExpression[operator="delete"]',
          message: 'Avoid delete operator on objects; use destructuring, undefined assignment, or Map.',
        },
        {
          selector: 'CallExpression[callee.object.name="Date"][callee.property.name="now"]',
          message: 'Implicit system clock (Date.now()) violates DETERMINISTIC-TIME; pass an explicit timestamp parameter.',
        },
        {
          selector: 'NewExpression[callee.name="Date"][arguments.length=0]',
          message: 'Implicit system clock (new Date()) violates DETERMINISTIC-TIME; pass an explicit timestamp parameter.',
        },
      ],
    },
  },
];
