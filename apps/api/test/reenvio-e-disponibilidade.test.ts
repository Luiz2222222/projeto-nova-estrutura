// Testes de integração dos ajustes:
//  A) Reenvio pós-ajuste (Fase I e II): marca ajusteReenviadoEm SÓ no envio (não no
//     rascunho), avisa a coordenação com o NOME do avaliador e a marca some quando a
//     coordenação decide (aprovar / novo ajuste).
//  B) Disponibilidade do professor: indisponível some dos candidatos de banca e é
//     barrado em banca nova/troca e como orientador; avaliador EXTERNO segue elegível;
//     membro já existente não é revalidado na troca.
import 'reflect-metadata';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { createClient } from '@libsql/client';
import { PrismaLibSQL } from '@prisma/adapter-libsql';
import { PrismaClient } from '@prisma/client';
import { CRITERIOS_FASE1, CRITERIOS_FASE2 } from '@tcc/compartilhado';
import { BancasService } from '../src/bancas/bancas.service';
import { TccsService } from '../src/tccs/tccs.service';
import { PrazosService } from '../src/prazos/prazos.service';

const DB = '/tmp/tcc-teste-reenvio.db';

let prisma: PrismaClient;
let bancas: BancasService;
let tccs: TccsService;
let libsql: ReturnType<typeof createClient> | undefined;

let chamadas: { evento: string; msg?: string }[] = [];
const eventosSpy = {
  emitirParaUsuario: async (evento: string, _uid: string, _t: string, msg: string) => { chamadas.push({ evento, msg }); },
  emitirParaCoordenadores: async (evento: string, _t: string, msg: string) => { chamadas.push({ evento, msg }); },
} as any;

const arquivoDocx = () => ({
  originalname: 'doc.docx',
  buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]),
  size: 8,
  mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
});

beforeAll(async () => {
  await fs.rm(DB, { force: true }).catch(() => undefined);
  libsql = createClient({ url: `file:${DB}` });
  const migracoes = join(__dirname, '..', 'prisma', 'migrations');
  for (const pasta of readdirSync(migracoes).sort()) {
    try {
      await libsql.executeMultiple(readFileSync(join(migracoes, pasta, 'migration.sql'), 'utf-8'));
    } catch { /* entradas sem migration.sql */ }
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
  bancas = new BancasService(prisma as any, eventosSpy, prazos);
  tccs = new TccsService(prisma as any, eventosSpy, prazos);
});

afterAll(async () => {
  await prisma?.$disconnect();
  libsql?.close();
  await fs.rm(DB, { force: true }).catch(() => undefined);
});

beforeEach(async () => {
  chamadas = [];
  await prisma.tcc.deleteMany();
  await prisma.usuario.deleteMany();
  await prisma.configuracaoSistema.deleteMany().catch(() => undefined);
  await prisma.configuracaoSistema.create({ data: { id: 'global', semestreAtivo: '2026.1' } });
});

let seq = 0;
async function usuario(papel: string, disponivel = true) {
  seq += 1;
  return prisma.usuario.create({
    data: { nomeCompleto: `${papel} ${seq}`, email: `rd${seq}@teste.br`, senhaHash: 'x', papel, disponivelParaOrientar: disponivel },
  });
}

// Notas completas da fase (uma por critério, no teto do peso padrão).
const notasDe = (fase: 'FASE_1' | 'FASE_2') =>
  Object.fromEntries((fase === 'FASE_1' ? CRITERIOS_FASE1 : CRITERIOS_FASE2).map((c) => [c.chave, c.pesoPadrao]));

// TCC em VALIDACAO_* com banca da fase e um membro em AJUSTE_SOLICITADO.
async function cenarioValidacao(fase: 'FASE_1' | 'FASE_2') {
  const aluno = await usuario('ALUNO');
  const orientador = await usuario('PROFESSOR');
  const avaliador = await usuario('PROFESSOR');
  const tcc = await prisma.tcc.create({
    data: {
      titulo: 'TCC reenvio', semestre: '2026.1',
      faseAtual: fase === 'FASE_1' ? 'VALIDACAO_FASE_1' : 'VALIDACAO_FASE_2',
      alunoId: aluno.id, orientadorId: orientador.id,
    },
  });
  const banca = await prisma.banca.create({
    data: { tccId: tcc.id, fase, membros: { create: [{ avaliadorId: avaliador.id, status: 'AJUSTE_SOLICITADO', ajusteMotivo: 'refine' }] } },
  });
  const membro = (await prisma.membroBanca.findFirst({ where: { bancaId: banca.id } }))!;
  return { tcc, banca, membro, avaliador };
}

describe('A — Reenvio pós-ajuste marca a ação pendente (Fase I e II)', () => {
  for (const fase of ['FASE_1', 'FASE_2'] as const) {
    it(`${fase}: rascunho NÃO marca; reenvio marca, avisa com o nome e decisões limpam`, async () => {
      const { banca, membro, avaliador } = await cenarioValidacao(fase);

      // Rascunho durante o ajuste: nada de ação pendente nem aviso.
      await bancas.avaliar(avaliador.id, banca.id, notasDe(fase), 'rascunho', false);
      let m = await prisma.membroBanca.findUnique({ where: { id: membro.id } });
      expect(m?.ajusteReenviadoEm).toBeNull();
      expect(chamadas.filter((c) => c.evento === 'coord_avaliacao_reenviada')).toHaveLength(0);

      // Reenvio (finalizar): marca a ação e avisa a coordenação COM o nome do avaliador.
      await bancas.avaliar(avaliador.id, banca.id, notasDe(fase), 'ajustado', true);
      m = await prisma.membroBanca.findUnique({ where: { id: membro.id } });
      expect(m?.status).toBe('ENVIADO');
      expect(m?.ajusteReenviadoEm).toBeTruthy();
      const avisos = chamadas.filter((c) => c.evento === 'coord_avaliacao_reenviada');
      expect(avisos).toHaveLength(1); // sem duplicar
      expect(avisos[0].msg).toContain(avaliador.nomeCompleto); // quem reenviou
      expect(avisos[0].msg).not.toMatch(/\d+[.,]\d+/); // sem nota na mensagem

      // Decisão "aprovar": limpa a ação pendente.
      await bancas.aprovarAvaliacaoMembro(membro.id);
      m = await prisma.membroBanca.findUnique({ where: { id: membro.id } });
      expect(m?.status).toBe('APROVADO');
      expect(m?.ajusteReenviadoEm).toBeNull();
    });
  }

  it('decisão "novo ajuste" também limpa a marca', async () => {
    const { banca, membro, avaliador } = await cenarioValidacao('FASE_1');
    await bancas.avaliar(avaliador.id, banca.id, notasDe('FASE_1'), 'ajustado', true);
    await bancas.solicitarAjuste(membro.id, 'ainda falta');
    const m = await prisma.membroBanca.findUnique({ where: { id: membro.id } });
    expect(m?.status).toBe('AJUSTE_SOLICITADO');
    expect(m?.ajusteReenviadoEm).toBeNull();
  });
});

describe('B — Disponibilidade do professor', () => {
  it('candidatos de banca: professor indisponível some; avaliador externo fica', async () => {
    const aluno = await usuario('ALUNO');
    const orientador = await usuario('PROFESSOR');
    const profIndisp = await usuario('PROFESSOR', false);
    const externo = await usuario('AVALIADOR', false); // externo indisponível SEGUE elegível
    const tcc = await prisma.tcc.create({
      data: { titulo: 'T', semestre: '2026.1', faseAtual: 'FORMACAO_BANCA_FASE_1', alunoId: aluno.id, orientadorId: orientador.id },
    });
    const lista = await bancas.candidatos(tcc.id);
    const ids = lista.map((c) => c.id);
    expect(ids).not.toContain(profIndisp.id);
    expect(ids).toContain(externo.id);
  });

  it('formar banca NOVA recusa professor indisponível (bloqueio no backend)', async () => {
    const aluno = await usuario('ALUNO');
    const orientador = await usuario('PROFESSOR');
    const profIndisp = await usuario('PROFESSOR', false);
    const profOk = await usuario('PROFESSOR');
    const tcc = await prisma.tcc.create({
      data: { titulo: 'T', semestre: '2026.1', faseAtual: 'FORMACAO_BANCA_FASE_1', alunoId: aluno.id, orientadorId: orientador.id },
    });
    await expect(bancas.formarBanca(tcc.id, [profIndisp.id, profOk.id], arquivoDocx())).rejects.toSatisfy(
      (e: any) => /indisponível/.test(e?.getResponse?.()?.mensagem ?? ''),
    );
  });

  it('troca: mantém membro que FICOU indisponível, mas barra indisponível NOVO', async () => {
    const aluno = await usuario('ALUNO');
    const orientador = await usuario('PROFESSOR');
    const m1 = await usuario('PROFESSOR'); // vai ficar indisponível DEPOIS de entrar
    const m2 = await usuario('PROFESSOR');
    const novoIndisp = await usuario('PROFESSOR', false);
    const novoOk = await usuario('PROFESSOR');
    const tcc = await prisma.tcc.create({
      data: { titulo: 'T', semestre: '2026.1', faseAtual: 'AVALIACAO_FASE_1', alunoId: aluno.id, orientadorId: orientador.id },
    });
    await prisma.banca.create({
      data: { tccId: tcc.id, fase: 'FASE_1', membros: { create: [{ avaliadorId: m1.id }, { avaliadorId: m2.id }] } },
    });
    await prisma.usuario.update({ where: { id: m1.id }, data: { disponivelParaOrientar: false } });

    // Novo indisponível → erro; banca intacta.
    await expect(bancas.editarAvaliadoresFase1(tcc.id, [m1.id, novoIndisp.id])).rejects.toSatisfy(
      (e: any) => /indisponível/.test(e?.getResponse?.()?.mensagem ?? ''),
    );
    // Manter o m1 (agora indisponível) e trocar só o outro por um disponível → ok.
    await bancas.editarAvaliadoresFase1(tcc.id, [m1.id, novoOk.id]);
    const membros = await prisma.membroBanca.findMany({ where: { banca: { tccId: tcc.id, fase: 'FASE_1' } } });
    expect(new Set(membros.map((m) => m.avaliadorId))).toEqual(new Set([m1.id, novoOk.id]));
  });

  it('abrir TCC: orientador indisponível é recusado; coorientador EXTERNO indisponível passa', async () => {
    const alunoA = await usuario('ALUNO');
    const profIndisp = await usuario('PROFESSOR', false);
    await expect(tccs.abrir(alunoA.id, { titulo: 'TCC novo', orientadorId: profIndisp.id } as any)).rejects.toSatisfy(
      (e: any) => /não está disponível/.test(e?.getResponse?.()?.mensagem ?? ''),
    );

    const alunoB = await usuario('ALUNO');
    const profOk = await usuario('PROFESSOR');
    const externoIndisp = await usuario('AVALIADOR', false); // regra é só p/ professor interno
    const tcc = await tccs.abrir(alunoB.id, { titulo: 'TCC novo 2', orientadorId: profOk.id, coorientadorId: externoIndisp.id } as any);
    expect(tcc.coorientadorId).toBe(externoIndisp.id);
  });
});
