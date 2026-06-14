import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { promises as fs } from 'fs';
import { extname, join } from 'path';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import {
  MARCOS_CALENDARIO,
  DESTINATARIOS_AVISO,
  CORES_AVISO,
  CRITERIOS_FASE1,
  CRITERIOS_FASE2,
  colunaPeso,
  pesosSomam10,
  type DadosAviso,
} from '@tcc/compartilhado';

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

  // Salva os pesos por critério (Fase I e II). Cada conjunto deve somar 10.
  async salvarPesos(dados: Record<string, unknown>) {
    const semestre = semestreAtual();
    const ler = (criterios: typeof CRITERIOS_FASE1) =>
      criterios.map((c) => {
        const v = Number(dados[colunaPeso(c.chave)]);
        if (!Number.isFinite(v) || v < 0) {
          throw new BadRequestException({ mensagem: `Peso inválido em "${c.rotulo}".` });
        }
        return v;
      });
    const p1 = ler(CRITERIOS_FASE1);
    const p2 = ler(CRITERIOS_FASE2);
    if (!pesosSomam10(p1)) throw new BadRequestException({ mensagem: 'Os pesos da Fase I devem somar 10.' });
    if (!pesosSomam10(p2)) throw new BadRequestException({ mensagem: 'Os pesos da Fase II devem somar 10.' });

    const data: Record<string, number> = {};
    CRITERIOS_FASE1.forEach((c, i) => (data[colunaPeso(c.chave)] = p1[i]));
    CRITERIOS_FASE2.forEach((c, i) => (data[colunaPeso(c.chave)] = p2[i]));
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

  private normalizarDestinatarios(lista?: string[]): string {
    const sel = (lista ?? []).filter((p) => (DESTINATARIOS_AVISO as readonly string[]).includes(p));
    const unicos = [...new Set(sel)];
    if (!unicos.length) {
      throw new BadRequestException({ mensagem: 'Selecione ao menos um perfil destinatário.' });
    }
    return unicos.join(',');
  }

  // Valida a cor contra a lista permitida (não aceita string livre).
  private normalizarCor(cor?: string): string {
    const c = (cor ?? '').trim();
    if (!(CORES_AVISO as readonly string[]).includes(c)) {
      throw new BadRequestException({ mensagem: 'Cor inválida.' });
    }
    return c;
  }

  // Coordenador vê todos; demais perfis só veem avisos destinados ao seu papel. Fixados primeiro.
  async listarAvisos(papel?: string) {
    const avisos = await this.prisma.aviso.findMany({
      orderBy: [{ fixado: 'desc' }, { criadoEm: 'desc' }],
      include: { comentarios: { orderBy: { criadoEm: 'asc' } } },
    });
    if (!papel || papel === 'COORDENADOR') return avisos;
    return avisos.filter((a) => a.destinatarios.split(',').includes(papel));
  }

  async criarAviso(usuarioId: string, dados: DadosAviso) {
    const autor = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { nomeCompleto: true },
    });
    return this.prisma.aviso.create({
      data: {
        titulo: dados.titulo,
        conteudo: dados.conteudo,
        cor: this.normalizarCor(dados.cor),
        fixado: dados.fixado ?? false,
        destinatarios: this.normalizarDestinatarios(dados.destinatarios),
        autorId: usuarioId,
        autorNome: autor?.nomeCompleto ?? null,
      },
    });
  }

  async editarAviso(id: string, dados: DadosAviso) {
    const aviso = await this.prisma.aviso.findUnique({ where: { id } });
    if (!aviso) throw new NotFoundException('Aviso não encontrado');
    return this.prisma.aviso.update({
      where: { id },
      data: {
        titulo: dados.titulo,
        conteudo: dados.conteudo,
        cor: this.normalizarCor(dados.cor),
        fixado: dados.fixado ?? false,
        destinatarios: this.normalizarDestinatarios(dados.destinatarios),
      },
    });
  }

  async removerAviso(id: string) {
    const aviso = await this.prisma.aviso.findUnique({ where: { id } });
    if (!aviso) throw new NotFoundException('Aviso não encontrado');
    await this.prisma.aviso.delete({ where: { id } }); // cascata remove os comentários
    return { ok: true };
  }

  // ----- Comentários (qualquer usuário logado) -----

  async comentar(avisoId: string, usuario: { sub: string; papel: string }, texto: string) {
    const aviso = await this.prisma.aviso.findUnique({ where: { id: avisoId } });
    if (!aviso) throw new NotFoundException('Aviso não encontrado');
    // Só comenta quem pode ver o aviso (coordenador vê todos).
    if (usuario.papel !== 'COORDENADOR' && !aviso.destinatarios.split(',').includes(usuario.papel)) {
      throw new ForbiddenException();
    }
    const autor = await this.prisma.usuario.findUnique({
      where: { id: usuario.sub },
      select: { nomeCompleto: true },
    });
    return this.prisma.comentarioAviso.create({
      data: { avisoId, autorId: usuario.sub, autorNome: autor?.nomeCompleto ?? 'Usuário', texto: texto.trim() },
    });
  }

  // Apaga o comentário: precisa pertencer ao aviso da URL e ser do autor ou do coordenador.
  async removerComentario(avisoId: string, comentarioId: string, usuario: { sub: string; papel: string }) {
    const c = await this.prisma.comentarioAviso.findUnique({ where: { id: comentarioId } });
    if (!c || c.avisoId !== avisoId) throw new NotFoundException('Comentário não encontrado');
    if (c.autorId !== usuario.sub && usuario.papel !== 'COORDENADOR') throw new ForbiddenException();
    await this.prisma.comentarioAviso.delete({ where: { id: comentarioId } });
    return { ok: true };
  }

  // ---------- Documentos de referência (modelos) ----------

  private readonly PAPEIS_VISIVEIS = ['ALUNO', 'PROFESSOR', 'AVALIADOR'];

  // Normaliza a lista de perfis (CSV) que podem ver um documento de referência.
  private normalizarVisibilidade(v?: string): string {
    const sel = (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((p) => this.PAPEIS_VISIVEIS.includes(p));
    const unicos = [...new Set(sel)];
    if (!unicos.length) {
      throw new BadRequestException({ mensagem: 'Selecione ao menos um perfil que pode ver o documento.' });
    }
    return unicos.join(',');
  }

  // Coordenador vê todos; demais perfis só veem os documentos liberados para o seu papel.
  async listarReferencias(papel?: string) {
    const docs = await this.prisma.documentoReferencia.findMany({ orderBy: { criadoEm: 'asc' } });
    if (!papel || papel === 'COORDENADOR') return docs;
    return docs.filter((d) => d.visivelPara.split(',').includes(papel));
  }

  referencia(id: string) {
    return this.prisma.documentoReferencia.findUnique({ where: { id } });
  }

  // Devolve o documento só se o usuário puder vê-lo (coordenador sempre; demais pelo papel).
  // Senão devolve null — tratado como 404, evitando acesso por link/ID direto.
  async referenciaParaUsuario(id: string, papel: string) {
    const doc = await this.prisma.documentoReferencia.findUnique({ where: { id } });
    if (!doc) return null;
    if (papel === 'COORDENADOR' || doc.visivelPara.split(',').includes(papel)) return doc;
    return null;
  }

  async editarVisibilidade(id: string, visivelPara?: string) {
    const visivel = this.normalizarVisibilidade(visivelPara);
    const doc = await this.prisma.documentoReferencia.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException();
    return this.prisma.documentoReferencia.update({ where: { id }, data: { visivelPara: visivel } });
  }

  async adicionarReferencia(titulo: string, visivelPara: string | undefined, arquivo: any) {
    const visivel = this.normalizarVisibilidade(visivelPara);
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
        data: { titulo, nomeArquivo, caminho, tamanho: arquivo.size, visivelPara: visivel },
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

  // ---------- Exportar / Resetar dados (coordenador) ----------

  // Dump completo dos TCCs (com aluno/orientador/notas/documentos/bancas) para backup.
  async exportarDados() {
    const tccs = await this.prisma.tcc.findMany({
      orderBy: { criadoEm: 'asc' },
      include: {
        aluno: { select: { nomeCompleto: true, email: true, curso: true } },
        orientador: { select: { nomeCompleto: true, tratamento: true } },
        coorientador: { select: { nomeCompleto: true } },
        solicitacoes: true,
        documentos: true,
        bancas: { include: { membros: { include: { avaliador: { select: { nomeCompleto: true } } } } } },
      },
    });
    return { geradoEm: new Date().toISOString(), semestre: semestreAtual(), total: tccs.length, tccs };
  }

  // Dados completos dos TCCs para a tela de Relatórios (com bancas, membros e notas por critério).
  relatorio() {
    return this.prisma.tcc.findMany({
      orderBy: { criadoEm: 'asc' },
      include: {
        aluno: { select: { nomeCompleto: true, curso: true } },
        orientador: { select: { nomeCompleto: true, tratamento: true, afiliacao: true } },
        coorientador: { select: { nomeCompleto: true, tratamento: true, afiliacao: true } },
        bancas: {
          include: {
            membros: { include: { avaliador: { select: { nomeCompleto: true, tratamento: true, afiliacao: true } } } },
          },
        },
      },
    });
  }

  // Reseta o período: apaga os TCCs do semestre atual (cascade) e seus arquivos.
  // Segurança: exige a senha do coordenador e o texto de confirmação "APAGAR".
  async resetarPeriodo(usuarioId: string, senha: string, confirmacao: string) {
    if (confirmacao !== 'APAGAR') {
      throw new BadRequestException({ mensagem: 'Confirmação inválida. Digite APAGAR para confirmar.' });
    }
    const u = await this.prisma.usuario.findUnique({ where: { id: usuarioId } });
    if (!u) throw new UnauthorizedException();
    const ok = await bcrypt.compare(senha || '', u.senhaHash);
    if (!ok) {
      throw new BadRequestException({ mensagem: 'Senha incorreta.', erros: [{ campo: 'senha', mensagem: 'Senha incorreta' }] });
    }

    const semestre = semestreAtual();
    const backup = await this.exportarDados(); // backup antes de apagar
    const docs = await this.prisma.documentoTcc.findMany({
      where: { tcc: { semestre } },
      select: { caminho: true },
    });
    const { count } = await this.prisma.tcc.deleteMany({ where: { semestre } });
    for (const d of docs) {
      await fs.rm(join(process.cwd(), d.caminho), { force: true }).catch(() => {});
    }
    return { apagados: count, backup };
  }
}
