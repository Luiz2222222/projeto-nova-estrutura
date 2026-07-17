import { defineConfig } from 'vitest/config';

// Testes do frontend sem Playwright: lógica pura roda em Node; testes de RENDERIZAÇÃO
// (.test.tsx) declaram `// @vitest-environment jsdom` no topo e usam Testing Library.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true, // afterEach global -> auto-cleanup do Testing Library entre os testes
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
