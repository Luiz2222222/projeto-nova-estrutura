import { defineConfig } from 'vitest/config';

// Testes da API: unitários (helpers puros em src/comum) + integração do fluxo do TCC
// (test/*.test.ts, com SQLite real via driver adapter). Usa o vitest já presente no monorepo.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000, // testes de integração aplicam migrations num SQLite temporário
  },
});
