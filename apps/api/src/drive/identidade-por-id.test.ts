// Regra única do Drive: a identidade é o ID salvo, conferido com a conta conectada AGORA.
//   acessível        -> reusa;
//   AUSENTE (404/403/lixeira) -> cria outro e reconstrói a cópia a partir da VPS;
//   instabilidade    -> NÃO decide nada (jamais cria uma segunda cópia).
// O e-mail da conta não entra em nenhuma decisão, e nome de pasta nunca escolhe pasta.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';

const { md5, MIME_PASTA } = vi.hoisted(() => ({
  // O corpo só roda quando a fábrica do mock chama, então `createHash` já existe.
  md5: (b?: Buffer) => (b ? createHash('md5').update(b).digest('hex') : null),
  MIME_PASTA: 'application/vnd.google-apps.folder',
}));

// Drive falso com estados por id: acessível, ausente (404/403) ou instável (5xx).
const g = vi.hoisted(() => ({
  itens: new Map<string, any>(),
  ausentes: new Set<string>(),
  instaveis: new Set<string>(),
  seq: 0,
  criadas: [] as string[],
  renomeadas: [] as { id: string; nome: string }[],
  movidas: [] as { id: string; pai: string }[],
  uploads: [] as { nome: string; pai: string }[],
  atualizacoes: [] as string[],
}));

vi.mock('./drive-api', () => {
  class ErroDrive extends Error {
    constructor(
      m: string,
      readonly status?: number,
      readonly permanente = false,
    ) {
      super(m);
      this.name = 'ErroDrive';
    }
  }
  const conferir = async (_t: string, id: string) => {
    if (g.instaveis.has(id)) throw new ErroDrive('Google instável', 503, false);
    if (g.ausentes.has(id) || !g.itens.has(id)) return { estado: 'AUSENTE', motivo: 'não encontrado' };
    const it = g.itens.get(id);
    if (it.trashed) return { estado: 'AUSENTE', motivo: 'está na lixeira' };
    return { estado: 'ACESSIVEL', meta: { ...it, id } };
  };
  return {
    ErroDrive,
    MIME_PASTA,
    conferirRemoto: conferir,
    async metadadosArquivo(_t: string, id: string) {
      const r = await conferir(_t, id);
      if (r.estado === 'AUSENTE') throw new ErroDrive('File not found', 404, true);
      return (r as any).meta;
    },
    async criarPasta(_t: string, nome: string, pai?: string, marcas?: Record<string, string>) {
      const id = `pasta-${++g.seq}`;
      g.itens.set(id, { nome, mimeType: MIME_PASTA, trashed: false, pais: pai ? [pai] : [], marcas: marcas ?? {}, tamanho: null, md5: null });
      g.criadas.push(id);
      return id;
    },
    async buscarPastaPorMarca() {
      return null; // marca não interessa nestes cenários
    },
    async buscarPorNome() {
      return null; // NUNCA escolher pasta por nome
    },
    async renomearArquivo(_t: string, id: string, nome: string) {
      g.renomeadas.push({ id, nome });
      if (g.itens.has(id)) g.itens.get(id).nome = nome;
    },
    async moverParaPasta(_t: string, id: string, pai: string) {
      g.movidas.push({ id, pai });
      if (g.itens.has(id)) g.itens.get(id).pais = [pai];
    },
    async enviarArquivo(_t: string, d: { nome: string; paiId: string; conteudo: Buffer }) {
      const id = `arq-${++g.seq}`;
      g.itens.set(id, { nome: d.nome, mimeType: 'application/pdf', trashed: false, pais: [d.paiId], marcas: {}, tamanho: d.conteudo.length, md5: md5(d.conteudo) });
      g.uploads.push({ nome: d.nome, pai: d.paiId });
      return id;
    },
    async atualizarConteudo(_t: string, id: string, _m: string, conteudo: Buffer) {
      g.atualizacoes.push(id);
      if (g.itens.has(id)) Object.assign(g.itens.get(id), { tamanho: conteudo.length, md5: md5(conteudo) });
    },
    async moverParaLixeira() {},
    async listarFilhos() {
      return [];
    },
  };
});

vi.mock('./snapshot-tcc', () => ({ montarSnapshot: () => ({ v: 1 }), montarResumo: () => 'resumo' }));

const conteudoLocal = vi.hoisted(() => ({ valor: Buffer.from('conteudo do documento') }));
vi.mock('fs', () => ({
  promises: { readFile: async () => conteudoLocal.valor },
}));

import { DriveSyncService } from './drive-sync.service';

const TCC = 'tcc-1';

function prismaFalso() {
  const mapeados: any[] = [];
  const fila: any[] = [];
  let seq = 0;
  return {
    _mapeados: mapeados,
    _fila: fila,
    driveArquivo: {
      findUnique: vi.fn(async ({ where }: any) => {
        const { tccId, chave } = where.tccId_chave;
        return mapeados.find((m) => m.tccId === tccId && m.chave === chave) ?? null;
      }),
      findFirst: vi.fn(async ({ where }: any) => mapeados.find((m) => m.driveId === where.driveId) ?? null),
      create: vi.fn(async ({ data }: any) => {
        if (mapeados.some((m) => m.tccId === data.tccId && m.chave === data.chave)) {
          throw new Error('Unique constraint failed on the fields: (`tccId`,`chave`)');
        }
        const linha = { id: `m-${++seq}`, ...data };
        mapeados.push(linha);
        return linha;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const alvo = mapeados.find((m) => m.id === where.id);
        Object.assign(alvo, data);
        return alvo;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const m of mapeados) {
          if (m.tccId === where.tccId && m.chave === where.chave) {
            Object.assign(m, data);
            count++;
          }
        }
        return { count };
      }),
      deleteMany: vi.fn(async ({ where }: any) => {
        let count = 0;
        for (let i = mapeados.length - 1; i >= 0; i--) {
          if (mapeados[i].tccId === where.tccId) {
            mapeados.splice(i, 1);
            count++;
          }
        }
        return { count };
      }),
    },
    syncDrive: {
      upsert: vi.fn(async ({ where, create }: any) => {
        const { tccId, chave } = where.tccId_chave;
        const atual = fila.find((f) => f.tccId === tccId && f.chave === chave);
        if (atual) return atual;
        const novo = { id: `f-${fila.length + 1}`, status: 'PENDENTE', tentativas: 0, ...create };
        fila.push(novo);
        return novo;
      }),
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    tcc: { findUnique: vi.fn(async ({ where }: any) => ({ id: where.id, ...dadosTcc })) },
    documentoTcc: {
      findMany: vi.fn(async () => documentos),
      findUnique: vi.fn(async ({ where }: any) => documentos.find((d) => d.id === where.id) ?? null),
    },
    calendario: { findFirst: vi.fn(async () => null) },
  } as any;
}

let dadosTcc: any;
let documentos: any[];

const driveService = () =>
  ({
    accessToken: vi.fn(async () => 'token'),
    pastaRaizId: vi.fn(async () => 'raiz'),
    conectado: vi.fn(async () => true),
    registrarSync: vi.fn(async () => {}),
  }) as any;

let prisma: any;
let sync: DriveSyncService;

beforeEach(() => {
  g.itens = new Map();
  g.ausentes = new Set();
  g.instaveis = new Set();
  g.seq = 0;
  g.criadas = [];
  g.renomeadas = [];
  g.movidas = [];
  g.uploads = [];
  g.atualizacoes = [];
  conteudoLocal.valor = Buffer.from('conteudo do documento');
  dadosTcc = { semestre: '2026.2', titulo: 'Título teste', aluno: { nomeCompleto: 'Luiz Henrique' } };
  documentos = [];
  prisma = prismaFalso();
  sync = new DriveSyncService(prisma, driveService());
});

// Deixa o TCC com pasta mapeada e acessível.
async function comPastaPronta() {
  const id = await sync.garantirPastaTcc(TCC);
  g.criadas = [];
  return id;
}

describe('Pasta do TCC: o ID manda', () => {
  it('ID acessível é reutilizado, sem criar outra pasta', async () => {
    const id = await comPastaPronta();

    const denovo = await sync.garantirPastaTcc(TCC);

    expect(denovo).toBe(id);
    expect(g.criadas).toEqual([]);
  });

  it('ID ausente (404) recria a pasta e reconstrói a cópia daquele TCC', async () => {
    const antigo = await comPastaPronta();
    prisma._mapeados.push({ id: 'm-doc', tccId: TCC, chave: 'DADOS_JSON', driveId: 'arq-antigo', nome: 'dados.json' });
    documentos = [{ id: 'mono-1', tccId: TCC, tipo: 'MONOGRAFIA', versao: 1, nomeArquivo: 'm.pdf', caminho: 'uploads/m.pdf', status: 'APROVADO' }];
    g.ausentes.add(antigo);

    const novo = await sync.garantirPastaTcc(TCC);

    expect(novo).not.toBe(antigo);
    expect(g.criadas).toContain(novo);
    // Mapeamentos velhos descartados e reconstrução enfileirada.
    expect(prisma._mapeados.find((m: any) => m.chave === 'DADOS_JSON')).toBeUndefined();
    const naFila = prisma._fila.map((f: any) => f.chave);
    expect(naFila).toContain('DOC_INICIAL');
    expect(naFila).toContain('DADOS');
    expect(naFila).toContain('DOC:mono-1');
  });

  it('sem acesso com a conta atual (403) também recria', async () => {
    const antigo = await comPastaPronta();
    g.ausentes.add(antigo); // o fake devolve AUSENTE para 403 e 404 igualmente

    const novo = await sync.garantirPastaTcc(TCC);

    expect(novo).not.toBe(antigo);
  });

  it('INSTABILIDADE não cria pasta nova: o erro sobe para tentar depois', async () => {
    const antigo = await comPastaPronta();
    g.instaveis.add(antigo);

    await expect(sync.garantirPastaTcc(TCC)).rejects.toMatchObject({ status: 503 });
    expect(g.criadas).toEqual([]); // nada foi criado
    // E o mapeamento continua intacto, esperando o Google voltar.
    expect(prisma._mapeados.find((m: any) => m.chave === 'PASTA').driveId).toBe(antigo);
  });
});

describe('Nome e semestre da pasta', () => {
  it('mudar o nome do aluno renomeia a MESMA pasta', async () => {
    const id = await comPastaPronta();
    dadosTcc.aluno.nomeCompleto = 'Luiz Henrique da Silva';

    await (sync as any).processarItem({ tccId: TCC, tipo: 'PASTA', chave: 'PASTA', documentoId: null });

    expect(g.renomeadas).toEqual([{ id, nome: 'Luiz Henrique da Silva - Título teste' }]);
    expect(g.criadas).toEqual([]); // NUNCA cria pasta por renomeação
    expect(prisma._mapeados.find((m: any) => m.chave === 'PASTA').driveId).toBe(id);
  });

  it('mudar o título renomeia a MESMA pasta', async () => {
    const id = await comPastaPronta();
    dadosTcc.titulo = 'Novo título definitivo';

    await (sync as any).processarItem({ tccId: TCC, tipo: 'PASTA', chave: 'PASTA', documentoId: null });

    expect(g.renomeadas).toEqual([{ id, nome: 'Luiz Henrique - Novo título definitivo' }]);
  });

  it('nome inalterado não gera renomeação', async () => {
    await comPastaPronta();

    await (sync as any).processarItem({ tccId: TCC, tipo: 'PASTA', chave: 'PASTA', documentoId: null });

    expect(g.renomeadas).toEqual([]);
  });

  it('mudar o semestre MOVE a mesma pasta, sem copiar', async () => {
    const id = await comPastaPronta();
    dadosTcc.semestre = '2027.1';

    await (sync as any).processarItem({ tccId: TCC, tipo: 'PASTA', chave: 'PASTA', documentoId: null });

    expect(g.movidas.map((m) => m.id)).toEqual([id]);
    expect(prisma._mapeados.find((m: any) => m.chave === 'PASTA').driveId).toBe(id);
  });
});

describe('Arquivos: local é a verdade, remoto é espelho', () => {
  beforeEach(() => {
    documentos = [
      { id: 'plano-1', tccId: TCC, tipo: 'PLANO_DESENVOLVIMENTO', versao: 1, nomeArquivo: 'p.pdf', caminho: 'uploads/p.pdf', status: 'APROVADO' },
    ];
  });

  it('conteúdo igual não sobe nem sobrescreve nada', async () => {
    await (sync as any).processarItem({ tccId: TCC, tipo: 'DOC_INICIAL', chave: 'DOC_INICIAL', documentoId: null });
    const uploadsAntes = g.uploads.length;

    await (sync as any).processarItem({ tccId: TCC, tipo: 'DOC_INICIAL', chave: 'DOC_INICIAL', documentoId: null });

    expect(g.uploads.length).toBe(uploadsAntes);
    expect(g.atualizacoes).toEqual([]);
  });

  it('conteúdo diferente ATUALIZA o mesmo arquivo remoto', async () => {
    await (sync as any).processarItem({ tccId: TCC, tipo: 'DOC_INICIAL', chave: 'DOC_INICIAL', documentoId: null });
    const idRemoto = prisma._mapeados.find((m: any) => m.chave === 'INICIAL:PLANO_DESENVOLVIMENTO').driveId;
    conteudoLocal.valor = Buffer.from('plano corrigido pelo aluno');

    await (sync as any).processarItem({ tccId: TCC, tipo: 'DOC_INICIAL', chave: 'DOC_INICIAL', documentoId: null });

    expect(g.atualizacoes).toEqual([idRemoto]); // mesmo arquivo, conteúdo novo
    expect(prisma._mapeados.filter((m: any) => m.chave.startsWith('INICIAL:'))).toHaveLength(1);
  });

  it('arquivo remoto ausente é recriado e o mapeamento aproveitado', async () => {
    await (sync as any).processarItem({ tccId: TCC, tipo: 'DOC_INICIAL', chave: 'DOC_INICIAL', documentoId: null });
    const linha = prisma._mapeados.find((m: any) => m.chave === 'INICIAL:PLANO_DESENVOLVIMENTO');
    const antigo = linha.driveId;
    g.ausentes.add(antigo);

    await (sync as any).processarItem({ tccId: TCC, tipo: 'DOC_INICIAL', chave: 'DOC_INICIAL', documentoId: null });

    const depois = prisma._mapeados.find((m: any) => m.chave === 'INICIAL:PLANO_DESENVOLVIMENTO');
    expect(depois.driveId).not.toBe(antigo);
    expect(prisma._mapeados.filter((m: any) => m.chave === 'INICIAL:PLANO_DESENVOLVIMENTO')).toHaveLength(1);
  });

  it('Plano/Termo NÃO acumulam v1/v2/v3 quando o aluno reenvia', async () => {
    await (sync as any).processarItem({ tccId: TCC, tipo: 'DOC_INICIAL', chave: 'DOC_INICIAL', documentoId: null });
    // Nova versão aprovada do MESMO tipo.
    documentos = [
      { id: 'plano-2', tccId: TCC, tipo: 'PLANO_DESENVOLVIMENTO', versao: 2, nomeArquivo: 'p.pdf', caminho: 'uploads/p2.pdf', status: 'APROVADO' },
    ];
    conteudoLocal.valor = Buffer.from('versao 2 do plano');

    await (sync as any).processarItem({ tccId: TCC, tipo: 'DOC_INICIAL', chave: 'DOC_INICIAL', documentoId: null });

    const nomes = g.uploads.map((u) => u.nome);
    expect(nomes.filter((n) => n.startsWith('Plano'))).toEqual(['Plano de desenvolvimento.pdf']); // um só
    expect(g.atualizacoes).toHaveLength(1); // a segunda versão sobrescreveu a primeira
  });

  it('mapeamento legado DOC:<id> é adotado, sem criar arquivo duplicado', async () => {
    // Estado de antes da mudança: Plano mapeado por documento.
    const pasta = await comPastaPronta();
    g.itens.set('arq-legado', { nome: 'Plano de desenvolvimento.pdf', mimeType: 'application/pdf', trashed: false, pais: [pasta], marcas: {}, tamanho: conteudoLocal.valor.length, md5: md5(conteudoLocal.valor) });
    prisma._mapeados.push({ id: 'm-legado', tccId: TCC, chave: 'DOC:plano-1', driveId: 'arq-legado', nome: 'Plano de desenvolvimento.pdf' });

    await (sync as any).processarItem({ tccId: TCC, tipo: 'DOC_INICIAL', chave: 'DOC_INICIAL', documentoId: null });

    expect(g.uploads).toEqual([]); // reaproveitou o arquivo que já estava lá
    const linha = prisma._mapeados.find((m: any) => m.chave === 'INICIAL:PLANO_DESENVOLVIMENTO');
    expect(linha.driveId).toBe('arq-legado');
    expect(prisma._mapeados.find((m: any) => m.chave === 'DOC:plano-1')).toBeUndefined();
  });

  it('monografia preserva uma versão por arquivo', async () => {
    documentos = [
      { id: 'mono-1', tccId: TCC, tipo: 'MONOGRAFIA', versao: 1, nomeArquivo: 'm.pdf', caminho: 'uploads/m1.pdf', status: 'APROVADO' },
      { id: 'mono-2', tccId: TCC, tipo: 'MONOGRAFIA', versao: 2, nomeArquivo: 'm.pdf', caminho: 'uploads/m2.pdf', status: 'APROVADO' },
    ];

    await (sync as any).processarItem({ tccId: TCC, tipo: 'DOCUMENTO', chave: 'DOC:mono-1', documentoId: 'mono-1' });
    conteudoLocal.valor = Buffer.from('monografia versao 2');
    await (sync as any).processarItem({ tccId: TCC, tipo: 'DOCUMENTO', chave: 'DOC:mono-2', documentoId: 'mono-2' });

    expect(g.uploads.map((u) => u.nome)).toEqual(['Monografia v1.pdf', 'Monografia v2.pdf']);
  });

  it('dados.json só é reescrito quando o conteúdo muda', async () => {
    await sync.gravarDados(TCC);
    const uploads = g.uploads.length;

    await sync.gravarDados(TCC); // nada mudou no TCC

    expect(g.uploads.length).toBe(uploads);
    expect(g.atualizacoes).toEqual([]);
  });
});
