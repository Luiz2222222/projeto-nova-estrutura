// Testes de integração do AGENDAMENTO DA DEFESA (Fase II).
//
//  1. Orientador agenda defesa futura (dados salvos; fase NÃO avança antes da hora).
//  2. Quem não é o orientador recebe 403.
//  3. Data/hora passada libera a avaliação imediatamente.
//  4. Agendador libera defesa futura já vencida (varredura), mesmo sem requisição.
//  5. Liberação é idempotente: chamadas concorrentes liberam/notificam UMA vez.
//  6. Reagendar antes da hora atualiza os dados sem liberar.
//  7. Reagendar após a liberação atualiza os dados e NUNCA regride a fase.
//  8. Notificações do agendamento: destinatários corretos, sem duplicidade.
//  9. Sem banca da Fase II, agendar falha com erro claro.
import 'reflect-metadata';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { createClient } from '@libsql/client';
import { PrismaLibSQL } from '@prisma/adapter-libsql';
import { PrismaClient } from '@prisma/client';
import { esquemaAgendarDefesa } from '@tcc/compartilhado';
import { BancasService } from '../src/bancas/bancas.service';
import { PrazosService } from '../src/prazos/prazos.service';

const DB = '/tmp/tcc-teste-defesa.db';

let prisma: PrismaClient;
let bancas: BancasService;
let libsql: ReturnType<typeof createClient> | undefined;

// Espião de eventos: registra cada emissão para conferir destinatários/duplicidade.
let chamadas: { evento: string; usuarioId?: string; coordenadores?: boolean }[] = [];
const eventosSpy = {
  emitirParaUsuario: async (evento: string, usuarioId: string) => {
    chamadas.push({ evento, usuarioId });
  },
  emitirParaCoordenadores: async (evento: string) => {
    chamadas.push({ evento, coordenadores: true });
  },
} as any;

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
  bancas = new BancasService(prisma as any, eventosSpy, prazos);
});

afterAll(async () => {
  await prisma?.$disconnect();
  libsql?.close(); // libera o arquivo antes de apagar (Windows trava enquanto aberto)
  await fs.rm(DB, { force: true }).catch(() => undefined);
});

beforeEach(async () => {
  chamadas = [];
  await prisma.tcc.deleteMany();
  await prisma.usuario.deleteMany();
});

let seq = 0;
async function usuario(papel: string) {
  seq += 1;
  return prisma.usuario.create({
    data: { nomeCompleto: `${papel} ${seq}`, email: `def${seq}@teste.br`, senhaHash: 'x', papel },
  });
}

// TCC em AGENDAMENTO_DEFESA_FASE_2 com banca F2 (orientador + 2 avaliadores), como o
// validar() da Fase I deixa. comBanca=false simula estado quebrado por mexida manual.
async function cenario(comBanca = true, fase = 'AGENDAMENTO_DEFESA_FASE_2') {
  const aluno = await usuario('ALUNO');
  const orientador = await usuario('PROFESSOR');
  const coorientador = await usuario('PROFESSOR');
  const av1 = await usuario('PROFESSOR');
  const av2 = await usuario('AVALIADOR');
  const tcc = await prisma.tcc.create({
    data: {
      titulo: 'TCC defesa', semestre: '2026.1', faseAtual: fase,
      alunoId: aluno.id, orientadorId: orientador.id, coorientadorId: coorientador.id,
    },
  });
  if (comBanca) {
    await prisma.banca.create({
      data: {
        tccId: tcc.id, fase: 'FASE_2',
        membros: { create: [orientador.id, av1.id, av2.id].map((id) => ({ avaliadorId: id })) },
      },
    });
  }
  return { tcc, aluno, orientador, coorientador, av1, av2 };
}

const daquiUmDia = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const umaHoraAtras = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();
const dados = (dataHora: string, extra: Partial<{ local: string; comentario: string }> = {}) => ({
  dataHora,
  local: extra.local ?? 'Auditório do DEE',
  comentario: extra.comentario,
});

describe('1 — Agendamento futuro pelo orientador', () => {
  it('salva data/local/comentário e NÃO libera a avaliação antes da hora', async () => {
    const { tcc, orientador } = await cenario();
    const r = await bancas.agendarDefesa(orientador.id, tcc.id, dados(daquiUmDia(), { comentario: 'Levar projetor' }));
    expect(r.liberada).toBe(false);
    const dep = await prisma.tcc.findUnique({ where: { id: tcc.id } });
    expect(dep?.faseAtual).toBe('AGENDAMENTO_DEFESA_FASE_2');
    expect(dep?.defesaAgendadaPara).toBeTruthy();
    expect(dep?.defesaLocal).toBe('Auditório do DEE');
    expect(dep?.defesaComentario).toBe('Levar projetor');
    expect(dep?.defesaAgendadaEm).toBeTruthy();
    expect(dep?.defesaLiberadaEm).toBeNull();
  });

  it('valida o local: link http:// é recusado pelo esquema (só HTTPS)', () => {
    expect(esquemaAgendarDefesa.safeParse({ dataHora: daquiUmDia(), local: 'http://site.com/sala' }).success).toBe(false);
    expect(esquemaAgendarDefesa.safeParse({ dataHora: daquiUmDia(), local: 'https://meet.google.com/xyz' }).success).toBe(true);
    expect(esquemaAgendarDefesa.safeParse({ dataHora: daquiUmDia(), local: 'Sala A-204' }).success).toBe(true);
  });
});

describe('2 — Permissão', () => {
  it('quem não é o orientador do TCC recebe 403', async () => {
    const { tcc } = await cenario();
    const intruso = await usuario('PROFESSOR');
    await expect(bancas.agendarDefesa(intruso.id, tcc.id, dados(daquiUmDia()))).rejects.toSatisfy(
      (e: any) => e?.getStatus?.() === 403,
    );
  });
});

describe('3 — Data passada libera imediatamente', () => {
  it('agendar para o passado muda para AVALIACAO_FASE_2 na hora e notifica a banca', async () => {
    const { tcc, orientador, av1, av2 } = await cenario();
    const r = await bancas.agendarDefesa(orientador.id, tcc.id, dados(umaHoraAtras()));
    expect(r.liberada).toBe(true);
    const dep = await prisma.tcc.findUnique({ where: { id: tcc.id } });
    expect(dep?.faseAtual).toBe('AVALIACAO_FASE_2');
    expect(dep?.defesaLiberadaEm).toBeTruthy();
    const liberacoes = chamadas.filter((c) => c.evento === 'avaliador_fase2_liberada');
    expect(new Set(liberacoes.map((c) => c.usuarioId))).toEqual(new Set([orientador.id, av1.id, av2.id]));
  });
});

describe('4 — Agendador libera defesa vencida', () => {
  it('varredura libera TCC com defesa no passado sem nenhuma requisição do orientador', async () => {
    const { tcc } = await cenario();
    await prisma.tcc.update({
      where: { id: tcc.id },
      data: { defesaAgendadaPara: new Date(Date.now() - 5 * 60 * 1000), defesaAgendadaEm: new Date(), defesaLocal: 'Sala 1' },
    });
    const liberadas = await bancas.liberarDefesasVencidas();
    expect(liberadas).toBe(1);
    const dep = await prisma.tcc.findUnique({ where: { id: tcc.id } });
    expect(dep?.faseAtual).toBe('AVALIACAO_FASE_2');
    // Segunda varredura não faz nada (idempotente).
    expect(await bancas.liberarDefesasVencidas()).toBe(0);
  });
});

describe('5 — Liberação idempotente sob concorrência', () => {
  it('chamadas simultâneas liberam e notificam UMA única vez', async () => {
    const { tcc } = await cenario();
    await prisma.tcc.update({
      where: { id: tcc.id },
      data: { defesaAgendadaPara: new Date(Date.now() - 1000), defesaAgendadaEm: new Date(), defesaLocal: 'Sala 2' },
    });
    const resultados = await Promise.all([
      bancas.liberarDefesaSeVencida(tcc.id),
      bancas.liberarDefesaSeVencida(tcc.id),
      bancas.liberarDefesaSeVencida(tcc.id),
    ]);
    expect(resultados.filter(Boolean)).toHaveLength(1);
    // 3 membros na banca → exatamente 3 notificações de liberação (uma por membro).
    expect(chamadas.filter((c) => c.evento === 'avaliador_fase2_liberada')).toHaveLength(3);
  });
});

describe('6 — Reagendamento antes da hora', () => {
  it('atualiza data/local/comentário e continua sem liberar', async () => {
    const { tcc, orientador } = await cenario();
    await bancas.agendarDefesa(orientador.id, tcc.id, dados(daquiUmDia()));
    const novaData = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const r = await bancas.agendarDefesa(orientador.id, tcc.id, dados(novaData, { local: 'https://meet.google.com/abc', comentario: 'Mudou o link' }));
    expect(r.liberada).toBe(false);
    const dep = await prisma.tcc.findUnique({ where: { id: tcc.id } });
    expect(dep?.faseAtual).toBe('AGENDAMENTO_DEFESA_FASE_2');
    expect(dep?.defesaLocal).toBe('https://meet.google.com/abc');
    expect(dep?.defesaComentario).toBe('Mudou o link');
    expect(new Date(dep!.defesaAgendadaPara!).toISOString()).toBe(novaData);
  });
});

describe('7 — Reagendamento após a liberação nunca regride', () => {
  it('em AVALIACAO_FASE_2 atualiza os dados e mantém a fase e a liberação', async () => {
    const { tcc, orientador } = await cenario();
    await bancas.agendarDefesa(orientador.id, tcc.id, dados(umaHoraAtras()));
    const antes = await prisma.tcc.findUnique({ where: { id: tcc.id } });
    expect(antes?.faseAtual).toBe('AVALIACAO_FASE_2');
    // Reagenda para o FUTURO depois de liberada: não pode voltar a bloquear nada.
    const r = await bancas.agendarDefesa(orientador.id, tcc.id, dados(daquiUmDia(), { local: 'Sala nova' }));
    expect(r.liberada).toBe(true);
    const dep = await prisma.tcc.findUnique({ where: { id: tcc.id } });
    expect(dep?.faseAtual).toBe('AVALIACAO_FASE_2'); // não regrediu
    expect(dep?.defesaLiberadaEm?.toISOString()).toBe(antes?.defesaLiberadaEm?.toISOString()); // não "liberou de novo"
    expect(dep?.defesaLocal).toBe('Sala nova');
    // E nenhuma notificação de liberação extra foi disparada no reagendamento.
    expect(chamadas.filter((c) => c.evento === 'avaliador_fase2_liberada')).toHaveLength(3);
  });

  it('fora do intervalo permitido (ex.: já em análise da coordenação) recusa com erro claro', async () => {
    const { tcc, orientador } = await cenario(true, 'AGUARDANDO_ANALISE_COORDENACAO_FASE_2');
    await expect(bancas.agendarDefesa(orientador.id, tcc.id, dados(daquiUmDia()))).rejects.toSatisfy((e: any) =>
      /agendada ou alterada/.test(e?.getResponse?.()?.mensagem ?? ''),
    );
  });
});

describe('8 — Notificações do agendamento', () => {
  it('avisa aluno, coorientador, banca (incl. orientador) UMA vez cada e os coordenadores', async () => {
    const { tcc, aluno, orientador, coorientador, av1, av2 } = await cenario();
    await bancas.agendarDefesa(orientador.id, tcc.id, dados(daquiUmDia()));
    const avisos = chamadas.filter((c) => c.evento === 'defesa_agendada');
    const paraUsuarios = avisos.filter((c) => !c.coordenadores).map((c) => c.usuarioId);
    // Sem duplicados e exatamente os esperados.
    expect(paraUsuarios).toHaveLength(new Set(paraUsuarios).size);
    expect(new Set(paraUsuarios)).toEqual(new Set([aluno.id, coorientador.id, orientador.id, av1.id, av2.id]));
    expect(avisos.some((c) => c.coordenadores)).toBe(true);
  });
});

describe('9 — Sem banca da Fase II', () => {
  it('agendar sem banca formada falha com mensagem clara e nada é liberado', async () => {
    const { tcc, orientador } = await cenario(false);
    await expect(bancas.agendarDefesa(orientador.id, tcc.id, dados(umaHoraAtras()))).rejects.toSatisfy((e: any) =>
      /banca da Fase II não está formada/.test(e?.getResponse?.()?.mensagem ?? ''),
    );
    const dep = await prisma.tcc.findUnique({ where: { id: tcc.id } });
    expect(dep?.faseAtual).toBe('AGENDAMENTO_DEFESA_FASE_2');
    expect(dep?.defesaAgendadaPara).toBeNull();
  });
});
