import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', '.vite/**'],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      'no-debugger': 'error',
      'no-alert': 'warn',
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-restricted-syntax': [
        'warn',
        {
          selector: "AssignmentExpression[left.type='MemberExpression'][left.property.name='innerHTML']",
          message: 'Avoid assigning to innerHTML; use a sanitized sink and replaceChildren.',
        },
        {
          selector: "CallExpression[callee.property.name='createContextualFragment']",
          message: 'Avoid createContextualFragment; parse sanitized HTML into a DocumentFragment using the sink API.',
        },
        {
          selector: "AssignmentExpression[left.type='MemberExpression'][left.object.type='MemberExpression'][left.object.object.name='ui'][left.object.property.name='aiResponse'][left.property.name='innerHTML']",
          message: 'Use replaceChildren(DocumentFragment) em vez de ui.aiResponse.innerHTML.',
        },
        {
          selector: "AssignmentExpression[left.type='MemberExpression'][left.object.type='MemberExpression'][left.object.object.name='ui'][left.object.property.name='confirmModalText'][left.property.name='innerHTML']",
          message: 'Use sanitização + replaceChildren para conteúdo HTML do modal de confirmação.',
        },
        {
          selector: "AssignmentExpression[left.type='MemberExpression'][left.object.type='MemberExpression'][left.object.object.name='ui'][left.object.property.name='syncWarningText'][left.property.name='innerHTML']",
          message: 'Use setTextContent para syncWarningText.',
        },
      ],
    },
  },
];
