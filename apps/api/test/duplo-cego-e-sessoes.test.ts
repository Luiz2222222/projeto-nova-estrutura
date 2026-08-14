// Testes de integração do DUPLO-CEGO (Fase I) e da INVALIDAÇÃO DE SESSÕES.
//
// Duplo-cego: na banca da Fase I a avaliação é às cegas — o avaliador não recebe a
// identidade do aluno/orientador nem os metadados dos documentos do TCC, e não consegue
// baixar a monografia original (só o documento anônimo da banca). Na Fase II (defesa
// presencial) a identidade é visível normalmente.
//
// Sessões: o guard confere no banco que o usuário ainda existe e que a versão do token
// bate — trocar/redefinir a senha derruba todas as sessões antigas na hora, e o papel
// usado nas autorizações vem sempre do banco.
import 'reflect-metadata';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import * as bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { createClient } from '@libsql/client';
import { PrismaLibSQL } from '@prisma/adapter-libsql';
import { PrismaClient } from '@prisma/client';
import { TccsService } from '../src/tccs/tccs.service';
import { BancasService } from '../src/bancas/bancas.service';
import { PrazosService } from '../src/prazos/prazos.service';
import { AutenticacaoService } from '../src/autenticacao/autenticacao.service';
import { GuardaJwt } from '../src/autenticacao/guarda-jwt';

const DB = '/tmp/tcc-teste-cego-sessoes.db';

let prisma: PrismaClient;
let tccs: TccsService;
let bancas: BancasService;
let auth: AutenticacaoService;
let jwt: JwtService;
let guarda: GuardaJwt;
// Mantido em escopo de módulo para ser FECHADO no afterAll — senão o arquivo SQLite fica
// travado e o unlink de limpeza falha com EBUSY no Windows.
let libsql: ReturnType<typeof createClient> | undefined;

const eventosStub = { emitirParaUsuario: async () => undefined, emitirParaCoordenadores: async () => undefined } as any;
const emailStub = { enviarRecuperacaoSenha: async () => undefined } as any;

beforeAll(async () => {
  await fs.rm(DB, { force: true }).catch(() => undefined);
  libsql = createClient({ url: `file:${DB}` });
  const migracoes = join(__dirname, '..', 'prisma', 'migrations');
  for (const pasta of readdirSync(migracoes).sort()) {
    try {
      await libsql.executeMultiple(readFileSync(join(migracoes, pasta, 'migration.sql'), 'utf-8'));
    } catch {
      /* entradas sem migration.sql */
    }
  }
  try {
    const nativo: any = new PrismaClient({ datasources: { db: { url: `file:${DB}` } } } as any);
    await nativo.$queryRaw`SELECT 1`;
    prisma = nativo;
  } catch {
    const { PrismaClient: PrismaWasm } = (await import('@prisma/client/wasm' as any)) as any;
    prisma = new PrismaWasm({ adapter: new PrismaLibSQL(libsql) });
  }
  const prazos = new PrazosService(prisma as any);
  tccs = new TccsService(prisma as any, eventosStub, prazos, { aoAprovarAbertura: async () => {}, aoEnviarDocumento: async () => {}, aoAlterarTcc: async () => {} } as any);
  bancas = new BancasService(prisma as any, eventosStub, prazos, { aoAprovarAbertura: async () => {}, aoEnviarDocumento: async () => {}, aoAlterarTcc: async () => {} } as any);
  jwt = new JwtService({ secret: 'segredo-teste' });
  auth = new AutenticacaoService(prisma as any, jwt, emailStub);
  guarda = new GuardaJwt(jwt, prisma as any);
});

afterAll(async () => {
  await prisma?.$disconnect();
  libsql?.close(); // libera o arquivo antes de apagar (Windows trava enquanto aberto)
  await fs.rm(DB, { force: true }).catch(() => undefined); // limpeza best-effort (ignora lock)
});

beforeEach(async () => {
  await prisma.tcc.deleteMany();
  await prisma.usuario.deleteMany();
});

let seq = 0;
async function usuario(papel: string, senha?: string) {
  seq += 1;
  return prisma.usuario.create({
    data: {
      nomeCompleto: `${papel} ${seq}`,
      email: `u${seq}@teste.br`,
      senhaHash: senha ? await bcrypt.hash(senha, 4) : 'x',
      papel,
    },
  });
}

// TCC + banca da fase indicada com o avaliador informado. Para a Fase I também cria o
// documento anônimo da banca (documentoAvaliacao) e uma MONOGRAFIA original do aluno.
async function tccComBanca(fase: 'FASE_1' | 'FASE_2', avaliadorId: string) {
  const aluno = await usuario('ALUNO');
  const orientador = await usuario('PROFESSOR');
  const tcc = await prisma.tcc.create({
    data: {
      titulo: 'TCC sigiloso',
      semestre: '2026.1',
      faseAtual: fase === 'FASE_1' ? 'AVALIACAO_FASE_1' : 'AVALIACAO_FASE_2',
      alunoId: aluno.id,
      orientadorId: orientador.id,
    },
  });
  const mono = await prisma.documentoTcc.create({
    data: { tccId: tcc.id, tipo: 'MONOGRAFIA', nomeArquivo: 'TCC_do_Fulano.docx', caminho: 'uploads/m.docx', tamanho: 1, status: 'APROVADO' },
  });
  let docBanca: any = null;
  if (fase === 'FASE_1') {
    docBanca = await prisma.documentoTcc.create({
      data: { tccId: tcc.id, tipo: 'AVALIACAO_BANCA', nomeArquivo: 'anonimo.pdf', caminho: 'uploads/a.pdf', tamanho: 1, status: 'APROVADO' },
    });
  }
  await prisma.banca.create({
    data: { tccId: tcc.id, fase, documentoAvaliacaoId: docBanca?.id ?? null, membros: { create: [{ avaliadorId }] } },
  });
  return { tcc, aluno, orientador, mono, docBanca };
}

describe('Duplo-cego — Fase I (avaliação às cegas)', () => {
  it('minhasBancas NÃO entrega a identidade do aluno/orientador nem os documentos na Fase I', async () => {
    const av = await usuario('AVALIADOR');
    const { docBanca } = await tccComBanca('FASE_1', av.id);
    const [item]: any[] = await bancas.minhasBancas(av.id);
    expect(item.banca.tcc.aluno).toBeNull();
    expect(item.banca.tcc.alunoId).toBeNull();
    expect(item.banca.tcc.orientadorId).toBeNull();
    expect(item.banca.tcc.documentos).toEqual([]); // nomes de arquivo entregariam o aluno
    expect(item.banca.tcc.titulo).toBe('TCC sigiloso'); // o trabalho em si continua identificável
    expect(item.banca.documentoAvaliacao?.id).toBe(docBanca.id); // documento anônimo disponível
  });

  it('na Fase II (defesa presencial) a identidade é visível normalmente', async () => {
    const av = await usuario('AVALIADOR');
    const { aluno } = await tccComBanca('FASE_2', av.id);
    const [item]: any[] = await bancas.minhasBancas(av.id);
    expect(item.banca.tcc.aluno?.nomeCompleto).toBe(aluno.nomeCompleto);
  });

  it('membro da banca da Fase I NÃO baixa a monografia original; o da Fase II sim; o dono sempre', async () => {
    const avF1 = await usuario('AVALIADOR');
    const { tcc, aluno, mono, docBanca } = await tccComBanca('FASE_1', avF1.id);

    // Fase I: monografia original bloqueada; documento anônimo da banca liberado.
    expect(await tccs.documentoParaUsuario(mono.id, { sub: avF1.id, papel: 'AVALIADOR' })).toBeNull();
    expect((await tccs.documentoParaUsuario(docBanca.id, { sub: avF1.id, papel: 'AVALIADOR' }))?.id).toBe(docBanca.id);

    // Dono (aluno) continua acessando a própria monografia — e NUNCA o doc interno da banca.
    expect((await tccs.documentoParaUsuario(mono.id, { sub: aluno.id, papel: 'ALUNO' }))?.id).toBe(mono.id);
    expect(await tccs.documentoParaUsuario(docBanca.id, { sub: aluno.id, papel: 'ALUNO' })).toBeNull();

    // Fase II: o membro volta a acessar a monografia (a defesa não é anônima).
    const avF2 = await usuario('AVALIADOR');
    await prisma.banca.create({ data: { tccId: tcc.id, fase: 'FASE_2', membros: { create: [{ avaliadorId: avF2.id }] } } });
    expect((await tccs.documentoParaUsuario(mono.id, { sub: avF2.id, papel: 'AVALIADOR' }))?.id).toBe(mono.id);
  });
});

// Contexto fake do Nest para exercitar o guard como na requisição real.
function ctxCom(token?: string) {
  const req: any = { cookies: token ? { token } : {} };
  return { req, ctx: { switchToHttp: () => ({ getRequest: () => req }) } as any };
}

describe('Sessões — guard confere existência do usuário e versão do token', () => {
  it('token válido passa e o papel vem do BANCO (não do token)', async () => {
    const u = await usuario('PROFESSOR', '123456');
    const token = auth.gerarToken(u as any, false);
    const { req, ctx } = ctxCom(token);
    expect(await guarda.canActivate(ctx)).toBe(true);
    expect(req.usuario.papel).toBe('PROFESSOR');

    // Papel mudou no banco → próxima requisição já usa o papel novo, sem esperar expirar.
    await prisma.usuario.update({ where: { id: u.id }, data: { papel: 'AVALIADOR' } });
    const { req: req2, ctx: ctx2 } = ctxCom(token);
    expect(await guarda.canActivate(ctx2)).toBe(true);
    expect(req2.usuario.papel).toBe('AVALIADOR');
  });

  it('trocar a própria senha derruba as sessões antigas na hora', async () => {
    const u = await usuario('ALUNO', '123456');
    const tokenAntigo = auth.gerarToken(u as any, true); // "manter login" (7 dias)
    await auth.trocarSenha(u.id, '123456', 'novaSenha1');
    await expect(guarda.canActivate(ctxCom(tokenAntigo).ctx)).rejects.toThrow(/Sessão inválida/);

    // Logando de novo, o token novo (com a versão atual) volta a funcionar.
    const atualizado = await prisma.usuario.findUniqueOrThrow({ where: { id: u.id } });
    const tokenNovo = auth.gerarToken(atualizado as any, false);
    expect(await guarda.canActivate(ctxCom(tokenNovo).ctx)).toBe(true);
  });

  it('usuário excluído perde o acesso imediatamente (mesmo com token ainda não expirado)', async () => {
    const u = await usuario('AVALIADOR', '123456');
    const token = auth.gerarToken(u as any, true);
    await prisma.usuario.delete({ where: { id: u.id } });
    await expect(guarda.canActivate(ctxCom(token).ctx)).rejects.toThrow(/Sessão inválida/);
  });

  it('token antigo (sem versão de sessão) é rejeitado — basta logar de novo', async () => {
    const u = await usuario('ALUNO', '123456');
    const tokenLegado = jwt.sign({ sub: u.id, papel: u.papel }); // formato anterior, sem `v`
    await expect(guarda.canActivate(ctxCom(tokenLegado).ctx)).rejects.toThrow(/Sessão inválida/);
  });
});
