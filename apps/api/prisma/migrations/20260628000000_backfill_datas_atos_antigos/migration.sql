-- Backfill das datas reais de atos para TCCs ANTIGOS (criados antes dos campos
-- monografiaAprovadaEm/fase1ValidadaEm/fase2ValidadaEm/versaoFinalValidadaEm/concluidoEm).
-- Fonte confiável: notificações já emitidas para o ALUNO no momento de cada ato.
-- Regras: só preenche onde está NULL (não sobrescreve), casa por usuarioId = alunoId e
-- pela mensagem contendo o título do TCC (desambigua TCCs do mesmo aluno). Não inventa
-- data: onde não há notificação correspondente, permanece NULL. Idempotente.

-- Monografia aprovada  <- evento "aluno_monografia_aprovada"
UPDATE "tccs" SET "monografiaAprovadaEm" = (
  SELECT n."criadoEm" FROM "notificacoes" n
  WHERE n."usuarioId" = "tccs"."alunoId"
    AND n."evento" = 'aluno_monografia_aprovada'
    AND n."mensagem" LIKE '%' || "tccs"."titulo" || '%'
  ORDER BY n."criadoEm" ASC LIMIT 1
)
WHERE "monografiaAprovadaEm" IS NULL;

-- Validação da Fase I  <- evento "aluno_resultado_fase1"
UPDATE "tccs" SET "fase1ValidadaEm" = (
  SELECT n."criadoEm" FROM "notificacoes" n
  WHERE n."usuarioId" = "tccs"."alunoId"
    AND n."evento" = 'aluno_resultado_fase1'
    AND n."mensagem" LIKE '%' || "tccs"."titulo" || '%'
  ORDER BY n."criadoEm" ASC LIMIT 1
)
WHERE "fase1ValidadaEm" IS NULL;

-- Validação da Fase II  <- evento "aluno_resultado_fase2"
UPDATE "tccs" SET "fase2ValidadaEm" = (
  SELECT n."criadoEm" FROM "notificacoes" n
  WHERE n."usuarioId" = "tccs"."alunoId"
    AND n."evento" = 'aluno_resultado_fase2'
    AND n."mensagem" LIKE '%' || "tccs"."titulo" || '%'
  ORDER BY n."criadoEm" ASC LIMIT 1
)
WHERE "fase2ValidadaEm" IS NULL;

-- Validação do orientador (versão final)  <- evento "aluno_tcc_concluido" (só TCC concluído)
UPDATE "tccs" SET "versaoFinalValidadaEm" = (
  SELECT n."criadoEm" FROM "notificacoes" n
  WHERE n."usuarioId" = "tccs"."alunoId"
    AND n."evento" = 'aluno_tcc_concluido'
    AND n."mensagem" LIKE '%' || "tccs"."titulo" || '%'
  ORDER BY n."criadoEm" ASC LIMIT 1
)
WHERE "versaoFinalValidadaEm" IS NULL AND "faseAtual" = 'CONCLUIDO';

-- Concluído  <- evento "aluno_tcc_concluido" (só TCC concluído)
UPDATE "tccs" SET "concluidoEm" = (
  SELECT n."criadoEm" FROM "notificacoes" n
  WHERE n."usuarioId" = "tccs"."alunoId"
    AND n."evento" = 'aluno_tcc_concluido'
    AND n."mensagem" LIKE '%' || "tccs"."titulo" || '%'
  ORDER BY n."criadoEm" ASC LIMIT 1
)
WHERE "concluidoEm" IS NULL AND "faseAtual" = 'CONCLUIDO';
