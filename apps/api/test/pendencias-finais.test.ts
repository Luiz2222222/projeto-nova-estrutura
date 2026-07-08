// Testes de integração das PENDÊNCIAS FINAIS da auditoria de backend.
//
//  1. Teto de documentos por TCC nos envios do aluno (anti enchimento de disco).
//  2. Aprovar a abertura exige plano/termo VÁLIDOS (documento rejeitado não conta).
//  3. Pesos travados: critérios não mudam após a 1ª avaliação enviada do período;
//     pesos das fases não mudam após a 1ª nota final apurada. Regravar os MESMOS
//     valores continua permitido.
//  4. Avaliador da Fase II só recebe documentos da defesa (monografia/versão final).
import 'reflect-metadata';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { createClient } from '@libsql/client';
import { PrismaLibSQL } from '@prisma/adapter-libsql';
import { PrismaClient } from '@prisma/client';
import { CRITERIOS_FASE1, CRITERIOS_FASE2, colunaPeso } from '@tcc/compartilhado';
import { TccsService } from '../src/tccs/tccs.service';
import { BancasService } from '../src/bancas/bancas.service';
import { PrazosService } from '../src/prazos/prazos.service';
import { CoordenacaoService } from '../src/coordenacao/coordenacao.service';

const DB = '/tmp/tcc-teste-pendencias.db';

let prisma: PrismaClient;
let tccs: TccsService;
let bancas: BancasService;
let coordenacao: CoordenacaoService;
// Mantido em escopo de módulo para ser FECHADO no afterAll — senão o arquivo SQLite fica
// travado e o unlink de limpeza falha com EBUSY no Windows.
let libsql: ReturnType<typeof createClient> | undefined;

const eventosStub = { emitirParaUsuario: async () => undefined, emitirParaCoordenadores: async () => undefined } as any;

// DOCX mínimo válido para a checagem de assinatura binária (contêiner zip: "PK").
const arquivoDocx = (nome = 'arquivo.docx') => ({
  originalname: nome,
  buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]),
  size: 8,
  mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
});

async function esperarErro(p: Promise<unknown>, trecho: RegExp) {
  await expect(p).rejects.toSatisfy((e: any) => {
    const msg = e?.getResponse?.()?.mensagem ?? e?.message ?? '';
    if (!trecho.test(msg)) throw new Error(`mensagem inesperada: "${msg}"`);
    return true;
  });
}

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
  tccs = new TccsService(prisma as any, eventosStub, prazos);
  bancas = new BancasService(prisma as any, eventosStub, prazos);
  coordenacao = new CoordenacaoService(prisma as any);
});

afterAll(async () => {
  await prisma?.$disconnect();
  libsql?.close(); // libera o arquivo antes de apagar (Windows trava enquanto aberto)
  await fs.rm(DB, { force: true }).catch(() => undefined); // limpeza best-effort (ignora lock)
});

beforeEach(async () => {
  await prisma.tcc.deleteMany();
  await prisma.usuario.deleteMany();
  await prisma.calendario.deleteMany();
  await prisma.configuracaoSistema.deleteMany();
  // Semestre ativo fixo para os testes de pesos.
  await prisma.configuracaoSistema.create({ data: { id: 'global', semestreAtivo: '2026.1' } });
});

let seq = 0;
async function usuario(papel: string) {
  seq += 1;
  return prisma.usuario.create({
    data: { nomeCompleto: `${papel} ${seq}`, email: `u${seq}@teste.br`, senhaHash: 'x', papel },
  });
}

async function tccBasico(fase: string) {
  const aluno = await usuario('ALUNO');
  const orientador = await usuario('PROFESSOR');
  const tcc = await prisma.tcc.create({
    data: { titulo: 'TCC pendências', semestre: '2026.1', faseAtual: fase, alunoId: aluno.id, orientadorId: orientador.id },
  });
  return { tcc, aluno, orientador };
}

describe('1 — Teto de documentos por TCC nos envios do aluno', () => {
  it('bloqueia o envio quando o TCC já tem 40 documentos; abaixo disso, aceita', async () => {
    const { tcc, aluno } = await tccBasico('DESENVOLVIMENTO');
    await prisma.documentoTcc.createMany({
      data: Array.from({ length: 40 }, (_, i) => ({
        tccId: tcc.id, tipo: 'MONOGRAFIA', status: 'SUBSTITUIDA', versao: i + 1,
        nomeArquivo: `v${i}.pdf`, caminho: `uploads/v${i}.pdf`, tamanho: 1,
      })),
    });
    await esperarErro(tccs.enviarMonografia(aluno.id, tcc.id, arquivoDocx()), /limite de documentos/);

    // Removendo o excesso, o envio volta a funcionar (grava arquivo e registro de verdade).
    await prisma.documentoTcc.deleteMany({ where: { tccId: tcc.id, versao: { gt: 10 } } });
    const doc = await tccs.enviarMonografia(aluno.id, tcc.id, arquivoDocx('monografia.docx'));
    expect(doc.tipo).toBe('MONOGRAFIA');
    await fs.rm(join(process.cwd(), doc.caminho), { force: true }); // limpeza do arquivo de teste
  });
});

describe('2 — Aprovação da abertura exige documentos válidos', () => {
  async function aberturaComDocs(statusPlano: string) {
    const { tcc } = await tccBasico('INICIALIZACAO');
    await prisma.solicitacaoOrientacao.create({
      data: { tccId: tcc.id, status: 'PENDENTE' },
    });
    await prisma.documentoTcc.createMany({
      data: [
        { tccId: tcc.id, tipo: 'PLANO_DESENVOLVIMENTO', status: statusPlano, nomeArquivo: 'p.pdf', caminho: 'uploads/p.pdf', tamanho: 1 },
        { tccId: tcc.id, tipo: 'TERMO_ACEITE', status: 'PENDENTE', nomeArquivo: 't.pdf', caminho: 'uploads/t.pdf', tamanho: 1 },
      ],
    });
    return tcc;
  }

  it('plano REJEITADO não conta: aprovação é recusada pedindo o reenvio', async () => {
    const tcc = await aberturaComDocs('REJEITADO');
    await esperarErro(tccs.aprovar(tcc.id), /rejeitado não conta/);
    expect((await prisma.tcc.findUniqueOrThrow({ where: { id: tcc.id } })).faseAtual).toBe('INICIALIZACAO');
  });

  it('com os dois documentos válidos, a abertura é aprovada normalmente', async () => {
    const tcc = await aberturaComDocs('PENDENTE');
    await tccs.aprovar(tcc.id);
    expect((await prisma.tcc.findUniqueOrThrow({ where: { id: tcc.id } })).faseAtual).toBe('DESENVOLVIMENTO');
  });
});

describe('3 — Pesos travados após avaliações/notas do período', () => {
  function pesosPadrao(): Record<string, number> {
    const d: Record<string, number> = {};
    for (const c of [...CRITERIOS_FASE1, ...CRITERIOS_FASE2]) d[colunaPeso(c.chave)] = c.pesoPadrao;
    return d;
  }
  // Move peso entre os dois primeiros critérios da Fase I (soma continua 10).
  function pesosAlterados(): Record<string, number> {
    const d = pesosPadrao();
    const [a, b] = CRITERIOS_FASE1;
    d[colunaPeso(a.chave)] = a.pesoPadrao + 1;
    d[colunaPeso(b.chave)] = b.pesoPadrao - 1;
    return d;
  }
  async function avaliacaoEnviadaNoSemestre() {
    const { tcc } = await tccBasico('AVALIACAO_FASE_1');
    const av = await usuario('AVALIADOR');
    await prisma.banca.create({
      data: { tccId: tcc.id, fase: 'FASE_1', membros: { create: [{ avaliadorId: av.id, status: 'ENVIADO', nota: 7 }] } },
    });
    return tcc;
  }

  it('sem avaliações no período, mudar os pesos é permitido', async () => {
    await coordenacao.salvarPesos(pesosAlterados());
    const cal: any = await prisma.calendario.findUnique({ where: { semestre: '2026.1' } });
    expect(cal[colunaPeso(CRITERIOS_FASE1[0].chave)]).toBe(CRITERIOS_FASE1[0].pesoPadrao + 1);
  });

  it('com avaliação enviada, MUDAR pesos de critério é bloqueado — regravar os mesmos, não', async () => {
    await avaliacaoEnviadaNoSemestre();
    await esperarErro(coordenacao.salvarPesos(pesosAlterados()), /não podem mais mudar/);
    await coordenacao.salvarPesos(pesosPadrao()); // mesmos valores: passa
  });

  it('com nota final apurada, mudar os pesos das FASES é bloqueado', async () => {
    const { tcc } = await tccBasico('CONCLUIDO');
    await prisma.tcc.update({ where: { id: tcc.id }, data: { nf1: 8, nf2: 7, nf: 7.6, resultado: 'APROVADO' } });
    await esperarErro(
      coordenacao.salvarPesos({ ...pesosPadrao(), pesoFase1: 0.5, pesoFase2: 0.5 }),
      /nota final apurada/,
    );
    // Os pesos vigentes (60/40) podem ser regravados sem erro.
    await coordenacao.salvarPesos({ ...pesosPadrao(), pesoFase1: 0.6, pesoFase2: 0.4 });
  });
});

describe('4 — Avaliador da Fase II só recebe documentos da defesa', () => {
  it('plano e termo ficam fora da visão da banca; monografia/versão final entram', async () => {
    const { tcc } = await tccBasico('AVALIACAO_FASE_2');
    const av = await usuario('AVALIADOR');
    await prisma.documentoTcc.createMany({
      data: [
        { tccId: tcc.id, tipo: 'PLANO_DESENVOLVIMENTO', status: 'APROVADO', nomeArquivo: 'plano_do_Fulano.pdf', caminho: 'uploads/p.pdf', tamanho: 1 },
        { tccId: tcc.id, tipo: 'MONOGRAFIA', status: 'APROVADO', nomeArquivo: 'monografia.pdf', caminho: 'uploads/m.pdf', tamanho: 1 },
      ],
    });
    await prisma.banca.create({ data: { tccId: tcc.id, fase: 'FASE_2', membros: { create: [{ avaliadorId: av.id }] } } });

    const [item]: any[] = await bancas.minhasBancas(av.id);
    const tipos = item.banca.tcc.documentos.map((d: any) => d.tipo);
    expect(tipos).toEqual(['MONOGRAFIA']);
  });
});
