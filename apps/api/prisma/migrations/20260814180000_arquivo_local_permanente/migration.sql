-- Arquivo LOCAL permanente do encerramento de período.
--
-- Passa a ser a garantia do encerramento: os documentos são copiados para uma área própria
-- na VPS e validados (tamanho + sha256) ANTES de qualquer exclusão. O Google Drive vira
-- cópia adicional e opcional.
--
-- Só adiciona: 2 colunas nulas e 1 tabela nova. Nada existente é alterado ou removido.

-- AlterTable
ALTER TABLE "tccs_arquivados" ADD COLUMN "arquivadoLocalEm" DATETIME;
ALTER TABLE "tccs_arquivados" ADD COLUMN "pastaArquivo" TEXT;

-- CreateTable
CREATE TABLE "documentos_arquivados" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "arquivadoId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "nomeArquivo" TEXT NOT NULL,
    "versao" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "caminho" TEXT NOT NULL,
    "tamanho" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "ehFinal" BOOLEAN NOT NULL DEFAULT false,
    "driveId" TEXT,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "documentos_arquivados_arquivadoId_fkey" FOREIGN KEY ("arquivadoId") REFERENCES "tccs_arquivados" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "documentos_arquivados_arquivadoId_tipo_versao_key" ON "documentos_arquivados"("arquivadoId", "tipo", "versao");
