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
  documentos: [
    { id: 'doc-arq', tipo: 'VERSAO_FINAL', nomeArquivo: 'final.pdf', versao: 2, status: 'APROVADO', tamanho: 10, criadoEm: new Date('2025-06-25') },
    // Documento interno da coordenação: o professor não pode nem enxergar na lista.
    { id: 'doc-banca', tipo: 'AVALIACAO_BANCA', nomeArquivo: 'ata-da-banca.pdf', versao: 1, status: 'CONCLUIDO', tamanho: 10, criadoEm: new Date('2025-06-26') },
  ],
  participantes: [{ usuarioId: PROF, papel: 'ORIENTADOR' }],
};

// Reprovado na Fase I, com PROF apenas na banca daquela fase: caso do duplo-cego.
const OUTRO_PROF = 'prof-2';
const reprovadoFase1 = {
  id: 'arq-reprovado',
  titulo: 'TCC reprovado na Fase I',
  semestre: '2025.1',
  faseFinal: 'REPROVADO_FASE_1',
  nf1: 4,
  nf2: null,
  nf: null,
  resultado: 'REPROVADO',
  concluidoEm: null,
  defesaAgendadaPara: null,
  defesaLocal: null,
  arquivadoEm: new Date('2025-07-15'),
  alunoNome: 'Aluno Reprovado',
  alunoEmail: 'reprovado@x',
  alunoCurso: 'ENGENHARIA_ELETRICA',
  orientadorNome: 'Prof Orientador Dois',
  coorientadorNome: null,
  dadosJson: JSON.stringify({
    bancas: [{ fase: 'FASE_1', membros: [{ avaliadorId: PROF, nome: 'Prof Um', notaTotal: 4 }] }],
    solicitacoes: [],
  }),
  documentos: [{ id: 'doc-reprovado', tipo: 'MONOGRAFIA', nomeArquivo: 'monografia-do-aluno.pdf', versao: 1, status: 'REJEITADO', tamanho: 10, criadoEm: new Date('2025-05-01') }],
  participantes: [
    { usuarioId: OUTRO_PROF, papel: 'ORIENTADOR' },
    { usuarioId: PROF, papel: 'BANCA' },
  ],
};

// Sem nota final e sem fase terminal: notas ainda não liberadas para o professor.
const semNotaFinal = {
  ...arquivado,
  id: 'arq-sem-nf',
  titulo: 'TCC arquivado sem nota final',
  faseFinal: 'EM_BANCA_FASE_2',
  nf1: 7,
  nf2: null,
  nf: null,
  resultado: null,
  dadosJson: JSON.stringify({
    notas: { nf1: 7 },
    bancas: [
      {
        fase: 'FASE_2',
        membros: [
          {
            avaliadorId: OUTRO_PROF,
            nome: 'Prof Dois',
            status: 'AVALIADO',
            notaTotal: 9,
            parecer: 'parecer sigiloso',
            notasPorCriterio: { Coerência: 2, Qualidade: 2 },
          },
        ],
      },
    ],
    solicitacoes: [],
  }),
  documentos: [arquivado.documentos[0]],
};

const ARQUIVADOS = [arquivado, reprovadoFase1, semNotaFinal];

// Calendário de 2025.1 com pesos PERSONALIZADOS (diferentes do padrão do regulamento).
const calendario2025_1 = {
  semestre: '2025.1',
  pesoResumo: 2.0,
  pesoIntroducao: 1.0,
  pesoRevisao: 2.0,
  pesoDesenvolvimento: 3.0,
  pesoConclusoes: 2.0,
  pesoCoerencia: 3.0,
  pesoQualidade: 1.0,
  pesoDominio: 3.0,
  pesoClareza: 2.0,
  pesoObservancia: 1.0,
  pesoFase1: 0.7,
  pesoFase2: 0.3,
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
    calendario: {
      findMany: async ({ where }: any = {}) => {
        const pedidos: string[] | undefined = where?.semestre?.in;
        return [calendario2025_1].filter((c) => !pedidos || pedidos.includes(c.semestre));
      },
    },
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
      findMany: async ({ where }: any) => ARQUIVADOS.filter((a) => casaWhere(a, where)),
      findFirst: async ({ where }: any) => ARQUIVADOS.filter((a) => casaWhere(a, where))[0] ?? null,
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

    // Uma lista só, período mais recente primeiro — vivo e encerrado misturados.
    expect(lista[0].titulo).toBe('TCC vivo de 2025.2');
    expect(lista.map((t) => t.titulo).slice(1).sort()).toEqual([
      'TCC arquivado de 2025.1',
      'TCC arquivado sem nota final',
      'TCC reprovado na Fase I',
    ]);
  });

  it('o registro arquivado chega com a mesma forma usada pelas telas', async () => {
    const lista: any[] = await servico.historicoCoordenador('coord-1');
    const arq = lista.find((t) => t.titulo === 'TCC arquivado de 2025.1');

    expect(arq.aluno.nomeCompleto).toBe('Aluno Apagado'); // conta apagada, nome sobrevive
    expect(arq.orientador.nomeCompleto).toBe('Prof Um');
    expect(arq.faseAtual).toBe('CONCLUIDO');
    expect(arq.fase1ValidadaEm).toBe('2025-04-01T00:00:00.000Z'); // timeline preenchida
    expect(arq.pesoFase1).toBe(0.7); // peso do calendário daquele semestre, não o padrão
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

describe('Duplo-cego da Fase I na lista unificada', () => {
  it('avaliador só da Fase I não recebe identidade nem documentos', async () => {
    const lista: any[] = await servico.historicoProfessor(PROF);
    const cego = lista.find((t) => t.titulo === 'TCC reprovado na Fase I');

    expect(cego).toBeTruthy(); // o registro aparece, mas anônimo
    expect(cego.aluno).toBeNull();
    expect(cego.orientador).toBeNull();
    expect(cego.orientadorId).toBeNull();
    expect(cego.documentos).toEqual([]);
    const cru = JSON.stringify(cego);
    expect(cru).not.toContain('Aluno Reprovado');
    expect(cru).not.toContain('Prof Orientador Dois');
    expect(cru).not.toContain('monografia-do-aluno.pdf');
  });

  it('coordenador vê o mesmo TCC com tudo no lugar', async () => {
    const lista: any[] = await servico.historicoCoordenador('coord-1');
    const item = lista.find((t) => t.titulo === 'TCC reprovado na Fase I');

    expect(item.aluno.nomeCompleto).toBe('Aluno Reprovado');
    expect(item.orientador.nomeCompleto).toBe('Prof Orientador Dois');
    expect(item.documentos).toHaveLength(1);
  });
});

describe('Documento de avaliação da banca', () => {
  it('não chega ao professor na lista de documentos', async () => {
    const lista: any[] = await servico.historicoProfessor(PROF);
    const arq = lista.find((t) => t.titulo === 'TCC arquivado de 2025.1');

    expect(arq.documentos.map((d: any) => d.tipo)).toEqual(['VERSAO_FINAL']);
    expect(JSON.stringify(arq)).not.toContain('ata-da-banca.pdf');
  });

  it('coordenador continua recebendo o documento da banca', async () => {
    const lista: any[] = await servico.historicoCoordenador('coord-1');
    const arq = lista.find((t) => t.titulo === 'TCC arquivado de 2025.1');

    expect(arq.documentos.map((d: any) => d.tipo)).toEqual(['VERSAO_FINAL', 'AVALIACAO_BANCA']);
  });
});

describe('Notas de TCC arquivado sem nota final', () => {
  it('professor não recebe NF, notas por critério nem pareceres', async () => {
    const lista: any[] = await servico.historicoProfessor(PROF);
    const semNf = lista.find((t) => t.titulo === 'TCC arquivado sem nota final');

    expect(semNf.nf).toBeNull();
    expect(semNf.nf1).toBeNull();
    expect(semNf.nf2).toBeNull();
    expect(semNf.resultado).toBeNull();
    const membro = semNf.bancas[0].membros[0];
    expect(membro.nota).toBeNull();
    expect(membro.notaCoerencia).toBeNull();
    expect(membro.parecer).toBeNull();
    expect(JSON.stringify(semNf)).not.toContain('parecer sigiloso');
  });

  it('coordenador vê as notas do mesmo registro', async () => {
    const lista: any[] = await servico.historicoCoordenador('coord-1');
    const semNf = lista.find((t) => t.titulo === 'TCC arquivado sem nota final');

    expect(semNf.nf1).toBe(7);
    expect(semNf.bancas[0].membros[0].nota).toBe(9);
    expect(semNf.bancas[0].membros[0].parecer).toBe('parecer sigiloso');
  });

  it('TCC arquivado com nota confirmada continua liberado para o professor', async () => {
    const lista: any[] = await servico.historicoProfessor(PROF);
    const arq = lista.find((t) => t.titulo === 'TCC arquivado de 2025.1');

    expect(arq.nf).toBe(8.4);
    expect(arq.bancas[0].membros[0].nota).toBe(9);
  });
});

describe('Pesos históricos', () => {
  it('usa os pesos do calendário daquele semestre, não o padrão', async () => {
    const lista: any[] = await servico.historicoCoordenador('coord-1');
    const arq = lista.find((t) => t.titulo === 'TCC arquivado de 2025.1');

    // Denominador por critério (o que a tela mostra em "nota / peso").
    expect(arq.pesos).toMatchObject({ pesoCoerencia: 3.0, pesoQualidade: 1.0, pesoDominio: 3.0 });
    expect(arq.pesoFase1).toBe(0.7);
    expect(arq.pesoFase2).toBe(0.3);
  });

  it('sem calendário daquele semestre, cai num padrão seguro', async () => {
    prisma.calendario.findMany = async () => []; // período antigo demais
    const lista: any[] = await servico.historicoCoordenador('coord-1');
    const arq = lista.find((t) => t.titulo === 'TCC arquivado de 2025.1');

    expect(arq.pesos).toBeNull();
    expect(arq.pesoFase1).toBe(0.6); // pesos gravados no snapshot
    expect(arq.pesoFase2).toBe(0.4);
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
