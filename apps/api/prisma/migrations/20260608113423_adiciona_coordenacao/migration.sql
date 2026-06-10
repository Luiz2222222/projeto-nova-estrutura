-- CreateTable
CREATE TABLE "calendarios" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "semestre" TEXT NOT NULL,
    "reuniaoAlunos" DATETIME,
    "envioDocumentos" DATETIME,
    "avaliacaoContinuidade" DATETIME,
    "submissaoMonografia" DATETIME,
    "preparacaoBancasFase1" DATETIME,
    "avaliacaoFase1" DATETIME,
    "preparacaoBancasFase2" DATETIME,
    "apresentacaoFase2" DATETIME,
    "ajustesFinais" DATETIME,
    "atualizadoEm" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "documentos_referencia" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "titulo" TEXT NOT NULL,
    "nomeArquivo" TEXT NOT NULL,
    "caminho" TEXT NOT NULL,
    "tamanho" INTEGER NOT NULL,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "avisos" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "titulo" TEXT NOT NULL,
    "conteudo" TEXT NOT NULL,
    "autorNome" TEXT,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "calendarios_semestre_key" ON "calendarios"("semestre");
