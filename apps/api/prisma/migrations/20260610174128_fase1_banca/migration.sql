-- AlterTable
ALTER TABLE "tccs" ADD COLUMN "nf" REAL;
ALTER TABLE "tccs" ADD COLUMN "nf1" REAL;
ALTER TABLE "tccs" ADD COLUMN "nf2" REAL;
ALTER TABLE "tccs" ADD COLUMN "resultado" TEXT;

-- CreateTable
CREATE TABLE "bancas" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tccId" TEXT NOT NULL,
    "fase" TEXT NOT NULL,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bancas_tccId_fkey" FOREIGN KEY ("tccId") REFERENCES "tccs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "membros_banca" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bancaId" TEXT NOT NULL,
    "avaliadorId" TEXT NOT NULL,
    "nota" REAL,
    "parecer" TEXT,
    "avaliadoEm" DATETIME,
    CONSTRAINT "membros_banca_bancaId_fkey" FOREIGN KEY ("bancaId") REFERENCES "bancas" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "membros_banca_avaliadorId_fkey" FOREIGN KEY ("avaliadorId") REFERENCES "usuarios" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "bancas_tccId_fase_key" ON "bancas"("tccId", "fase");

-- CreateIndex
CREATE UNIQUE INDEX "membros_banca_bancaId_avaliadorId_key" ON "membros_banca"("bancaId", "avaliadorId");
