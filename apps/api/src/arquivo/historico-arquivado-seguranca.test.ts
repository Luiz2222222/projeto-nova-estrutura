// Rotas PRÓPRIAS do histórico arquivado (/historico-arquivado, /:id, /:id/baixar,
// /:id/visualizar). A lista unificada já anonimiza o avaliador cego da Fase I — estas rotas
// não podem virar a porta dos fundos que devolve o mesmo registro cru.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HistoricoArquivadoService } from './historico-arquivado.service';

const AVALIADOR_CEGO = 'prof-cego'; // só banca da Fase I do TCC reprovado nela
const ORIENTADOR = 'prof-orientador';

// Snapshot no formato que o encerramento grava em dadosJson.
const snapshotReprovado = {
  tcc: { criadoEm: '2025-02-01T00:00:00.000Z' },
  aluno: { nomeCompleto: 'Aluno Reprovado', email: 'reprovado@x', curso: 'ENGENHARIA_ELETRICA' },
  orientador: { nomeCompleto: 'Prof Orientador', tratamento: 'Dr.' },
  coorientador: { nomeCompleto: 'Prof Coorientador' },
  notas: { nf1: 4, nf2: null, nf: null, resultado: 'REPROVADO' },
  documentos: [{ id: 'd-mono', nomeArquivo: 'monografia-do-aluno.pdf' }],
  bancas: [{ fase: 'FASE_1', membros: [{ avaliadorId: AVALIADOR_CEGO, nome: 'Prof Cego', notaTotal: 4 }] }],
};

const reprovadoF1 = {
  id: 'arq-reprovado',
  semestre: '2025.1',
  titulo: 'Trabalho reprovado na Fase I',
  alunoNome: 'Aluno Reprovado',
  alunoEmail: 'reprovado@x',
  alunoCurso: 'ENGENHARIA_ELETRICA',
  orientadorNome: 'Prof Orientador',
  coorientadorNome: 'Prof Coorientador',
  nf1: 4,
  nf2: null,
  nf: null,
  resultado: 'REPROVADO',
  faseFinal: 'REPROVADO_FASE_1',
  concluidoEm: null,
  arquivadoEm: new Date('2025-07-15'),
  arquivadoLocalEm: new Date('2025-07-15'),
  driveArquivoFinalId: null,
  driveArquivoFinalNome: 'monografia-do-aluno.pdf',
  dadosJson: JSON.stringify(snapshotReprovado),
  documentos: [
    { id: 'd-mono', tipo: 'MONOGRAFIA', nomeArquivo: 'monografia-do-aluno.pdf', versao: 1, status: 'REJEITADO', tamanho: 10, caminho: 'arquivo-permanente/x.pdf', ehFinal: true },
  ],
  participantes: [
    { usuarioId: ORIENTADOR, papel: 'ORIENTADOR' },
    { usuarioId: AVALIADOR_CEGO, papel: 'BANCA' },
  ],
};

// TCC concluído normal, com um documento da banca (interno da coordenação).
const concluido = {
  id: 'arq-concluido',
  semestre: '2025.1',
  titulo: 'Trabalho concluído',
  alunoNome: 'Aluno Aprovado',
  alunoEmail: 'aprovado@x',
  alunoCurso: 'ENGENHARIA_ELETRICA',
  orientadorNome: 'Prof Orientador',
  coorientadorNome: null,
  nf1: 8,
  nf2: 9,
  nf: 8.4,
  resultado: 'APROVADO',
  faseFinal: 'CONCLUIDO',
  concluidoEm: new Date('2025-06-30'),
  arquivadoEm: new Date('2025-07-15'),
  arquivadoLocalEm: new Date('2025-07-15'),
  driveArquivoFinalId: null,
  driveArquivoFinalNome: 'final.pdf',
  dadosJson: JSON.stringify({ notas: { nf: 8.4 }, bancas: [] }),
  documentos: [
    { id: 'd-final', tipo: 'VERSAO_FINAL', nomeArquivo: 'final.pdf', versao: 1, status: 'APROVADO', tamanho: 10, caminho: 'arquivo-permanente/f.pdf', ehFinal: true },
    { id: 'd-banca', tipo: 'AVALIACAO_BANCA', nomeArquivo: 'ata-da-banca.pdf', versao: 1, status: 'CONCLUIDO', tamanho: 10, caminho: 'arquivo-permanente/b.pdf', ehFinal: false },
  ],
  participantes: [{ usuarioId: ORIENTADOR, papel: 'ORIENTADOR' }],
};

// Em andamento: sem nota final e sem fase terminal — notas ainda não liberadas.
const emAndamento = {
  ...concluido,
  id: 'arq-andamento',
  titulo: 'Trabalho sem nota final',
  nf1: 7,
  nf2: null,
  nf: null,
  resultado: null,
  faseFinal: 'EM_BANCA_FASE_2',
  dadosJson: JSON.stringify({
    notas: { nf1: 7, nf2: null, nf: null, resultado: null },
    bancas: [
      {
        fase: 'FASE_2',
        membros: [
          { avaliadorId: ORIENTADOR, nome: 'Prof Orientador', notaTotal: 9, parecer: 'parecer sigiloso', notasPorCriterio: { Coerência: 2 } },
        ],
      },
    ],
  }),
  documentos: [concluido.documentos[0]],
};

const BASE = [reprovadoF1, concluido, emAndamento];

function prismaFalso() {
  const casa = (a: any, where: any) => {
    if (where.id && a.id !== where.id) return false;
    const usuarioId = where.participantes?.some?.usuarioId;
    if (usuarioId) return a.participantes.some((p: any) => p.usuarioId === usuarioId);
    return true;
  };
  // Projeta como o Prisma faria: só o que o `select` pediu. Sem isso o fake devolveria
  // campos que a consulta real nunca traz (dadosJson, caminho em disco…) e o teste
  // deixaria de provar que o próprio `select` é parte da proteção.
  const projetar = (a: any, select: any) => {
    if (!select) return { ...a };
    const out: any = {};
    for (const [campo, pedido] of Object.entries(select)) {
      if (!pedido) continue;
      if (campo === '_count') out._count = { documentos: a.documentos.length };
      else if (campo === 'participantes') out.participantes = a.participantes;
      else out[campo] = a[campo];
    }
    return out;
  };

  return {
    tccArquivado: {
      findMany: vi.fn(async ({ where, select }: any) =>
        BASE.filter((a) => casa(a, where ?? {})).map((a) => projetar(a, select)),
      ),
      findFirst: vi.fn(async ({ where }: any) => BASE.find((a) => casa(a, where ?? {})) ?? null),
    },
  } as any;
}

let servico: HistoricoArquivadoService;

beforeEach(() => {
  servico = new HistoricoArquivadoService(prismaFalso(), { accessToken: vi.fn() } as any);
});

describe('Duplo-cego da Fase I nas rotas diretas', () => {
  it('a lista não entrega aluno, orientador nem contagem de documentos', async () => {
    const lista: any[] = await servico.listar(AVALIADOR_CEGO, 'PROFESSOR');
    const item = lista.find((i) => i.id === 'arq-reprovado');

    expect(item.alunoNome).toBeNull();
    expect(item.orientadorNome).toBeNull();
    expect(item.documentos).toBe(0);
    expect(JSON.stringify(item)).not.toContain('Aluno Reprovado');
    expect(JSON.stringify(item)).not.toContain('Prof Orientador');
  });

  it('o detalhe não entrega identidade, documentos nem snapshot bruto', async () => {
    const d: any = await servico.detalhe('arq-reprovado', AVALIADOR_CEGO, 'PROFESSOR');

    expect(d.alunoNome).toBeNull();
    expect(d.alunoEmail).toBeNull();
    expect(d.orientadorNome).toBeNull();
    expect(d.coorientadorNome).toBeNull();
    expect(d.documentos).toEqual([]);
    expect(d.dados.aluno).toBeUndefined();
    expect(d.dados.orientador).toBeUndefined();
    expect(d.dados.documentos).toBeUndefined();
    const cru = JSON.stringify(d);
    expect(cru).not.toContain('Aluno Reprovado');
    expect(cru).not.toContain('reprovado@x');
    expect(cru).not.toContain('monografia-do-aluno.pdf');
  });

  it('baixar e visualizar respondem 404, sem confirmar que o arquivo existe', async () => {
    // Ambas as rotas do controller chamam este mesmo método.
    await expect(servico.baixar('arq-reprovado', AVALIADOR_CEGO, 'PROFESSOR')).rejects.toMatchObject({ status: 404 });
    await expect(
      servico.baixar('arq-reprovado', AVALIADOR_CEGO, 'PROFESSOR', 'd-mono'),
    ).rejects.toMatchObject({ status: 404, response: { mensagem: 'Registro arquivado não encontrado.' } });
  });

  it('o orientador do MESMO TCC continua vendo tudo (não é cego)', async () => {
    const d: any = await servico.detalhe('arq-reprovado', ORIENTADOR, 'PROFESSOR');

    expect(d.alunoNome).toBe('Aluno Reprovado');
    expect(d.documentos).toHaveLength(1);
  });

  it('coordenador vê o registro normalmente', async () => {
    const lista: any[] = await servico.listar('coord-1', 'COORDENADOR');
    const item = lista.find((i) => i.id === 'arq-reprovado');
    const d: any = await servico.detalhe('arq-reprovado', 'coord-1', 'COORDENADOR');

    expect(item.alunoNome).toBe('Aluno Reprovado');
    expect(item.documentos).toBe(1);
    expect(d.dados.aluno.nomeCompleto).toBe('Aluno Reprovado');
    expect(d.documentos).toHaveLength(1);
  });
});

describe('Documento de avaliação da banca', () => {
  it('não aparece na lista de documentos do professor', async () => {
    const d: any = await servico.detalhe('arq-concluido', ORIENTADOR, 'PROFESSOR');

    expect(d.documentos.map((x: any) => x.tipo)).toEqual(['VERSAO_FINAL']);
  });

  it('não pode ser baixado por URL direta pelo professor', async () => {
    await expect(
      servico.baixar('arq-concluido', ORIENTADOR, 'PROFESSOR', 'd-banca'),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('a mensagem do 404 é a mesma de um id inexistente (não revela que existe)', async () => {
    const oculto = await servico
      .baixar('arq-concluido', ORIENTADOR, 'PROFESSOR', 'd-banca')
      .catch((e) => e.response?.mensagem);
    const inexistente = await servico
      .baixar('arq-concluido', ORIENTADOR, 'PROFESSOR', 'nao-existe')
      .catch((e) => e.response?.mensagem);

    expect(oculto).toBe(inexistente);
  });

  it('coordenador continua baixando o documento da banca', async () => {
    // O arquivo não existe em disco no teste, então cai no 404 de "sem documento
    // disponível" — o que importa é NÃO ser barrado pela regra de papel.
    const erro = await servico.baixar('arq-concluido', 'coord-1', 'COORDENADOR', 'd-banca').catch((e) => e);

    expect(erro.response?.mensagem).not.toBe('Registro arquivado não encontrado.');
    expect(erro.response?.mensagem).not.toBe('Documento arquivado não encontrado neste registro.');
  });
});

describe('Notas antes da liberação', () => {
  it('professor não recebe NF, notas por critério nem parecer de TCC sem nota final', async () => {
    const d: any = await servico.detalhe('arq-andamento', ORIENTADOR, 'PROFESSOR');

    expect(d.nf1).toBeNull();
    expect(d.nf2).toBeNull();
    expect(d.nf).toBeNull();
    expect(d.resultado).toBeNull();
    expect(d.dados.notas.nf1).toBeNull();
    expect(d.dados.bancas[0].membros[0].notaTotal).toBeNull();
    expect(d.dados.bancas[0].membros[0].notasPorCriterio).toEqual({});
    expect(JSON.stringify(d)).not.toContain('parecer sigiloso');
  });

  it('coordenador continua vendo as notas do mesmo registro', async () => {
    const d: any = await servico.detalhe('arq-andamento', 'coord-1', 'COORDENADOR');

    expect(d.nf1).toBe(7);
    expect(d.dados.bancas[0].membros[0].notaTotal).toBe(9);
    expect(d.dados.bancas[0].membros[0].parecer).toBe('parecer sigiloso');
  });

  it('TCC concluído (nf confirmada) segue liberado para o professor', async () => {
    const d: any = await servico.detalhe('arq-concluido', ORIENTADOR, 'PROFESSOR');

    expect(d.nf).toBe(8.4);
    expect(d.resultado).toBe('APROVADO');
  });
});
