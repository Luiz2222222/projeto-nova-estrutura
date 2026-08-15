// Histórico UNIFICADO: TCC de período encerrado (conta do aluno já apagada) tem que sair na
// MESMA lista, com a MESMA forma dos TCCs vivos. Se aparecesse numa lista/rota paralela, a
// tela voltaria a ter duas categorias — que é exatamente o que essa unificação tirou.
import { describe, it, expect, beforeEach } from 'vitest';
import { HistoricoTccsService } from './historico-tccs.service';

const SEMESTRE_ATIVO = '2026.1';
const PROF = 'prof-1';

// TCC vivo de período anterior (o histórico "normal").
const tccVivo = {
  id: 'tcc-vivo',
  titulo: 'TCC vivo de 2025.2',
  semestre: '2025.2',
  faseAtual: 'CONCLUIDO',
  nf: 8,
  orientadorId: PROF,
  coorientadorId: null,
  aluno: { id: 'a1', nomeCompleto: 'Aluno Vivo', email: 'a@x', curso: 'ELETRICA' },
  orientador: { id: PROF, nomeCompleto: 'Prof Um', tratamento: 'Dr.' },
  coorientador: null,
  documentos: [{ id: 'doc-vivo', tipo: 'MONOGRAFIA', nomeArquivo: 'm.pdf', versao: 1, status: 'APROVADO' }],
  bancas: [],
  solicitacoes: [],
  criadoEm: new Date('2025-08-01'),
};

// Mesmo formato do que o encerramento grava em TccArquivado.dadosJson.
const snapshot = {
  tcc: { criadoEm: '2025-02-01T00:00:00.000Z', monografiaAprovada: true, continuidadeConfirmada: true },
  datas: { fase1ValidadaEm: '2025-04-01T00:00:00.000Z', concluidoEm: '2025-06-30T00:00:00.000Z' },
  defesa: { agendadaPara: '2025-06-20T00:00:00.000Z', local: 'Sala 1' },
  notas: { pesoFase1: 0.6, pesoFase2: 0.4 },
  bancas: [
    {
      fase: 'FASE_2',
      criadoEm: '2025-05-01T00:00:00.000Z',
      membros: [
        {
          avaliadorId: PROF,
          nome: 'Prof Um',
          tratamento: 'Dr.',
          status: 'AVALIADO',
          notaTotal: 9,
          parecer: 'ok',
          avaliadoEm: '2025-06-21T00:00:00.000Z',
          notasPorCriterio: { Coerência: 2, Qualidade: 2 },
        },
      ],
    },
  ],
  solicitacoes: [],
};

const arquivado = {
  id: 'arq-1',
  titulo: 'TCC arquivado de 2025.1',
  semestre: '2025.1',
  faseFinal: 'CONCLUIDO',
  nf1: 8,
  nf2: 9,
  nf: 8.4,
  resultado: 'APROVADO',
  concluidoEm: new Date('2025-06-30'),
  defesaAgendadaPara: new Date('2025-06-20'),
  defesaLocal: 'Sala 1',
  arquivadoEm: new Date('2025-07-15'),
  alunoNome: 'Aluno Apagado',
  alunoEmail: 'apagado@x',
  alunoCurso: 'ELETRICA',
  orientadorNome: 'Prof Um',
  coorientadorNome: null,
  dadosJson: JSON.stringify(snapshot),
  documentos: [{ id: 'doc-arq', tipo: 'VERSAO_FINAL', nomeArquivo: 'final.pdf', versao: 2, status: 'APROVADO', tamanho: 10, criadoEm: new Date('2025-06-25') }],
  participantes: [{ usuarioId: PROF, papel: 'ORIENTADOR' }],
};

// Prisma falso mínimo: só o que o serviço realmente consulta.
function prismaFalso() {
  const ocultos: { usuarioId: string; tccId: string; criadoEm: Date }[] = [];
  const casaWhere = (a: any, where: any) => {
    if (!where || Object.keys(where).length === 0) return true;
    const usuarioId = where.participantes?.some?.usuarioId;
    if (usuarioId) return a.participantes.some((p: any) => p.usuarioId === usuarioId);
    if (where.id?.in) return where.id.in.includes(a.id);
    if (where.id) return a.id === where.id;
    return true;
  };
  return {
    _ocultos: ocultos,
    configuracaoSistema: { findUnique: async () => ({ semestreAtivo: SEMESTRE_ATIVO }) },
    calendario: { findMany: async () => [] },
    historicoTccOculto: {
      findMany: async ({ where }: any) => ocultos.filter((o) => o.usuarioId === where.usuarioId),
      upsert: async ({ create }: any) => {
        if (!ocultos.some((o) => o.usuarioId === create.usuarioId && o.tccId === create.tccId)) {
          ocultos.push({ ...create, criadoEm: new Date() });
        }
        return create;
      },
      deleteMany: async ({ where }: any) => {
        for (let i = ocultos.length - 1; i >= 0; i--) {
          if (ocultos[i].usuarioId === where.usuarioId && ocultos[i].tccId === where.tccId) ocultos.splice(i, 1);
        }
        return { count: 1 };
      },
    },
    tcc: {
      findMany: async ({ where }: any) => {
        const fora: string[] = where?.id?.notIn ?? [];
        const dentro: string[] | undefined = where?.id?.in;
        return [tccVivo].filter(
          (t) => !fora.includes(t.id) && (dentro ? dentro.includes(t.id) : t.semestre !== SEMESTRE_ATIVO),
        );
      },
      findFirst: async ({ where }: any) => (where.id === tccVivo.id ? { id: tccVivo.id } : null),
    },
    tccArquivado: {
      findMany: async ({ where }: any) => [arquivado].filter((a) => casaWhere(a, where)),
      findFirst: async ({ where }: any) => [arquivado].filter((a) => casaWhere(a, where))[0] ?? null,
    },
  } as any;
}

let prisma: any;
let servico: HistoricoTccsService;

beforeEach(() => {
  prisma = prismaFalso();
  servico = new HistoricoTccsService(prisma);
});

describe('Histórico do coordenador', () => {
  it('traz períodos encerrados na MESMA lista dos TCCs vivos', async () => {
    const lista: any[] = await servico.historicoCoordenador('coord-1');

    expect(lista.map((t) => t.titulo)).toEqual(['TCC vivo de 2025.2', 'TCC arquivado de 2025.1']);
  });

  it('o registro arquivado chega com a mesma forma usada pelas telas', async () => {
    const lista: any[] = await servico.historicoCoordenador('coord-1');
    const arq = lista.find((t) => t.titulo === 'TCC arquivado de 2025.1');

    expect(arq.aluno.nomeCompleto).toBe('Aluno Apagado'); // conta apagada, nome sobrevive
    expect(arq.orientador.nomeCompleto).toBe('Prof Um');
    expect(arq.faseAtual).toBe('CONCLUIDO');
    expect(arq.fase1ValidadaEm).toBe('2025-04-01T00:00:00.000Z'); // timeline preenchida
    expect(arq.pesoFase1).toBe(0.6);
    expect(arq.bancas[0].membros[0].nota).toBe(9);
    expect(arq.bancas[0].membros[0].notaCoerencia).toBe(2); // nota por critério vira coluna
    expect(arq.bancas[0].id).toBeTruthy(); // chave de render estável
    expect(arq.bancas[0].membros[0].id).toBeTruthy();
  });

  it('os documentos apontam para o arquivo permanente, pelo backend autenticado', async () => {
    const lista: any[] = await servico.historicoCoordenador('coord-1');
    const arq = lista.find((t) => t.titulo === 'TCC arquivado de 2025.1');

    expect(arq.documentos[0].urlBaixar).toBe('/historico-arquivado/arq-1/baixar?documento=doc-arq');
    expect(arq.documentos[0].urlVisualizar).toBe('/historico-arquivado/arq-1/visualizar?documento=doc-arq');
  });
});

describe('Histórico do professor', () => {
  it('só vê período encerrado em que participou, com os vínculos preenchidos', async () => {
    const lista: any[] = await servico.historicoProfessor(PROF);
    const arq = lista.find((t) => t.titulo === 'TCC arquivado de 2025.1');

    expect(arq).toBeTruthy();
    expect(arq.vinculos).toEqual(['ORIENTADOR', 'AVALIADOR']);
  });

  it('professor sem vínculo não recebe o registro arquivado', async () => {
    const lista: any[] = await servico.historicoProfessor('outro-prof');

    expect(lista.some((t) => t.titulo === 'TCC arquivado de 2025.1')).toBe(false);
  });
});

describe('Ocultar do meu histórico vale também para período encerrado', () => {
  it('oculta, some da lista e continua reexibível', async () => {
    const usuario = { sub: 'coord-1', papel: 'COORDENADOR' };

    await servico.ocultarDoHistorico(usuario, 'arq_arq-1');
    const depois: any[] = await servico.historicoCoordenador('coord-1');
    expect(depois.some((t) => t.id === 'arq_arq-1')).toBe(false);

    const ocultos: any[] = await servico.listarOcultosDoHistorico(usuario);
    expect(ocultos.map((o) => o.id)).toContain('arq_arq-1');

    await servico.desocultarDoHistorico(usuario, 'arq_arq-1');
    const voltou: any[] = await servico.historicoCoordenador('coord-1');
    expect(voltou.some((t) => t.id === 'arq_arq-1')).toBe(true);
  });

  it('professor sem vínculo não consegue ocultar um arquivado alheio', async () => {
    await expect(
      servico.ocultarDoHistorico({ sub: 'outro-prof', papel: 'PROFESSOR' }, 'arq_arq-1'),
    ).rejects.toMatchObject({ status: 404 });
  });
});
