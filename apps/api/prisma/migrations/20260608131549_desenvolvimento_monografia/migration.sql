-- AlterTable
ALTER TABLE "documentos_tcc" ADD COLUMN "parecer" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_tccs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "titulo" TEXT NOT NULL,
    "semestre" TEXT NOT NULL,
    "faseAtual" TEXT NOT NULL DEFAULT 'INICIALIZACAO',
    "monografiaAprovada" BOOLEAN NOT NULL DEFAULT false,
    "continuidadeConfirmada" BOOLEAN NOT NULL DEFAULT false,
    "parecerContinuidade" TEXT,
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
INSERT INTO "new_tccs" ("alunoId", "atualizadoEm", "coorientadorAfiliacao", "coorientadorId", "coorientadorLattes", "coorientadorNome", "coorientadorTitulacao", "criadoEm", "faseAtual", "id", "orientadorId", "semestre", "titulo") SELECT "alunoId", "atualizadoEm", "coorientadorAfiliacao", "coorientadorId", "coorientadorLattes", "coorientadorNome", "coorientadorTitulacao", "criadoEm", "faseAtual", "id", "orientadorId", "semestre", "titulo" FROM "tccs";
DROP TABLE "tccs";
ALTER TABLE "new_tccs" RENAME TO "tccs";
CREATE UNIQUE INDEX "tccs_alunoId_semestre_key" ON "tccs"("alunoId", "semestre");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
