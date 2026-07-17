import { defineConfig } from 'vitest/config';

// Testes de LÓGICA do frontend (utils/regras puras): rodam em Node, sem navegador,
// sem Playwright e sem dependência nova — o vitest é o mesmo do monorepo.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
