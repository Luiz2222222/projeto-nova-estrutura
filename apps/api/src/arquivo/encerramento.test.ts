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
    syncDrive: { count: vi.fn(async () => 0) },
    documentoTcc: {
      findMany: vi.fn(async () => [{ id: 'd1', tipo: 'VERSAO_FINAL', versao: 1, criadoEm: new Date() }]),
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
      create: vi.fn(async ({ data }: any) => {
        const a = { id: `a${arquivados.length + 1}`, ...data };
        arquivados.push(a);
        return a;
      }),
      findMany: vi.fn(async () => arquivados),
      findFirst: vi.fn(async () => arquivados[0] ?? null),
    },
    tccArquivadoParticipante: {
      create: vi.fn(async ({ data }: any) => {
        participantes.push(data);
        return data;
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
    const p = prismaFalso({ syncDrive: { count: vi.fn(async () => 3) } });
    const s = new EncerramentoService(p, driveFalso(), syncFalso());
    await expect(s.encerrar('c1', 'senha-certa', 'ENCERRAR')).rejects.toMatchObject({ status: 400 });
    expect(p.tcc.deleteMany).not.toHaveBeenCalled();
  });
});

describe('Encerramento completo', () => {
  it('arquiva antes de apagar e apaga só aluno e avaliador externo', async () => {
    const p = prismaFalso();
    const s = new EncerramentoService(p, driveFalso(), syncFalso());
    const r = await s.encerrar('c1', 'senha-certa', 'ENCERRAR');

    // Arquivou primeiro
    expect(p.tccArquivado.create).toHaveBeenCalled();
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

  it('NÃO poda quando o arquivo final não está confirmado no Drive', async () => {
    const p = prismaFalso();
    const { arquivoValido, apagarArquivo } = await import('../drive/drive-api');
    vi.mocked(arquivoValido).mockResolvedValueOnce(false);
    const s = new EncerramentoService(p, driveFalso(), syncFalso());
    const r = await s.encerrar('c1', 'senha-certa', 'ENCERRAR');

    expect(r.arquivosPodadosNoDrive).toBe(0);
    expect(vi.mocked(apagarArquivo)).not.toHaveBeenCalled();
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
    expect(p.tccArquivado.create).not.toHaveBeenCalled();
    expect(p.usuario.delete).not.toHaveBeenCalled();
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
