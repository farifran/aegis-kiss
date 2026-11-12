import { defineConfig } from 'vitest/config';

export default defineConfig({
  // O build injeta esta constante nos três consumidores do locale (index.html,
  // i18n.ts e sw.js). O vitest não passa pelo build, então sem este espelho o
  // `i18n.ts` lança ReferenceError e nenhuma tradução carrega nos testes.
  define: {
    __LOCALE_VERSION__: JSON.stringify('test'),
  },
  test: {
    // Simula um navegador para que 'window', 'document' e 'localStorage' existam.
    // jsdom (e não happy-dom): DOMPurify >= 3.4.8 não sanitiza sob happy-dom.
    environment: 'jsdom',
    // Permite usar describe, it, expect sem importar em cada arquivo
    globals: true,
    // Padrão de busca de arquivos de teste
    include: ['**/*.test.ts'],
    // Limpa mocks automaticamente entre testes para evitar vazamento de estado
    mockReset: true,
    // Setup global (mocks e polyfills) antes dos testes
    setupFiles: ['./vitest.setup.ts'],
    // Aumenta timeout para testes de cenario que fazem operações pesadas
    testTimeout: 30000,
    // Performance budgets
    slowTestThreshold: 1000,
    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'services/**/*.ts',
        'render/**/*.ts',
        'listeners/**/*.ts',
        'habitActions.ts',
        'state.ts',
        'utils.ts'
      ],
      exclude: [
        '**/*.test.ts',
        '**/*.config.ts',
        '**/build.js',
        'api/**',
        'scripts/**'
      ],
      thresholds: {
        lines: 80,
        functions: 70,
        branches: 70,
        statements: 80
      }
    }
  },
});