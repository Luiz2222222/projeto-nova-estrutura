// Correção pontual (banco de dev): re-decodifica nomeArquivo que foi gravado quebrado
// pelo bug de encoding do upload (multer entregava o nome em latin1, salvo como UTF-8).
// Reinterpretar a string atual como latin1 e ler como UTF-8 recupera os acentos.
// Idempotente: só toca em registros que ainda contêm o padrão de mojibake (Ã/Â).
//
// Uso (a partir de apps/api):  node --env-file=.env scripts/corrige-nomes-arquivo.mjs
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const corrigir = (s) => Buffer.from(s, 'latin1').toString('utf8');
const quebrado = (s) => typeof s === 'string' && /[ÃÂ]/.test(s);

async function corrigirModelo(nome, registros, atualizar) {
  let n = 0;
  for (const r of registros) {
    if (quebrado(r.nomeArquivo)) {
      await atualizar(r.id, corrigir(r.nomeArquivo));
      n++;
    }
  }
  console.log(`${nome}: ${n} corrigido(s).`);
  return n;
}

async function main() {
  let total = 0;
  total += await corrigirModelo(
    'DocumentoTcc',
    await prisma.documentoTcc.findMany({ select: { id: true, nomeArquivo: true } }),
    (id, nomeArquivo) => prisma.documentoTcc.update({ where: { id }, data: { nomeArquivo } }),
  );
  total += await corrigirModelo(
    'DocumentoReferencia',
    await prisma.documentoReferencia.findMany({ select: { id: true, nomeArquivo: true } }),
    (id, nomeArquivo) => prisma.documentoReferencia.update({ where: { id }, data: { nomeArquivo } }),
  );
  console.log(`Total: ${total} registro(s) corrigido(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
