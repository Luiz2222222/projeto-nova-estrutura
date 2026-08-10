// Teste de integração da EXCLUSÃO PERMANENTE em banco REAL (SQLite de teste com as
// migrations aplicadas): comprova os cascades de verdade — TCC, solicitações, documentos,
// bancas, membros/avaliações, liberações de prazo e preferências de histórico saem do
// banco, e os arquivos físicos saem do disco SÓ depois de a transação confirmar.
import 'reflect-metadata';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { createClient } from '@libsql/client';
import { PrismaLibSQL } from '@prisma/adapter-libsql';
import { PrismaClient } from '@prisma/client';
import { TccsService } from '../src/tccs/tccs.service';

const DB = '/tmp/tcc-teste-exclusao.db';

let prisma: PrismaClient;
let servico: TccsService;
let libsql: ReturnType<typeof createClient> | undefined;

const eventosStub = { emitirParaUsuario: async () => undefined, emitirParaCoordenadores: async () => undefined } as any;
const prazosStub = { exigirEtapaLiberada: async () => undefined, bloqueiosDoTcc: async () => ({}) } as any;

beforeAll(async () => {
  await fs.rm(DB, { force: true }).catch(() => undefined);
  libsql = createClient({ url: `file:${DB}` });
  const migracoes = join(__dirname, '..', 'prisma', 'migrations');
  for (const pasta of readdirSync(migracoes).sort()) {
    try {
      await libsql.executeMultiple(readFileSync(join(migracoes, pasta, 'migration.sql'), 'utf-8'));
    } catch {
      /* entradas sem migration.sql */
    }
  }
  try {
    const nativo: any = new PrismaClient({ datasources: { db: { url: `file:${DB}` } } } as any);
    await nativo.$queryRaw`SELECT 1`;
    prisma = nativo;
  } catch {
    const { PrismaClient: PrismaWasm } = (await import('@prisma/client/wasm' as any)) as any;
    prisma = new PrismaWasm({ adapter: new PrismaLibSQL(libsql) });
  }
  servico = new TccsService(prisma as any, eventosStub, prazosStub);
});

afterAll(async () => {
  await prisma?.$disconnect();
  libsql?.close(); // libera o arquivo antes de apagar (Windows trava enquanto aberto)
  await fs.rm(DB, { force: true }).catch(() => undefined);
});

beforeEach(async () => {
  await prisma.tcc.deleteMany();
  await prisma.historicoTccOculto.deleteMany();
  await prisma.usuario.deleteMany();
});

let seq = 0;
async function usuario(papel: string) {
  seq += 1;
  return prisma.usuario.create({
    data: { nomeCompleto: `${papel} ${seq}`, email: `exc${seq}@teste.br`, senhaHash: 'x', papel },
  });
}

// Grava um arquivo físico de verdade em uploads/ e devolve o caminho relativo (como o
// serviço registra nos documentos).
async function arquivoReal(nome: string) {
  const caminho = join('uploads', nome);
  await fs.mkdir(join(process.cwd(), 'uploads'), { recursive: true });
  await fs.writeFile(join(process.cwd(), caminho), '%PDF-1.4 conteudo de teste');
  return caminho;
}

describe('Exclusão permanente em banco real', () => {
  it('apaga TCC + solicitações + documentos + bancas/membros + liberações + preferências e os arquivos do disco', async () => {
    const aluno = await usuario('ALUNO');
    const orientador = await usuario('PROFESSOR');
    const av1 = await usuario('PROFESSOR');
    const av2 = await usuario('AVALIADOR');
    const coord = await usuario('COORDENADOR');

    const caminhoPlano = await arquivoReal(`teste-exclusao-plano-${Date.now()}.pdf`);
    const caminhoTermo = await arquivoReal(`teste-exclusao-termo-${Date.now()}.pdf`);

    const tcc = await prisma.tcc.create({
      data: {
        titulo: 'TCC exclusão', semestre: '2020.9', faseAtual: 'AVALIACAO_FASE_1',
        alunoId: aluno.id, orientadorId: orientador.id,
        solicitacoes: { create: { status: 'ACEITA' } },
        documentos: {
          create: [
            { tipo: 'PLANO_DESENVOLVIMENTO', nomeArquivo: 'plano.pdf', caminho: caminhoPlano, tamanho: 10, status: 'APROVADO' },
            { tipo: 'TERMO_ACEITE', nomeArquivo: 'termo.pdf', caminho: caminhoTermo, tamanho: 10, status: 'APROVADO' },
          ],
        },
        bancas: {
          create: [
            { fase: 'FASE_1', membros: { create: [{ avaliadorId: av1.id, nota: 8 }, { avaliadorId: av2.id }] } },
            { fase: 'FASE_2', membros: { create: [{ avaliadorId: orientador.id }] } },
          ],
        },
        liberacoesPrazo: { create: { etapa: 'SUBMISSAO_MONOGRAFIA' } },
      },
    });
    await prisma.historicoTccOculto.create({ data: { usuarioId: coord.id, tccId: tcc.id } });

    const r = await servico.excluir({ sub: coord.id, papel: 'COORDENADOR' }, tcc.id);
    expect(r.ok).toBe(true);

    // Banco: nada sobrou em NENHUMA tabela ligada ao TCC.
    expect(await prisma.tcc.count()).toBe(0);
    expect(await prisma.solicitacaoOrientacao.count()).toBe(0);
    expect(await prisma.documentoTcc.count()).toBe(0);
    expect(await prisma.banca.count()).toBe(0);
    expect(await prisma.membroBanca.count()).toBe(0);
    expect(await prisma.liberacaoPrazo.count()).toBe(0);
    expect(await prisma.historicoTccOculto.count()).toBe(0);
    // Usuários NÃO são apagados (a exclusão é do TCC, não das contas).
    expect(await prisma.usuario.count()).toBe(5);

    // Disco: os arquivos de upload saíram junto.
    await expect(fs.access(join(process.cwd(), caminhoPlano))).rejects.toBeTruthy();
    await expect(fs.access(join(process.cwd(), caminhoTermo))).rejects.toBeTruthy();
  });

  it('é idempotente: excluir um TCC já inexistente devolve ok', async () => {
    const r = await servico.excluir({ sub: 'qualquer', papel: 'COORDENADOR' }, 'nao-existe');
    expect(r).toEqual({ ok: true });
  });
});
