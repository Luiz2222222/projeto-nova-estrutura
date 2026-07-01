-- CreateTable
CREATE TABLE "configuracao_sistema" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'global',
    "semestreAtivo" TEXT,
    "atualizadoEm" DATETIME NOT NULL,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
