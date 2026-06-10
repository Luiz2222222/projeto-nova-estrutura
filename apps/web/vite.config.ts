import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  // O pacote do monorepo é CommonJS; forçar o Vite a pré-processá-lo
  // faz os "exports" nomeados funcionarem no navegador.
  optimizeDeps: {
    include: ['@tcc/compartilhado'],
  },
});
