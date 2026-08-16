// Duas armadilhas do fluxo do Drive:
//
// 1. O cache de pasta de semestre vive no processo. Se a raiz mudar (reconexão numa raiz
//    que o ID antigo não alcança), uma entrada antiga apontaria para dentro da raiz
//    anterior — e a sincronização seguinte penduraria TCC numa pasta inalcançável.
//
// 2. Nem todo HTTP 403 quer dizer "sumiu". Cota, rate limit e política de domínio também
//    são 403. Tratá-los como ausência faria uma cota estourada apagar mapeamentos e
//    recriar raiz, pasta e arquivos — perdendo a cópia boa que já estava lá.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';

const { md5, MIME_PASTA } = vi.hoisted(() => ({
  md5: (b?: Buffer) => (b ? createHash('md5').update(b).digest('hex') : null),
  MIME_PASTA: 'application/vnd.google-apps.folder',
}));

const g = vi.hoisted(() => ({
  itens: new Map<string, any>(),
  seq: 0,
  criadas: [] as { id: string; nome: string; pai?: string }[],
  // Erro programado por id: { status, motivo }.
  falhas: new Map<string, { status: number; motivo?: string }>(),
  apagados: [] as string[],
}));

vi.mock('./drive-api', () => {
  class ErroDrive extends Error {
    constructor(
      m: string,
      readonly status?: number,
      readonly permanente = false,
      readonly motivo?: string,
    ) {
      super(m);
      this.name = 'ErroDrive';
    }
  }
  // Reproduz a regra real: só 404, lixeira e 403 de "sem acesso a ESTE arquivo" são
  // ausência; o resto vira exceção.
  const SEM_ACESSO = new Set(['insufficientFilePermissions', 'appNotAuthorizedToFile']);
  const conferir = async (_t: string, id: string) => {
    const falha = g.falhas.get(id);
    if (falha) {
      if (falha.status === 404) return { estado: 'AUSENTE', motivo: 'não encontrado' };
      if (falha.status === 403 && falha.motivo && SEM_ACESSO.has(falha.motivo)) {
        return { estado: 'AUSENTE', motivo: `sem acesso a este arquivo (${falha.motivo})` };
      }
      throw new ErroDrive('recusado', falha.status, false, falha.motivo);
    }
    if (!g.itens.has(id)) return { estado: 'AUSENTE', motivo: 'não encontrado' };
    return { estado: 'ACESSIVEL', meta: { ...g.itens.get(id), id } };
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
      g.criadas.push({ id, nome, pai });
      return id;
    },
    // Um item que o Google recusa (404/403) também não aparece nas listagens da conta.
    async buscarPastaPorMarca(_t: string, chave: string, valor: string, pai?: string) {
      for (const [id, it] of g.itens) {
        if (g.falhas.has(id)) continue;
        if (it.marcas?.[chave] === valor && (pai === undefined || it.pais?.includes(pai))) return { id, nome: it.nome };
      }
      return null;
    },
    async buscarPorNome(_t: string, nome: string, pai: string) {
      for (const [id, it] of g.itens) if (!g.falhas.has(id) && it.nome === nome && it.pais?.includes(pai)) return id;
      return null;
    },
    async renomearArquivo() {},
    async moverParaPasta() {},
    async enviarArquivo(_t: string, d: { nome: string; paiId: string; conteudo: Buffer }) {
      const id = `arq-${++g.seq}`;
      g.itens.set(id, { nome: d.nome, mimeType: 'application/pdf', trashed: false, pais: [d.paiId], marcas: {}, tamanho: d.conteudo.length, md5: md5(d.conteudo) });
      return id;
    },
    async atualizarConteudo() {},
    async moverParaLixeira(_t: string, id: string) {
      g.apagados.push(id);
    },
    async listarFilhos() {
      return [];
    },
  };
});

vi.mock('./snapshot-tcc', () => ({ montarSnapshot: () => ({ v: 1 }), montarResumo: () => 'resumo' }));
vi.mock('fs', () => ({ promises: { readFile: async () => Buffer.from('documento') } }));

import { DriveSyncService } from './drive-sync.service';

const TCC = 'tcc-1';
let raizAtual = 'raiz-antiga';

function prismaFalso() {
  const mapeados: any[] = [];
  let seq = 0;
  return {
    _mapeados: mapeados,
    driveArquivo: {
      findUnique: vi.fn(async ({ where }: any) => {
        const { tccId, chave } = where.tccId_chave;
        return mapeados.find((m) => m.tccId === tccId && m.chave === chave) ?? null;
      }),
      findFirst: vi.fn(async ({ where }: any) => mapeados.find((m) => m.driveId === where.driveId) ?? null),
      create: vi.fn(async ({ data }: any) => {
        const linha = { id: `m-${++seq}`, ...data };
        mapeados.push(linha);
        return linha;
      }),
      update: vi.fn(async ({ where, data }: any) => Object.assign(mapeados.find((m) => m.id === where.id), data)),
      updateMany: vi.fn(async () => ({ count: 0 })),
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
      upsert: vi.fn(async () => ({})),
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    tcc: {
      findUnique: vi.fn(async ({ where }: any) => ({
        id: where.id,
        semestre: '2026.2',
        titulo: 'Título teste',
        aluno: { nomeCompleto: 'Luiz Henrique' },
      })),
    },
    documentoTcc: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null) },
    calendario: { findFirst: vi.fn(async () => null) },
  } as any;
}

// O DriveService real troca pastaRaizId ao reconectar numa raiz nova; aqui basta a leitura
// refletir essa troca, sem reiniciar nada.
const driveService = () =>
  ({
    accessToken: vi.fn(async () => 'token'),
    pastaRaizId: vi.fn(async () => raizAtual),
    conectado: vi.fn(async () => true),
    registrarSync: vi.fn(async () => {}),
  }) as any;

let prisma: any;
let sync: DriveSyncService;

beforeEach(() => {
  g.itens = new Map();
  g.seq = 0;
  g.criadas = [];
  g.falhas = new Map();
  g.apagados = [];
  raizAtual = 'raiz-antiga';
  g.itens.set('raiz-antiga', { nome: 'Sistema de TCC - DEE', mimeType: MIME_PASTA, trashed: false, pais: [], marcas: {}, tamanho: null, md5: null });
  prisma = prismaFalso();
  sync = new DriveSyncService(prisma, driveService());
});

const pastasEm = (pai: string) => g.criadas.filter((c) => c.pai === pai);

describe('Cache de pasta de semestre não sobrevive à troca de raiz', () => {
  it('a raiz nova recebe a sua própria pasta 2026.2, sem reutilizar o ID da raiz antiga', async () => {
    // 1) Sincroniza na raiz antiga: cria 2026.2 lá e guarda no cache.
    await sync.garantirPastaTcc(TCC);
    const semestreAntigo = pastasEm('raiz-antiga').find((c) => c.nome === '2026.2')!;
    expect(semestreAntigo).toBeTruthy();

    // 2) Reconexão cria uma raiz nova; a instância do serviço é a MESMA (sem reiniciar a API).
    raizAtual = 'raiz-nova';
    g.itens.set('raiz-nova', { nome: 'Sistema de TCC - DEE', mimeType: MIME_PASTA, trashed: false, pais: [], marcas: {}, tamanho: null, md5: null });
    prisma._mapeados.length = 0; // a troca de raiz invalida os ponteiros locais

    // 3) A sincronização seguinte tem que montar tudo dentro da raiz nova.
    const pastaTcc = await sync.garantirPastaTcc(TCC);

    const semestreNovo = pastasEm('raiz-nova').find((c) => c.nome === '2026.2');
    expect(semestreNovo).toBeTruthy();
    expect(semestreNovo!.id).not.toBe(semestreAntigo.id);
    // E a pasta do TCC ficou pendurada na pasta de semestre NOVA.
    expect(g.itens.get(pastaTcc).pais).toEqual([semestreNovo!.id]);
  });

  it('voltar para a raiz antiga reaproveita o cache dela (uma entrada por raiz)', async () => {
    await sync.garantirPastaTcc(TCC);
    const antiga = pastasEm('raiz-antiga').find((c) => c.nome === '2026.2')!;

    raizAtual = 'raiz-nova';
    g.itens.set('raiz-nova', { nome: 'Sistema de TCC - DEE', mimeType: MIME_PASTA, trashed: false, pais: [], marcas: {}, tamanho: null, md5: null });
    prisma._mapeados.length = 0;
    await sync.garantirPastaTcc(TCC);

    raizAtual = 'raiz-antiga';
    prisma._mapeados.length = 0;
    g.criadas = [];
    await sync.garantirPastaTcc('tcc-2');

    // Não recriou a pasta de semestre da raiz antiga: o cache dela continuava válido.
    expect(pastasEm('raiz-antiga').filter((c) => c.nome === '2026.2')).toEqual([]);
    expect(g.itens.get(antiga.id)).toBeTruthy();
  });

  it('dois TCCs na mesma raiz continuam compartilhando uma pasta de semestre só', async () => {
    await sync.garantirPastaTcc(TCC);
    await sync.garantirPastaTcc('tcc-2');

    expect(pastasEm('raiz-antiga').filter((c) => c.nome === '2026.2')).toHaveLength(1);
  });
});

describe('403 que não é ausência preserva tudo', () => {
  const CENARIOS: [string, string][] = [
    ['rate limit', 'rateLimitExceeded'],
    ['limite do usuário', 'userRateLimitExceeded'],
    ['cota', 'quotaExceeded'],
    ['política de domínio', 'domainPolicy'],
    ['403 genérico sem motivo', ''],
  ];

  it.each(CENARIOS)('%s: não recria pasta e não apaga mapeamentos', async (_nome, motivo) => {
    const pasta = await sync.garantirPastaTcc(TCC);
    const mapeamentosAntes = [...prisma._mapeados];
    g.criadas = [];
    g.falhas.set(pasta, { status: 403, ...(motivo ? { motivo } : {}) });

    await expect(sync.garantirPastaTcc(TCC)).rejects.toMatchObject({ status: 403 });

    expect(g.criadas).toEqual([]); // nenhuma pasta nova
    expect(prisma._mapeados).toEqual(mapeamentosAntes); // nenhum mapeamento apagado
    expect(prisma.driveArquivo.deleteMany).not.toHaveBeenCalled();
  });

  it('403 de cota não recria o arquivo mapeado nem sobrescreve o remoto', async () => {
    await sync.gravarDados(TCC);
    const dadosJson = prisma._mapeados.find((m: any) => m.chave === 'DADOS_JSON');
    g.falhas.set(dadosJson.driveId, { status: 403, motivo: 'quotaExceeded' });

    await expect(sync.gravarDados(TCC)).rejects.toMatchObject({ status: 403 });

    // O ponteiro continua o mesmo: nada foi reenviado nem remapeado.
    expect(prisma._mapeados.find((m: any) => m.chave === 'DADOS_JSON').driveId).toBe(dadosJson.driveId);
  });

  it('403 de cota é temporário: NÃO vira erro permanente na fila', async () => {
    // `permanente` decide o backoff; cota tem que voltar cedo, não no intervalo diário.
    const { ErroDrive } = await import('./drive-api');
    const erro = new (ErroDrive as any)('quota', 403, false, 'quotaExceeded');

    expect(erro.permanente).toBe(false);
  });

  it('403 de "sem acesso a ESTE arquivo" continua sendo ausência e recria', async () => {
    const pasta = await sync.garantirPastaTcc(TCC);
    g.criadas = [];
    g.falhas.set(pasta, { status: 403, motivo: 'insufficientFilePermissions' });

    const nova = await sync.garantirPastaTcc(TCC);

    expect(nova).not.toBe(pasta);
    expect(g.criadas.length).toBeGreaterThan(0);
  });

  it('404 continua recriando normalmente', async () => {
    const pasta = await sync.garantirPastaTcc(TCC);
    g.criadas = [];
    g.falhas.set(pasta, { status: 404 });

    const nova = await sync.garantirPastaTcc(TCC);

    expect(nova).not.toBe(pasta);
  });

  it('500 e 429 seguem como erro, sem criar nada', async () => {
    for (const status of [500, 429, 503]) {
      const prismaLocal = prismaFalso();
      const s = new DriveSyncService(prismaLocal, driveService());
      const pasta = await s.garantirPastaTcc(TCC);
      g.criadas = [];
      g.falhas.set(pasta, { status });

      await expect(s.garantirPastaTcc(TCC)).rejects.toMatchObject({ status });
      expect(g.criadas).toEqual([]);
      g.falhas.delete(pasta);
    }
  });
});
