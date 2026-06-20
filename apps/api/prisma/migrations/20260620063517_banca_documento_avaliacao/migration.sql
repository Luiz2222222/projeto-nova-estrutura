-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_bancas" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tccId" TEXT NOT NULL,
    "fase" TEXT NOT NULL,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "documentoAvaliacaoId" TEXT,
    CONSTRAINT "bancas_tccId_fkey" FOREIGN KEY ("tccId") REFERENCES "tccs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "bancas_documentoAvaliacaoId_fkey" FOREIGN KEY ("documentoAvaliacaoId") REFERENCES "documentos_tcc" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_bancas" ("criadoEm", "fase", "id", "tccId") SELECT "criadoEm", "fase", "id", "tccId" FROM "bancas";
DROP TABLE "bancas";
ALTER TABLE "new_bancas" RENAME TO "bancas";
CREATE UNIQUE INDEX "bancas_documentoAvaliacaoId_key" ON "bancas"("documentoAvaliacaoId");
CREATE UNIQUE INDEX "bancas_tccId_fase_key" ON "bancas"("tccId", "fase");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
