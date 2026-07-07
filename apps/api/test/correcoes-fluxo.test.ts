// Testes de integração das correções de lógica do fluxo do TCC.
// Rodam contra um SQLite REAL (migrations aplicadas), com os services de verdade e a
// engine WASM do Prisma (driver adapter libsql) — sem depender das engines nativas.
//
// Cobrem:
//  1. Junção "E" (monografia aprovada + continuidade confirmada) atômica, nas duas ordens
//     e sob concorrência — o TCC nunca fica preso em DESENVOLVIMENTO com as duas flags.
//  2. validar() numa transação única — inclusive quando a banca da Fase II já existe
//     (cenário que antes quebrava e deixava membros CONCLUIDO com a fase presa).
//  3. Notas liberadas em reprovação terminal (aluno reprovado na Fase I vê a NF1).
import 'reflect-metadata';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { createClient } from '@libsql/client';
import { PrismaLibSQL } from '@prisma/adapter-libsql';
import { PrismaClient } from '@prisma/client';
import { TccsService } from '../src/tccs/tccs.service';
import { BancasService } from '../src/bancas/bancas.service';
import { PrazosService } from '../src/prazos/prazos.service';
import { sanitizarNotasTcc } from '../src/comum/sanitizar-notas';

const DB = '/tmp/tcc-teste-correcoes.db';

let prisma: PrismaClient;
let tccs: TccsService;
let bancas: BancasService;
// Mantido em escopo de módulo para ser FECHADO no afterAll — senão o arquivo SQLite fica
// travado e o unlink de limpeza falha com EBUSY no Windows.
let libsql: ReturnType<typeof createClient> | undefined;

// Eventos (notificações/e-mail) viram no-op nos testes.
const eventosStub = {
  emitirParaUsuario: async () => undefined,
  emitirParaCoordenadores: async () => undefined,
} as any;

beforeAll(async () => {
  await fs.rm(DB, { force: true });
  // Aplica as migrations reais, em ordem, no banco de teste.
  libsql = createClient({ url: `file:${DB}` });
  const migracoes = join(__dirname, '..', 'prisma', 'migrations');
  for (const pasta of readdirSync(migracoes).sort()) {
    const sql = join(migracoes, pasta, 'migration.sql');
    try {
      await libsql.executeMultiple(readFileSync(sql, 'utf-8'));
    } catch {
      /* pastas sem migration.sql (ex.: migration_lock.toml na raiz) */
    }
  }
  // Engine nativa quando disponível (máquina de dev normal); senão, a engine WASM que já
  // vem no pacote @prisma/client, via driver adapter (ambientes sem download de binários).
  try {
    const nativo: any = new PrismaClient({ datasources: { db: { url: `file:${DB}` } } } as any);
    await nativo.$queryRaw`SELECT 1`;
    prisma = nativo;
  } catch {
    const { PrismaClient: PrismaWasm } = (await import('@prisma/client/wasm' as any)) as any;
    prisma = new PrismaWasm({ adapter: new PrismaLibSQL(libsql) });
  }
  const prazos = new PrazosService(prisma as any);
  tccs = new TccsService(prisma as any, eventosStub, prazos);
  bancas = new BancasService(prisma as any, eventosStub, prazos);
});

afterAll(async () => {
  await prisma?.$disconnect();
  libsql?.close(); // libera o arquivo antes de apagar (Windows trava enquanto aberto)
  await fs.rm(DB, { force: true }).catch(() => undefined); // limpeza best-effort (ignora lock)
});

beforeEach(async () => {
  // Limpa tudo entre testes (ordem respeita as FKs; cascades cuidam do resto).
  await prisma.tcc.deleteMany();
  await prisma.usuario.deleteMany();
  await prisma.configuracaoSistema.deleteMany();
});

let seq = 0;
async function usuario(papel: string) {
  seq += 1;
  return prisma.usuario.create({
    data: { nomeCompleto: `${papel} ${seq}`, email: `u${seq}@teste.br`, senhaHash: 'x', papel },
  });
}

// TCC em DESENVOLVIMENTO com aluno + orientador (e monografia PENDENTE opcional).
async function tccEmDesenvolvimento(opts: { comMonografiaPendente?: boolean } = {}) {
  const aluno = await usuario('ALUNO');
  const orientador = await usuario('PROFESSOR');
  const tcc = await prisma.tcc.create({
    data: {
      titulo: 'TCC de teste',
      semestre: '2026.1',
      faseAtual: 'DESENVOLVIMENTO',
      alunoId: aluno.id,
      orientadorId: orientador.id,
      ...(opts.comMonografiaPendente
        ? { documentos: { create: { tipo: 'MONOGRAFIA', nomeArquivo: 'm.docx', caminho: 'uploads/m.docx', tamanho: 1, status: 'PENDENTE' } } }
        : {}),
    },
  });
  return { tcc, aluno, orientador };
}

describe('Correção 1 — junção "E" atômica (monografia + continuidade)', () => {
  it('avança para FORMACAO_BANCA_FASE_1 quando a monografia é aprovada por último', async () => {
    const { tcc, orientador } = await tccEmDesenvolvimento({ comMonografiaPendente: true });
    await tccs.avaliarContinuidade(orientador.id, tcc.id, 'CONFIRMAR');
    let atual = await prisma.tcc.findUniqueOrThrow({ where: { id: tcc.id } });
    expect(atual.faseAtual).toBe('DESENVOLVIMENTO'); // só uma trilha concluída: não avança

    await tccs.avaliarMonografia(orientador.id, tcc.id, 'APROVAR');
    atual = await prisma.tcc.findUniqueOrThrow({ where: { id: tcc.id } });
    expect(atual.faseAtual).toBe('FORMACAO_BANCA_FASE_1');
    expect(atual.monografiaAprovada).toBe(true);
    expect(atual.continuidadeConfirmada).toBe(true);
  });

  it('avança quando a continuidade é confirmada por último (ordem inversa)', async () => {
    const { tcc, orientador } = await tccEmDesenvolvimento({ comMonografiaPendente: true });
    await tccs.avaliarMonografia(orientador.id, tcc.id, 'APROVAR');
    await tccs.avaliarContinuidade(orientador.id, tcc.id, 'CONFIRMAR');
    const atual = await prisma.tcc.findUniqueOrThrow({ where: { id: tcc.id } });
    expect(atual.faseAtual).toBe('FORMACAO_BANCA_FASE_1');
  });

  it('NUNCA deixa o TCC preso quando as duas decisões chegam ao mesmo tempo', async () => {
    const { tcc, orientador } = await tccEmDesenvolvimento({ comMonografiaPendente: true });
    // As duas ações concorrentes (era a corrida que travava o TCC em DESENVOLVIMENTO).
    const resultados = await Promise.allSettled([
      tccs.avaliarMonografia(orientador.id, tcc.id, 'APROVAR'),
      tccs.avaliarContinuidade(orientador.id, tcc.id, 'CONFIRMAR'),
    ]);
    const atual = await prisma.tcc.findUniqueOrThrow({ where: { id: tcc.id } });
    // Invariante do fluxograma: se as duas trilhas concluíram, a fase TEM que ter avançado.
    if (atual.monografiaAprovada && atual.continuidadeConfirmada) {
      expect(atual.faseAtual).toBe('FORMACAO_BANCA_FASE_1');
    }
    // E nenhuma das duas pode ter deixado o banco em estado sem saída: ou as duas
    // concluíram (fase avançou), ou a que falhou ainda pode ser refeita.
    expect(resultados.some((r) => r.status === 'fulfilled')).toBe(true);
  });
});

// Monta um TCC em VALIDACAO_FASE_1 com banca de 2 avaliadores APROVADO e notas dadas.
async function tccEmValidacaoFase1(notas: [number, number]) {
  const { tcc, aluno, orientador } = await tccEmDesenvolvimento();
  const av1 = await usuario('AVALIADOR');
  const av2 = await usuario('PROFESSOR');
  await prisma.tcc.update({
    where: { id: tcc.id },
    data: { faseAtual: 'VALIDACAO_FASE_1', monografiaAprovada: true, continuidadeConfirmada: true },
  });
  await prisma.banca.create({
    data: {
      tccId: tcc.id,
      fase: 'FASE_1',
      membros: {
        create: [
          { avaliadorId: av1.id, status: 'APROVADO', nota: notas[0] },
          { avaliadorId: av2.id, status: 'APROVADO', nota: notas[1] },
        ],
      },
    },
  });
  return { tcc, aluno, orientador, av1, av2 };
}

describe('Correção 2 — validar() em transação única', () => {
  it('Fase I aprovada: NF1 = média, avança e cria a banca da Fase II (orientador + 2)', async () => {
    const { tcc, orientador, av1, av2 } = await tccEmValidacaoFase1([8, 7]);
    const r: any = await bancas.validar(tcc.id);
    expect(r.nf1).toBeCloseTo(7.5);
    expect(r.aprovado).toBe(true);

    const atual = await prisma.tcc.findUniqueOrThrow({ where: { id: tcc.id } });
    expect(atual.faseAtual).toBe('AGENDAMENTO_DEFESA_FASE_2');
    expect(atual.nf1).toBeCloseTo(7.5);

    const f2 = await prisma.banca.findUniqueOrThrow({
      where: { tccId_fase: { tccId: tcc.id, fase: 'FASE_2' } },
      include: { membros: true },
    });
    const ids = f2.membros.map((m) => m.avaliadorId).sort();
    expect(ids).toEqual([orientador.id, av1.id, av2.id].sort());

    const f1 = await prisma.banca.findUniqueOrThrow({
      where: { tccId_fase: { tccId: tcc.id, fase: 'FASE_1' } },
      include: { membros: true },
    });
    expect(f1.membros.every((m) => m.status === 'CONCLUIDO')).toBe(true);
  });

  it('Fase I reprovada (NF1 < 6): vai para REPROVADO_FASE_1 com resultado REPROVADO', async () => {
    const { tcc } = await tccEmValidacaoFase1([5, 5]);
    const r: any = await bancas.validar(tcc.id);
    expect(r.aprovado).toBe(false);
    const atual = await prisma.tcc.findUniqueOrThrow({ where: { id: tcc.id } });
    expect(atual.faseAtual).toBe('REPROVADO_FASE_1');
    expect(atual.resultado).toBe('REPROVADO');
    expect(atual.nf1).toBeCloseTo(5);
  });

  it('NÃO trava quando a banca da Fase II já existe (cenário que antes quebrava)', async () => {
    const { tcc, orientador } = await tccEmValidacaoFase1([9, 9]);
    // Sobra de um remanejo administrativo: banca F2 já criada antes da validação.
    await prisma.banca.create({
      data: { tccId: tcc.id, fase: 'FASE_2', membros: { create: [{ avaliadorId: orientador.id }] } },
    });

    // Antes da correção: quebrava na unique (tccId, fase) DEPOIS de travar os membros em
    // CONCLUIDO → revalidar ficava impossível. Agora: valida normalmente e reaproveita a banca.
    const r: any = await bancas.validar(tcc.id);
    expect(r.aprovado).toBe(true);

    const atual = await prisma.tcc.findUniqueOrThrow({ where: { id: tcc.id } });
    expect(atual.faseAtual).toBe('AGENDAMENTO_DEFESA_FASE_2');
    const bancasF2 = await prisma.banca.findMany({ where: { tccId: tcc.id, fase: 'FASE_2' } });
    expect(bancasF2).toHaveLength(1); // reaproveitada, não duplicada
  });

  it('Fase II: NF = peso1·NF1 + peso2·NF2 e decide aprovado (≥7) / reprovado', async () => {
    const montar = async (nf1: number, notaF2: number) => {
      const { tcc, orientador } = await tccEmDesenvolvimento();
      const av1 = await usuario('AVALIADOR');
      const av2 = await usuario('PROFESSOR');
      await prisma.tcc.update({ where: { id: tcc.id }, data: { faseAtual: 'VALIDACAO_FASE_2', nf1 } });
      await prisma.banca.create({
        data: {
          tccId: tcc.id,
          fase: 'FASE_2',
          membros: {
            create: [orientador.id, av1.id, av2.id].map((id) => ({ avaliadorId: id, status: 'APROVADO', nota: notaF2 })),
          },
        },
      });
      return tcc;
    };

    // NF = 0,6·8 + 0,4·7 = 7,6 → aprovado, aguarda a versão final.
    const aprovado = await montar(8, 7);
    const ra: any = await bancas.validar(aprovado.id);
    expect(ra.nf).toBeCloseTo(7.6);
    expect((await prisma.tcc.findUniqueOrThrow({ where: { id: aprovado.id } })).faseAtual).toBe('AGUARDANDO_AJUSTES_FINAIS');

    // NF = 0,6·8 + 0,4·4 = 6,4 → reprovado na Fase II.
    const reprovado = await montar(8, 4);
    const rr: any = await bancas.validar(reprovado.id);
    expect(rr.nf).toBeCloseTo(6.4);
    const t2 = await prisma.tcc.findUniqueOrThrow({ where: { id: reprovado.id } });
    expect(t2.faseAtual).toBe('REPROVADO_FASE_2');
    expect(t2.resultado).toBe('REPROVADO');
  });
});

describe('Correção 3 — notas visíveis em reprovação terminal', () => {
  it('aluno reprovado na Fase I VÊ a NF1 (antes ficava oculta para sempre)', async () => {
    const { tcc } = await tccEmValidacaoFase1([5, 5]);
    await bancas.validar(tcc.id);
    const atual = await prisma.tcc.findUniqueOrThrow({ where: { id: tcc.id } });
    const visaoAluno: any = sanitizarNotasTcc(atual);
    expect(visaoAluno.nf1).toBeCloseTo(5);
    expect(visaoAluno.resultado).toBe('REPROVADO');
  });

  it('continua ESCONDENDO as notas durante o fluxo normal (sem nota final confirmada)', async () => {
    const visao: any = sanitizarNotasTcc({ faseAtual: 'VALIDACAO_FASE_1', nf1: 7.5, nf2: null, nf: null, resultado: null } as any);
    expect(visao.nf1).toBeNull();
  });
});
