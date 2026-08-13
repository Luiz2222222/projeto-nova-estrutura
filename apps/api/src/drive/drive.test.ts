// Garantias do arquivamento no Drive: chave própria, nenhuma pasta antes da aprovação,
// enfileiramento após a aprovação, retry que não bloqueia o fluxo e snapshot sem credenciais.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { criptografarDrive, descriptografarDrive, sanitizarNome } from './cripto-drive';
import { montarResumo, montarSnapshot, limparSensiveis } from './snapshot-tcc';
import { DriveSyncService } from './drive-sync.service';

const SEGREDO = 'segredo-drive-de-teste-1234';
const guardado = { drive: process.env.DRIVE_CRYPTO_SEGREDO, jwt: process.env.JWT_SEGREDO };

beforeEach(() => {
  process.env.DRIVE_CRYPTO_SEGREDO = SEGREDO;
  process.env.JWT_SEGREDO = 'jwt-diferente-do-drive';
});
afterEach(() => {
  process.env.DRIVE_CRYPTO_SEGREDO = guardado.drive;
  process.env.JWT_SEGREDO = guardado.jwt;
});

describe('Criptografia do refresh token (chave própria)', () => {
  it('ida e volta funciona e o texto cifrado não contém o original', () => {
    const blob = criptografarDrive('refresh-token-ficticio');
    expect(blob).not.toContain('refresh-token-ficticio');
    expect(blob.split(':')).toHaveLength(3);
    expect(descriptografarDrive(blob)).toBe('refresh-token-ficticio');
  });

  it('EXIGE DRIVE_CRYPTO_SEGREDO — não cai no JWT_SEGREDO nem na chave de e-mail', () => {
    delete process.env.DRIVE_CRYPTO_SEGREDO;
    process.env.JWT_SEGREDO = 'jwt-que-nao-deve-ser-usado';
    process.env.EMAIL_CRYPTO_SEGREDO = 'email-que-nao-deve-ser-usado';
    expect(() => criptografarDrive('x')).toThrow(/DRIVE_CRYPTO_SEGREDO/);
    delete process.env.EMAIL_CRYPTO_SEGREDO;
  });

  it('recusa segredo curto demais', () => {
    process.env.DRIVE_CRYPTO_SEGREDO = 'curto';
    expect(() => criptografarDrive('x')).toThrow(/DRIVE_CRYPTO_SEGREDO/);
  });

  it('com a chave trocada não abre o blob (devolve undefined em vez de estourar)', () => {
    const blob = criptografarDrive('refresh-token-ficticio');
    process.env.DRIVE_CRYPTO_SEGREDO = 'outro-segredo-completamente-diferente';
    expect(descriptografarDrive(blob)).toBeUndefined();
  });

  it('sanitiza nome de pasta (sem barras nem caracteres de controle)', () => {
    expect(sanitizarNome('Lucas/Silva: TCC*?')).toBe('Lucas-Silva- TCC--');
    expect(sanitizarNome('   ')).toBe('sem-nome');
  });
});

// ---------- Snapshot ----------

function tccCompleto() {
  return {
    id: 't1',
    titulo: 'Automação de sistemas elétricos',
    semestre: '2026.2',
    faseAtual: 'CONCLUIDO',
    monografiaAprovada: true,
    continuidadeConfirmada: true,
    nf1: 8.5,
    nf2: 9,
    nf: 8.7,
    resultado: 'APROVADO',
    criadoEm: new Date('2026-03-01T12:00:00Z'),
    concluidoEm: new Date('2026-11-20T12:00:00Z'),
    defesaAgendadaPara: new Date('2026-11-10T14:00:00Z'),
    defesaLocal: 'Sala 3',
    aluno: { nomeCompleto: 'Lucas Silva', email: 'lucas@ufpe.br', curso: 'ENGENHARIA_ELETRICA', senhaHash: '$2a$10$hash' },
    orientador: { id: 'p1', nomeCompleto: 'Ana Souza', tratamento: 'Prof. Dr.' },
    coorientador: null,
    documentos: [
      { id: 'd1', tipo: 'PLANO_DESENVOLVIMENTO', nomeArquivo: 'plano.pdf', versao: 1, status: 'APROVADO', tamanho: 10, criadoEm: new Date() },
      { id: 'd2', tipo: 'MONOGRAFIA', nomeArquivo: 'mono.docx', versao: 2, status: 'APROVADO', tamanho: 20, criadoEm: new Date() },
    ],
    solicitacoes: [{ status: 'ACEITA', mensagem: null, parecer: null, criadoEm: new Date(), respondidoEm: new Date() }],
    bancas: [
      {
        fase: 'FASE_1',
        criadoEm: new Date(),
        membros: [
          {
            avaliadorId: 'a1',
            status: 'CONCLUIDO',
            nota: 8.5,
            parecer: 'Bom trabalho',
            avaliadoEm: new Date(),
            rascunho: '{"notas":{"segredo":1}}',
            notaResumo: 1.5,
            notaIntroducao: 1.5,
            notaRevisao: 2,
            notaDesenvolvimento: 2,
            notaConclusoes: 1.5,
            avaliador: { id: 'a1', nomeCompleto: 'Carlos Lima', tratamento: 'Dr.', papel: 'AVALIADOR', afiliacao: 'UFRPE' },
          },
        ],
      },
    ],
  };
}

describe('Snapshot (dados.json / resumo.txt)', () => {
  const dados: any = montarSnapshot(tccCompleto(), { pesoFase1: 0.6, pesoFase2: 0.4 });

  it('traz identificação, notas, datas, defesa, documentos e banca por critério', () => {
    expect(dados.tcc.titulo).toBe('Automação de sistemas elétricos');
    expect(dados.aluno.nomeCompleto).toBe('Lucas Silva');
    expect(dados.orientador.nomeCompleto).toBe('Ana Souza');
    expect(dados.notas).toMatchObject({ nf1: 8.5, nf2: 9, nf: 8.7, resultado: 'APROVADO', pesoFase1: 0.6 });
    expect(dados.datas.concluidoEm).toBeTruthy();
    expect(dados.defesa.local).toBe('Sala 3');
    expect(dados.documentos).toHaveLength(2);
    expect(dados.bancas[0].membros[0].notasPorCriterio).toMatchObject({ Resumo: 1.5, Conclusões: 1.5 });
    expect(dados.bancas[0].membros[0].externo).toBe(true);
  });

  it('NUNCA inclui senha, hash, token ou rascunho privado do avaliador', () => {
    const texto = JSON.stringify(dados);
    expect(texto).not.toContain('senhaHash');
    expect(texto).not.toContain('$2a$10$hash');
    expect(texto).not.toContain('rascunho');
    expect(texto).not.toContain('segredo');
  });

  it('limparSensiveis remove chaves suspeitas em qualquer profundidade', () => {
    const limpo: any = limparSensiveis({ a: { b: { senhaHash: 'x', refreshToken: 'y', ok: 1 } } });
    expect(limpo.a.b).toEqual({ ok: 1 });
  });

  it('o resumo legível mostra os mesmos dados principais', () => {
    const txt = montarResumo(dados);
    expect(txt).toContain('Automação de sistemas elétricos');
    expect(txt).toContain('Lucas Silva');
    expect(txt).toContain('Nota final: 8,70');
    expect(txt).toContain('Carlos Lima');
    expect(txt).not.toContain('$2a$10$hash');
  });
});

// ---------- Fila ----------

function prismaFalso() {
  const fila: any[] = [];
  const arquivos: any[] = [];
  const p: any = {
    _fila: fila,
    syncDrive: {
      // Espelha a chave única (tccId, chave): upsert reaproveita a linha existente.
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const achado = fila.find(
          (i) => i.tccId === where.tccId_chave.tccId && i.chave === where.tccId_chave.chave,
        );
        if (achado) {
          Object.assign(achado, update);
          return achado;
        }
        const item = { id: `f${fila.length + 1}`, status: 'PENDENTE', tentativas: 0, ...create };
        fila.push(item);
        return item;
      }),
      findFirst: vi.fn(async ({ where }: any) =>
        fila.find((i) => i.tccId === where.tccId && i.chave === where.chave) ?? null,
      ),
      update: vi.fn(async ({ where, data }: any) => {
        const i = fila.find((x) => x.id === where.id);
        Object.assign(i, data);
        return i;
      }),
      findMany: vi.fn(async () => fila.filter((i) => ['PENDENTE', 'ERRO'].includes(i.status))),
      updateMany: vi.fn(async () => ({ count: 0 })),
      count: vi.fn(async () => 0),
    },
    driveArquivo: {
      findUnique: vi.fn(async ({ where }: any) =>
        arquivos.find((a) => a.tccId === where.tccId_chave.tccId && a.chave === where.tccId_chave.chave) ?? null,
      ),
      create: vi.fn(async ({ data }: any) => {
        arquivos.push(data);
        return data;
      }),
    },
    tcc: { findMany: vi.fn(async () => []) },
    documentoTcc: { findMany: vi.fn(async () => []) },
  };
  return p;
}

const driveConectado = (conectado = true) =>
  ({
    conectado: vi.fn(async () => conectado),
    accessToken: vi.fn(async () => 'token'),
    pastaRaizId: vi.fn(async () => 'raiz'),
    registrarSync: vi.fn(),
  }) as any;

describe('Fila: nada vai ao Drive antes da aprovação da abertura', () => {
  it('envio de monografia SEM pasta (abertura não aprovada) não enfileira nada', async () => {
    const p = prismaFalso();
    const sync = new DriveSyncService(p, driveConectado());
    await sync.aoEnviarDocumento('t1', 'd1', 'MONOGRAFIA');
    expect(p._fila).toHaveLength(0);
  });

  it('alteração do TCC sem pasta também não enfileira', async () => {
    const p = prismaFalso();
    const sync = new DriveSyncService(p, driveConectado());
    await sync.aoAlterarTcc('t1');
    expect(p._fila).toHaveLength(0);
  });

  it('após a aprovação, enfileira pasta + documentos iniciais + dados', async () => {
    const p = prismaFalso();
    const sync = new DriveSyncService(p, driveConectado());
    await sync.aoAprovarAbertura('t1');
    expect(p._fila.map((i: any) => i.tipo)).toEqual(['PASTA', 'DOC_INICIAL', 'DADOS']);
  });

  it('com a pasta já criada, novo documento e alteração passam a enfileirar', async () => {
    const p = prismaFalso();
    const sync = new DriveSyncService(p, driveConectado());
    await p.driveArquivo.create({ data: { tccId: 't1', chave: 'PASTA', driveId: 'p1', nome: 'pasta' } });
    await sync.aoEnviarDocumento('t1', 'd9', 'MONOGRAFIA');
    expect(p._fila.map((i: any) => i.chave)).toEqual(['DOC:d9', 'DADOS']);
  });

  it('documento da banca (interno/anônimo) nunca é enfileirado', async () => {
    const p = prismaFalso();
    const sync = new DriveSyncService(p, driveConectado());
    await p.driveArquivo.create({ data: { tccId: 't1', chave: 'PASTA', driveId: 'p1', nome: 'pasta' } });
    await sync.aoEnviarDocumento('t1', 'd5', 'AVALIACAO_BANCA');
    expect(p._fila).toHaveLength(0);
  });

  it('não duplica: enfileirar a mesma chave duas vezes reaproveita o item pendente', async () => {
    const p = prismaFalso();
    const sync = new DriveSyncService(p, driveConectado());
    await sync.enfileirar('t1', 'DADOS', 'DADOS');
    await sync.enfileirar('t1', 'DADOS', 'DADOS');
    expect(p._fila).toHaveLength(1);
  });
});

describe('Reconciliação diária (não depende de gancho lembrado)', () => {
  function prismaReconciliacao(docsMapeados: string[] = []) {
    const p = prismaFalso();
    p.tcc.findMany = vi.fn(async () => [{ id: 't1' }, { id: 't2' }]);
    p.documentoTcc.findMany = vi.fn(async () => [{ id: 'mono1' }, { id: 'final1' }]);
    p.driveArquivo.findUnique = vi.fn(async ({ where }: any) =>
      docsMapeados.includes(where.tccId_chave.chave) ? { driveId: 'x' } : null,
    );
    return p;
  }

  it('encontra MONOGRAFIA/VERSAO_FINAL sem DriveArquivo e enfileira', async () => {
    const p = prismaReconciliacao();
    const sync = new DriveSyncService(p, driveConectado());
    const r = await sync.reconciliar();

    expect(r.tccs).toBe(2);
    expect(r.documentos).toBe(4); // 2 documentos x 2 TCCs
    expect(p._fila.filter((i: any) => i.tipo === 'DOCUMENTO')).toHaveLength(4);
  });

  it('não reenfileira documento que já tem mapeamento no Drive', async () => {
    const p = prismaReconciliacao(['DOC:mono1', 'DOC:final1']);
    const sync = new DriveSyncService(p, driveConectado());
    const r = await sync.reconciliar();

    expect(r.documentos).toBe(0);
    expect(p._fila.some((i: any) => i.tipo === 'DOCUMENTO')).toBe(false);
  });

  it('garante pasta e dados de todo TCC ativo já aprovado', async () => {
    const p = prismaReconciliacao();
    const sync = new DriveSyncService(p, driveConectado());
    await sync.reconciliar();

    const chaves = p._fila.filter((i: any) => i.tccId === 't1').map((i: any) => i.chave);
    expect(chaves).toEqual(expect.arrayContaining(['PASTA', 'DOC_INICIAL', 'DADOS']));
    // TCC ainda em INICIALIZACAO não entra: o filtro exclui a fase.
    expect(p.tcc.findMany.mock.calls[0][0].where.faseAtual).toEqual({ not: 'INICIALIZACAO' });
    expect(p.tcc.findMany.mock.calls[0][0].where.excluidoEm).toBeNull();
  });

  it('Drive desconectado: reconciliação não faz nada', async () => {
    const p = prismaReconciliacao();
    const sync = new DriveSyncService(p, driveConectado(false));
    await expect(sync.reconciliar()).resolves.toEqual({ tccs: 0, documentos: 0 });
  });
});

describe('Retry: falha do Drive não quebra o fluxo', () => {
  it('Drive desconectado: o worker simplesmente não processa (sem lançar)', async () => {
    const p = prismaFalso();
    const sync = new DriveSyncService(p, driveConectado(false));
    await expect(sync.processarPendentes()).resolves.toEqual({ processados: 0, falhas: 0 });
  });

  it('erro no item marca ERRO com backoff futuro, sem propagar exceção', async () => {
    const p = prismaFalso();
    const sync = new DriveSyncService(p, driveConectado());
    await sync.enfileirar('t1', 'TIPO_INVALIDO', 'X'); // cai no default → erro permanente

    const r = await sync.processarPendentes();
    expect(r).toEqual({ processados: 0, falhas: 1 });
    const item = p._fila[0];
    expect(item.status).toBe('ERRO');
    expect(item.tentativas).toBe(1);
    expect(item.ultimoErro).toContain('desconhecido');
    expect(item.proximaTentativaEm.getTime()).toBeGreaterThan(Date.now());
  });
});
