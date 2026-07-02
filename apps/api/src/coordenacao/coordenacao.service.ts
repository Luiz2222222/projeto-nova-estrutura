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
import AdmZip from 'adm-zip';
import { PrismaService } from '../prisma/prisma.service';
import { corrigirNomeArquivo } from '../comum/nome-arquivo';
import { resolverSemestreAtivo, gravarSemestreAtivo } from '../comum/semestre';
import {
  MARCOS_CALENDARIO,
  DESTINATARIOS_AVISO,
  CORES_AVISO,
  CRITERIOS_FASE1,
  CRITERIOS_FASE2,
  colunaPeso,
  colunaNota,
  pesosSomam10,
  ROTULO_FASE,
  ROTULO_CURSO,
  CURSOS,
  TRATAMENTOS,
  AFILIACOES,
  type DadosAviso,
} from '@tcc/compartilhado';

// Opções do download em ZIP (cada parte é incluída se true).
export type OpcoesExport = { dados: boolean; monografia: boolean; documentos: boolean };

@Injectable()
export class CoordenacaoService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- Período/semestre ativo (definido manualmente pela coordenação) ----------

  // Período ativo atual do sistema (persistido; não muda sozinho pela data).
  async obterSemestreAtivo() {
    return { semestre: await resolverSemestreAtivo(this.prisma) };
  }

  // Define o período ativo. NÃO altera o semestre de TCCs já existentes.
  async definirSemestreAtivo(semestre: string) {
    return { semestre: await gravarSemestreAtivo(this.prisma, semestre) };
  }

  // ---------- Calendário ----------

  async calendario() {
    const semestre = await resolverSemestreAtivo(this.prisma);
    return this.prisma.calendario.findUnique({ where: { semestre } });
  }

  async salvarCalendario(dados: Record<string, string | null | undefined>) {
    const semestre = await resolverSemestreAtivo(this.prisma);
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
    const semestre = await resolverSemestreAtivo(this.prisma);
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

    // Pesos das FASES na nota final (frações que somam 1; default 60/40). Só grava se enviados.
    if (dados.pesoFase1 !== undefined || dados.pesoFase2 !== undefined) {
      const pf1 = Number(dados.pesoFase1);
      const pf2 = Number(dados.pesoFase2);
      if (!Number.isFinite(pf1) || !Number.isFinite(pf2) || pf1 < 0 || pf2 < 0) {
        throw new BadRequestException({ mensagem: 'Pesos das fases inválidos.' });
      }
      if (Math.abs(pf1 + pf2 - 1) > 0.001) {
        throw new BadRequestException({ mensagem: 'Os pesos das fases (Fase I + Fase II) devem somar 100%.' });
      }
      data.pesoFase1 = pf1;
      data.pesoFase2 = pf2;
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

    // Corrige acentos do nome enviado (latin1->UTF-8), de forma segura/condicional.
    const nomeArquivo = corrigirNomeArquivo(arquivo.originalname);
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
    return { geradoEm: new Date().toISOString(), semestre: await resolverSemestreAtivo(this.prisma), total: tccs.length, tccs };
  }

  // ----- Download em ZIP (dados.txt + monografia aprovada + documentos gerais) -----

  // Include comum para montar o ZIP (aluno, orientação, documentos e bancas/notas).
  private readonly incExport = {
    aluno: { select: { nomeCompleto: true, email: true, curso: true } },
    orientador: { select: { nomeCompleto: true, tratamento: true } },
    coorientador: { select: { nomeCompleto: true, tratamento: true, afiliacao: true } },
    documentos: true,
    bancas: { include: { membros: { include: { avaliador: { select: { nomeCompleto: true, tratamento: true } } } } } },
  };

  // ZIP geral: todos os TCCs do período ativo, uma pasta por aluno.
  async exportarZipGeral(opts: OpcoesExport): Promise<{ buffer: Buffer; nome: string }> {
    const semestre = await resolverSemestreAtivo(this.prisma);
    const tccs = await this.prisma.tcc.findMany({
      where: { semestre },
      orderBy: { aluno: { nomeCompleto: 'asc' } },
      include: this.incExport,
    });
    const zip = new AdmZip();
    const pastasUsadas = new Map<string, number>();
    for (const tcc of tccs) {
      const base = this.sanitizarNome(tcc.aluno?.nomeCompleto || 'Aluno');
      const usadas = pastasUsadas.get(base.toLowerCase()) ?? 0;
      pastasUsadas.set(base.toLowerCase(), usadas + 1);
      const pasta = usadas === 0 ? base : `${base} (${usadas + 1})`;
      await this.adicionarTccAoZip(zip, tcc, opts, pasta);
    }
    return { buffer: zip.toBuffer(), nome: `TCCs_${semestre}.zip` };
  }

  // ZIP de um TCC específico (sem subpasta; arquivos na raiz do ZIP).
  async exportarZipTcc(id: string, opts: OpcoesExport): Promise<{ buffer: Buffer; nome: string }> {
    const tcc = await this.prisma.tcc.findUnique({ where: { id }, include: this.incExport });
    if (!tcc) throw new NotFoundException('TCC não encontrado');
    const zip = new AdmZip();
    await this.adicionarTccAoZip(zip, tcc, opts, '');
    return { buffer: zip.toBuffer(), nome: `${this.sanitizarNome(tcc.aluno?.nomeCompleto || 'TCC')}.zip` };
  }

  // Adiciona dados.txt + monografia + documentos gerais de um TCC ao ZIP (sob `pasta`).
  private async adicionarTccAoZip(zip: AdmZip, tcc: any, opts: OpcoesExport, pasta: string) {
    const prefixo = pasta ? `${pasta}/` : '';
    const usados = new Set<string>();
    const nomeUnico = (nome: string) => {
      const base = this.sanitizarNome(nome);
      let n = base;
      let i = 2;
      while (usados.has(n.toLowerCase())) n = this.comSufixo(base, ` (${i++})`);
      usados.add(n.toLowerCase());
      return n;
    };
    const addArquivo = async (doc: any) => {
      try {
        const buf = await fs.readFile(join(process.cwd(), doc.caminho));
        zip.addFile(prefixo + nomeUnico(doc.nomeArquivo), buf);
      } catch {
        // Arquivo físico ausente: ignora sem quebrar o restante do ZIP.
      }
    };

    if (opts.dados) {
      usados.add('dados.txt');
      zip.addFile(`${prefixo}dados.txt`, Buffer.from(this.gerarDadosTxt(tcc), 'utf-8'));
    }

    const docs: any[] = tcc.documentos ?? [];
    if (opts.monografia) {
      // Só MONOGRAFIA aprovada, a de maior versão. Sem fallback para pendente/rejeitada.
      const mono = docs
        .filter((d) => d.tipo === 'MONOGRAFIA' && d.status === 'APROVADO')
        .sort((a, b) => b.versao - a.versao)[0];
      if (mono) await addArquivo(mono);
    }
    if (opts.documentos) {
      // Documentos gerais: exclui a monografia principal, o documento interno da banca
      // (AVALIACAO_BANCA, equivalente ao antigo MONOGRAFIA_AVALIACAO) e versões substituídas.
      const gerais = docs
        .filter((d) => d.tipo !== 'MONOGRAFIA' && d.tipo !== 'AVALIACAO_BANCA' && d.status !== 'SUBSTITUIDA')
        .sort((a, b) => (a.tipo === b.tipo ? b.versao - a.versao : a.tipo < b.tipo ? -1 : 1));
      for (const d of gerais) await addArquivo(d);
    }
  }

  // Relatório do TCC em texto (dados, fases, notas, banca, avaliações e pareceres).
  private gerarDadosTxt(tcc: any): string {
    const L: string[] = [];
    const add = (s = '') => L.push(s);
    const sep = () => add('='.repeat(60));
    const nomeTrat = (p: any) => (p ? `${p.tratamento ? p.tratamento + ' ' : ''}${p.nomeCompleto}` : '—');

    sep();
    add(`TCC: ${tcc.titulo}`);
    sep();
    add('');
    add('ALUNO');
    add(`  Nome: ${tcc.aluno?.nomeCompleto ?? '—'}`);
    add(`  E-mail: ${tcc.aluno?.email ?? '—'}`);
    add(`  Curso: ${(ROTULO_CURSO as Record<string, string>)[tcc.aluno?.curso] ?? tcc.aluno?.curso ?? '—'}`);
    add('');
    add('ORIENTAÇÃO');
    add(`  Orientador: ${nomeTrat(tcc.orientador)}`);
    const coor = tcc.coorientador
      ? nomeTrat(tcc.coorientador)
      : tcc.coorientadorNome
        ? `${tcc.coorientadorTitulacao ? tcc.coorientadorTitulacao + ' ' : ''}${tcc.coorientadorNome}${tcc.coorientadorAfiliacao ? ' · ' + tcc.coorientadorAfiliacao : ''}`
        : 'Sem coorientador';
    add(`  Coorientador: ${coor}`);
    add('');
    add('SITUAÇÃO');
    add(`  Fase atual: ${ROTULO_FASE[tcc.faseAtual] ?? tcc.faseAtual}`);
    add(`  Semestre: ${tcc.semestre}`);
    add(`  Criado em: ${this.fmtData(tcc.criadoEm)}`);
    add(`  Atualizado em: ${this.fmtData(tcc.atualizadoEm)}`);
    add(`  Resultado: ${tcc.resultado ?? '—'}`);
    add('');
    add('NOTAS');
    add(`  NF1 (Fase I): ${this.fmtNota(tcc.nf1)}`);
    add(`  NF2 (Fase II): ${this.fmtNota(tcc.nf2)}`);
    add(`  NF (final): ${this.fmtNota(tcc.nf)}`);
    add('');

    const bancas = [...(tcc.bancas ?? [])].sort((a: any, b: any) => (a.fase < b.fase ? -1 : 1));
    add('BANCA E AVALIAÇÕES');
    if (!bancas.length) {
      add('  Banca ainda não formada.');
    } else {
      for (const b of bancas) {
        const ehF2 = b.fase === 'FASE_2';
        const criterios = ehF2 ? CRITERIOS_FASE2 : CRITERIOS_FASE1;
        add('');
        add(`  -- ${ehF2 ? 'Fase II — Apresentação' : 'Fase I — Monografia'} --`);
        const membros: any[] = b.membros ?? [];
        if (!membros.length) add('    Sem membros.');
        for (const m of membros) {
          add(`    Avaliador: ${nomeTrat(m.avaliador)}`);
          add(`    Status: ${m.status}${m.avaliadoEm ? ` (em ${this.fmtData(m.avaliadoEm)})` : ''}`);
          for (const c of criterios) add(`      - ${c.rotulo}: ${this.fmtNota(m[colunaNota(c.chave)])}`);
          add(`      Nota total: ${this.fmtNota(m.nota)}`);
          if (m.parecer) {
            add('      Parecer:');
            for (const ln of String(m.parecer).split('\n')) add(`        ${ln}`);
          }
          add('');
        }
      }
    }
    sep();
    add(`Gerado em ${this.fmtData(new Date())}.`);
    return L.join('\n');
  }

  private fmtData(d?: Date | null): string {
    if (!d) return '—';
    const dt = new Date(d);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(dt.getDate())}/${p(dt.getMonth() + 1)}/${dt.getFullYear()}`;
  }

  private fmtNota(v?: number | null): string {
    return v == null ? '—' : Number(v).toFixed(2).replace('.', ',');
  }

  // Nome seguro para entrada de ZIP / pasta (sem separadores nem caracteres de controle).
  private sanitizarNome(nome: string): string {
    const limpo = (nome || '')
      .replace(/[\\/:*?"<>|]/g, '_')
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return limpo || 'arquivo';
  }

  // Insere um sufixo antes da extensão: "doc.pdf" + " (2)" -> "doc (2).pdf".
  private comSufixo(nome: string, sufixo: string): string {
    const i = nome.lastIndexOf('.');
    return i > 0 ? `${nome.slice(0, i)}${sufixo}${nome.slice(i)}` : `${nome}${sufixo}`;
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

  // ---------- Usuários (gestão pelo coordenador) ----------

  // Papéis que o coordenador pode gerenciar. COORDENADOR fica de fora de
  // propósito: não se lista nem se edita/exclui coordenador por esta tela.
  private readonly PAPEIS_GERENCIAVEIS = ['ALUNO', 'PROFESSOR', 'AVALIADOR'] as const;

  // Tratamento/afiliação: aceita um valor da lista OU um texto livre (o "Outros" do
  // cadastro grava o texto digitado, não o literal "Outros"). Exige não-vazio e um
  // limite seguro pro valor customizado. Espelha ModalCadastro/esquemaCadastro.
  private validarOpcaoOuLivre(valor: unknown, lista: readonly string[], campo: string, rotulo: string): string {
    const v = String(valor ?? '').trim();
    if (!v || v === 'Outros') {
      throw new BadRequestException({ mensagem: `Informe ${rotulo.toLowerCase()}.`, erros: [{ campo, mensagem: `${rotulo} obrigatório` }] });
    }
    if (!lista.includes(v) && v.length > 80) {
      throw new BadRequestException({ mensagem: `${rotulo} muito longo (máx. 80 caracteres).`, erros: [{ campo, mensagem: 'Texto muito longo' }] });
    }
    return v;
  }

  listarUsuarios(papel: string) {
    if (!this.PAPEIS_GERENCIAVEIS.includes(papel as any)) {
      throw new BadRequestException({ mensagem: 'Papel inválido para gestão de usuários.' });
    }
    return this.prisma.usuario.findMany({
      where: { papel },
      orderBy: { nomeCompleto: 'asc' },
      select: {
        id: true,
        nomeCompleto: true,
        email: true,
        papel: true,
        curso: true,
        tratamento: true,
        afiliacao: true,
        disponivelParaOrientar: true,
        _count: { select: { tccsComoOrientador: true, tccsComoCoorientador: true, bancasComoAvaliador: true } },
      },
    });
  }

  async editarUsuario(id: string, dados: any) {
    const u = await this.prisma.usuario.findUnique({ where: { id } });
    if (!u) throw new NotFoundException('Usuário não encontrado');
    if (!this.PAPEIS_GERENCIAVEIS.includes(u.papel as any)) {
      throw new ForbiddenException({ mensagem: 'Este usuário não pode ser gerenciado por aqui.' });
    }
    const nomeCompleto = (dados?.nomeCompleto ?? '').trim();
    const email = (dados?.email ?? '').trim().toLowerCase();
    if (!nomeCompleto) throw new BadRequestException({ mensagem: 'Informe o nome.' });
    if (!email) throw new BadRequestException({ mensagem: 'Informe o e-mail.' });
    const outro = await this.prisma.usuario.findUnique({ where: { email } });
    if (outro && outro.id !== id) {
      throw new BadRequestException({ mensagem: 'E-mail já está em uso.', erros: [{ campo: 'email', mensagem: 'E-mail em uso' }] });
    }

    // Campos específicos validados pelo papel REAL do usuário, não pelo que veio no corpo.
    // Não aceita string livre/inválida nem limpa campo obrigatório do papel.
    const data: Record<string, unknown> = { nomeCompleto, email };
    if (u.papel === 'ALUNO') {
      const curso = String(dados?.curso ?? '');
      if (!CURSOS.includes(curso as any)) {
        throw new BadRequestException({ mensagem: 'Curso inválido.', erros: [{ campo: 'curso', mensagem: 'Curso obrigatório e válido' }] });
      }
      data.curso = curso;
    } else if (u.papel === 'PROFESSOR') {
      if (typeof dados?.disponivelParaOrientar !== 'boolean') {
        throw new BadRequestException({ mensagem: 'Disponibilidade para orientar inválida.', erros: [{ campo: 'disponivelParaOrientar', mensagem: 'Informe verdadeiro ou falso' }] });
      }
      data.tratamento = this.validarOpcaoOuLivre(dados?.tratamento, TRATAMENTOS, 'tratamento', 'Titulação');
      data.disponivelParaOrientar = dados.disponivelParaOrientar;
    } else if (u.papel === 'AVALIADOR') {
      data.tratamento = this.validarOpcaoOuLivre(dados?.tratamento, TRATAMENTOS, 'tratamento', 'Titulação');
      data.afiliacao = this.validarOpcaoOuLivre(dados?.afiliacao, AFILIACOES, 'afiliacao', 'Afiliação');
    }

    return this.prisma.usuario.update({ where: { id }, data, select: { id: true } });
  }

  async resetarSenhaUsuario(id: string, novaSenha: string) {
    if (!novaSenha || novaSenha.length < 6) {
      throw new BadRequestException({ mensagem: 'A nova senha precisa ter ao menos 6 caracteres.' });
    }
    const u = await this.prisma.usuario.findUnique({ where: { id } });
    if (!u) throw new NotFoundException('Usuário não encontrado');
    if (!this.PAPEIS_GERENCIAVEIS.includes(u.papel as any)) {
      throw new ForbiddenException({ mensagem: 'Este usuário não pode ser gerenciado por aqui.' });
    }
    const senhaHash = await bcrypt.hash(novaSenha, 10);
    await this.prisma.usuario.update({ where: { id }, data: { senhaHash } });
    return { ok: true };
  }

  async excluirUsuario(id: string, solicitanteId: string) {
    if (id === solicitanteId) throw new BadRequestException({ mensagem: 'Você não pode excluir a si mesmo.' });
    const u = await this.prisma.usuario.findUnique({
      where: { id },
      select: {
        id: true,
        papel: true,
        _count: { select: { tccsComoAluno: true, tccsComoOrientador: true, tccsComoCoorientador: true, bancasComoAvaliador: true } },
      },
    });
    if (!u) throw new NotFoundException('Usuário não encontrado');
    if (!this.PAPEIS_GERENCIAVEIS.includes(u.papel as any)) {
      throw new ForbiddenException({ mensagem: 'Este usuário não pode ser gerenciado por aqui.' });
    }
    const c = u._count;
    if (c.tccsComoAluno + c.tccsComoOrientador + c.tccsComoCoorientador + c.bancasComoAvaliador > 0) {
      throw new BadRequestException({ mensagem: 'Não é possível excluir: o usuário tem TCCs, orientações ou bancas vinculados.' });
    }
    await this.prisma.usuario.delete({ where: { id } });
    return { ok: true };
  }

  // ---------- Lista do período (espelha a tela do original) ----------

  // Lista TODOS os alunos e cruza com o TCC do período ativo, classificando o
  // envio inicial pelo fluxo de Solicitação (não por documento, como era no antigo).
  async listaDoPeriodo() {
    const semestre = await resolverSemestreAtivo(this.prisma);
    const calendario = await this.prisma.calendario.findUnique({ where: { semestre } });

    const alunos = await this.prisma.usuario.findMany({
      where: { papel: 'ALUNO' },
      orderBy: { nomeCompleto: 'asc' },
      select: {
        id: true,
        nomeCompleto: true,
        email: true,
        curso: true,
        tccsComoAluno: {
          where: { semestre },
          select: {
            criadoEm: true,
            faseAtual: true,
            solicitacoes: { select: { status: true, criadoEm: true }, orderBy: { criadoEm: 'desc' } },
          },
        },
      },
    });

    const lista = alunos.map((a) => {
      const tcc = a.tccsComoAluno[0];
      let status = 'Não enviado';
      let dataEnvio: Date | null = null;
      if (tcc) {
        const sols = tcc.solicitacoes;
        // Aprovado: TCC já saiu de INICIALIZACAO ou tem solicitação ACEITA.
        // Pendente: tem solicitação PENDENTE. Senão (recusada/cancelada/sem) = não enviado.
        if (tcc.faseAtual !== 'INICIALIZACAO' || sols.some((s) => s.status === 'ACEITA')) {
          status = 'Aprovado';
        } else if (sols.some((s) => s.status === 'PENDENTE')) {
          status = 'Aprovação pendente';
        }
        // Data de envio: solicitação mais recente, ou a criação do TCC no semestre.
        dataEnvio = sols[0]?.criadoEm ?? tcc.criadoEm ?? null;
      }
      return { alunoId: a.id, alunoNome: a.nomeCompleto, email: a.email, curso: a.curso, dataEnvio, status };
    });

    return { semestre, prazoEnvio: calendario?.envioDocumentos ?? null, alunos: lista };
  }

  // Reseta o período: apaga os TCCs do período ativo (cascade) e seus arquivos.
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

    const semestre = await resolverSemestreAtivo(this.prisma);
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
