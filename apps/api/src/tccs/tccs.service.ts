import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { promises as fs } from 'fs';
import { extname, join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { corrigirNomeArquivo } from '../comum/nome-arquivo';
import type { DadosAbrirTcc } from '@tcc/compartilhado';

function semestreAtual(): string {
  const d = new Date();
  const s = d.getMonth() + 1 <= 6 ? 1 : 2;
  return `${d.getFullYear()}.${s}`;
}

// Prazo encerrado: existe a data e ela já passou (compara só a data; o próprio
// dia do prazo ainda é permitido). Sem data, não há prazo a encerrar.
function prazoEncerrado(prazo?: Date | null): boolean {
  if (!prazo) return false;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const dia = new Date(prazo.getUTCFullYear(), prazo.getUTCMonth(), prazo.getUTCDate());
  return hoje > dia;
}

@Injectable()
export class TccsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  // ---------- Notificações por e-mail (helpers; nunca quebram o fluxo) ----------

  private async notificar(evento: string, usuarioId: string | null | undefined, assunto: string, texto: string) {
    if (!usuarioId) return;
    const p = await this.prisma.usuario.findUnique({ where: { id: usuarioId }, select: { id: true, email: true, nomeCompleto: true } });
    if (p) await this.email.enviarEvento(evento, p, assunto, texto);
  }

  private async notificarCoordenadores(evento: string, assunto: string, texto: string) {
    const coords = await this.prisma.usuario.findMany({ where: { papel: 'COORDENADOR' }, select: { id: true, email: true, nomeCompleto: true } });
    for (const c of coords) await this.email.enviarEvento(evento, c, assunto, texto);
  }

  professoresDisponiveis() {
    return this.prisma.usuario.findMany({
      where: { papel: 'PROFESSOR', disponivelParaOrientar: true },
      select: { id: true, nomeCompleto: true, tratamento: true },
      orderBy: { nomeCompleto: 'asc' },
    });
  }

  coorientadores() {
    return this.prisma.usuario.findMany({
      where: { papel: { in: ['PROFESSOR', 'AVALIADOR', 'COORDENADOR'] } },
      select: { id: true, nomeCompleto: true, tratamento: true, papel: true },
      orderBy: { nomeCompleto: 'asc' },
    });
  }

  async abrir(alunoId: string, dados: DadosAbrirTcc) {
    const semestre = semestreAtual();

    const jaTem = await this.prisma.tcc.findUnique({
      where: { alunoId_semestre: { alunoId, semestre } },
    });
    if (jaTem) throw new BadRequestException({ mensagem: 'Você já tem um TCC neste semestre.' });

    // Prazo de envio de documentos (calendário da coordenação): se já encerrou, bloqueia
    // a abertura — espelha o bloqueio do projeto antigo. Sem data definida, não bloqueia.
    const calendario = await this.prisma.calendario.findUnique({ where: { semestre } });
    if (prazoEncerrado(calendario?.envioDocumentos)) {
      throw new BadRequestException({
        mensagem: 'O prazo de envio de documentos já encerrou. Procure a coordenação.',
      });
    }

    const orientador = await this.prisma.usuario.findUnique({ where: { id: dados.orientadorId } });
    if (!orientador || orientador.papel !== 'PROFESSOR') {
      throw new BadRequestException({ mensagem: 'Orientador inválido.' });
    }
    if (dados.coorientadorId) {
      if (dados.coorientadorId === dados.orientadorId) {
        throw new BadRequestException({ mensagem: 'O coorientador deve ser diferente do orientador.' });
      }
      const co = await this.prisma.usuario.findUnique({ where: { id: dados.coorientadorId } });
      // Coorientador precisa ser um docente/avaliador — não pode ser um aluno.
      if (!co || !['PROFESSOR', 'AVALIADOR', 'COORDENADOR'].includes(co.papel)) {
        throw new BadRequestException({ mensagem: 'Coorientador inválido.' });
      }
    }

    const tcc = await this.prisma.tcc.create({
      data: {
        titulo: dados.titulo,
        semestre,
        faseAtual: 'INICIALIZACAO',
        alunoId,
        orientadorId: dados.orientadorId,
        coorientadorId: dados.coorientadorId || null,
        coorientadorNome: dados.coorientadorNome || null,
        coorientadorTitulacao: dados.coorientadorTitulacao || null,
        coorientadorAfiliacao: dados.coorientadorAfiliacao || null,
        coorientadorLattes: dados.coorientadorLattes || null,
        solicitacoes: { create: { mensagem: dados.mensagem || null, status: 'PENDENTE' } },
      },
      include: { solicitacoes: true },
    });

    await this.notificar('aluno_solicitacao_enviada', alunoId, 'Solicitação de TCC enviada', `Sua solicitação de abertura do TCC "${tcc.titulo}" foi enviada e está em análise pela coordenação.`);
    await this.notificarCoordenadores('coord_nova_solicitacao', 'Nova solicitação de TCC', `Há uma nova solicitação de abertura aguardando análise: "${tcc.titulo}".`);
    await this.notificar('coorientador_indicado', tcc.coorientadorId, 'Você foi indicado como coorientador', `Você foi indicado como coorientador do TCC "${tcc.titulo}".`);
    return tcc;
  }

  meu(alunoId: string) {
    return this.prisma.tcc.findFirst({
      where: { alunoId },
      orderBy: { criadoEm: 'desc' },
      include: {
        orientador: { select: { id: true, nomeCompleto: true, tratamento: true } },
        coorientador: { select: { id: true, nomeCompleto: true } },
        solicitacoes: { orderBy: { criadoEm: 'desc' } },
        documentos: true,
      },
    });
  }

  async cancelar(alunoId: string, tccId: string) {
    const tcc = await this.prisma.tcc.findUnique({ where: { id: tccId } });
    if (!tcc) throw new NotFoundException();
    if (tcc.alunoId !== alunoId) throw new ForbiddenException();
    if (tcc.faseAtual !== 'INICIALIZACAO') {
      throw new BadRequestException({ mensagem: 'Só é possível cancelar enquanto aguarda aprovação.' });
    }
    await this.prisma.tcc.delete({ where: { id: tccId } });
    return { ok: true };
  }

  // TCCs do período atual (visão do coordenador), com dados pra gerir banca/fase
  // e abrir o detalhe (aluno, orientador, coorientador, documentos, banca + notas).
  todos() {
    return this.prisma.tcc.findMany({
      where: { semestre: semestreAtual() },
      include: {
        aluno: { select: { id: true, nomeCompleto: true, email: true, curso: true } },
        orientador: { select: { id: true, nomeCompleto: true, tratamento: true } },
        coorientador: { select: { id: true, nomeCompleto: true, tratamento: true } },
        bancas: { include: { membros: { include: { avaliador: { select: { nomeCompleto: true, tratamento: true } } } } } },
        documentos: { orderBy: { criadoEm: 'desc' } },
      },
      orderBy: { criadoEm: 'desc' },
    });
  }

  pendentes() {
    return this.prisma.tcc.findMany({
      where: { faseAtual: 'INICIALIZACAO', solicitacoes: { some: { status: 'PENDENTE' } } },
      include: {
        aluno: { select: { id: true, nomeCompleto: true, email: true, curso: true } },
        orientador: { select: { id: true, nomeCompleto: true } },
        solicitacoes: { orderBy: { criadoEm: 'desc' }, take: 1 },
        documentos: true,
      },
      orderBy: { criadoEm: 'asc' },
    });
  }

  async aprovar(tccId: string) {
    const tcc = await this.prisma.tcc.findUnique({
      where: { id: tccId },
      include: { solicitacoes: { where: { status: 'PENDENTE' } }, documentos: true },
    });
    if (!tcc) throw new NotFoundException();
    if (tcc.faseAtual !== 'INICIALIZACAO' || tcc.solicitacoes.length === 0) {
      throw new BadRequestException({ mensagem: 'Este TCC não está aguardando aprovação de abertura.' });
    }
    // Não aprova sem os dois documentos obrigatórios da abertura.
    const tipos = new Set(tcc.documentos.map((d) => d.tipo));
    if (!tipos.has('PLANO_DESENVOLVIMENTO') || !tipos.has('TERMO_ACEITE')) {
      throw new BadRequestException({ mensagem: 'A solicitação não tem o Plano de Desenvolvimento e o Termo de Aceite.' });
    }
    await this.prisma.$transaction([
      this.prisma.solicitacaoOrientacao.updateMany({
        where: { tccId, status: 'PENDENTE' },
        data: { status: 'ACEITA', respondidoEm: new Date() },
      }),
      this.prisma.tcc.update({ where: { id: tccId }, data: { faseAtual: 'DESENVOLVIMENTO' } }),
    ]);
    await this.notificar('aluno_solicitacao_aprovada', tcc.alunoId, 'Solicitação de TCC aprovada', `Sua solicitação do TCC "${tcc.titulo}" foi aprovada. O TCC entrou na fase de desenvolvimento.`);
    await this.notificar('orientador_definido', tcc.orientadorId, 'Você é orientador de um novo TCC', `Você foi confirmado como orientador do TCC "${tcc.titulo}".`);
    await this.notificar('orientador_confirmar_continuidade', tcc.orientadorId, 'Confirmar continuidade do TCC', `Quando puder, confirme a continuidade do TCC "${tcc.titulo}" na sua área de orientandos.`);
    await this.notificar('coorientador_mudanca_fase', tcc.coorientadorId, 'TCC em desenvolvimento', `O TCC "${tcc.titulo}" (no qual você é coorientador) entrou na fase de desenvolvimento.`);
    return { ok: true };
  }

  async recusar(tccId: string, parecer: string) {
    const tcc = await this.prisma.tcc.findUnique({
      where: { id: tccId },
      include: { solicitacoes: { where: { status: 'PENDENTE' } } },
    });
    if (!tcc) throw new NotFoundException();
    if (tcc.faseAtual !== 'INICIALIZACAO' || tcc.solicitacoes.length === 0) {
      throw new BadRequestException({ mensagem: 'Este TCC não está aguardando aprovação de abertura.' });
    }
    await this.prisma.solicitacaoOrientacao.updateMany({
      where: { tccId, status: 'PENDENTE' },
      data: { status: 'RECUSADA', parecer, respondidoEm: new Date() },
    });
    await this.notificar('aluno_solicitacao_recusada', tcc.alunoId, 'Solicitação de TCC recusada', `Sua solicitação do TCC "${tcc.titulo}" foi recusada.${parecer ? ' Parecer: ' + parecer : ''} Você pode corrigir os documentos e reenviar.`);
    return { ok: true };
  }

  // Só devolve o documento se o usuário tiver acesso a ele (coordenador, ou o aluno dono,
  // ou o orientador/coorientador do TCC). Senão devolve null (tratado como 404, sem vazar existência).
  async documentoParaUsuario(docId: string, usuario: { sub: string; papel: string }) {
    const doc = await this.prisma.documentoTcc.findUnique({
      where: { id: docId },
      include: {
        tcc: {
          select: {
            alunoId: true,
            orientadorId: true,
            coorientadorId: true,
            bancas: { select: { membros: { select: { avaliadorId: true } } } },
          },
        },
      },
    });
    if (!doc) return null;
    if (usuario.papel === 'COORDENADOR') return doc;
    const t = doc.tcc;
    const ehDono =
      t.alunoId === usuario.sub ||
      t.orientadorId === usuario.sub ||
      t.coorientadorId === usuario.sub;
    // Membro de banca só acessa a monografia/versão final (não os documentos de abertura).
    const ehMembroBanca = t.bancas.some((b) => b.membros.some((m) => m.avaliadorId === usuario.sub));
    const acessoBanca = ehMembroBanca && ['MONOGRAFIA', 'VERSAO_FINAL'].includes(doc.tipo);
    return ehDono || acessoBanca ? doc : null;
  }

  // ---------- Fase de Desenvolvimento (monografia + continuidade) ----------

  // Grava um arquivo no disco e devolve {nomeArquivo, caminho, tamanho}. Storage local (dev).
  private async gravarArquivo(arquivo: any) {
    const dir = join(process.cwd(), 'uploads');
    await fs.mkdir(dir, { recursive: true });
    // Nome interno seguro (sem usar o nome enviado → evita path traversal); original vira só metadado.
    const ext = extname(arquivo.originalname || '').replace(/[^.a-zA-Z0-9]/g, '').slice(0, 10);
    const nome = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    await fs.writeFile(join(dir, nome), arquivo.buffer);
    // Corrige acentos do nome enviado (latin1->UTF-8), de forma segura/condicional.
    const nomeArquivo = corrigirNomeArquivo(arquivo.originalname);
    return { nomeArquivo, caminho: join('uploads', nome), tamanho: arquivo.size };
  }

  // Aluno envia (ou reenvia) a monografia. Substitui versões pendentes antigas e cria a nova
  // (PENDENTE) numa transação; se algo falhar, remove o arquivo recém-gravado (sem órfão).
  async enviarMonografia(alunoId: string, tccId: string, arquivo: any) {
    const tcc = await this.prisma.tcc.findUnique({ where: { id: tccId } });
    if (!tcc) throw new NotFoundException();
    if (tcc.alunoId !== alunoId) throw new ForbiddenException();
    if (tcc.faseAtual !== 'DESENVOLVIMENTO') {
      throw new BadRequestException({ mensagem: 'O TCC não está na fase de desenvolvimento.' });
    }
    if (tcc.monografiaAprovada) {
      throw new BadRequestException({ mensagem: 'Sua monografia já foi aprovada pelo orientador.' });
    }
    const arq = await this.gravarArquivo(arquivo);
    try {
      const doc = await this.prisma.$transaction(async (tx) => {
        // Versões pendentes anteriores deixam de valer (evita várias PENDENTE soltas).
        await tx.documentoTcc.updateMany({
          where: { tccId, tipo: 'MONOGRAFIA', status: 'PENDENTE' },
          data: { status: 'SUBSTITUIDA' },
        });
        const versoes = await tx.documentoTcc.count({ where: { tccId, tipo: 'MONOGRAFIA' } });
        return tx.documentoTcc.create({
          data: { tccId, tipo: 'MONOGRAFIA', status: 'PENDENTE', versao: versoes + 1, ...arq },
        });
      });
      await this.notificar('orientador_monografia_enviada', tcc.orientadorId, 'Monografia enviada para avaliação', `O aluno enviou/reenviou a monografia do TCC "${tcc.titulo}" para sua avaliação.`);
      return doc;
    } catch (e) {
      await fs.rm(join(process.cwd(), arq.caminho), { force: true }).catch(() => {});
      throw e;
    }
  }

  // Lista os TCCs em que o usuário é orientador (com aluno, documentos e flags das trilhas).
  orientandos(professorId: string) {
    return this.prisma.tcc.findMany({
      where: { orientadorId: professorId },
      include: {
        aluno: { select: { id: true, nomeCompleto: true, email: true, curso: true } },
        documentos: { orderBy: { criadoEm: 'desc' } },
      },
      orderBy: { criadoEm: 'desc' },
    });
  }

  // Lista os TCCs em que o usuário é coorientador (visão de leitura: aluno, orientador e docs).
  coorientacoes(usuarioId: string) {
    return this.prisma.tcc.findMany({
      where: { coorientadorId: usuarioId },
      include: {
        aluno: { select: { id: true, nomeCompleto: true, email: true, curso: true } },
        orientador: { select: { id: true, nomeCompleto: true, tratamento: true } },
        documentos: { orderBy: { criadoEm: 'desc' } },
      },
      orderBy: { criadoEm: 'desc' },
    });
  }

  private async exigirOrientadorEmDesenvolvimento(profId: string, tccId: string) {
    const tcc = await this.prisma.tcc.findUnique({ where: { id: tccId } });
    if (!tcc) throw new NotFoundException();
    if (tcc.orientadorId !== profId) throw new ForbiddenException();
    if (tcc.faseAtual !== 'DESENVOLVIMENTO') {
      throw new BadRequestException({ mensagem: 'O TCC não está na fase de desenvolvimento.' });
    }
    return tcc;
  }

  // Orientador aprova ou rejeita a monografia enviada (Trilha A).
  async avaliarMonografia(profId: string, tccId: string, decisao: 'APROVAR' | 'REJEITAR', parecer?: string) {
    const tcc = await this.exigirOrientadorEmDesenvolvimento(profId, tccId);
    const mono = await this.prisma.documentoTcc.findFirst({
      where: { tccId, tipo: 'MONOGRAFIA' },
      orderBy: { versao: 'desc' },
    });
    if (!mono || mono.status !== 'PENDENTE') {
      throw new BadRequestException({ mensagem: 'Não há monografia aguardando avaliação.' });
    }
    if (decisao === 'APROVAR') {
      // Se a continuidade já estava confirmada, a junção "E" leva direto pra banca (Fase I).
      const vaiPraBanca = tcc.continuidadeConfirmada;
      await this.prisma.$transaction([
        this.prisma.documentoTcc.update({ where: { id: mono.id }, data: { status: 'APROVADO', parecer: null } }),
        this.prisma.tcc.update({
          where: { id: tccId },
          data: { monografiaAprovada: true, ...(vaiPraBanca ? { faseAtual: 'FORMACAO_BANCA_FASE_1' } : {}) },
        }),
      ]);
      await this.notificar('aluno_monografia_aprovada', tcc.alunoId, 'Monografia aprovada', `Sua monografia do TCC "${tcc.titulo}" foi aprovada pelo orientador.`);
      if (vaiPraBanca) {
        await this.notificarCoordenadores('coord_formar_banca_fase1', 'Formar banca da Fase I', `O TCC "${tcc.titulo}" teve monografia aprovada e continuidade confirmada — é preciso formar a banca da Fase I.`);
        await this.notificar('coorientador_mudanca_fase', tcc.coorientadorId, 'TCC avançou para a Fase I', `O TCC "${tcc.titulo}" (no qual você é coorientador) avançou para a Fase I.`);
      }
    } else {
      await this.prisma.documentoTcc.update({ where: { id: mono.id }, data: { status: 'REJEITADO', parecer: parecer ?? null } });
      await this.notificar('aluno_monografia_rejeitada', tcc.alunoId, 'Monografia precisa de ajustes', `O orientador pediu ajustes na sua monografia do TCC "${tcc.titulo}".${parecer ? ' Devolutiva: ' + parecer : ''}`);
    }
    return { ok: true };
  }

  // Orientador confirma ou rejeita a continuidade (Trilha B). Rejeição → Descontinuado.
  async avaliarContinuidade(profId: string, tccId: string, decisao: 'CONFIRMAR' | 'REJEITAR', parecer?: string) {
    const tcc = await this.exigirOrientadorEmDesenvolvimento(profId, tccId);
    if (decisao === 'CONFIRMAR') {
      if (tcc.continuidadeConfirmada) {
        throw new BadRequestException({ mensagem: 'A continuidade já foi confirmada.' });
      }
      // Junção "E": se a monografia já estava aprovada, vai direto pra banca (Fase I). Update único.
      const vaiPraBanca = tcc.monografiaAprovada;
      await this.prisma.tcc.update({
        where: { id: tccId },
        data: { continuidadeConfirmada: true, ...(vaiPraBanca ? { faseAtual: 'FORMACAO_BANCA_FASE_1' } : {}) },
      });
      if (vaiPraBanca) {
        await this.notificarCoordenadores('coord_formar_banca_fase1', 'Formar banca da Fase I', `O TCC "${tcc.titulo}" teve monografia aprovada e continuidade confirmada — é preciso formar a banca da Fase I.`);
        await this.notificar('coorientador_mudanca_fase', tcc.coorientadorId, 'TCC avançou para a Fase I', `O TCC "${tcc.titulo}" (no qual você é coorientador) avançou para a Fase I.`);
      }
    } else {
      await this.prisma.tcc.update({
        where: { id: tccId },
        data: { faseAtual: 'DESCONTINUADO', parecerContinuidade: parecer ?? null },
      });
      await this.notificar('aluno_continuidade_rejeitada', tcc.alunoId, 'TCC descontinuado', `O orientador não confirmou a continuidade do TCC "${tcc.titulo}".${parecer ? ' Motivo: ' + parecer : ''}`);
    }
    return { ok: true };
  }

  // ---------- Conclusão (versão final + validação do orientador) ----------

  // Aluno envia a versão final corrigida (após aprovado na defesa). → VALIDACAO_VERSAO_FINAL.
  async enviarVersaoFinal(alunoId: string, tccId: string, arquivo: any) {
    const tcc = await this.prisma.tcc.findUnique({ where: { id: tccId } });
    if (!tcc) throw new NotFoundException();
    if (tcc.alunoId !== alunoId) throw new ForbiddenException();
    if (tcc.faseAtual !== 'AGUARDANDO_AJUSTES_FINAIS') {
      throw new BadRequestException({ mensagem: 'O TCC não está aguardando a versão final.' });
    }
    const reenvio = (await this.prisma.documentoTcc.count({ where: { tccId, tipo: 'VERSAO_FINAL' } })) > 0;
    const arq = await this.gravarArquivo(arquivo);
    try {
      const doc = await this.prisma.$transaction(async (tx) => {
        await tx.documentoTcc.updateMany({
          where: { tccId, tipo: 'VERSAO_FINAL', status: 'PENDENTE' },
          data: { status: 'SUBSTITUIDA' },
        });
        const versoes = await tx.documentoTcc.count({ where: { tccId, tipo: 'VERSAO_FINAL' } });
        const novo = await tx.documentoTcc.create({
          data: { tccId, tipo: 'VERSAO_FINAL', status: 'PENDENTE', versao: versoes + 1, ...arq },
        });
        await tx.tcc.update({ where: { id: tccId }, data: { faseAtual: 'VALIDACAO_VERSAO_FINAL' } });
        return novo;
      });
      const evento = reenvio ? 'orientador_versao_final_reenviada' : 'orientador_versao_final_enviada';
      await this.notificar(evento, tcc.orientadorId, 'Versão final enviada', `O aluno ${reenvio ? 'reenviou' : 'enviou'} a versão final do TCC "${tcc.titulo}" para sua validação.`);
      return doc;
    } catch (e) {
      await fs.rm(join(process.cwd(), arq.caminho), { force: true }).catch(() => {});
      throw e;
    }
  }

  // Orientador valida a versão final: conclui (→ CONCLUIDO/APROVADO) ou pede ajustes (volta).
  async validarVersaoFinal(profId: string, tccId: string, decisao: 'CONCLUIR' | 'AJUSTES', parecer?: string) {
    const tcc = await this.prisma.tcc.findUnique({ where: { id: tccId } });
    if (!tcc) throw new NotFoundException();
    if (tcc.orientadorId !== profId) throw new ForbiddenException();
    if (tcc.faseAtual !== 'VALIDACAO_VERSAO_FINAL') {
      throw new BadRequestException({ mensagem: 'O TCC não está aguardando validação da versão final.' });
    }
    const versao = await this.prisma.documentoTcc.findFirst({
      where: { tccId, tipo: 'VERSAO_FINAL' },
      orderBy: { versao: 'desc' },
    });
    if (decisao === 'CONCLUIR') {
      await this.prisma.$transaction([
        ...(versao
          ? [this.prisma.documentoTcc.update({ where: { id: versao.id }, data: { status: 'APROVADO', parecer: null } })]
          : []),
        this.prisma.tcc.update({ where: { id: tccId }, data: { faseAtual: 'CONCLUIDO', resultado: 'APROVADO' } }),
      ]);
      await this.notificar('aluno_tcc_concluido', tcc.alunoId, 'TCC concluído 🎉', `Parabéns! Seu TCC "${tcc.titulo}" foi aprovado e concluído.`);
      await this.notificar('orientador_tcc_concluido', tcc.orientadorId, 'TCC concluído', `O TCC "${tcc.titulo}" que você orientou foi concluído (aprovado).`);
      await this.notificar('coorientador_mudanca_fase', tcc.coorientadorId, 'TCC concluído', `O TCC "${tcc.titulo}" (no qual você é coorientador) foi concluído.`);
    } else {
      await this.prisma.$transaction([
        ...(versao
          ? [this.prisma.documentoTcc.update({ where: { id: versao.id }, data: { status: 'REJEITADO', parecer: parecer ?? null } })]
          : []),
        this.prisma.tcc.update({ where: { id: tccId }, data: { faseAtual: 'AGUARDANDO_AJUSTES_FINAIS' } }),
      ]);
      await this.notificar('aluno_versao_final_rejeitada', tcc.alunoId, 'Versão final precisa de ajustes', `O orientador pediu ajustes na versão final do TCC "${tcc.titulo}".${parecer ? ' Devolutiva: ' + parecer : ''}`);
    }
    return { ok: true };
  }

  // Documentos da ABERTURA (plano + termo). Só na fase de solicitação e só esses dois tipos.
  async adicionarDocumento(alunoId: string, tccId: string, tipo: string, arquivo: any) {
    const tcc = await this.prisma.tcc.findUnique({ where: { id: tccId } });
    if (!tcc) throw new NotFoundException();
    if (tcc.alunoId !== alunoId) throw new ForbiddenException();
    if (!['PLANO_DESENVOLVIMENTO', 'TERMO_ACEITE'].includes(tipo)) {
      throw new BadRequestException({ mensagem: 'Tipo de documento inválido.' });
    }
    if (tcc.faseAtual !== 'INICIALIZACAO') {
      throw new BadRequestException({ mensagem: 'Os documentos de abertura só podem ser enviados na solicitação.' });
    }
    const arq = await this.gravarArquivo(arquivo);
    try {
      return await this.prisma.documentoTcc.create({
        data: { tccId, tipo, status: 'PENDENTE', ...arq },
      });
    } catch (e) {
      await fs.rm(join(process.cwd(), arq.caminho), { force: true }).catch(() => {});
      throw e;
    }
  }
}
