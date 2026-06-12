-- CreateTable
CREATE TABLE "comentarios_aviso" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "avisoId" TEXT NOT NULL,
    "autorId" TEXT NOT NULL,
    "autorNome" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "comentarios_aviso_avisoId_fkey" FOREIGN KEY ("avisoId") REFERENCES "avisos" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_avisos" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "titulo" TEXT NOT NULL,
    "conteudo" TEXT NOT NULL,
    "cor" TEXT NOT NULL DEFAULT '',
    "destinatarios" TEXT NOT NULL DEFAULT 'ALUNO,PROFESSOR,AVALIADOR,COORDENADOR',
    "fixado" BOOLEAN NOT NULL DEFAULT false,
    "autorId" TEXT,
    "autorNome" TEXT,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_avisos" ("autorNome", "conteudo", "criadoEm", "id", "titulo") SELECT "autorNome", "conteudo", "criadoEm", "id", "titulo" FROM "avisos";
DROP TABLE "avisos";
ALTER TABLE "new_avisos" RENAME TO "avisos";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
