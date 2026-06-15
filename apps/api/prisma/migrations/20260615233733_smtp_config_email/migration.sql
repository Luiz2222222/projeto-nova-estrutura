-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_configuracao_email" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'global',
    "recuperacaoSenhaAtiva" BOOLEAN NOT NULL DEFAULT true,
    "fluxoTccAtivo" BOOLEAN NOT NULL DEFAULT true,
    "smtpHost" TEXT,
    "smtpPort" INTEGER,
    "smtpSecure" BOOLEAN NOT NULL DEFAULT false,
    "smtpUsuario" TEXT,
    "smtpRemetente" TEXT,
    "smtpSenhaCriptografada" TEXT,
    "atualizadoEm" DATETIME NOT NULL,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_configuracao_email" ("atualizadoEm", "criadoEm", "fluxoTccAtivo", "id", "recuperacaoSenhaAtiva") SELECT "atualizadoEm", "criadoEm", "fluxoTccAtivo", "id", "recuperacaoSenhaAtiva" FROM "configuracao_email";
DROP TABLE "configuracao_email";
ALTER TABLE "new_configuracao_email" RENAME TO "configuracao_email";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
