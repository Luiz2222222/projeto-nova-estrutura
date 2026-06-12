-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_documentos_referencia" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "titulo" TEXT NOT NULL,
    "nomeArquivo" TEXT NOT NULL,
    "caminho" TEXT NOT NULL,
    "tamanho" INTEGER NOT NULL,
    "visivelPara" TEXT NOT NULL DEFAULT 'ALUNO,PROFESSOR,AVALIADOR',
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_documentos_referencia" ("caminho", "criadoEm", "id", "nomeArquivo", "tamanho", "titulo") SELECT "caminho", "criadoEm", "id", "nomeArquivo", "tamanho", "titulo" FROM "documentos_referencia";
DROP TABLE "documentos_referencia";
ALTER TABLE "new_documentos_referencia" RENAME TO "documentos_referencia";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
