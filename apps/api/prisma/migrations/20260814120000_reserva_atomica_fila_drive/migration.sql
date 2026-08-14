-- Reserva atômica dos itens da fila do Drive.
--
-- Duas colunas novas e nulas: seguras em banco com dados (nada a preencher). Itens antigos
-- ficam com reservaId NULL, que é exatamente o estado "livre para ser reservado".

-- AlterTable
ALTER TABLE "sync_drive" ADD COLUMN "reservaId" TEXT;
ALTER TABLE "sync_drive" ADD COLUMN "reservadoEm" DATETIME;
