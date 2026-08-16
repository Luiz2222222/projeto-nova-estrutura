// Limpeza DURÁVEL da pasta duplicada por corrida.
//
// Se o mapeamento correto já foi gravado e a pasta sobrando não conseguiu ir para a lixeira
// na hora, um warning não bastava: a pasta ficava no Drive sem nova tentativa. Agora vira
// item da MESMA fila (SyncDrive), então sobrevive a reinício e herda backoff e reserva.
//
// A faxina é conservadora de propósito: na dúvida NÃO mexe. Mover para a lixeira só depois
// de provar que a candidata não está mapeada, é pasta, tem a marca do TCC e está vazia.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DriveSyncService } from './drive-sync.service';

const drive = vi.hoisted(() => ({
  pastas: [] as { id: string; nome: string; pai?: string; marcas: Record<string, string>; lixeira: boolean; mime: string }[],
  filhos: new Map<string, { id: string; nome: string }[]>(),
  seq: 0,
  // Falhas programadas por id de pasta (para simular indisponibilidade temporária).
  falharLixeira: new Set<string>(),
  falharMetadados: new Map<string, { status?: number }>(),
  lixeiraChamada: [] as string[],
}));

vi.mock('./drive-api', async () => {
  const MIME_PASTA = 'application/vnd.google-apps.folder';
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
  return {
    ErroDrive,
    MIME_PASTA,
    async criarPasta(_t: string, nome: string, pai?: string, marcas?: Record<string, string>) {
      const id = `pasta-${++drive.seq}`;
      drive.pastas.push({ id, nome, pai, marcas: marcas ?? {}, lixeira: false, mime: MIME_PASTA });
      return id;
    },
    async buscarPastaPorMarca(_t: string, chave: string, valor: string, pai?: string) {
      const f = drive.pastas.find((p) => !p.lixeira && p.marcas[chave] === valor && (pai === undefined || p.pai === pai));
      return f ? { id: f.id, nome: f.nome } : null;
    },
    async buscarPorNome(_t: string, nome: string, pai: string) {
      return drive.pastas.find((p) => !p.lixeira && p.nome === nome && p.pai === pai)?.id ?? null;
    },
    async moverParaLixeira(_t: string, id: string) {
      drive.lixeiraChamada.push(id);
      if (drive.falharLixeira.has(id)) throw new ErroDrive('Drive indisponível', 503, false);
      const p = drive.pastas.find((x) => x.id === id);
      if (p) p.lixeira = true;
    },
    async metadadosArquivo(_t: string, id: string) {
      const falha = drive.falharMetadados.get(id);
      if (falha) throw new ErroDrive('falha ao consultar', falha.status, falha.status === 404);
      const p = drive.pastas.find((x) => x.id === id);
      if (!p) throw new ErroDrive('File not found', 404, true);
      return { id: p.id, nome: p.nome, mimeType: p.mime, trashed: p.lixeira, pais: p.pai ? [p.pai] : [], marcas: p.marcas };
    },
    async listarFilhos(_t: string, id: string) {
      return drive.filhos.get(id) ?? [];
    },
    async enviarArquivo() {
      return `arq-${++drive.seq}`;
    },
    async atualizarConteudo() {},
  };
});

vi.mock('./snapshot-tcc', () => ({ montarSnapshot: () => ({}), montarResumo: () => 'r' }));

const TCC = 'tcc-1';
const MARCA = 'sistemaTccId';

// Prisma falso com a fila SyncDrive de verdade (unique em tccId+chave) e o unique de
// DriveArquivo, que é o que dispara a corrida.
function prismaFalso() {
  const mapeados: any[] = [];
  const fila: any[] = [];
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
        mapeados.push({ ...data });
        return data;
      }),
    },
    syncDrive: {
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const { tccId, chave } = where.tccId_chave;
        const atual = fila.find((f) => f.tccId === tccId && f.chave === chave);
        if (atual) {
          Object.assign(atual, update);
          return atual;
        }
        const novo = { id: `fila-${fila.length + 1}`, status: 'PENDENTE', tentativas: 0, documentoId: null, ...create };
        fila.push(novo);
        return novo;
      }),
      findMany: vi.fn(async () => fila.filter((f) => ['PENDENTE', 'ERRO'].includes(f.status))),
      findFirst: vi.fn(async ({ where }: any) => fila.find((f) => f.tccId === where.tccId && f.chave === where.chave) ?? null),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const alvo = fila.find((f) => f.id === where.id);
        if (!alvo) return { count: 0 };
        if (where.reservaId && alvo.reservaId !== where.reservaId) return { count: 0 };
        Object.assign(alvo, data);
        return { count: 1 };
      }),
    },
    tcc: {
      findUnique: vi.fn(async ({ where }: any) => ({
        id: where.id,
        semestre: '2026.2',
        titulo: 'Título teste',
        aluno: { nomeCompleto: 'Aluno Teste' },
      })),
    },
    documentoTcc: { findMany: vi.fn(async () => []) },
    calendario: { findFirst: vi.fn(async () => null) },
  } as any;
}

const driveService = () =>
  ({
    accessToken: vi.fn(async () => 'token'),
    pastaRaizId: vi.fn(async () => 'raiz'),
    conectado: vi.fn(async () => true),
    registrarSync: vi.fn(async () => {}),
  }) as any;

let prisma: any;
let sync: DriveSyncService;

// Reproduz a corrida: outro processo mapeia a pasta dele durante o nosso create.
function outroProcessoMapeiaPrimeiro() {
  prisma.driveArquivo.create = vi.fn(async (args: any) => {
    if (args.data.chave === 'PASTA') {
      drive.pastas.push({ id: 'pasta-do-outro', nome: 'x', marcas: { [MARCA]: TCC }, lixeira: false, mime: 'application/vnd.google-apps.folder' });
      prisma._mapeados.push({ tccId: TCC, chave: 'PASTA', driveId: 'pasta-do-outro', nome: 'x' });
      throw new Error('Unique constraint failed on the fields: (`tccId`,`chave`)');
    }
    prisma._mapeados.push({ ...args.data });
    return args.data;
  });
}

const itensDeLimpeza = () => prisma._fila.filter((f: any) => f.tipo === 'LIMPAR_PASTA_DUPLICADA');

beforeEach(() => {
  drive.pastas = [];
  drive.filhos = new Map();
  drive.seq = 0;
  drive.falharLixeira = new Set();
  drive.falharMetadados = new Map();
  drive.lixeiraChamada = [];
  prisma = prismaFalso();
  sync = new DriveSyncService(prisma, driveService());
});

describe('Falha ao mover a duplicada vira limpeza PENDENTE', () => {
  async function corridaComLixeiraFora() {
    outroProcessoMapeiaPrimeiro();
    // A nossa pasta será a próxima criada; a lixeira está fora do ar para ela.
    drive.falharLixeira.add('pasta-2');
    const id = await sync.garantirPastaTcc(TCC);
    return id;
  }

  it('o mapeamento correto é preservado e a limpeza fica na fila', async () => {
    const id = await corridaComLixeiraFora();

    expect(id).toBe('pasta-do-outro'); // a pasta que vale continua valendo
    const limpezas = itensDeLimpeza();
    expect(limpezas).toHaveLength(1);
    expect(limpezas[0]).toMatchObject({ tccId: TCC, chave: 'LIXEIRA:pasta-2', status: 'PENDENTE' });
    expect(drive.pastas.find((p) => p.id === 'pasta-2')!.lixeira).toBe(false); // ainda não foi
  });

  it('a limpeza é gravada no banco, não em memória — sobrevive a reinício', async () => {
    await corridaComLixeiraFora();

    // Processo novo: só o que está no banco continua existindo.
    sync = new DriveSyncService(prisma, driveService());
    drive.falharLixeira.clear(); // Drive voltou
    const r = await sync.processarPendentes();

    expect(r.falhas).toBe(0);
    expect(drive.pastas.find((p) => p.id === 'pasta-2')!.lixeira).toBe(true);
    expect(itensDeLimpeza()[0].status).toBe('CONCLUIDO');
  });

  it('o retry posterior move para a lixeira e conclui a fila', async () => {
    await corridaComLixeiraFora();
    drive.falharLixeira.clear();

    await sync.processarPendentes();

    expect(drive.lixeiraChamada).toContain('pasta-2');
    expect(itensDeLimpeza()[0]).toMatchObject({ status: 'CONCLUIDO', ultimoErro: null });
  });

  it('erro temporário usa o backoff que já existe', async () => {
    await corridaComLixeiraFora(); // a lixeira segue fora do ar

    const antes = Date.now();
    const r = await sync.processarPendentes();

    expect(r.falhas).toBe(1);
    const item = itensDeLimpeza()[0];
    expect(item.status).toBe('ERRO');
    expect(item.tentativas).toBe(1);
    expect(new Date(item.proximaTentativaEm).getTime()).toBeGreaterThan(antes); // reprogramado
    expect(drive.pastas.find((p) => p.id === 'pasta-2')!.lixeira).toBe(false);
  });
});

describe('A faxina só mexe no que provou ser descartável', () => {
  // Enfileira uma limpeza direta, sem depender da corrida.
  async function agendarLimpeza(idPasta: string) {
    await sync.enfileirar(TCC, 'LIMPAR_PASTA_DUPLICADA', `LIXEIRA:${idPasta}`);
    return sync.processarPendentes();
  }

  it('NUNCA limpa a pasta mapeada como PASTA do TCC', async () => {
    drive.pastas.push({ id: 'a-que-vale', nome: 'ok', marcas: { [MARCA]: TCC }, lixeira: false, mime: 'application/vnd.google-apps.folder' });
    prisma._mapeados.push({ tccId: TCC, chave: 'PASTA', driveId: 'a-que-vale', nome: 'ok' });

    const r = await agendarLimpeza('a-que-vale');

    expect(r.falhas).toBe(0); // conclui sem erro, mas sem mexer
    expect(drive.lixeiraChamada).toEqual([]);
    expect(drive.pastas.find((p) => p.id === 'a-que-vale')!.lixeira).toBe(false);
  });

  it('NUNCA limpa uma pasta mapeada por qualquer outra chave', async () => {
    drive.pastas.push({ id: 'doc-1', nome: 'monografia', marcas: { [MARCA]: TCC }, lixeira: false, mime: 'application/vnd.google-apps.folder' });
    prisma._mapeados.push({ tccId: TCC, chave: 'DOC:x', driveId: 'doc-1', nome: 'monografia' });

    await agendarLimpeza('doc-1');

    expect(drive.lixeiraChamada).toEqual([]);
  });

  it('pasta COM arquivos não é movida: erro permanente e aviso claro', async () => {
    drive.pastas.push({ id: 'com-coisas', nome: 'dup', marcas: { [MARCA]: TCC }, lixeira: false, mime: 'application/vnd.google-apps.folder' });
    drive.filhos.set('com-coisas', [{ id: 'f1', nome: 'monografia.pdf' }]);

    const r = await agendarLimpeza('com-coisas');

    expect(r.falhas).toBe(1);
    expect(drive.lixeiraChamada).toEqual([]);
    expect(drive.pastas.find((p) => p.id === 'com-coisas')!.lixeira).toBe(false);
    const item = itensDeLimpeza()[0];
    expect(item.status).toBe('ERRO');
    expect(item.ultimoErro).toMatch(/1 item\(ns\)/);
    expect(item.ultimoErro).toMatch(/monografia\.pdf/);
    expect(item.ultimoErro).toMatch(/confira manualmente/i);
  });

  it('pasta SEM a marca do TCC não é movida (não dá para confirmar a origem)', async () => {
    drive.pastas.push({ id: 'sem-marca', nome: 'algo', marcas: {}, lixeira: false, mime: 'application/vnd.google-apps.folder' });

    const r = await agendarLimpeza('sem-marca');

    expect(r.falhas).toBe(1);
    expect(drive.lixeiraChamada).toEqual([]);
    expect(itensDeLimpeza()[0].ultimoErro).toMatch(/marca do TCC/);
  });

  it('pasta com a marca de OUTRO TCC não é movida', async () => {
    drive.pastas.push({ id: 'de-outro-tcc', nome: 'x', marcas: { [MARCA]: 'tcc-9' }, lixeira: false, mime: 'application/vnd.google-apps.folder' });

    await agendarLimpeza('de-outro-tcc');

    expect(drive.lixeiraChamada).toEqual([]);
  });

  it('o que não é pasta não é movido', async () => {
    drive.pastas.push({ id: 'um-arquivo', nome: 'x.pdf', marcas: { [MARCA]: TCC }, lixeira: false, mime: 'application/pdf' });

    const r = await agendarLimpeza('um-arquivo');

    expect(r.falhas).toBe(1);
    expect(itensDeLimpeza()[0].ultimoErro).toMatch(/não é uma pasta/);
    expect(drive.lixeiraChamada).toEqual([]);
  });

  it('pasta JÁ na lixeira conclui sem erro', async () => {
    drive.pastas.push({ id: 'ja-na-lixeira', nome: 'dup', marcas: { [MARCA]: TCC }, lixeira: true, mime: 'application/vnd.google-apps.folder' });

    const r = await agendarLimpeza('ja-na-lixeira');

    expect(r.falhas).toBe(0);
    expect(r.processados).toBe(1);
    expect(drive.lixeiraChamada).toEqual([]); // nem precisou chamar
    expect(itensDeLimpeza()[0].status).toBe('CONCLUIDO');
  });

  it('pasta que não existe mais conclui sem erro', async () => {
    const r = await agendarLimpeza('sumiu');

    expect(r.falhas).toBe(0);
    expect(itensDeLimpeza()[0].status).toBe('CONCLUIDO');
  });

  it('falha temporária ao CONSULTAR não conclui a limpeza às cegas', async () => {
    drive.pastas.push({ id: 'dup', nome: 'dup', marcas: { [MARCA]: TCC }, lixeira: false, mime: 'application/vnd.google-apps.folder' });
    drive.falharMetadados.set('dup', { status: 503 });

    const r = await agendarLimpeza('dup');

    expect(r.falhas).toBe(1);
    expect(drive.lixeiraChamada).toEqual([]);
    expect(itensDeLimpeza()[0].status).toBe('ERRO'); // volta pelo backoff
  });

  it('a limpeza vai para a lixeira, NUNCA apaga de vez', async () => {
    drive.pastas.push({ id: 'dup-vazia', nome: 'dup', marcas: { [MARCA]: TCC }, lixeira: false, mime: 'application/vnd.google-apps.folder' });

    await agendarLimpeza('dup-vazia');

    // A pasta continua existindo, só que na lixeira (recuperável).
    const p = drive.pastas.find((x) => x.id === 'dup-vazia')!;
    expect(p).toBeTruthy();
    expect(p.lixeira).toBe(true);
  });
});
