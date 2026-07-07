-- Versão do token de sessão do usuário. Incrementada a cada troca/redefinição de senha
-- (própria ou reset pelo coordenador): tokens antigos carregam a versão anterior e passam
-- a ser rejeitados pelo guard, derrubando imediatamente todas as sessões abertas.
ALTER TABLE "usuarios" ADD COLUMN "versaoToken" INTEGER NOT NULL DEFAULT 0;
