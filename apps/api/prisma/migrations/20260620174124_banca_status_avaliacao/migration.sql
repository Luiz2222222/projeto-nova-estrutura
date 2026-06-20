-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_membros_banca" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bancaId" TEXT NOT NULL,
    "avaliadorId" TEXT NOT NULL,
    "nota" REAL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "notaResumo" REAL,
    "notaIntroducao" REAL,
    "notaRevisao" REAL,
    "notaDesenvolvimento" REAL,
    "notaConclusoes" REAL,
    "notaCoerencia" REAL,
    "notaQualidade" REAL,
    "notaDominio" REAL,
    "notaClareza" REAL,
    "notaObservancia" REAL,
    "parecer" TEXT,
    "avaliadoEm" DATETIME,
    CONSTRAINT "membros_banca_bancaId_fkey" FOREIGN KEY ("bancaId") REFERENCES "bancas" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "membros_banca_avaliadorId_fkey" FOREIGN KEY ("avaliadorId") REFERENCES "usuarios" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_membros_banca" ("avaliadoEm", "avaliadorId", "bancaId", "id", "nota", "notaClareza", "notaCoerencia", "notaConclusoes", "notaDesenvolvimento", "notaDominio", "notaIntroducao", "notaObservancia", "notaQualidade", "notaResumo", "notaRevisao", "parecer") SELECT "avaliadoEm", "avaliadorId", "bancaId", "id", "nota", "notaClareza", "notaCoerencia", "notaConclusoes", "notaDesenvolvimento", "notaDominio", "notaIntroducao", "notaObservancia", "notaQualidade", "notaResumo", "notaRevisao", "parecer" FROM "membros_banca";
DROP TABLE "membros_banca";
ALTER TABLE "new_membros_banca" RENAME TO "membros_banca";
CREATE UNIQUE INDEX "membros_banca_bancaId_avaliadorId_key" ON "membros_banca"("bancaId", "avaliadorId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Status inicial dos dados já existentes (a coluna nasce 'PENDENTE' por default):
--   nota preenchida → 'ENVIADO'; e, se a fase já passou da avaliação (validada/adiante)
--   → 'CONCLUIDO' (trava). Linhas sem nota permanecem 'PENDENTE'.
UPDATE "membros_banca" SET "status" = 'ENVIADO' WHERE "nota" IS NOT NULL;
UPDATE "membros_banca" SET "status" = 'CONCLUIDO'
WHERE "nota" IS NOT NULL AND "bancaId" IN (
  SELECT b."id" FROM "bancas" b JOIN "tccs" t ON t."id" = b."tccId"
  WHERE (b."fase" = 'FASE_1' AND t."faseAtual" <> 'AVALIACAO_FASE_1')
     OR (b."fase" = 'FASE_2' AND t."faseAtual" <> 'AVALIACAO_FASE_2')
);
