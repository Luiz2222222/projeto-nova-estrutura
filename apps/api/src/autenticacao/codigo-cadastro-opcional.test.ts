// Código de cadastro OPCIONAL por papel: se a coordenação configurou um código, ele continua
// obrigatório; se deixou em branco, aquele perfil se cadastra sem código. O backend é a fonte
// da verdade — mexer na tela não pode abrir um cadastro que a coordenação fechou.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AutenticacaoService } from './autenticacao.service';
import { CoordenacaoService } from '../coordenacao/coordenacao.service';

vi.mock('bcryptjs', () => ({ hash: vi.fn(async () => 'hash-fake'), compare: vi.fn(async () => true) }));

// Banco falso com a tabela de códigos e a de usuários.
function prismaFalso(codigos: { papel: string; codigo: string }[] = []) {
  const linhas = [...codigos];
  return {
    _codigos: linhas,
    codigoCadastro: {
      findMany: vi.fn(async ({ where }: any = {}) =>
        where?.papel ? linhas.filter((l) => l.papel === where.papel) : linhas,
      ),
      findUnique: vi.fn(async ({ where }: any) => linhas.find((l) => l.papel === where.papel) ?? null),
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const atual = linhas.find((l) => l.papel === where.papel);
        if (atual) Object.assign(atual, update);
        else linhas.push({ ...create });
        return atual ?? create;
      }),
      deleteMany: vi.fn(async ({ where }: any) => {
        for (let i = linhas.length - 1; i >= 0; i--) if (linhas[i].papel === where.papel) linhas.splice(i, 1);
        return { count: 1 };
      }),
    },
    usuario: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }: any) => ({ id: 'u1', ...data })),
    },
    $transaction: vi.fn(async (ops: any[]) => Promise.all(ops)),
  } as any;
}

const base = {
  papel: 'ALUNO' as const,
  nomeCompleto: 'Fulano de Tal',
  email: 'Fulano@Exemplo.com',
  senha: 'senha123',
};

let prisma: any;

describe('Cadastro quando o papel NÃO tem código configurado', () => {
  beforeEach(() => {
    prisma = prismaFalso([{ papel: 'PROFESSOR', codigo: 'prof-2026' }]); // só professor tem
  });

  it('cadastra sem informar código', async () => {
    const auth = new AutenticacaoService(prisma, {} as any, {} as any);

    const u = await auth.cadastrar({ ...base } as any);

    expect(u.email).toBe('fulano@exemplo.com');
    expect(prisma.usuario.create).toHaveBeenCalled();
  });

  it('ignora um código enviado à toa (não vira erro)', async () => {
    const auth = new AutenticacaoService(prisma, {} as any, {} as any);

    await expect(auth.cadastrar({ ...base, codigo: 'qualquer-coisa' } as any)).resolves.toBeTruthy();
  });

  it('linha antiga com código em branco também conta como "sem código"', async () => {
    prisma = prismaFalso([{ papel: 'ALUNO', codigo: '   ' }]);
    const auth = new AutenticacaoService(prisma, {} as any, {} as any);

    await expect(auth.cadastrar({ ...base } as any)).resolves.toBeTruthy();
  });
});

describe('Cadastro quando o papel TEM código configurado', () => {
  beforeEach(() => {
    prisma = prismaFalso([{ papel: 'ALUNO', codigo: 'aluno-2026' }]);
  });

  it('sem código é recusado', async () => {
    const auth = new AutenticacaoService(prisma, {} as any, {} as any);

    await expect(auth.cadastrar({ ...base } as any)).rejects.toMatchObject({ status: 400 });
    expect(prisma.usuario.create).not.toHaveBeenCalled();
  });

  it('código errado é recusado', async () => {
    const auth = new AutenticacaoService(prisma, {} as any, {} as any);

    await expect(auth.cadastrar({ ...base, codigo: 'chute' } as any)).rejects.toMatchObject({ status: 400 });
  });

  it('código certo passa', async () => {
    const auth = new AutenticacaoService(prisma, {} as any, {} as any);

    await expect(auth.cadastrar({ ...base, codigo: 'aluno-2026' } as any)).resolves.toBeTruthy();
  });
});

describe('Rota pública de quais papéis exigem código', () => {
  it('devolve só booleanos por papel — nunca o código', async () => {
    const auth = new AutenticacaoService(prismaFalso([{ papel: 'PROFESSOR', codigo: 'segredo-do-prof' }]), {} as any, {} as any);

    const r = await auth.papeisQueExigemCodigo();

    expect(r).toEqual({ ALUNO: false, PROFESSOR: true, AVALIADOR: false });
    expect(JSON.stringify(r)).not.toContain('segredo-do-prof');
    expect(Object.values(r).every((v) => typeof v === 'boolean')).toBe(true);
  });
});

describe('Coordenação salvando os códigos', () => {
  it('campo em branco REMOVE o registro (em vez de guardar código vazio)', async () => {
    const p = prismaFalso([
      { papel: 'ALUNO', codigo: 'aluno-2026' },
      { papel: 'PROFESSOR', codigo: 'prof-2026' },
      { papel: 'AVALIADOR', codigo: 'aval-2026' },
    ]);
    const coord = new CoordenacaoService(p);

    await coord.salvarCodigos({ ALUNO: '', PROFESSOR: 'prof-2026', AVALIADOR: '   ' });

    expect(p._codigos.map((c: any) => c.papel)).toEqual(['PROFESSOR']);
    const auth = new AutenticacaoService(p, {} as any, {} as any);
    expect(await auth.papeisQueExigemCodigo()).toEqual({ ALUNO: false, PROFESSOR: true, AVALIADOR: false });
  });

  it('códigos já cadastrados continuam exigidos enquanto existirem', async () => {
    const p = prismaFalso([{ papel: 'ALUNO', codigo: 'aluno-2026' }]);
    const coord = new CoordenacaoService(p);

    await coord.salvarCodigos({ ALUNO: 'aluno-2026', PROFESSOR: '', AVALIADOR: '' });

    const auth = new AutenticacaoService(p, {} as any, {} as any);
    expect(await auth.papeisQueExigemCodigo()).toMatchObject({ ALUNO: true });
    await expect(auth.cadastrar({ ...base } as any)).rejects.toMatchObject({ status: 400 });
  });
});
