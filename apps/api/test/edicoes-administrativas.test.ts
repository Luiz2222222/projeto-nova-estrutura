// Testes de integração das EDIÇÕES ADMINISTRATIVAS do coordenador.
//
// Regras garantidas aqui:
//  1. Editar notas da banca NÃO pode contradizer o desfecho da fase atual: um TCC reprovado
//     não pode ficar com nota de aprovado (nem o inverso) — a edição contraditória é
//     rejeitada com mensagem que ensina o caminho oficial (voltar a fase e validar de novo).
//  2. Todo TCC precisa ter orientador — a edição não permite removê-lo.
//  3. Trocar o orientador sincroniza a banca da Fase II (antigo sai, novo entra), e é
//     bloqueada se o antigo já registrou avaliação (nada é descartado em silêncio).
import 'reflect-metadata';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { createClient } from '@libsql/client';
import { PrismaLibSQL } from '@prisma/adapter-libsql';
import { PrismaClient } from '@prisma/client';
import { CRITERIOS_FASE1, CRITERIOS_FASE2 } from '@tcc/compartilhado';
import { TccsService } from '../src/tccs/tccs.service';
import { BancasService } from '../src/bancas/bancas.service';
import { PrazosService } from '../src/prazos/prazos.service';

const DB = '/tmp/tcc-teste-edicoes-admin.db';

let prisma: PrismaClient;
let tccs: TccsService;
let bancas: BancasService;
// Mantido em escopo de módulo para ser FECHADO no afterAll — senão o arquivo SQLite fica
// travado e o unlink de limpeza falha com EBUSY no Windows.
let libsql: ReturnType<typeof createClient> | undefined;

const eventosStub = { emitirParaUsuario: async () => undefined, emitirParaCoordenadores: async () => undefined } as any;

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
  const prazos = new PrazosService(prisma as any);
  tccs = new TccsService(prisma as any, eventosStub, prazos, { aoAprovarAbertura: async () => {}, aoEnviarDocumento: async () => {}, aoAlterarTcc: async () => {} } as any);
  bancas = new BancasService(prisma as any, eventosStub, prazos, { aoAprovarAbertura: async () => {}, aoEnviarDocumento: async () => {}, aoAlterarTcc: async () => {} } as any);
});

afterAll(async () => {
  await prisma?.$disconnect();
  libsql?.close(); // libera o arquivo antes de apagar (Windows trava enquanto aberto)
  await fs.rm(DB, { force: true }).catch(() => undefined); // limpeza best-effort (ignora lock)
});

beforeEach(async () => {
  await prisma.tcc.deleteMany();
  await prisma.usuario.deleteMany();
});

let seq = 0;
async function usuario(papel: string) {
  seq += 1;
  return prisma.usuario.create({
    data: { nomeCompleto: `${papel} ${seq}`, email: `u${seq}@teste.br`, senhaHash: 'x', papel },
  });
}

// Notas por critério que somam `total` (pesos padrão somam 10 → nota_i = total·peso_i/10).
function notasSomando(fase: 'FASE_1' | 'FASE_2', total: number) {
  const criterios = fase === 'FASE_1' ? CRITERIOS_FASE1 : CRITERIOS_FASE2;
  return Object.fromEntries(criterios.map((c) => [c.chave, (total * c.pesoPadrao) / 10]));
}

// Cria membro CONCLUIDO com nota total definida (colunas por critério preenchidas).
async function membroConcluido(bancaId: string, avaliadorId: string, fase: 'FASE_1' | 'FASE_2', total: number) {
  const notas = notasSomando(fase, total);
  const colunas = Object.fromEntries(
    Object.entries(notas).map(([chave, v]) => [`nota${chave[0].toUpperCase()}${chave.slice(1)}`, v]),
  );
  return prisma.membroBanca.create({
    data: { bancaId, avaliadorId, status: 'CONCLUIDO', nota: total, avaliadoEm: new Date(), ...colunas },
  });
}

// TCC REPROVADO_FASE_1 (NF1 = 5) com banca F1 concluída (notas 5 e 5).
async function tccReprovadoFase1() {
  const aluno = await usuario('ALUNO');
  const orientador = await usuario('PROFESSOR');
  const av1 = await usuario('AVALIADOR');
  const av2 = await usuario('AVALIADOR');
  const tcc = await prisma.tcc.create({
    data: {
      titulo: 'TCC reprovado F1', semestre: '2026.1', faseAtual: 'REPROVADO_FASE_1',
      alunoId: aluno.id, orientadorId: orientador.id,
      nf1: 5, resultado: 'REPROVADO', monografiaAprovada: true, continuidadeConfirmada: true,
    },
  });
  const banca = await prisma.banca.create({ data: { tccId: tcc.id, fase: 'FASE_1' } });
  const m1 = await membroConcluido(banca.id, av1.id, 'FASE_1', 5);
  const m2 = await membroConcluido(banca.id, av2.id, 'FASE_1', 5);
  return { tcc, m1, m2, orientador, av1, av2 };
}

// TCC CONCLUIDO (NF1=8, NF2=7, NF=7,6, APROVADO) com bancas F1 e F2 concluídas.
async function tccConcluido() {
  const aluno = await usuario('ALUNO');
  const orientador = await usuario('PROFESSOR');
  // av1 é PROFESSOR de propósito: alguém elegível a orientador, mas que já é avaliador —
  // exatamente o conflito que a regra nova precisa barrar.
  const av1 = await usuario('PROFESSOR');
  const av2 = await usuario('AVALIADOR');
  const tcc = await prisma.tcc.create({
    data: {
      titulo: 'TCC concluído', semestre: '2026.1', faseAtual: 'CONCLUIDO',
      alunoId: aluno.id, orientadorId: orientador.id,
      nf1: 8, nf2: 7, nf: 7.6, resultado: 'APROVADO', monografiaAprovada: true, continuidadeConfirmada: true,
    },
  });
  const bancaF1 = await prisma.banca.create({ data: { tccId: tcc.id, fase: 'FASE_1' } });
  await membroConcluido(bancaF1.id, av1.id, 'FASE_1', 8);
  await membroConcluido(bancaF1.id, av2.id, 'FASE_1', 8);
  const bancaF2 = await prisma.banca.create({ data: { tccId: tcc.id, fase: 'FASE_2' } });
  const mOr = await membroConcluido(bancaF2.id, orientador.id, 'FASE_2', 7);
  const mA1 = await membroConcluido(bancaF2.id, av1.id, 'FASE_2', 7);
  const mA2 = await membroConcluido(bancaF2.id, av2.id, 'FASE_2', 7);
  return { tcc, orientador, av1, av2, bancaF2, mOr, mA1, mA2 };
}


// As exceções do projeto carregam o texto no campo `mensagem` (payload do Nest), não no
// `message` padrão — este helper verifica o texto onde ele realmente está.
async function esperarErro(p: Promise<unknown>, trecho: RegExp) {
  await expect(p).rejects.toSatisfy((e: any) => {
    const msg = e?.getResponse?.()?.mensagem ?? e?.message ?? '';
    if (!trecho.test(msg)) throw new Error(`mensagem inesperada: "${msg}"`);
    return true;
  });
}

describe('Edição de notas não pode contradizer o desfecho terminal', () => {
  it('REPROVADO_FASE_1: elevar notas para NF1 ≥ 6 é rejeitado com orientação, e nada muda', async () => {
    const { tcc, m1 } = await tccReprovadoFase1();
    // 8 e 5 → média 6,5 ≥ 6: contradiz a reprovação → deve rejeitar.
    await esperarErro(bancas.editarAvaliacaoMembro(m1.id, notasSomando('FASE_1', 8), undefined, 'CONCLUIDO'), /contradizendo a reprovação na Fase I/);

    // Transação desfeita: fase, NF1 e a nota do membro seguem intocadas.
    const atual = await prisma.tcc.findUniqueOrThrow({ where: { id: tcc.id } });
    expect(atual.faseAtual).toBe('REPROVADO_FASE_1');
    expect(atual.nf1).toBeCloseTo(5);
    expect((await prisma.membroBanca.findUniqueOrThrow({ where: { id: m1.id } })).nota).toBeCloseTo(5);
  });

  it('REPROVADO_FASE_1: correção que MANTÉM a reprovação passa e recalcula a NF1', async () => {
    const { tcc, m1 } = await tccReprovadoFase1();
    // 5,5 e 5 → média 5,25 < 6: coerente com a reprovação → aceita.
    await bancas.editarAvaliacaoMembro(m1.id, notasSomando('FASE_1', 5.5), undefined, 'CONCLUIDO');
    const atual = await prisma.tcc.findUniqueOrThrow({ where: { id: tcc.id } });
    expect(atual.faseAtual).toBe('REPROVADO_FASE_1');
    expect(atual.nf1).toBeCloseTo(5.25);
  });

  it('CONCLUIDO: derrubar notas para NF < 7 é rejeitado; correção que mantém NF ≥ 7 recalcula', async () => {
    const { tcc, mA1 } = await tccConcluido();
    // NF2 → (7+1+7)/3 = 5 → NF = 0,6·8 + 0,4·5 = 6,8 < 7: contradiz o concluído → rejeita.
    await esperarErro(bancas.editarAvaliacaoMembro(mA1.id, notasSomando('FASE_2', 1), undefined, 'CONCLUIDO'), /já foi aprovado na defesa/);

    // NF2 → (7+10+7)/3 = 8 → NF = 0,6·8 + 0,4·8 = 8 ≥ 7: coerente → aceita e recalcula.
    await bancas.editarAvaliacaoMembro(mA1.id, notasSomando('FASE_2', 10), undefined, 'CONCLUIDO');
    const atual = await prisma.tcc.findUniqueOrThrow({ where: { id: tcc.id } });
    expect(atual.faseAtual).toBe('CONCLUIDO');
    expect(atual.nf).toBeCloseTo(8);
    expect(atual.resultado).toBe('APROVADO');
  });
});

describe('Edição administrativa do TCC — orientador e bancas coerentes', () => {
  it('não permite deixar o TCC sem orientador', async () => {
    const { tcc } = await tccReprovadoFase1();
    await esperarErro(tccs.editarTcc(tcc.id, { orientadorId: '' } as any), /precisa ter um orientador/);
  });

  it('trocar o orientador sincroniza a banca da Fase II (antigo sai, novo entra, avaliadores ficam)', async () => {
    const { tcc, orientador, av1, av2, bancaF2, mOr } = await tccConcluido();
    // Zera a avaliação do orientador antigo (caminho oficial) para permitir a troca.
    await prisma.membroBanca.update({ where: { id: mOr.id }, data: { status: 'PENDENTE', nota: null } });
    const novo = await usuario('PROFESSOR');

    await tccs.editarTcc(tcc.id, { orientadorId: novo.id } as any);

    const membros = await prisma.membroBanca.findMany({ where: { bancaId: bancaF2.id } });
    const ids = membros.map((m) => m.avaliadorId).sort();
    expect(ids).toEqual([novo.id, av1.id, av2.id].sort()); // novo entrou, antigo saiu, avaliadores ficaram
    expect(ids).not.toContain(orientador.id);
    const membroNovo = membros.find((m) => m.avaliadorId === novo.id)!;
    expect(membroNovo.status).toBe('PENDENTE'); // entra sem avaliação
  });

  it('bloqueia a troca se o orientador antigo JÁ registrou avaliação na Fase II', async () => {
    const { tcc } = await tccConcluido(); // avaliação do orientador está CONCLUIDO
    const novo = await usuario('PROFESSOR');
    await esperarErro(tccs.editarTcc(tcc.id, { orientadorId: novo.id } as any), /já registrou avaliação/);
  });

  it('bloqueia orientador/coorientador que já seja avaliador na banca do TCC', async () => {
    const { tcc, av1, av2 } = await tccConcluido();
    await esperarErro(tccs.editarTcc(tcc.id, { orientadorId: av1.id } as any), /já é avaliador/);
    await esperarErro(tccs.editarTcc(tcc.id, { coorientadorId: av2.id } as any), /já é avaliador/);
  });
});
