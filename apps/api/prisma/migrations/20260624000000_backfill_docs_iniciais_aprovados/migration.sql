-- Backfill: documentos iniciais (Plano/Termo) que ficaram "Em análise" mesmo após a
-- abertura ter sido aprovada (ou o TCC já ter avançado/concluído). Marca como APROVADO
-- e limpa o parecer. Não toca em MONOGRAFIA/VERSAO_FINAL/AVALIACAO_BANCA nem em SUBSTITUIDA.
UPDATE "documentos_tcc"
SET "status" = 'APROVADO',
    "parecer" = NULL
WHERE "tipo" IN ('PLANO_DESENVOLVIMENTO', 'TERMO_ACEITE')
  AND "status" IN ('PENDENTE', 'EM_ANALISE')
  AND "tccId" IN (
    SELECT "id"
    FROM "tccs"
    WHERE "faseAtual" <> 'INICIALIZACAO'
       OR "resultado" IS NOT NULL
       OR "id" IN (
         SELECT "tccId"
         FROM "solicitacoes_orientacao"
         WHERE "status" = 'ACEITA'
       )
  );
