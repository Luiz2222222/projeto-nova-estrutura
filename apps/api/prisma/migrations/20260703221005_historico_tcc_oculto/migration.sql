-- CreateTable
CREATE TABLE "historico_tcc_oculto" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "usuarioId" TEXT NOT NULL,
    "tccId" TEXT NOT NULL,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "historico_tcc_oculto_usuarioId_tccId_key" ON "historico_tcc_oculto"("usuarioId", "tccId");
