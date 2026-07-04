import { defineConfig } from 'vitest/config';

// Testes unitários da API — focados em helpers PUROS de src/comum (sem Nest/Prisma runtime).
// Usa o vitest já presente no monorepo (nenhuma dependência nova).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
