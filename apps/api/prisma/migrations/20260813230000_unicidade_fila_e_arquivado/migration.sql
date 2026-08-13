-- Unicidade da fila de sincronização e do histórico arquivado.
--
-- Migration SEGURA: bancos que já rodaram a versão anterior podem ter linhas duplicadas
-- (a fila antiga usava create, não upsert). Removemos as duplicatas ANTES de criar os
-- índices únicos, mantendo sempre a linha mais recente — se criássemos o índice direto,
-- a migration falharia no meio e deixaria o banco inconsistente.

-- Fila: mantém, para cada (tccId, chave), a linha de atualização mais recente.
DELETE FROM "sync_drive"
WHERE "id" NOT IN (
  SELECT "id" FROM (
    SELECT "id",
           ROW_NUMBER() OVER (PARTITION BY "tccId", "chave" ORDER BY "atualizadoEm" DESC, "id" DESC) AS ordem
    FROM "sync_drive"
  )
  WHERE ordem = 1
);

-- Histórico arquivado: mantém o snapshot mais recente de cada TCC original.
DELETE FROM "tccs_arquivados"
WHERE "id" NOT IN (
  SELECT "id" FROM (
    SELECT "id",
           ROW_NUMBER() OVER (PARTITION BY "tccIdOriginal" ORDER BY "arquivadoEm" DESC, "id" DESC) AS ordem
    FROM "tccs_arquivados"
  )
  WHERE ordem = 1
);

-- CreateIndex
CREATE UNIQUE INDEX "sync_drive_tccId_chave_key" ON "sync_drive"("tccId", "chave");

-- CreateIndex
CREATE UNIQUE INDEX "tccs_arquivados_tccIdOriginal_key" ON "tccs_arquivados"("tccIdOriginal");
