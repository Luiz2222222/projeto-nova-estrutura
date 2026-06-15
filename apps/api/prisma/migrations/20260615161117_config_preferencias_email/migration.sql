-- CreateTable
CREATE TABLE "configuracao_email" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'global',
    "recuperacaoSenhaAtiva" BOOLEAN NOT NULL DEFAULT true,
    "fluxoTccAtivo" BOOLEAN NOT NULL DEFAULT true,
    "atualizadoEm" DATETIME NOT NULL,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "preferencias_email" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "usuarioId" TEXT NOT NULL,
    "evento" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "preferencias_email_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "preferencias_email_usuarioId_evento_key" ON "preferencias_email"("usuarioId", "evento");
