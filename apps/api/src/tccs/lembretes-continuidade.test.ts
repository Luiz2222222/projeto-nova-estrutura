// Lembretes do prazo de avaliação de continuidade.
//
// Substituíram o pedido que saía na aprovação da abertura (semanas antes do prazo, e por
// isso esquecido). Agora saem 2 dias antes, 1 dia antes e no dia — e só para quem não
// respondeu. Repetição é o risco central aqui: reinício da API, rodada extra do agendador
// ou erro no meio não podem gerar um segundo aviso.
import { describe, it, expect, vi } from 'vitest';
import {
  LembretesContinuidadeService,
  EVENTO_LEMBRETE,
  diasAte,
  tituloLembrete,
  corpoLembrete,
} from './lembretes-continuidade.service';
import { proximaExecucao, HORA_LEMBRETE, FUSO_LEMBRETE } from './agendador-continuidade';

const PRAZO = new Date('2026-08-04T12:00:00Z'); // 04/08/2026, 09:00 em Fortaleza
const ORIENTADOR = 'prof-1';

function prismaFalso(over: { calendarios?: any[]; tccs?: any[]; notificacoes?: any[] } = {}) {
  const notificacoes = over.notificacoes ?? [];
  return {
    _notificacoes: notificacoes,
    calendario: {
      findMany: vi.fn(async () => over.calendarios ?? [{ semestre: '2026.2', avaliacaoContinuidade: PRAZO }]),
    },
    tcc: {
      findMany: vi.fn(async ({ where }: any) =>
        (over.tccs ?? [
          { id: 't1', titulo: 'Título teste', orientadorId: ORIENTADOR, aluno: { nomeCompleto: 'Luiz Henrique' } },
        ]).filter(() => where.faseAtual === 'DESENVOLVIMENTO' && where.continuidadeConfirmada === false),
      ),
    },
    notificacao: {
      findFirst: vi.fn(async ({ where }: any) =>
        notificacoes.find(
          (n: any) => n.usuarioId === where.usuarioId && n.evento === where.evento && n.titulo === where.titulo && n.link === where.link,
        ) ?? null,
      ),
    },
  } as any;
}

// Registra o que foi emitido e simula a notificação interna que o evento cria.
function eventosFalso(prisma: any) {
  const enviados: any[] = [];
  return {
    _enviados: enviados,
    emitirParaUsuario: vi.fn(async (evento: string, usuarioId: string, titulo: string, mensagem: string, link?: string) => {
      enviados.push({ evento, usuarioId, titulo, mensagem, link });
      prisma._notificacoes.push({ usuarioId, evento, titulo, mensagem, link });
    }),
    emitirParaCoordenadores: vi.fn(),
  } as any;
}

const EM = (dias: number) => new Date(PRAZO.getTime() - dias * 86_400_000);

describe('Janela de disparo', () => {
  it.each([
    ['2 dias antes', 2, '[Ação pendente] Continuidade do TCC — faltam 2 dias'],
    ['1 dia antes', 1, '[Ação pendente] Continuidade do TCC — falta 1 dia'],
    ['no dia do prazo', 0, '[Ação pendente] Continuidade do TCC — último dia do prazo'],
  ])('%s dispara com o assunto certo', async (_n, dias, assunto) => {
    const prisma = prismaFalso();
    const eventos = eventosFalso(prisma);

    const r = await new LembretesContinuidadeService(prisma, eventos).enviarLembretes(EM(dias as number));

    expect(r.enviados).toBe(1);
    expect(eventos._enviados[0]).toMatchObject({ evento: EVENTO_LEMBRETE, usuarioId: ORIENTADOR, titulo: assunto });
  });

  it.each([[5], [3], [-1], [-10]])('não dispara com %i dia(s) de diferença', async (dias) => {
    const prisma = prismaFalso();
    const eventos = eventosFalso(prisma);

    const r = await new LembretesContinuidadeService(prisma, eventos).enviarLembretes(EM(dias as number));

    expect(r.enviados).toBe(0);
    expect(eventos.emitirParaUsuario).not.toHaveBeenCalled();
  });

  it('o corpo cita o orientando e a data do prazo', async () => {
    const prisma = prismaFalso();
    const eventos = eventosFalso(prisma);

    await new LembretesContinuidadeService(prisma, eventos).enviarLembretes(EM(2));

    const msg = eventos._enviados[0].mensagem;
    expect(msg).toContain('Luiz Henrique');
    expect(msg).toContain('Título teste');
    expect(msg).toContain('04/08/2026');
    expect(msg).toContain('faltam 2 dias');
  });

  it('no dia, avisa que sem a avaliação o TCC não avança', async () => {
    const prisma = prismaFalso();
    const eventos = eventosFalso(prisma);

    await new LembretesContinuidadeService(prisma, eventos).enviarLembretes(EM(0));

    expect(eventos._enviados[0].mensagem).toContain('O prazo termina hoje, 04/08/2026');
    expect(eventos._enviados[0].mensagem).toContain('não avança para a formação da banca');
  });
});

describe('Quem NÃO recebe', () => {
  it('sem prazo cadastrado no calendário, ninguém é lembrado', async () => {
    const prisma = prismaFalso({ calendarios: [] });
    const eventos = eventosFalso(prisma);

    const r = await new LembretesContinuidadeService(prisma, eventos).enviarLembretes(EM(1));

    expect(r.enviados).toBe(0);
    expect(prisma.tcc.findMany).not.toHaveBeenCalled();
  });

  it('TCC já decidido sai da fila (a consulta pede DESENVOLVIMENTO + continuidade não confirmada)', async () => {
    const prisma = prismaFalso();
    const eventos = eventosFalso(prisma);

    await new LembretesContinuidadeService(prisma, eventos).enviarLembretes(EM(2));

    const filtro = prisma.tcc.findMany.mock.calls[0][0].where;
    expect(filtro).toMatchObject({ faseAtual: 'DESENVOLVIMENTO', continuidadeConfirmada: false, excluidoEm: null });
  });

  it('sem TCC pendente, não sai nada', async () => {
    const prisma = prismaFalso({ tccs: [] });
    const eventos = eventosFalso(prisma);

    const r = await new LembretesContinuidadeService(prisma, eventos).enviarLembretes(EM(2));

    expect(r.enviados).toBe(0);
  });
});

describe('Sem duplicidade', () => {
  it('rodar duas vezes no mesmo dia envia UMA vez', async () => {
    const prisma = prismaFalso();
    const eventos = eventosFalso(prisma);
    const servico = new LembretesContinuidadeService(prisma, eventos);

    const um = await servico.enviarLembretes(EM(2));
    const dois = await servico.enviarLembretes(EM(2));

    expect(um.enviados).toBe(1);
    expect(dois.enviados).toBe(0);
    expect(dois.pulados).toBe(1);
    expect(eventos.emitirParaUsuario).toHaveBeenCalledTimes(1);
  });

  it('a trava sobrevive ao reinício da API (mora no banco, não em memória)', async () => {
    const prisma = prismaFalso();
    const eventos = eventosFalso(prisma);
    await new LembretesContinuidadeService(prisma, eventos).enviarLembretes(EM(2));

    // Instância nova = processo novo. Só o que está no banco continua valendo.
    const r = await new LembretesContinuidadeService(prisma, eventos).enviarLembretes(EM(2));

    expect(r.enviados).toBe(0);
    expect(r.pulados).toBe(1);
  });

  it('cada dia da janela é um aviso distinto (2 dias, 1 dia e no dia)', async () => {
    const prisma = prismaFalso();
    const eventos = eventosFalso(prisma);
    const servico = new LembretesContinuidadeService(prisma, eventos);

    await servico.enviarLembretes(EM(2));
    await servico.enviarLembretes(EM(1));
    await servico.enviarLembretes(EM(0));
    await servico.enviarLembretes(EM(0)); // rodada repetida do último dia

    expect(eventos.emitirParaUsuario).toHaveBeenCalledTimes(3);
    expect(eventos._enviados.map((e: any) => e.titulo)).toEqual([
      tituloLembrete(2),
      tituloLembrete(1),
      tituloLembrete(0),
    ]);
  });

  it('um aviso por TCC pendente, mesmo com o mesmo orientador', async () => {
    const prisma = prismaFalso({
      tccs: [
        { id: 't1', titulo: 'TCC um', orientadorId: ORIENTADOR, aluno: { nomeCompleto: 'Aluno Um' } },
        { id: 't2', titulo: 'TCC dois', orientadorId: ORIENTADOR, aluno: { nomeCompleto: 'Aluno Dois' } },
      ],
    });
    const eventos = eventosFalso(prisma);

    const r = await new LembretesContinuidadeService(prisma, eventos).enviarLembretes(EM(1));

    expect(r.enviados).toBe(2);
    expect(eventos._enviados.map((e: any) => e.link)).toEqual([
      '/professor/orientandos/t1#acao',
      '/professor/orientandos/t2#acao',
    ]);
  });
});

describe('Contagem de dias pelo calendário', () => {
  it('conta dias inteiros, não blocos de 24h', () => {
    // 23:59 de Fortaleza no dia 02 -> ainda faltam 2 dias para o dia 04.
    expect(diasAte(PRAZO, new Date('2026-08-03T02:50:00Z'))).toBe(2);
    // 00:01 de Fortaleza no dia 03 -> falta 1 dia.
    expect(diasAte(PRAZO, new Date('2026-08-03T03:01:00Z'))).toBe(1);
    expect(diasAte(PRAZO, new Date('2026-08-04T12:00:00Z'))).toBe(0);
  });

  it('o corpo muda conforme o dia', () => {
    expect(corpoLembrete(2, 'T', 'A', '04/08/2026')).toContain('faltam 2 dias');
    expect(corpoLembrete(1, 'T', 'A', '04/08/2026')).toContain('falta 1 dia');
    expect(corpoLembrete(0, 'T', 'A', '04/08/2026')).toContain('termina hoje');
  });
});

describe('Agendamento às 08:00 de Fortaleza', () => {
  const hora = (d: Date) =>
    new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO_LEMBRETE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);

  it('sempre cai às 08:00 no fuso do curso', () => {
    for (const agora of ['2026-08-16T05:00:00Z', '2026-08-16T14:30:00Z', '2026-08-16T23:59:00Z']) {
      expect(hora(proximaExecucao(new Date(agora)))).toBe(`0${HORA_LEMBRETE}:00`);
    }
  });

  it('antes das 08:00 agenda para hoje; depois, para amanhã', () => {
    // 09:00 UTC = 06:00 em Fortaleza -> hoje.
    expect(proximaExecucao(new Date('2026-08-16T09:00:00Z')).toISOString()).toBe('2026-08-16T11:00:00.000Z');
    // 15:00 UTC = 12:00 em Fortaleza -> amanhã.
    expect(proximaExecucao(new Date('2026-08-16T15:00:00Z')).toISOString()).toBe('2026-08-17T11:00:00.000Z');
  });

  it('a próxima execução está sempre no futuro e a menos de 24h', () => {
    for (let h = 0; h < 24; h++) {
      const agora = new Date(Date.UTC(2026, 7, 16, h, 23, 0));
      const horas = (proximaExecucao(agora).getTime() - agora.getTime()) / 3_600_000;
      expect(horas).toBeGreaterThan(0);
      expect(horas).toBeLessThanOrEqual(24);
    }
  });
});
