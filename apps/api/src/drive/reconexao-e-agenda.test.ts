// Reconexão do Drive e agendamento diário.
//
// Reconectar NÃO é "trocar de conta": a decisão é sempre a mesma pergunta feita ao Google —
// "o ID que eu guardei ainda serve com a credencial de agora?". Nenhum ramo olha para o
// e-mail da conta, e nenhum procura pasta pelo nome.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const g = vi.hoisted(() => ({
  raizes: new Set<string>(),
  instaveis: new Set<string>(),
  seq: 0,
  criadas: [] as string[],
  buscasPorNome: 0,
}));

vi.mock('./drive-api', () => {
  class ErroDrive extends Error {
    constructor(
      m: string,
      readonly status?: number,
      readonly permanente = false,
    ) {
      super(m);
    }
  }
  return {
    ErroDrive,
    MIME_PASTA: 'application/vnd.google-apps.folder',
    ESCOPO_DRIVE: 'escopo',
    credenciaisDoAmbiente: () => ({ clientId: 'x', clientSecret: 'y', redirectUri: 'z' }),
    gerarState: () => 'state',
    urlDeAutorizacao: () => 'https://consentimento',
    async trocarCodigoPorTokens() {
      return { refreshToken: 'refresh', accessToken: 'access' };
    },
    async renovarAccessToken() {
      return 'access';
    },
    async emailDaConta() {
      return 'qualquer@conta.com'; // nenhuma decisão depende disto
    },
    async conferirRemoto(_t: string, id: string) {
      if (g.instaveis.has(id)) throw new ErroDrive('Google fora do ar', 503, false);
      if (!g.raizes.has(id)) return { estado: 'AUSENTE', motivo: 'não encontrado' };
      return {
        estado: 'ACESSIVEL',
        meta: { id, nome: 'Sistema de TCC - DEE', mimeType: 'application/vnd.google-apps.folder', trashed: false, pais: [], marcas: {}, tamanho: null, md5: null },
      };
    },
    async criarPasta() {
      const id = `raiz-${++g.seq}`;
      g.raizes.add(id);
      g.criadas.push(id);
      return id;
    },
    async buscarPorNome() {
      g.buscasPorNome++;
      return null;
    },
  };
});

vi.mock('./cripto-drive', () => ({
  criptografarDrive: (v: string) => `cripto(${v})`,
  descriptografarDrive: (v: string) => String(v).replace(/^cripto\(|\)$/g, ''),
}));

import { DriveService } from './drive.service';
import { proximaExecucao, HORA_SYNC, FUSO_SYNC } from './agendador-drive';

function prismaFalso(config: Record<string, any> = {}) {
  const linha: Record<string, any> = {
    id: 'global',
    refreshTokenCriptografado: null,
    contaEmail: null,
    pastaRaizId: null,
    pastaRaizNome: null,
    conectadoEm: null,
    oauthState: 'state-valido',
    oauthStateExpiraEm: new Date(Date.now() + 60_000),
    ...config,
  };
  const mapeados: any[] = [
    { id: 'm1', tccId: 't1', chave: 'PASTA', driveId: 'antiga-1', nome: 'x' },
    { id: 'm2', tccId: 't1', chave: 'DADOS_JSON', driveId: 'antiga-2', nome: 'dados.json' },
  ];
  return {
    _linha: linha,
    _mapeados: mapeados,
    integracaoDrive: {
      findUnique: vi.fn(async () => ({ ...linha })),
      create: vi.fn(async () => ({ ...linha })),
      update: vi.fn(async ({ data }: any) => {
        Object.assign(linha, data);
        return { ...linha };
      }),
    },
    tcc: { findMany: vi.fn(async () => [{ id: 't1' }]) },
    driveArquivo: {
      deleteMany: vi.fn(async () => {
        const n = mapeados.length;
        mapeados.length = 0;
        return { count: n };
      }),
    },
    syncDrive: { count: vi.fn(async () => 0) },
  } as any;
}

beforeEach(() => {
  g.raizes = new Set();
  g.instaveis = new Set();
  g.seq = 0;
  g.criadas = [];
  g.buscasPorNome = 0;
});

describe('Reconectar reaproveita a raiz pelo ID', () => {
  it('raiz salva acessível: reusa, não cria outra e não mexe nos mapeamentos', async () => {
    g.raizes.add('raiz-salva');
    const p = prismaFalso({ pastaRaizId: 'raiz-salva' });
    const servico = new DriveService(p);

    await servico.concluirAutorizacao('codigo', 'state-valido');

    expect(g.criadas).toEqual([]);
    expect(p._linha.pastaRaizId).toBe('raiz-salva');
    expect(p.driveArquivo.deleteMany).not.toHaveBeenCalled();
    expect(p._mapeados).toHaveLength(2); // cópia atual preservada
  });

  it('raiz salva AUSENTE: cria uma nova e invalida os ponteiros locais para refazer a cópia', async () => {
    const p = prismaFalso({ pastaRaizId: 'raiz-que-sumiu' });
    const servico = new DriveService(p);

    await servico.concluirAutorizacao('codigo', 'state-valido');

    expect(g.criadas).toHaveLength(1);
    expect(p._linha.pastaRaizId).toBe(g.criadas[0]);
    expect(p.driveArquivo.deleteMany).toHaveBeenCalled();
    expect(p._mapeados).toHaveLength(0); // serão reconstruídos a partir da VPS
  });

  it('primeira conexão (sem ID salvo): cria a raiz', async () => {
    const p = prismaFalso({ pastaRaizId: null });
    const servico = new DriveService(p);

    await servico.concluirAutorizacao('codigo', 'state-valido');

    expect(g.criadas).toHaveLength(1);
    expect(p._linha.pastaRaizId).toBe(g.criadas[0]);
  });

  it('INSTABILIDADE do Google: não cria raiz nova nem apaga mapeamento', async () => {
    g.instaveis.add('raiz-salva');
    const p = prismaFalso({ pastaRaizId: 'raiz-salva' });
    const servico = new DriveService(p);

    await expect(servico.concluirAutorizacao('codigo', 'state-valido')).rejects.toMatchObject({ status: 400 });

    expect(g.criadas).toEqual([]);
    expect(p._linha.pastaRaizId).toBe('raiz-salva'); // intacto
    expect(p.driveArquivo.deleteMany).not.toHaveBeenCalled();
  });

  it('nunca procura pasta por NOME para escolher a raiz', async () => {
    g.raizes.add('raiz-salva');
    const p = prismaFalso({ pastaRaizId: 'raiz-salva' });

    await new DriveService(p).concluirAutorizacao('codigo', 'state-valido');

    expect(g.buscasPorNome).toBe(0);
  });

  it('a mesma raiz é reaproveitada mesmo com e-mail de conta diferente', async () => {
    // O fake devolve sempre o mesmo e-mail; o ponto é que NADA no fluxo o consulta para
    // decidir. Reconectar duas vezes seguidas não pode gerar uma segunda raiz.
    g.raizes.add('raiz-salva');
    const p = prismaFalso({ pastaRaizId: 'raiz-salva' });
    const servico = new DriveService(p);

    await servico.concluirAutorizacao('codigo', 'state-valido');
    p._linha.oauthState = 'state-valido';
    p._linha.oauthStateExpiraEm = new Date(Date.now() + 60_000);
    await servico.concluirAutorizacao('codigo', 'state-valido');

    expect(g.criadas).toEqual([]);
    expect(p._linha.pastaRaizId).toBe('raiz-salva');
  });
});

describe('Desconectar preserva o que permite reaproveitar depois', () => {
  it('some com a credencial, mantém pastaRaizId e os mapeamentos', async () => {
    const p = prismaFalso({ pastaRaizId: 'raiz-salva', refreshTokenCriptografado: 'cripto(refresh)', contaEmail: 'a@b.com' });
    const servico = new DriveService(p);

    await servico.desconectar();

    expect(p._linha.refreshTokenCriptografado).toBeNull();
    expect(p._linha.contaEmail).toBeNull();
    expect(p._linha.pastaRaizId).toBe('raiz-salva'); // é o que permite reusar na volta
    expect(p._mapeados).toHaveLength(2);
    expect(await servico.conectado()).toBe(false);
  });

  it('desconectar e reconectar volta para a MESMA raiz', async () => {
    g.raizes.add('raiz-salva');
    const p = prismaFalso({ pastaRaizId: 'raiz-salva', refreshTokenCriptografado: 'cripto(refresh)' });
    const servico = new DriveService(p);

    await servico.desconectar();
    p._linha.oauthState = 'state-valido';
    p._linha.oauthStateExpiraEm = new Date(Date.now() + 60_000);
    await servico.concluirAutorizacao('codigo', 'state-valido');

    expect(g.criadas).toEqual([]);
    expect(p._linha.pastaRaizId).toBe('raiz-salva');
    expect(p._mapeados).toHaveLength(2); // a cópia continua válida
  });
});

describe('Agendamento: uma vez por dia, às 23:00 em Fortaleza', () => {
  const emFortaleza = (d: Date) =>
    new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO_SYNC, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);

  it('sempre cai às 23:00 no fuso do curso', () => {
    for (const agora of ['2026-08-16T05:00:00Z', '2026-08-16T14:30:00Z', '2026-08-16T23:59:00Z', '2027-01-01T03:00:00Z']) {
      expect(emFortaleza(proximaExecucao(new Date(agora)))).toBe(`${HORA_SYNC}:00`);
    }
  });

  it('antes das 23:00 agenda para hoje', () => {
    // 12:00 UTC = 09:00 em Fortaleza -> 23:00 do MESMO dia = 02:00 UTC do dia seguinte.
    const alvo = proximaExecucao(new Date('2026-08-16T12:00:00Z'));

    expect(alvo.toISOString()).toBe('2026-08-17T02:00:00.000Z');
  });

  it('depois das 23:00 agenda para o dia seguinte', () => {
    // 03:00 UTC = 00:00 em Fortaleza (já passou das 23h de ontem).
    const alvo = proximaExecucao(new Date('2026-08-17T03:00:00Z'));

    expect(alvo.toISOString()).toBe('2026-08-18T02:00:00.000Z');
  });

  it('a próxima execução está sempre no futuro e a menos de 24h', () => {
    for (let h = 0; h < 24; h++) {
      const agora = new Date(Date.UTC(2026, 7, 16, h, 17, 0));
      const alvo = proximaExecucao(agora);
      const horas = (alvo.getTime() - agora.getTime()) / 3_600_000;
      expect(horas).toBeGreaterThan(0);
      expect(horas).toBeLessThanOrEqual(24);
    }
  });

  it('vira o mês e o ano corretamente', () => {
    expect(proximaExecucao(new Date('2026-12-31T23:30:00Z')).toISOString()).toBe('2027-01-01T02:00:00.000Z');
  });
});
