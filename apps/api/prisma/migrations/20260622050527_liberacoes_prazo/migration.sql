-- CreateTable
CREATE TABLE "liberacoes_prazo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "etapa" TEXT NOT NULL,
    "tccId" TEXT,
    "alunoId" TEXT,
    "semestre" TEXT,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "liberacoes_prazo_tccId_fkey" FOREIGN KEY ("tccId") REFERENCES "tccs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "liberacoes_prazo_alunoId_fkey" FOREIGN KEY ("alunoId") REFERENCES "usuarios" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "liberacoes_prazo_tccId_etapa_key" ON "liberacoes_prazo"("tccId", "etapa");

-- CreateIndex
CREATE UNIQUE INDEX "liberacoes_prazo_alunoId_semestre_etapa_key" ON "liberacoes_prazo"("alunoId", "semestre", "etapa");
