// Encerramento de período: nada é apagado antes do arquivamento confirmado, professores e
// coordenadores nunca são apagados, contas com vínculo em outro período são preservadas e o
// histórico continua acessível depois das exclusões.
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
    documentos: [{ id: 'd1', tipo: 'VERSAO_FINAL', versao: 1, caminho: 'uploads/final.pdf', criadoEm: new Date() }],
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
  const p: any = {
    _arquivados: arquivados,
    _participantes: participantes,
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
      findMany: vi.fn(async () => arquivados),
      findFirst: vi.fn(async () => arquivados[0] ?? null),
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

beforeEach(() => vi.clearAllMocks());

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

  it('Drive desconectado bloqueia o encerramento', async () => {
    const p = prismaFalso();
    const s = new EncerramentoService(p, driveFalso(false), syncFalso());
    await expect(s.encerrar('c1', 'senha-certa', 'ENCERRAR')).rejects.toMatchObject({ status: 400 });
    expect(p.tcc.deleteMany).not.toHaveBeenCalled();
  });

  it('falha ao sincronizar um TCC aborta SEM apagar nada', async () => {
    const p = prismaFalso();
    const sync = syncFalso();
    sync.gravarDados = vi.fn(async () => {
      throw new Error('Drive fora do ar');
    });
    const s = new EncerramentoService(p, driveFalso(), sync);
    await expect(s.encerrar('c1', 'senha-certa', 'ENCERRAR')).rejects.toMatchObject({ status: 400 });
    expect(p.tcc.deleteMany).not.toHaveBeenCalled();
    expect(p.usuario.delete).not.toHaveBeenCalled();
  });

  it('pendência na fila bloqueia o encerramento', async () => {
    const p = prismaFalso();
    p._statusNaFila = ['PENDENTE', 'ERRO', 'PENDENTE'];
    const s = new EncerramentoService(p, driveFalso(), syncFalso());
    await expect(s.encerrar('c1', 'senha-certa', 'ENCERRAR')).rejects.toMatchObject({ status: 400 });
    expect(p.tcc.deleteMany).not.toHaveBeenCalled();
  });

  // Um upload em curso não garante que o arquivo esteja completo no Drive: enquanto houver
  // PROCESSANDO, nada pode ser apagado e a tela não pode dizer que dá para encerrar.
  it('item PROCESSANDO bloqueia o encerramento e NÃO apaga nada', async () => {
    const p = prismaFalso();
    p._statusNaFila = ['PROCESSANDO'];
    const s = new EncerramentoService(p, driveFalso(), syncFalso());

    await expect(s.encerrar('c1', 'senha-certa', 'ENCERRAR')).rejects.toMatchObject({ status: 400 });
    expect(p.tcc.deleteMany).not.toHaveBeenCalled(); // nenhum TCC apagado
    expect(p.usuario.delete).not.toHaveBeenCalled(); // nenhuma conta apagada
    expect(p.tccArquivado.upsert).not.toHaveBeenCalled(); // nem chegou a arquivar
  });

  it('fila vazia libera o encerramento', async () => {
    const p = prismaFalso();
    p._statusNaFila = [];
    const s = new EncerramentoService(p, driveFalso(), syncFalso());
    await expect(s.encerrar('c1', 'senha-certa', 'ENCERRAR')).resolves.toMatchObject({ tccsApagados: 1 });
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

  it('ABORTA tudo quando o arquivo final não está confirmado no Drive', async () => {
    const p = prismaFalso();
    const { arquivoValido, apagarArquivo } = await import('../drive/drive-api');
    vi.mocked(arquivoValido).mockResolvedValue(false); // o Drive não confirma o arquivo
    const s = new EncerramentoService(p, driveFalso(), syncFalso());

    await expect(s.encerrar('c1', 'senha-certa', 'ENCERRAR')).rejects.toMatchObject({ status: 400 });
    // Nada apagado, nada podado, nada arquivado.
    expect(p.tcc.deleteMany).not.toHaveBeenCalled();
    expect(p.usuario.delete).not.toHaveBeenCalled();
    expect(vi.mocked(apagarArquivo)).not.toHaveBeenCalled();
    expect(p.tccArquivado.upsert).not.toHaveBeenCalled();
    vi.mocked(arquivoValido).mockResolvedValue(true);
  });

  it('ABORTA quando o documento escolhido ainda não foi enviado ao Drive', async () => {
    const p = prismaFalso();
    p.driveArquivo.findUnique = vi.fn(async ({ where }: any) =>
      where.tccId_chave.chave.startsWith('DOC:') ? null : { driveId: 'x', chave: where.tccId_chave.chave, nome: 'n' },
    );
    const s = new EncerramentoService(p, driveFalso(), syncFalso());

    await expect(s.encerrar('c1', 'senha-certa', 'ENCERRAR')).rejects.toMatchObject({ status: 400 });
    expect(p.tcc.deleteMany).not.toHaveBeenCalled();
    expect(p.usuario.delete).not.toHaveBeenCalled();
  });

  it('ABORTA quando não há documento acadêmico válido para preservar', async () => {
    const p = prismaFalso();
    p.documentoTcc.findMany = vi.fn(async () => []); // só havia versões rejeitadas/substituídas
    const s = new EncerramentoService(p, driveFalso(), syncFalso());

    await expect(s.encerrar('c1', 'senha-certa', 'ENCERRAR')).rejects.toMatchObject({ status: 400 });
    expect(p.tcc.deleteMany).not.toHaveBeenCalled();
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

  it('repetir o encerramento não duplica histórico nem participante', async () => {
    const p = prismaFalso();
    const s = new EncerramentoService(p, driveFalso(), syncFalso());
    await s.encerrar('c1', 'senha-certa', 'ENCERRAR');
    await s.encerrar('c1', 'senha-certa', 'ENCERRAR'); // segunda execução (retomada/2º coordenador)

    expect(p._arquivados).toHaveLength(1);
    expect(p._participantes).toHaveLength(2); // prof1 + prof2, sem repetição
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

  it('com item PROCESSANDO, a prévia diz que NÃO dá para encerrar', async () => {
    const p = prismaFalso();
    p._statusNaFila = ['PROCESSANDO'];
    const s = new EncerramentoService(p, driveFalso(), syncFalso());
    const r = await s.previa();

    expect(r.pendenciasSincronizacao).toBe(1);
    expect(r.podeEncerrar).toBe(false);
  });

  it('com a fila limpa e o Drive conectado, a prévia libera o encerramento', async () => {
    const p = prismaFalso();
    p._statusNaFila = [];
    const s = new EncerramentoService(p, driveFalso(), syncFalso());
    const r = await s.previa();

    expect(r.pendenciasSincronizacao).toBe(0);
    expect(r.podeEncerrar).toBe(true);
  });

  it('cada estado pendente da fila (inclusive PROCESSANDO) trava a prévia', async () => {
    for (const estado of ['PENDENTE', 'PROCESSANDO', 'ERRO']) {
      const p = prismaFalso();
      p._statusNaFila = [estado];
      const r = await new EncerramentoService(p, driveFalso(), syncFalso()).previa();
      expect(r.podeEncerrar, `estado ${estado} deveria travar`).toBe(false);
    }
  });
});

describe('Histórico arquivado: permissões e acesso após a exclusão', () => {
  function prismaHistorico() {
    return {
      tccArquivado: {
        findMany: vi.fn(async () => [{ id: 'a1', titulo: 'TCC de teste', alunoNome: 'Lucas' }]),
        findFirst: vi.fn(async ({ where }: any) =>
          where.participantes && !where.participantes.some.usuarioId
            ? null
            : { id: 'a1', titulo: 'TCC', dadosJson: '{"ok":true}', driveArquivoFinalId: 'f', driveArquivoFinalNome: 'final.pdf' },
        ),
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

  it('o download passa pelo backend (proxy autenticado), sem link público', async () => {
    const p = prismaHistorico();
    const { baixarArquivo } = await import('../drive/drive-api');
    const s = new HistoricoArquivadoService(p, driveFalso());

    const r = await s.baixar('a1', 'c1', 'COORDENADOR');
    expect(r.nome).toBe('final.pdf');
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
