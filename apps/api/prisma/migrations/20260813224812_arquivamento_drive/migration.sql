-- CreateTable
CREATE TABLE "integracao_drive" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'global',
    "contaEmail" TEXT,
    "pastaRaizId" TEXT,
    "pastaRaizNome" TEXT,
    "refreshTokenCriptografado" TEXT,
    "conectadoEm" DATETIME,
    "ultimoSyncEm" DATETIME,
    "ultimoErro" TEXT,
    "oauthState" TEXT,
    "oauthStateExpiraEm" DATETIME,
    "atualizadoEm" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "sync_drive" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tccId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "documentoId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "ultimoErro" TEXT,
    "proximaTentativaEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" DATETIME NOT NULL,
    CONSTRAINT "sync_drive_tccId_fkey" FOREIGN KEY ("tccId") REFERENCES "tccs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "drive_arquivos" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tccId" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "driveId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" DATETIME NOT NULL,
    CONSTRAINT "drive_arquivos_tccId_fkey" FOREIGN KEY ("tccId") REFERENCES "tccs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "tccs_arquivados" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tccIdOriginal" TEXT NOT NULL,
    "semestre" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "alunoNome" TEXT NOT NULL,
    "alunoEmail" TEXT NOT NULL,
    "alunoCurso" TEXT,
    "orientadorNome" TEXT,
    "coorientadorNome" TEXT,
    "nf1" REAL,
    "nf2" REAL,
    "nf" REAL,
    "resultado" TEXT,
    "faseFinal" TEXT,
    "concluidoEm" DATETIME,
    "defesaAgendadaPara" DATETIME,
    "defesaLocal" TEXT,
    "dadosJson" TEXT NOT NULL,
    "resumoTexto" TEXT NOT NULL,
    "drivePastaId" TEXT,
    "driveArquivoFinalId" TEXT,
    "driveArquivoFinalNome" TEXT,
    "arquivadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "tccs_arquivados_participantes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "arquivadoId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "papel" TEXT NOT NULL,
    CONSTRAINT "tccs_arquivados_participantes_arquivadoId_fkey" FOREIGN KEY ("arquivadoId") REFERENCES "tccs_arquivados" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "tccs_arquivados_participantes_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "sync_drive_status_proximaTentativaEm_idx" ON "sync_drive"("status", "proximaTentativaEm");

-- CreateIndex
CREATE UNIQUE INDEX "drive_arquivos_tccId_chave_key" ON "drive_arquivos"("tccId", "chave");

-- CreateIndex
CREATE INDEX "tccs_arquivados_semestre_idx" ON "tccs_arquivados"("semestre");

-- CreateIndex
CREATE UNIQUE INDEX "tccs_arquivados_participantes_arquivadoId_usuarioId_papel_key" ON "tccs_arquivados_participantes"("arquivadoId", "usuarioId", "papel");
