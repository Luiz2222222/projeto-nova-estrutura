-- AlterTable
ALTER TABLE "membros_banca" ADD COLUMN "notaClareza" REAL;
ALTER TABLE "membros_banca" ADD COLUMN "notaCoerencia" REAL;
ALTER TABLE "membros_banca" ADD COLUMN "notaConclusoes" REAL;
ALTER TABLE "membros_banca" ADD COLUMN "notaDesenvolvimento" REAL;
ALTER TABLE "membros_banca" ADD COLUMN "notaDominio" REAL;
ALTER TABLE "membros_banca" ADD COLUMN "notaIntroducao" REAL;
ALTER TABLE "membros_banca" ADD COLUMN "notaObservancia" REAL;
ALTER TABLE "membros_banca" ADD COLUMN "notaQualidade" REAL;
ALTER TABLE "membros_banca" ADD COLUMN "notaResumo" REAL;
ALTER TABLE "membros_banca" ADD COLUMN "notaRevisao" REAL;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_calendarios" (
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
    "pesoResumo" REAL NOT NULL DEFAULT 1.0,
    "pesoIntroducao" REAL NOT NULL DEFAULT 2.0,
    "pesoRevisao" REAL NOT NULL DEFAULT 2.0,
    "pesoDesenvolvimento" REAL NOT NULL DEFAULT 3.5,
    "pesoConclusoes" REAL NOT NULL DEFAULT 1.5,
    "pesoCoerencia" REAL NOT NULL DEFAULT 2.0,
    "pesoQualidade" REAL NOT NULL DEFAULT 2.0,
    "pesoDominio" REAL NOT NULL DEFAULT 2.5,
    "pesoClareza" REAL NOT NULL DEFAULT 2.5,
    "pesoObservancia" REAL NOT NULL DEFAULT 1.0,
    "atualizadoEm" DATETIME NOT NULL
);
INSERT INTO "new_calendarios" ("ajustesFinais", "apresentacaoFase2", "atualizadoEm", "avaliacaoContinuidade", "avaliacaoFase1", "envioDocumentos", "id", "preparacaoBancasFase1", "preparacaoBancasFase2", "reuniaoAlunos", "semestre", "submissaoMonografia") SELECT "ajustesFinais", "apresentacaoFase2", "atualizadoEm", "avaliacaoContinuidade", "avaliacaoFase1", "envioDocumentos", "id", "preparacaoBancasFase1", "preparacaoBancasFase2", "reuniaoAlunos", "semestre", "submissaoMonografia" FROM "calendarios";
DROP TABLE "calendarios";
ALTER TABLE "new_calendarios" RENAME TO "calendarios";
CREATE UNIQUE INDEX "calendarios_semestre_key" ON "calendarios"("semestre");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
