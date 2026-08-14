// Encerramento de período: nada é apagado antes do arquivamento confirmado, professores e
// coordenadores nunca são apagados, contas com vínculo em outro período são preservadas e o
// histórico continua acessível depois das exclusões.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { EncerramentoService } from './encerramento.service';
import { HistoricoArquivadoService } from './historico-arquivado.service';

vi.mock('bcryptjs', () => ({ compare: vi.fn(async (a: string) => a === 'senha-certa') }));
vi.mock('../drive/drive-api', () => ({
  apagarArquivo: vi.fn(async () => undefined),
  arquivoValido: vi.fn(async () => true),
  baixarArquivo: vi.fn(async () => Buffer.from('conteudo-do-pdf')),
}));
vi.mock('../comum/semestre', () => ({ resolverSemestreAtivo: vi.fn(async () => '2026.2') }));

function baseTcc(over: Record<string, any> = {}) {
  return {
    id: 't1',
    titulo: 'TCC de teste',
    semestre: '2026.2',
    faseAtual: 'CONCLUIDO',
    nf: 8.5,
    resultado: 'APROVADO',
    alunoId: 'aluno1',
    orientadorId: 'prof1',
    coorientadorId: null,
    aluno: { id: 'aluno1', nomeCompleto: 'Lucas', email: 'lucas@ufpe.br', curso: 'ENGENHARIA_ELETRICA', papel: 'ALUNO' },
    orientador: { id: 'prof1', nomeCompleto: 'Ana' },
    coorientador: null,
    documentos: [
      {
        id: 'd1',
        tipo: 'VERSAO_FINAL',
        versao: 1,
        status: 'APROVADO',
        nomeArquivo: 'final.pdf',
        caminho: 'uploads/final.pdf',
        criadoEm: new Date(),
      },
    ],
    bancas: [
      {
        membros: [
          { avaliadorId: 'ext1', avaliador: { id: 'ext1', nomeCompleto: 'Carlos', papel: 'AVALIADOR' } },
          { avaliadorId: 'prof2', avaliador: { id: 'prof2', nomeCompleto: 'Bia', papel: 'PROFESSOR' } },
        ],
      },
    ],
    ...over,
  };
}

function prismaFalso(over: Record<string, any> = {}) {
  const arquivados: any[] = [];
  const participantes: any[] = [];
  const docsArquivados: any[] = [];
  const p: any = {
    _arquivados: arquivados,
    _participantes: participantes,
    _docsArquivados: docsArquivados,
    _apagados: [] as string[],
    usuario: {
      findUnique: vi.fn(async () => ({ id: 'c1', senhaHash: 'hash' })),
      delete: vi.fn(async ({ where }: any) => {
        p._apagados.push(where.id);
        return {};
      }),
    },
    tcc: {
      findMany: vi.fn(async () => [baseTcc()]),
      count: vi.fn(async () => 0),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
    membroBanca: { count: vi.fn(async () => 0) },
    // Fila do Drive: `_statusNaFila` simula o que existe pendente, e o count respeita o
    // filtro de status recebido — é isso que faz o teste enxergar PROCESSANDO.
    _statusNaFila: [] as string[],
    syncDrive: {
      count: vi.fn(async ({ where }: any = {}) => {
        const filtro: string[] = where?.status?.in ?? [];
        return p._statusNaFila.filter((s: string) => filtro.includes(s)).length;
      }),
    },
    documentoTcc: {
      // Documento preservável padrão: versão final APROVADA.
      findMany: vi.fn(async () => [
        { id: 'd1', tipo: 'VERSAO_FINAL', versao: 1, status: 'APROVADO', criadoEm: new Date() },
      ]),
    },
    driveArquivo: {
      findUnique: vi.fn(async ({ where }: any) => ({
        driveId: `drive-${where.tccId_chave.chave}`,
        chave: where.tccId_chave.chave,
        nome: 'Versão final v1.pdf',
      })),
      findMany: vi.fn(async () => [
        { chave: 'PASTA', driveId: 'p', nome: 'pasta' },
        { chave: 'DADOS_JSON', driveId: 'j', nome: 'dados.json' },
        { chave: 'RESUMO_TXT', driveId: 'r', nome: 'resumo.txt' },
        { chave: 'DOC:d1', driveId: 'f', nome: 'Versão final v1.pdf' },
        { chave: 'DOC:d0', driveId: 'i', nome: 'Monografia v1.docx' },
      ]),
    },
    tccArquivado: {
      // Idempotente por tccIdOriginal (chave única): repetir atualiza, não duplica.
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const achado = arquivados.find((a) => a.tccIdOriginal === where.tccIdOriginal);
        if (achado) {
          Object.assign(achado, update);
          return achado;
        }
        const a = { id: `a${arquivados.length + 1}`, ...create };
        arquivados.push(a);
        return a;
      }),
      // include: { documentos: true } — devolve os documentos arquivados junto.
      findMany: vi.fn(async () => arquivados.map((a) => ({ ...a, documentos: docsArquivados.filter((d) => d.arquivadoId === a.id) }))),
      findFirst: vi.fn(async () => arquivados[0] ?? null),
    },
    documentoArquivado: {
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const c = where.arquivadoId_tipo_versao;
        const achado = docsArquivados.find(
          (d) => d.arquivadoId === c.arquivadoId && d.tipo === c.tipo && d.versao === c.versao,
        );
        if (achado) {
          Object.assign(achado, update);
          return achado;
        }
        const novo = { id: `da${docsArquivados.length + 1}`, ...create };
        docsArquivados.push(novo);
        return novo;
      }),
    },
    tccArquivadoParticipante: {
      upsert: vi.fn(async ({ where, create }: any) => {
        const chave = where.arquivadoId_usuarioId_papel;
        const achado = participantes.find(
          (x) => x.arquivadoId === chave.arquivadoId && x.usuarioId === chave.usuarioId && x.papel === chave.papel,
        );
        if (achado) return achado;
        participantes.push(create);
        return create;
      }),
    },
    ...over,
  };
  return p;
}

const driveFalso = (conectado = true) =>
  ({ conectado: vi.fn(async () => conectado), accessToken: vi.fn(async () => 'tok') }) as any;

const syncFalso = () =>
  ({
    garantirPastaTcc: vi.fn(async () => 'pasta'),
    gravarDados: vi.fn(async () => undefined),
    montarConteudo: vi.fn(async () => ({ dados: { tcc: { titulo: 'TCC de teste' } }, resumo: 'resumo legível' })),
  }) as any;

// O encerramento copia arquivos DE VERDADE. Cada teste roda numa raiz temporária própria
// (process.cwd mockado), com o documento do TCC existindo no disco.
let raiz: string;
let espiaoCwd: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  vi.clearAllMocks();
  raiz = await fs.mkdtemp(join(tmpdir(), 'tcc-encerr-'));
  await fs.mkdir(join(raiz, 'uploads'), { recursive: true });
  await fs.writeFile(join(raiz, 'uploads', 'final.pdf'), 'conteudo da versao final');
  espiaoCwd = vi.spyOn(process, 'cwd').mockReturnValue(raiz);
});

afterEach(async () => {
  // Restaura SÓ o cwd: restoreAllMocks zeraria também as implementações dos mocks de
  // módulo (arquivoValido, apagarArquivo…), fazendo-os devolver undefined.
  espiaoCwd.mockRestore();
  await fs.rm(raiz, { recursive: true, force: true });
});

describe('Travas antes de apagar', () => {
  it('confirmação errada não apaga nada', async () => {
    const p = prismaFalso();
    const s = new EncerramentoService(p, driveFalso(), syncFalso());
    await expect(s.encerrar('c1', 'senha-certa', 'APAGAR')).rejects.toMatchObject({ status: 400 });
    expect(p.tcc.deleteMany).not.toHaveBeenCalled();
  });

  it('senha errada não apaga nada', async () => {
    const p = prismaFalso();
    const s = new EncerramentoService(p, driveFalso(), syncFalso());
    await expect(s.encerrar('c1', 'senha-errada', 'ENCERRAR')).rejects.toMatchObject({ status: 400 });
    expect(p.tcc.deleteMany).not.toHaveBeenCalled();
  });

  // O arquivo LOCAL é a garantia. Se a cópia de qualquer documento falhar, nada é apagado.
  it('documento sumido do disco ABORTA o encerramento', async () => {
    const p = prismaFalso();
    await fs.rm(join(raiz, 'uploads', 'final.pdf')); // arquivo ativo não existe mais
    const s = new EncerramentoService(p, driveFalso(), syncFalso());

    await expect(s.encerrar('c1', 'senha-certa', 'ENCERRAR')).rejects.toMatchObject({ status: 400 });
    expect(p.tcc.deleteMany).not.toHaveBeenCalled();
    expect(p.usuario.delete).not.toHaveBeenCalled();
  });

  it('sem nenhum documento válido para arquivar, ABORTA', async () => {
    const p = prismaFalso();
    p.tcc.findMany = vi.fn(async () => [baseTcc({ documentos: [] })]);
    const s = new EncerramentoService(p, driveFalso(), syncFalso());

    await expect(s.encerrar('c1', 'senha-certa', 'ENCERRAR')).rejects.toMatchObject({ status: 400 });
    expect(p.tcc.deleteMany).not.toHaveBeenCalled();
  });

  it('falha na revalidação final ABORTA antes de apagar', async () => {
    const p = prismaFalso();
    // O registro é gravado, mas a revalidação não encontra o arquivo (simula corrupção
    // entre a cópia e a exclusão).
    p.tccArquivado.findMany = vi.fn(async () => [
      { id: 'a1', titulo: 'TCC de teste', documentos: [{ caminho: 'arquivo-permanente/x/y.pdf', tamanho: 10, sha256: 'abc', nomeArquivo: 'y.pdf' }] },
    ]);
    const s = new EncerramentoService(p, driveFalso(), syncFalso());

    await expect(s.encerrar('c1', 'senha-certa', 'ENCERRAR')).rejects.toMatchObject({ status: 400 });
    expect(p.tcc.deleteMany).not.toHaveBeenCalled();
    expect(p.usuario.delete).not.toHaveBeenCalled();
  });
});

// O Drive é cópia ADICIONAL: sua ausência ou falha não pode impedir o encerramento.
describe('Drive é opcional', () => {
  it('SEM Drive conectado o encerramento acontece e marca a cópia como pendente', async () => {
    const p = prismaFalso();
    const s = new EncerramentoService(p, driveFalso(false), syncFalso());
    const r = await s.encerrar('c1', 'senha-certa', 'ENCERRAR');

    expect(r.arquivadoLocalmente).toBe(true);
    expect(r.driveConectado).toBe(false);
    expect(r.copiaDrivePendente).toBe(1);
    expect(r.tccsApagados).toBe(1); // apagou normalmente
    expect(p._docsArquivados).toHaveLength(1); // com o documento guardado localmente
  });

  it('falha do Drive não impede o encerramento (fica pendente)', async () => {
    const p = prismaFalso();
    const sync = syncFalso();
    sync.gravarDados = vi.fn(async () => {
      throw new Error('Drive fora do ar');
    });
    const s = new EncerramentoService(p, driveFalso(), sync);
    const r = await s.encerrar('c1', 'senha-certa', 'ENCERRAR');

    expect(r.copiaDrivePendente).toBe(1);
    expect(r.tccsApagados).toBe(1);
  });

  it('pendência na fila do Drive não bloqueia mais o encerramento', async () => {
    const p = prismaFalso();
    p._statusNaFila = ['PENDENTE', 'PROCESSANDO', 'ERRO'];
    const s = new EncerramentoService(p, driveFalso(false), syncFalso());

    await expect(s.encerrar('c1', 'senha-certa', 'ENCERRAR')).resolves.toMatchObject({ tccsApagados: 1 });
  });

  it('a prévia libera o encerramento mesmo sem Drive', async () => {
    const p = prismaFalso();
    p._statusNaFila = ['PROCESSANDO'];
    const r = await new EncerramentoService(p, driveFalso(false), syncFalso()).previa();

    expect(r.conectadoAoDrive).toBe(false);
    expect(r.pendenciasSincronizacao).toBe(1); // informado…
    expect(r.podeEncerrar).toBe(true); // …mas não bloqueia
  });
});

describe('Encerramento completo', () => {
  it('arquiva antes de apagar e apaga só aluno e avaliador externo', async () => {
    const p = prismaFalso();
    const s = new EncerramentoService(p, driveFalso(), syncFalso());
    const r = await s.encerrar('c1', 'senha-certa', 'ENCERRAR');

    // Arquivou primeiro
    expect(p.tccArquivado.upsert).toHaveBeenCalled();
    expect(r.tccsArquivados).toBe(1);
    // Apagou TCCs
    expect(p.tcc.deleteMany).toHaveBeenCalledWith({ where: { semestre: '2026.2' } });
    // Contas: aluno + avaliador externo SIM; professores NÃO
    expect(p._apagados.sort()).toEqual(['aluno1', 'ext1']);
    expect(p._apagados).not.toContain('prof1');
    expect(p._apagados).not.toContain('prof2');
  });

  it('guarda o histórico com os dados do aluno em TEXTO (sobrevive à exclusão da conta)', async () => {
    const p = prismaFalso();
    const s = new EncerramentoService(p, driveFalso(), syncFalso());
    await s.encerrar('c1', 'senha-certa', 'ENCERRAR');

    const a = p._arquivados[0];
    expect(a.alunoNome).toBe('Lucas');
    expect(a.alunoEmail).toBe('lucas@ufpe.br');
    expect(a.titulo).toBe('TCC de teste');
    expect(a.resumoTexto).toBe('resumo legível');
    expect(JSON.parse(a.dadosJson).tcc.titulo).toBe('TCC de teste');
    // Sem FK para a conta apagada: só referência textual do TCC original.
    expect(a.tccIdOriginal).toBe('t1');
  });

  it('registra como participantes apenas professores (contas que nunca são apagadas)', async () => {
    const p = prismaFalso();
    const s = new EncerramentoService(p, driveFalso(), syncFalso());
    await s.encerrar('c1', 'senha-certa', 'ENCERRAR');

    const ids = p._participantes.map((x: any) => x.usuarioId).sort();
    expect(ids).toEqual(['prof1', 'prof2']);
    expect(ids).not.toContain('ext1'); // avaliador externo é apagado
    expect(ids).not.toContain('aluno1');
  });

  it('poda o Drive mantendo dados.json, resumo.txt e o arquivo final', async () => {
    const p = prismaFalso();
    const { apagarArquivo } = await import('../drive/drive-api');
    const s = new EncerramentoService(p, driveFalso(), syncFalso());
    const r = await s.encerrar('c1', 'senha-certa', 'ENCERRAR');

    expect(r.arquivosPodadosNoDrive).toBe(1); // só a monografia intermediária
    expect(vi.mocked(apagarArquivo)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(apagarArquivo).mock.calls[0][1]).toBe('i'); // id da monografia
  });

  it('nunca escolhe versão REJEITADA: prefere a final aprovada', async () => {
    const p = prismaFalso();
    // O service filtra por status preserváveis; a rejeitada nem chega na consulta.
    p.documentoTcc.findMany = vi.fn(async ({ where }: any) => {
      const todos = [
        { id: 'dRejeitada', tipo: 'VERSAO_FINAL', versao: 3, status: 'REJEITADO', criadoEm: new Date() },
        { id: 'dAprovada', tipo: 'VERSAO_FINAL', versao: 2, status: 'APROVADO', criadoEm: new Date() },
      ];
      const permitidos: string[] = where?.status?.in ?? [];
      return todos.filter((d) => permitidos.includes(d.status));
    });
    const s = new EncerramentoService(p, driveFalso(), syncFalso());
    await s.encerrar('c1', 'senha-certa', 'ENCERRAR');

    // O mapeamento buscado é o da APROVADA, nunca o da rejeitada.
    const chaves = p.driveArquivo.findUnique.mock.calls.map((c: any) => c[0].where.tccId_chave.chave);
    expect(chaves).toContain('DOC:dAprovada');
    expect(chaves).not.toContain('DOC:dRejeitada');
  });

  it('poda o Drive mantendo dados.json, resumo.txt e o arquivo final', async () => {
    const p = prismaFalso();
    const { apagarArquivo } = await import('../drive/drive-api');
    const s = new EncerramentoService(p, driveFalso(), syncFalso());
    const r = await s.encerrar('c1', 'senha-certa', 'ENCERRAR');

    expect(r.arquivosPodadosNoDrive).toBe(1); // só a monografia intermediária
    expect(vi.mocked(apagarArquivo)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(apagarArquivo).mock.calls[0][1]).toBe('i');
  });

  it('retomar o encerramento não duplica histórico, participante nem documento', async () => {
    const p = prismaFalso();
    const s = new EncerramentoService(p, driveFalso(), syncFalso());
    await s.encerrar('c1', 'senha-certa', 'ENCERRAR');

    // Simula a retomada (interrupção antes de a limpeza terminar, ou um 2º coordenador):
    // os arquivos de origem ainda existem e o encerramento roda de novo sobre o mesmo TCC.
    await fs.writeFile(join(raiz, 'uploads', 'final.pdf'), 'conteudo da versao final');
    await s.encerrar('c1', 'senha-certa', 'ENCERRAR');

    expect(p._arquivados).toHaveLength(1); // upsert por tccIdOriginal
    expect(p._participantes).toHaveLength(2); // prof1 + prof2, sem repetição
    expect(p._docsArquivados).toHaveLength(1); // upsert por (arquivado, tipo, versão)
  });

  it('coorientador externo entra na análise e é apagado quando só existe neste período', async () => {
    const p = prismaFalso();
    p.tcc.findMany = vi.fn(async () => [
      baseTcc({
        coorientadorId: 'ext2',
        coorientador: { id: 'ext2', nomeCompleto: 'Diego', email: 'diego@x.com', papel: 'AVALIADOR' },
      }),
    ]);
    const s = new EncerramentoService(p, driveFalso(), syncFalso());
    const r = await s.encerrar('c1', 'senha-certa', 'ENCERRAR');

    expect(p._apagados).toContain('ext2');
    expect(r.contasApagadas).toContain('Diego');
  });

  it('coorientador externo com vínculo em outro período é PRESERVADO', async () => {
    const p = prismaFalso();
    p.tcc.findMany = vi.fn(async () => [
      baseTcc({
        coorientadorId: 'ext2',
        coorientador: { id: 'ext2', nomeCompleto: 'Diego', email: 'diego@x.com', papel: 'AVALIADOR' },
      }),
    ]);
    // Diego coorienta outro TCC, de outro semestre.
    p.tcc.count = vi.fn(async ({ where }: any) => (where.coorientadorId === 'ext2' && where.semestre ? 1 : 0));
    const s = new EncerramentoService(p, driveFalso(), syncFalso());
    const r = await s.encerrar('c1', 'senha-certa', 'ENCERRAR');

    expect(p._apagados).not.toContain('ext2');
    expect(r.contasPreservadas.some((c: any) => c.nome === 'Diego')).toBe(true);
  });

  it('preserva conta com vínculo em outro período e informa o motivo', async () => {
    const p = prismaFalso();
    // O aluno aparece em TCC de outro semestre.
    p.tcc.count = vi.fn(async ({ where }: any) => (where.alunoId === 'aluno1' && where.semestre ? 1 : 0));
    const s = new EncerramentoService(p, driveFalso(), syncFalso());
    const r = await s.encerrar('c1', 'senha-certa', 'ENCERRAR');

    expect(p._apagados).not.toContain('aluno1');
    expect(r.contasPreservadas.some((c: any) => /outro período/.test(c.motivo))).toBe(true);
  });
});

describe('Prévia de impacto (não muda nada)', () => {
  it('mostra contagens e não apaga nem arquiva', async () => {
    const p = prismaFalso();
    const s = new EncerramentoService(p, driveFalso(), syncFalso());
    const r = await s.previa();

    expect(r.semestre).toBe('2026.2');
    expect(r.tccs).toBe(1);
    expect(r.contasParaApagar.map((c: any) => c.nome).sort()).toEqual(['Carlos', 'Lucas']);
    expect(p.tcc.deleteMany).not.toHaveBeenCalled();
    expect(p.tccArquivado.upsert).not.toHaveBeenCalled();
    expect(p.usuario.delete).not.toHaveBeenCalled();
  });

  it('informa as pendências do Drive sem travar o encerramento', async () => {
    const p = prismaFalso();
    p._statusNaFila = ['PENDENTE', 'PROCESSANDO', 'ERRO'];
    const s = new EncerramentoService(p, driveFalso(), syncFalso());
    const r = await s.previa();

    expect(r.pendenciasSincronizacao).toBe(3); // mostrado na tela…
    expect(r.podeEncerrar).toBe(true); // …mas o arquivo local é que garante
  });

  it('sem TCC no período não há o que encerrar', async () => {
    const p = prismaFalso();
    p.tcc.findMany = vi.fn(async () => []);
    const r = await new EncerramentoService(p, driveFalso(), syncFalso()).previa();
    expect(r.podeEncerrar).toBe(false);
  });
});

describe('Histórico arquivado: permissões e acesso após a exclusão', () => {
  function prismaHistorico(documentos: any[] = []) {
    return {
      tccArquivado: {
        findMany: vi.fn(async () => [{ id: 'a1', titulo: 'TCC de teste', alunoNome: 'Lucas', _count: { documentos: 1 } }]),
        findFirst: vi.fn(async () => ({
          id: 'a1',
          titulo: 'TCC',
          dadosJson: '{"ok":true}',
          documentos,
          driveArquivoFinalId: 'f',
          driveArquivoFinalNome: 'final.pdf',
        })),
      },
    } as any;
  }

  it('coordenador vê tudo; professor é filtrado por participação', async () => {
    const p = prismaHistorico();
    const s = new HistoricoArquivadoService(p, driveFalso());

    await s.listar('c1', 'COORDENADOR');
    expect(p.tccArquivado.findMany.mock.calls[0][0].where).toEqual({});

    await s.listar('prof1', 'PROFESSOR');
    expect(p.tccArquivado.findMany.mock.calls[1][0].where).toEqual({ participantes: { some: { usuarioId: 'prof1' } } });
  });

  it('aluno e avaliador recebem 403 no histórico arquivado', async () => {
    const s = new HistoricoArquivadoService(prismaHistorico(), driveFalso());
    await expect(s.listar('x', 'ALUNO')).rejects.toMatchObject({ status: 403 });
    await expect(s.listar('x', 'AVALIADOR')).rejects.toMatchObject({ status: 403 });
  });

  it('o download vem do ARQUIVO LOCAL, sem tocar no Drive', async () => {
    const rel = join('arquivo-permanente', '2026.2', 't1', 'VERSAO_FINAL-v1.pdf');
    await fs.mkdir(join(raiz, 'arquivo-permanente', '2026.2', 't1'), { recursive: true });
    await fs.writeFile(join(raiz, rel), 'pdf arquivado localmente');

    const p = prismaHistorico([{ id: 'da1', caminho: rel, nomeArquivo: 'final.pdf', ehFinal: true }]);
    const { baixarArquivo } = await import('../drive/drive-api');
    const s = new HistoricoArquivadoService(p, driveFalso());

    const r = await s.baixar('a1', 'c1', 'COORDENADOR');
    expect(r.nome).toBe('final.pdf');
    expect(r.conteudo.toString()).toBe('pdf arquivado localmente');
    expect(vi.mocked(baixarArquivo)).not.toHaveBeenCalled(); // Drive nem foi consultado
  });

  it('o histórico continua acessível mesmo SEM Drive nenhum', async () => {
    const rel = join('arquivo-permanente', '2026.2', 't1', 'MONOGRAFIA-v2.docx');
    await fs.mkdir(join(raiz, 'arquivo-permanente', '2026.2', 't1'), { recursive: true });
    await fs.writeFile(join(raiz, rel), 'monografia arquivada');

    const p = prismaHistorico([{ id: 'da2', caminho: rel, nomeArquivo: 'mono.docx', ehFinal: true }]);
    p.tccArquivado.findFirst = vi.fn(async () => ({
      id: 'a1',
      dadosJson: '{}',
      documentos: [{ id: 'da2', caminho: rel, nomeArquivo: 'mono.docx', ehFinal: true }],
      driveArquivoFinalId: null, // nunca houve cópia no Drive
    }));
    const s = new HistoricoArquivadoService(p, driveFalso());

    await expect(s.baixar('a1', 'c1', 'COORDENADOR')).resolves.toMatchObject({ nome: 'mono.docx' });
  });

  it('cai para o Drive só se a cópia local estiver inacessível', async () => {
    const p = prismaHistorico([{ id: 'da3', caminho: 'arquivo-permanente/sumiu.pdf', nomeArquivo: 'x.pdf', ehFinal: true }]);
    const { baixarArquivo } = await import('../drive/drive-api');
    const s = new HistoricoArquivadoService(p, driveFalso());

    const r = await s.baixar('a1', 'c1', 'COORDENADOR');
    expect(r.conteudo.toString()).toBe('conteudo-do-pdf');
    expect(vi.mocked(baixarArquivo)).toHaveBeenCalledWith('tok', 'f');
  });

  it('o detalhe devolve os dados sem o JSON cru duplicado', async () => {
    const s = new HistoricoArquivadoService(prismaHistorico(), driveFalso());
    const d: any = await s.detalhe('a1', 'c1', 'COORDENADOR');
    expect(d.dados).toEqual({ ok: true });
    expect(d).not.toHaveProperty('dadosJson');
  });
});
