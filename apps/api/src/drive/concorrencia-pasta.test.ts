// Concorrência na criação de pastas do Drive.
//
// O bug real de produção: PASTA, DOC_INICIAL e DADOS são itens SEPARADOS da fila e todos
// chamam garantirPastaTcc(). A reserva do SyncDrive protege a mesma LINHA da fila, não o
// mesmo RECURSO no Drive — então dois itens do mesmo TCC não achavam o mapeamento ao mesmo
// tempo, criavam duas pastas no Google e só depois uma falhava no unique (tccId, chave),
// deixando a outra órfã. Log: "Unique constraint failed on (tccId, chave)".
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DriveSyncService } from './drive-sync.service';

// Drive falso: conta chamadas de criação e guarda as pastas com suas marcas privadas.
const drive = vi.hoisted(() => ({
  pastas: [] as { id: string; nome: string; pai?: string; marcas: Record<string, string>; lixeira: boolean }[],
  criadas: 0,
  arquivos: [] as { id: string; nome: string; pai: string }[],
  seq: 0,
  // Atraso artificial entre "achar" e "criar": é a janela em que a corrida acontece.
  atraso: 0,
}));

vi.mock('./drive-api', () => ({
  ErroDrive: class ErroDrive extends Error {
    constructor(
      m: string,
      readonly status?: number,
      readonly permanente = false,
    ) {
      super(m);
    }
  },
  async criarPasta(_t: string, nome: string, pai?: string, marcas?: Record<string, string>) {
    if (drive.atraso) await new Promise((r) => setTimeout(r, drive.atraso));
    const id = `pasta-${++drive.seq}`;
    drive.pastas.push({ id, nome, pai, marcas: marcas ?? {}, lixeira: false });
    drive.criadas++;
    return id;
  },
  async buscarPastaPorMarca(_t: string, chave: string, valor: string, pai?: string) {
    if (drive.atraso) await new Promise((r) => setTimeout(r, drive.atraso));
    const f = drive.pastas.find(
      (p) => !p.lixeira && p.marcas[chave] === valor && (pai === undefined || p.pai === pai),
    );
    return f ? { id: f.id, nome: f.nome } : null;
  },
  async buscarPorNome(_t: string, nome: string, pai: string) {
    if (drive.atraso) await new Promise((r) => setTimeout(r, drive.atraso));
    return drive.pastas.find((p) => !p.lixeira && p.nome === nome && p.pai === pai)?.id ?? null;
  },
  async moverParaLixeira(_t: string, id: string) {
    const p = drive.pastas.find((x) => x.id === id);
    if (p) p.lixeira = true;
  },
  async enviarArquivo(_t: string, d: { nome: string; paiId: string }) {
    const id = `arq-${++drive.seq}`;
    drive.arquivos.push({ id, nome: d.nome, pai: d.paiId });
    return id;
  },
  async atualizarConteudo() {},
}));

vi.mock('./snapshot-tcc', () => ({
  montarSnapshot: () => ({ tcc: {} }),
  montarResumo: () => 'resumo',
}));

const TCC = 'tcc-1';

// Prisma falso com a MESMA unicidade do schema em (tccId, chave).
function prismaFalso() {
  const mapeados: { tccId: string; chave: string; driveId: string; nome: string }[] = [];
  return {
    _mapeados: mapeados,
    driveArquivo: {
      findUnique: vi.fn(async ({ where }: any) => {
        const { tccId, chave } = where.tccId_chave;
        return mapeados.find((m) => m.tccId === tccId && m.chave === chave) ?? null;
      }),
      create: vi.fn(async ({ data }: any) => {
        if (mapeados.some((m) => m.tccId === data.tccId && m.chave === data.chave)) {
          throw new Error('Unique constraint failed on the fields: (`tccId`,`chave`)');
        }
        mapeados.push({ ...data });
        return data;
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
    documentoTcc: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null) },
    calendario: { findFirst: vi.fn(async () => null) },
    syncDrive: { upsert: vi.fn(async () => ({})), findFirst: vi.fn(async () => null) },
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

beforeEach(() => {
  drive.pastas = [];
  drive.arquivos = [];
  drive.criadas = 0;
  drive.seq = 0;
  drive.atraso = 5; // janela de corrida aberta de propósito
  prisma = prismaFalso();
  sync = new DriveSyncService(prisma, driveService());
});

describe('Uma única pasta por TCC', () => {
  it('PASTA, DOC_INICIAL e DADOS em paralelo criam UMA pasta só', async () => {
    // Exatamente o cenário do TCC cmsvgy6cg0006q19xb6c9u6wl em produção.
    await Promise.all([
      sync.garantirPastaTcc(TCC),
      sync.garantirPastaTcc(TCC),
      sync.gravarDados(TCC),
    ]);

    const pastasDoTcc = drive.pastas.filter((p) => p.marcas.sistemaTccId === TCC && !p.lixeira);
    expect(pastasDoTcc).toHaveLength(1);
    expect(prisma._mapeados.filter((m: any) => m.chave === 'PASTA')).toHaveLength(1);
  });

  it('worker automático e "Atualizar" simultâneos não duplicam pasta nem documento', async () => {
    // Duas rodadas do mesmo trabalho ao mesmo tempo (setInterval + POST /drive/sincronizar).
    await Promise.all([
      Promise.all([sync.garantirPastaTcc(TCC), sync.gravarDados(TCC)]),
      Promise.all([sync.garantirPastaTcc(TCC), sync.gravarDados(TCC)]),
    ]);

    expect(drive.pastas.filter((p) => !p.lixeira && p.marcas.sistemaTccId === TCC)).toHaveLength(1);
    // dados.json e resumo.txt: um de cada, não quatro.
    expect(drive.arquivos.filter((a) => a.nome === 'dados.json')).toHaveLength(1);
    expect(drive.arquivos.filter((a) => a.nome === 'resumo.txt')).toHaveLength(1);
  });

  it('dez chamadas concorrentes ainda resultam em uma pasta', async () => {
    const ids = await Promise.all(Array.from({ length: 10 }, () => sync.garantirPastaTcc(TCC)));

    expect(new Set(ids).size).toBe(1);
    expect(drive.criadas).toBe(2); // a do semestre + a do TCC
  });
});

describe('Uma única pasta por semestre', () => {
  it('dois TCCs do mesmo semestre em paralelo compartilham a pasta do semestre', async () => {
    prisma.tcc.findUnique = vi.fn(async ({ where }: any) => ({
      id: where.id,
      semestre: '2026.2',
      titulo: `Título ${where.id}`,
      aluno: { nomeCompleto: `Aluno ${where.id}` },
    }));

    await Promise.all([sync.garantirPastaTcc('tcc-a'), sync.garantirPastaTcc('tcc-b')]);

    const doSemestre = drive.pastas.filter((p) => p.marcas.sistemaTccSemestre === '2026.2' && !p.lixeira);
    expect(doSemestre).toHaveLength(1);
    // E as duas pastas de TCC penduradas nela.
    const pastasTcc = drive.pastas.filter((p) => p.marcas.sistemaTccId);
    expect(pastasTcc).toHaveLength(2);
    expect(new Set(pastasTcc.map((p) => p.pai))).toEqual(new Set([doSemestre[0].id]));
  });
});

describe('Reinício da API entre criar no Google e gravar no banco', () => {
  it('a repetição REENCONTRA a pasta pela marca, sem criar outra', async () => {
    // 1ª tentativa: o Google cria, mas o banco falha antes de mapear (API caiu).
    prisma.driveArquivo.create.mockRejectedValueOnce(new Error('conexão perdida'));
    await expect(sync.garantirPastaTcc(TCC)).rejects.toThrow('conexão perdida');
    const criadaAntes = drive.pastas.find((p) => p.marcas.sistemaTccId === TCC)!;
    expect(criadaAntes).toBeTruthy();
    expect(drive.criadas).toBe(2);

    // 2ª tentativa (processo novo, cache do semestre vazio): tem que reusar a mesma pasta.
    sync = new DriveSyncService(prisma, driveService());
    const id = await sync.garantirPastaTcc(TCC);

    expect(id).toBe(criadaAntes.id);
    expect(drive.pastas.filter((p) => p.marcas.sistemaTccId === TCC)).toHaveLength(1);
    expect(drive.criadas).toBe(2); // nenhuma pasta nova
  });

  it('se outro processo mapear primeiro, a pasta sobrando vai para a LIXEIRA', async () => {
    // Simula o processo B: mapeia uma pasta própria durante o nosso create.
    const original = prisma.driveArquivo.create;
    prisma.driveArquivo.create = vi.fn(async (args: any) => {
      if (args.data.chave === 'PASTA') {
        drive.pastas.push({ id: 'pasta-de-outro', nome: 'x', marcas: { sistemaTccId: TCC }, lixeira: false });
        prisma._mapeados.push({ tccId: TCC, chave: 'PASTA', driveId: 'pasta-de-outro', nome: 'x' });
        throw new Error('Unique constraint failed on the fields: (`tccId`,`chave`)');
      }
      return original(args);
    });

    const id = await sync.garantirPastaTcc(TCC);

    expect(id).toBe('pasta-de-outro'); // fica com a pasta de quem chegou primeiro
    // A que NÓS criamos (marcada para este TCC, mas não a do outro processo) foi para a
    // lixeira em vez de virar órfã — que era exatamente o defeito em produção.
    const nossa = drive.pastas.find((p) => p.marcas.sistemaTccId === TCC && p.id !== 'pasta-de-outro');
    expect(nossa).toBeTruthy();
    expect(nossa!.lixeira).toBe(true);
    expect(drive.pastas.filter((p) => p.marcas.sistemaTccId === TCC && !p.lixeira)).toHaveLength(1);
  });

  it('erro que não é corrida continua subindo (não é engolido)', async () => {
    prisma.driveArquivo.create.mockRejectedValueOnce(new Error('disco cheio'));

    await expect(sync.garantirPastaTcc(TCC)).rejects.toThrow('disco cheio');
  });
});

describe('A pasta continua com o conteúdo esperado', () => {
  it('dados.json e resumo.txt ficam DENTRO da pasta do TCC', async () => {
    const pasta = await sync.garantirPastaTcc(TCC);
    await sync.gravarDados(TCC);

    const dentro = drive.arquivos.filter((a) => a.pai === pasta).map((a) => a.nome);
    expect(dentro).toEqual(['dados.json', 'resumo.txt']);
  });

  it('gravar dados duas vezes não cria cópias (sobrescreve)', async () => {
    await sync.gravarDados(TCC);
    await sync.gravarDados(TCC);

    expect(drive.arquivos.filter((a) => a.nome === 'dados.json')).toHaveLength(1);
    expect(drive.arquivos.filter((a) => a.nome === 'resumo.txt')).toHaveLength(1);
  });
});
