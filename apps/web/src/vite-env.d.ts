/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL base da API em produção (ex.: https://api.meusite.com). Em dev cai no localhost. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
