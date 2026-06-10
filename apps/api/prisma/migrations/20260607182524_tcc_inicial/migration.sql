-- CreateTable
CREATE TABLE "tccs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "titulo" TEXT NOT NULL,
    "semestre" TEXT NOT NULL,
    "faseAtual" TEXT NOT NULL DEFAULT 'INICIALIZACAO',
    "alunoId" TEXT NOT NULL,
    "orientadorId" TEXT,
    "coorientadorId" TEXT,
    "coorientadorNome" TEXT,
    "coorientadorTitulacao" TEXT,
    "coorientadorAfiliacao" TEXT,
    "coorientadorLattes" TEXT,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" DATETIME NOT NULL,
    CONSTRAINT "tccs_alunoId_fkey" FOREIGN KEY ("alunoId") REFERENCES "usuarios" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "tccs_orientadorId_fkey" FOREIGN KEY ("orientadorId") REFERENCES "usuarios" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "tccs_coorientadorId_fkey" FOREIGN KEY ("coorientadorId") REFERENCES "usuarios" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "solicitacoes_orientacao" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tccId" TEXT NOT NULL,
    "mensagem" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "parecer" TEXT,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondidoEm" DATETIME,
    CONSTRAINT "solicitacoes_orientacao_tccId_fkey" FOREIGN KEY ("tccId") REFERENCES "tccs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "documentos_tcc" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tccId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "nomeArquivo" TEXT NOT NULL,
    "caminho" TEXT NOT NULL,
    "tamanho" INTEGER NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "documentos_tcc_tccId_fkey" FOREIGN KEY ("tccId") REFERENCES "tccs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "tccs_alunoId_semestre_key" ON "tccs"("alunoId", "semestre");
