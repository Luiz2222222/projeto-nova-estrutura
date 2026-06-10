-- CreateTable
CREATE TABLE "usuarios" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nomeCompleto" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senhaHash" TEXT NOT NULL,
    "papel" TEXT NOT NULL,
    "curso" TEXT,
    "tratamento" TEXT,
    "afiliacao" TEXT,
    "disponivelParaOrientar" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "codigos_cadastro" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "papel" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "atualizadoEm" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE UNIQUE INDEX "codigos_cadastro_papel_key" ON "codigos_cadastro"("papel");
