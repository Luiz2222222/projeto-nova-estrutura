-- Trava persistente de encerramento por período.
--
-- Enquanto houver uma linha ENCERRANDO, criações e alterações de TCC/documento daquele
-- semestre são recusadas (409). A unicidade de `semestre` é o que torna o início do
-- encerramento atômico: duas tentativas simultâneas → só uma cria a linha.
--
-- Tabela nova: nada existente é alterado.

-- CreateTable
CREATE TABLE "periodos_encerramento" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "semestre" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ENCERRANDO',
    "iniciadoPorId" TEXT,
    "iniciadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluidoEm" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "periodos_encerramento_semestre_key" ON "periodos_encerramento"("semestre");
