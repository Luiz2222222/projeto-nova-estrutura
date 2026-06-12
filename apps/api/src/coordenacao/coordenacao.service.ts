import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { promises as fs } from 'fs';
import { extname, join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { MARCOS_CALENDARIO } from '@tcc/compartilhado';

function semestreAtual(): string {
  const d = new Date();
  const s = d.getMonth() + 1 <= 6 ? 1 : 2;
  return `${d.getFullYear()}.${s}`;
}

@Injectable()
export class CoordenacaoService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- Calendário ----------

  calendario() {
    return this.prisma.calendario.findUnique({ where: { semestre: semestreAtual() } });
  }

  async salvarCalendario(dados: Record<string, string | null | undefined>) {
    const semestre = semestreAtual();
    const data: Record<string, Date | null> = {};
    for (const marco of MARCOS_CALENDARIO) {
      const valor = dados[marco];
      if (!valor) {
        data[marco] = null;
        continue;
      }
      const d = new Date(valor);
      if (Number.isNaN(d.getTime())) {
        throw new BadRequestException({ mensagem: `Data inválida em "${marco}".` });
      }
      data[marco] = d;
    }
    return this.prisma.calendario.upsert({
      where: { semestre },
      update: data,
      create: { semestre, ...data },
    });
  }

  // ---------- Códigos de cadastro ----------

  // Senhas que cada perfil usa para se cadastrar (lidas/definidas só pelo coordenador).
  private readonly PAPEIS_CODIGO = ['ALUNO', 'PROFESSOR', 'AVALIADOR'] as const;

  listarCodigos() {
    return this.prisma.codigoCadastro.findMany({ orderBy: { papel: 'asc' } });
  }

  async salvarCodigos(dados: Record<string, string>) {
    const ops = this.PAPEIS_CODIGO.map((papel) => {
      const codigo = (dados[papel] ?? '').trim();
      if (!codigo) throw new BadRequestException({ mensagem: `Informe o código de cadastro de ${papel}.` });
      return this.prisma.codigoCadastro.upsert({
        where: { papel },
        update: { codigo },
        create: { papel, codigo },
      });
    });
    await this.prisma.$transaction(ops);
    return this.listarCodigos();
  }

  // ---------- Avisos ----------

  listarAvisos() {
    return this.prisma.aviso.findMany({ orderBy: { criadoEm: 'desc' } });
  }

  async criarAviso(usuarioId: string, titulo: string, conteudo: string) {
    const autor = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { nomeCompleto: true },
    });
    return this.prisma.aviso.create({
      data: { titulo, conteudo, autorNome: autor?.nomeCompleto ?? null },
    });
  }

  async removerAviso(id: string) {
    const aviso = await this.prisma.aviso.findUnique({ where: { id } });
    if (!aviso) throw new NotFoundException('Aviso não encontrado');
    await this.prisma.aviso.delete({ where: { id } });
    return { ok: true };
  }

  // ---------- Documentos de referência (modelos) ----------

  listarReferencias() {
    return this.prisma.documentoReferencia.findMany({ orderBy: { criadoEm: 'asc' } });
  }

  referencia(id: string) {
    return this.prisma.documentoReferencia.findUnique({ where: { id } });
  }

  async adicionarReferencia(titulo: string, arquivo: any) {
    const dir = join(process.cwd(), 'uploads', 'referencia');
    await fs.mkdir(dir, { recursive: true });
    const ext = extname(arquivo.originalname || '').replace(/[^.a-zA-Z0-9]/g, '').slice(0, 10);
    const nome = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    const caminho = join('uploads', 'referencia', nome);
    await fs.writeFile(join(dir, nome), arquivo.buffer);

    // O multer entrega o originalname interpretado como latin1; reinterpreta como UTF-8
    // para preservar acentos (ex.: "Orientações" em vez de "OrientaÃ§oes").
    const nomeArquivo = Buffer.from(arquivo.originalname || '', 'latin1').toString('utf8');
    try {
      return await this.prisma.documentoReferencia.create({
        data: { titulo, nomeArquivo, caminho, tamanho: arquivo.size },
      });
    } catch (e) {
      // Se o registro falhar, remove o arquivo recém-gravado (sem órfão).
      await fs.rm(join(process.cwd(), caminho), { force: true }).catch(() => {});
      throw e;
    }
  }

  async removerReferencia(id: string) {
    const doc = await this.prisma.documentoReferencia.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException();
    await fs.rm(join(process.cwd(), doc.caminho), { force: true }).catch(() => {});
    await this.prisma.documentoReferencia.delete({ where: { id } });
    return { ok: true };
  }
}
