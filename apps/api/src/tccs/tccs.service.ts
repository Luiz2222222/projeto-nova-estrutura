import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { promises as fs } from 'fs';
import { extname, join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { EventosTccService } from '../eventos-tcc/eventos-tcc.service';
import { PrazosService } from '../prazos/prazos.service';
import { corrigirNomeArquivo } from '../comum/nome-arquivo';
import { sanitizarNotasTcc, ocultarRascunho, FASES_NOTAS_LIBERADAS } from '../comum/sanitizar-notas';
import { resolverSemestreAtivo, FORMATO_SEMESTRE } from '../comum/semestre';
import { buscarTccAtivoOuFalhar } from '../comum/tcc-ativo';
import { conteudoCompativel } from '../comum/assinatura-arquivo';
import { FASES, ROTULO_FASE, arquivoPermitidoParaTipo, formatoDoTipoDoc, PESO_NF1, PESO_NF2, aprovadoFase1, aprovadoFinal, CRITERIOS_FASE1, CRITERIOS_FASE2, colunaNota } from '@tcc/compartilhado';
import type { DadosAbrirTcc, DadosEditarTcc, DadosEditarDocumento } from '@tcc/compartilhado';

@Injectable()
export class TccsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventos: EventosTccService,
    private readonly prazos: PrazosService,
  ) {}

  professoresDisponiveis() {
    return this.prisma.usuario.findMany({
      where: { papel: 'PROFESSOR', disponivelParaOrientar: true },
      select: { id: true, nomeCompleto: true, tratamento: true, afiliacao: true },
      orderBy: { nomeCompleto: 'asc' },
    });
  }

  // Professor indisponível sai da lista de NOVAS coorientações; avaliador externo e
  // coordenador seguem elegíveis (a regra de disponibilidade é do professor interno).
  coorientadores() {
    return this.prisma.usuario.findMany({
      where: {
        OR: [
          { papel: { in: ['AVALIADOR', 'COORDENADOR'] } },
          { papel: 'PROFESSOR', disponivelParaOrientar: true },
        ],
      },
      select: { id: true, nomeCompleto: true, tratamento: true, afiliacao: true, papel: true },
      orderBy: { nomeCompleto: 'asc' },
    });
  }

  // Edição administrativa dos DADOS GERAIS do TCC pelo coordenador (atualização parcial).
  // Valida papéis dos usuários e a unique (alunoId, semestre). Fase, NF1/NF2/NF e resultado
  // NÃO passam por aqui: são derivados do fluxo e só mudam pela correção administrativa de
  // fluxo (corrigirFase), que limpa os dados dependentes de forma coerente.
  async editarTcc(tccId: string, dados: DadosEditarTcc) {
    const tcc = await buscarTccAtivoOuFalhar(this.prisma, tccId);

    const data: Record<string, unknown> = {};
    if (dados.titulo !== undefined) data.titulo = dados.titulo;
    if (dados.semestre !== undefined && dados.semestre !== tcc.semestre) {
      // Semestre não é texto livre: precisa do formato AAAA.S e de um Calendário já
      // configurado (prazos e pesos vêm dele — sem calendário o TCC ficaria sem régua).
      if (!FORMATO_SEMESTRE.test(dados.semestre)) {
        throw new BadRequestException({ mensagem: 'Semestre inválido — use o formato AAAA.1 ou AAAA.2 (ex.: 2026.1).' });
      }
      const cal = await this.prisma.calendario.findUnique({ where: { semestre: dados.semestre } });
      if (!cal) {
        throw new BadRequestException({
          mensagem: `O semestre ${dados.semestre} ainda não tem Calendário configurado no Planejamento — configure-o antes de mover o TCC.`,
        });
      }
      // Notas apuradas e avaliações de banca foram dadas com a régua (pesos por critério e
      // por fase) do calendário do período ATUAL do TCC. Mover para outro período com essas
      // notas gravadas deixaria números e régua divergentes — bloqueia; o caminho é reabrir
      // a fase pela Correção de fluxo (que invalida as avaliações às claras) e então trocar.
      const temNotaApurada = tcc.nf1 != null || tcc.nf2 != null || tcc.nf != null;
      const avaliacaoRegistrada = temNotaApurada
        ? true
        : !!(await this.prisma.membroBanca.findFirst({ where: { banca: { tccId }, nota: { not: null } }, select: { id: true } }));
      if (avaliacaoRegistrada) {
        throw new BadRequestException({
          mensagem: 'Este TCC já tem avaliações/notas registradas com os pesos do período atual — trocar o semestre mudaria a régua das notas. ' +
            'Se a troca for mesmo necessária, reabra a fase pela Correção de fluxo (as avaliações são invalidadas explicitamente) e depois troque.',
        });
      }
      data.semestre = dados.semestre;
    }
    // As trilhas do desenvolvimento (monografia aprovada / continuidade) só podem MUDAR com
    // o TCC em DESENVOLVIMENTO — é quando elas decidem a junção que forma a banca. Fora daí
    // (ex.: desmarcar continuidade com o TCC na Fase II) criariam fase e flags contraditórias;
    // o caminho é a Correção de fluxo (voltar para o desenvolvimento) primeiro. Reenviar o
    // valor atual segue permitido (o formulário sempre manda os dois campos).
    const mudouMonografia = dados.monografiaAprovada !== undefined && dados.monografiaAprovada !== tcc.monografiaAprovada;
    const mudouContinuidade = dados.continuidadeConfirmada !== undefined && dados.continuidadeConfirmada !== tcc.continuidadeConfirmada;
    if ((mudouMonografia || mudouContinuidade) && tcc.faseAtual !== 'DESENVOLVIMENTO') {
      throw new BadRequestException({
        mensagem: 'Monografia aprovada e continuidade só mudam com o TCC em desenvolvimento — use a Correção de fluxo para voltar a fase antes.',
      });
    }
    if (mudouMonografia) data.monografiaAprovada = dados.monografiaAprovada;
    if (mudouContinuidade) data.continuidadeConfirmada = dados.continuidadeConfirmada;
    if (dados.parecerContinuidade !== undefined) data.parecerContinuidade = dados.parecerContinuidade || null;

    if (dados.alunoId !== undefined) {
      const aluno = await this.prisma.usuario.findUnique({ where: { id: dados.alunoId } });
      if (!aluno || aluno.papel !== 'ALUNO') {
        throw new BadRequestException({ mensagem: 'Aluno inválido (precisa ser um usuário do tipo aluno).' });
      }
      data.alunoId = dados.alunoId;
    }
    if (dados.orientadorId !== undefined) {
      if (!dados.orientadorId) {
        // Sem orientador o fluxo trava: é ele quem aprova monografia/continuidade, libera a
        // defesa e compõe a banca da Fase II. Todo TCC ativo precisa ter um orientador.
        throw new BadRequestException({ mensagem: 'O TCC precisa ter um orientador — escolha outro em vez de remover.' });
      }
      const o = await this.prisma.usuario.findUnique({ where: { id: dados.orientadorId } });
      if (!o || !['PROFESSOR', 'COORDENADOR'].includes(o.papel)) {
        throw new BadRequestException({ mensagem: 'Orientador inválido (precisa ser professor ou coordenador).' });
      }
      data.orientadorId = dados.orientadorId;
    }
    if (dados.coorientadorId !== undefined) {
      if (!dados.coorientadorId) data.coorientadorId = null;
      else {
        const co = await this.prisma.usuario.findUnique({ where: { id: dados.coorientadorId } });
        if (!co || !['PROFESSOR', 'AVALIADOR', 'COORDENADOR'].includes(co.papel)) {
          throw new BadRequestException({ mensagem: 'Coorientador inválido.' });
        }
        data.coorientadorId = dados.coorientadorId;
      }
    }
    for (const k of ['coorientadorNome', 'coorientadorTitulacao', 'coorientadorAfiliacao', 'coorientadorLattes'] as const) {
      if (dados[k] !== undefined) data[k] = dados[k] || null;
    }

    // Coorientador interno e externo são MUTUAMENTE EXCLUSIVOS. Quem está sendo definido
    // agora vence e o outro lado é LIMPO NO BANCO (não só ignorado): assim, remover o
    // interno depois não ressuscita dados antigos de um externo (e vice-versa).
    const CAMPOS_EXTERNO = ['coorientadorNome', 'coorientadorTitulacao', 'coorientadorAfiliacao', 'coorientadorLattes'] as const;
    const definiuInterno = data.coorientadorId != null;
    const definiuExterno = CAMPOS_EXTERNO.some((k) => data[k] != null);
    if (definiuInterno && definiuExterno) {
      throw new BadRequestException({ mensagem: 'Escolha um coorientador interno OU informe um externo — não os dois.' });
    }
    if (definiuInterno) {
      for (const k of CAMPOS_EXTERNO) data[k] = null;
    }
    if (definiuExterno) {
      data.coorientadorId = null;
    }
    // Removeu o interno sem definir externo → não deixa restos de um externo antigo no banco.
    if (dados.coorientadorId === null && !definiuExterno) {
      for (const k of CAMPOS_EXTERNO) data[k] = null;
    }

    // Orientador e coorientador interno não podem ser a mesma pessoa.
    const novoOrient = data.orientadorId !== undefined ? (data.orientadorId as string | null) : tcc.orientadorId;
    const novoCoor = data.coorientadorId !== undefined ? (data.coorientadorId as string | null) : tcc.coorientadorId;
    if (novoOrient && novoCoor && novoOrient === novoCoor) {
      throw new BadRequestException({ mensagem: 'O coorientador deve ser diferente do orientador.' });
    }

    // Respeita a unique (alunoId, semestre).
    const novoAluno = (data.alunoId as string) ?? tcc.alunoId;
    const novoSem = (data.semestre as string) ?? tcc.semestre;
    if (novoAluno !== tcc.alunoId || novoSem !== tcc.semestre) {
      const conflito = await this.prisma.tcc.findFirst({
        where: { alunoId: novoAluno, semestre: novoSem, NOT: { id: tccId } },
      });
      if (conflito) throw new BadRequestException({ mensagem: 'Já existe um TCC para este aluno neste semestre.' });
    }

    // ----- Coerência com as bancas (mesma transação da gravação) -----
    return this.prisma.$transaction(async (tx) => {
      const bancas = await tx.banca.findMany({ where: { tccId }, include: { membros: true } });
      const trocouOrientador = data.orientadorId !== undefined && data.orientadorId !== tcc.orientadorId;

      // Ninguém pode ser juiz e parte: o novo orientador/coorientador não pode já ser
      // avaliador em banca deste TCC (a vaga do orientador na Fase II é criada pela
      // sincronização abaixo — o orientador ATUAL, membro legítimo da F2, não conta).
      const ehAvaliadorDoTcc = (userId: string | null) =>
        !!userId && bancas.some((b) => b.membros.some((m) => m.avaliadorId === userId && m.avaliadorId !== tcc.orientadorId));
      if (trocouOrientador && ehAvaliadorDoTcc(novoOrient)) {
        throw new BadRequestException({ mensagem: 'O novo orientador já é avaliador na banca deste TCC — escolha outra pessoa ou troque antes os avaliadores.' });
      }
      if (data.coorientadorId !== undefined && ehAvaliadorDoTcc(novoCoor)) {
        throw new BadRequestException({ mensagem: 'O novo coorientador já é avaliador na banca deste TCC.' });
      }

      // Troca de orientador com banca da Fase II existente → sincroniza a composição
      // (a F2 é sempre orientador + os 2 avaliadores da Fase I). Antes, o antigo continuava
      // avaliador da defesa e o novo ficava de fora — estado impossível.
      if (trocouOrientador) {
        const bancaF2 = bancas.find((b) => b.fase === 'FASE_2');
        const membroAntigo = bancaF2?.membros.find((m) => m.avaliadorId === tcc.orientadorId);
        if (membroAntigo) {
          const jaAvaliou = membroAntigo.nota != null || membroAntigo.status !== 'PENDENTE';
          if (jaAvaliou) {
            // Não descartamos silenciosamente uma avaliação oficial já registrada: o
            // coordenador decide o destino dela primeiro (zerar/editar) e então troca.
            throw new BadRequestException({
              mensagem: 'O orientador atual já registrou avaliação na banca da Fase II. ' +
                'Edite/zere essa avaliação (em Bancas → editar avaliação, status "Pendente") antes de trocar o orientador.',
            });
          }
          await tx.membroBanca.delete({ where: { id: membroAntigo.id } });
        }
        if (bancaF2) {
          await tx.membroBanca.create({ data: { bancaId: bancaF2.id, avaliadorId: data.orientadorId as string } });
        }
      }

      return tx.tcc.update({ where: { id: tccId }, data });
    });
  }

  // ---------- Correção administrativa de FLUXO (coordenador) ----------
  // Muda a fase por uma ação CONTROLADA que nunca deixa notas, banca, defesa ou datas
  // contraditórias: cada destino tem pré-requisitos (o que precisa existir para a fase ser
  // possível) e limpezas (o que deixa de valer). confirmar=false devolve só a lista de
  // impactos, sem gravar nada; confirmar=true aplica tudo numa única transação. Nenhuma
  // avaliação registrada é descartada em silêncio — toda invalidação aparece nos impactos
  // que o coordenador confirmou. Datas de defesa limpas incluem defesaLiberadaEm, para a
  // liberação automática funcionar de novo num próximo agendamento.
  async corrigirFase(tccId: string, fase: string, confirmar: boolean) {
    if (!(FASES as readonly string[]).includes(fase)) {
      throw new BadRequestException({ mensagem: 'Fase inválida.' });
    }
    const tcc = await buscarTccAtivoOuFalhar(this.prisma, tccId);
    if (fase === tcc.faseAtual) {
      return { aplicado: false, faseAtual: tcc.faseAtual, impactos: ['O TCC já está nesta fase — nada a alterar.'] };
    }

    const bancas = await this.prisma.banca.findMany({ where: { tccId }, include: { membros: true } });
    const f1 = bancas.find((b) => b.fase === 'FASE_1');
    const f2 = bancas.find((b) => b.fase === 'FASE_2');
    const comNota = (b?: { membros: { nota: number | null }[] }) => (b?.membros ?? []).filter((m) => m.nota != null).length;
    const zerarCriterios = Object.fromEntries([...CRITERIOS_FASE1, ...CRITERIOS_FASE2].map((c) => [colunaNota(c.chave), null]));

    const impactos: string[] = [`Fase: "${ROTULO_FASE[tcc.faseAtual] ?? tcc.faseAtual}" → "${ROTULO_FASE[fase] ?? fase}".`];
    const data: Record<string, unknown> = { faseAtual: fase };
    const acoes: Array<(tx: any) => Promise<void>> = [];

    // Descontinuar guarda a fase atual para retomada; qualquer outro destino limpa a marca.
    if (fase === 'DESCONTINUADO') {
      data.faseAnteriorDescontinuacao = tcc.faseAtual;
      impactos.push('Nada é apagado: a fase atual fica registrada e o TCC pode ser retomado depois.');
    } else {
      data.faseAnteriorDescontinuacao = null;
    }

    // Limpa o agendamento INTEIRO da defesa (incluindo defesaLiberadaEm — um valor antigo
    // impediria a próxima liberação automática, já que a liberação é idempotente por ele).
    const limparDefesa = () => {
      if (tcc.defesaAgendadaPara) impactos.push('A defesa agendada será removida — um novo agendamento (com nova liberação automática) fica disponível.');
      data.defesaAgendadaPara = null;
      data.defesaLocal = null;
      data.defesaComentario = null;
      data.defesaAgendadaEm = null;
      data.defesaLiberadaEm = null;
    };
    const limparNf2Nf = () => {
      if (tcc.nf2 != null || tcc.nf != null || tcc.resultado) impactos.push('NF2, nota final (NF) e resultado apurados serão limpos — deixam de aparecer como válidos.');
      data.nf2 = null;
      data.nf = null;
      data.resultado = null;
      data.fase2ValidadaEm = null;
      data.versaoFinalValidadaEm = null;
      data.concluidoEm = null;
    };
    const limparNf1 = () => {
      if (tcc.nf1 != null) impactos.push('A NF1 apurada será limpa (é reapurada na próxima validação da Fase I).');
      data.nf1 = null;
      data.fase1ValidadaEm = null;
    };
    // Invalida as avaliações de uma banca (ficam PENDENTE, sem notas) — sempre com impacto.
    const invalidarAvaliacoes = (banca: typeof f1, rotulo: string) => {
      if (!banca || banca.membros.length === 0) return;
      const n = comNota(banca);
      if (n > 0) impactos.push(`${n} avaliação(ões) registrada(s) da ${rotulo} será(ão) invalidada(s) — os avaliadores precisarão avaliar novamente.`);
      acoes.push(async (tx) => {
        await tx.membroBanca.updateMany({
          where: { bancaId: banca.id },
          data: { status: 'PENDENTE', nota: null, parecer: null, avaliadoEm: null, rascunho: null, ajusteMotivo: null, ajusteReenviadoEm: null, ...zerarCriterios },
        });
      });
    };
    // Preserva as avaliações (notas continuam valendo) e normaliza o status para o ponto do
    // fluxo: quem tem nota vira `statusComNota`; quem não tem, PENDENTE.
    const normalizarStatus = (banca: NonNullable<typeof f1>, statusComNota: string) => {
      acoes.push(async (tx) => {
        await tx.membroBanca.updateMany({ where: { bancaId: banca.id, nota: { not: null } }, data: { status: statusComNota, ajusteMotivo: null, ajusteReenviadoEm: null } });
        await tx.membroBanca.updateMany({ where: { bancaId: banca.id, nota: null }, data: { status: 'PENDENTE', ajusteMotivo: null, ajusteReenviadoEm: null } });
      });
    };
    const exigir = (cond: unknown, mensagem: string) => {
      if (!cond) throw new BadRequestException({ mensagem });
    };

    switch (fase) {
      case 'INICIALIZACAO':
      case 'DESENVOLVIMENTO': {
        if (f1 || f2) {
          const total = comNota(f1) + comNota(f2);
          impactos.push(total > 0
            ? `As bancas serão desfeitas e ${total} avaliação(ões) registrada(s) serão descartadas.`
            : 'As bancas formadas serão desfeitas.');
          acoes.push(async (tx) => { await tx.banca.deleteMany({ where: { tccId } }); });
        }
        limparNf1();
        limparNf2Nf();
        limparDefesa();
        if (fase === 'INICIALIZACAO') {
          data.monografiaAprovada = false;
          data.continuidadeConfirmada = false;
          impactos.push('Aprovação da monografia e confirmação de continuidade serão desmarcadas.');
        }
        break;
      }
      case 'FORMACAO_BANCA_FASE_1': {
        if (f2) {
          const n = comNota(f2);
          impactos.push(n > 0 ? `A banca da Fase II será desfeita e ${n} avaliação(ões) descartada(s).` : 'A banca da Fase II será desfeita (é recriada na validação da Fase I).');
          acoes.push(async (tx) => { await tx.banca.deleteMany({ where: { tccId, fase: 'FASE_2' } }); });
        }
        invalidarAvaliacoes(f1, 'Fase I');
        limparNf1();
        limparNf2Nf();
        limparDefesa();
        break;
      }
      case 'AVALIACAO_FASE_1':
      case 'AGUARDANDO_ANALISE_COORDENACAO_FASE_1':
      case 'VALIDACAO_FASE_1': {
        exigir(f1 && f1.membros.length > 0, 'A banca da Fase I não está formada — este destino ficaria sem avaliadores. Use "Formação da banca (Fase I)".');
        if (fase !== 'AVALIACAO_FASE_1') {
          exigir(!f1!.membros.some((m) => m.nota == null), 'Nem todos os avaliadores da Fase I têm avaliação registrada — o destino coerente é "Avaliação — Fase I".');
        }
        normalizarStatus(f1!, fase === 'VALIDACAO_FASE_1' ? 'EM_ANALISE' : 'ENVIADO');
        impactos.push(fase === 'VALIDACAO_FASE_1'
          ? 'As avaliações da Fase I são preservadas e voltam para a análise da coordenação (aprove cada uma e valide a fase novamente).'
          : 'As avaliações da Fase I já registradas são preservadas e voltam a ser editáveis pelos avaliadores.');
        invalidarAvaliacoes(f2, 'Fase II');
        limparNf1();
        limparNf2Nf();
        limparDefesa();
        break;
      }
      case 'AGENDAMENTO_DEFESA_FASE_2': {
        exigir(tcc.nf1 != null && f2 && f2.membros.length > 0, 'A Fase I ainda não foi validada (sem NF1 ou sem banca da Fase II) — valide a Fase I para o TCC chegar ao agendamento.');
        invalidarAvaliacoes(f2, 'Fase II');
        limparNf2Nf();
        limparDefesa();
        break;
      }
      case 'AVALIACAO_FASE_2':
      case 'AGUARDANDO_ANALISE_COORDENACAO_FASE_2':
      case 'VALIDACAO_FASE_2': {
        exigir(tcc.nf1 != null && f2 && f2.membros.length > 0, 'A Fase I ainda não foi validada (sem NF1 ou sem banca da Fase II) — valide a Fase I primeiro.');
        exigir(tcc.defesaAgendadaPara, 'Não há defesa registrada — a avaliação da Fase II pressupõe a defesa. Use "Agendamento da defesa (Fase II)".');
        // A avaliação NUNCA abre antes da defesa acontecer — nem por correção administrativa.
        // Com defesa futura, o destino coerente é o agendamento (a liberação continua 100%
        // automática na data/hora marcada).
        exigir(
          tcc.defesaAgendadaPara && tcc.defesaAgendadaPara <= new Date(),
          'A defesa está marcada para o futuro — a avaliação da Fase II só abre na data/hora da defesa. ' +
            'Use "Agendamento da defesa (Fase II)": a liberação é automática na hora marcada.',
        );
        if (fase !== 'AVALIACAO_FASE_2') {
          exigir(!f2!.membros.some((m) => m.nota == null), 'Nem todos os avaliadores da Fase II têm avaliação registrada — o destino coerente é "Avaliação — Fase II".');
        }
        normalizarStatus(f2!, fase === 'VALIDACAO_FASE_2' ? 'EM_ANALISE' : 'ENVIADO');
        impactos.push(fase === 'VALIDACAO_FASE_2'
          ? 'As avaliações da Fase II são preservadas e voltam para a análise da coordenação (aprove cada uma e valide a fase novamente).'
          : 'As avaliações da Fase II já registradas são preservadas e voltam a ser editáveis pelos avaliadores.');
        if (!tcc.defesaLiberadaEm) data.defesaLiberadaEm = new Date(); // avaliação aberta ⇒ liberação registrada
        limparNf2Nf();
        break;
      }
      case 'AGUARDANDO_AJUSTES_FINAIS':
      case 'VALIDACAO_VERSAO_FINAL': {
        exigir(tcc.nf != null && aprovadoFinal(tcc.nf), 'Este destino exige nota final aprovada (NF ≥ 7) já apurada — valide a Fase II primeiro.');
        if (fase === 'VALIDACAO_VERSAO_FINAL') {
          const versaoFinal = await this.prisma.documentoTcc.findFirst({ where: { tccId, tipo: 'VERSAO_FINAL', status: { not: 'SUBSTITUIDA' } } });
          exigir(versaoFinal, 'Não há versão final enviada — o destino coerente é "Ajustes finais — versão final".');
        }
        if (tcc.resultado || tcc.concluidoEm) impactos.push('O resultado/conclusão registrados serão desfeitos até a nova validação da versão final.');
        data.resultado = null;
        data.concluidoEm = null;
        data.versaoFinalValidadaEm = null;
        break;
      }
      case 'CONCLUIDO': {
        exigir(tcc.nf != null && aprovadoFinal(tcc.nf), 'Concluir exige nota final aprovada (NF ≥ 7) já apurada — valide a Fase II primeiro.');
        // Sem versão final enviada não existe TCC concluído — o superpoder administrativo
        // pula só a VALIDAÇÃO do orientador (com aviso), nunca a existência do documento.
        const versaoFinalConcluir = await this.prisma.documentoTcc.findFirst({ where: { tccId, tipo: 'VERSAO_FINAL', status: { not: 'SUBSTITUIDA' } } });
        exigir(versaoFinalConcluir, 'Não há versão final enviada — sem ela o destino coerente é "Ajustes finais — versão final".');
        data.resultado = 'APROVADO';
        data.concluidoEm = tcc.concluidoEm ?? new Date();
        data.versaoFinalValidadaEm = tcc.versaoFinalValidadaEm ?? new Date();
        impactos.push('O TCC será marcado como concluído (resultado APROVADO) sem passar pela validação da versão final pelo orientador.');
        break;
      }
      case 'DESCONTINUADO':
        break; // só a marca de retomada (acima); nada é limpo
      case 'REPROVADO_FASE_1': {
        exigir(tcc.nf1 != null && !aprovadoFase1(tcc.nf1), 'Reprovação na Fase I exige NF1 apurada abaixo de 6 — o desfecho sai da validação da fase, não desta correção.');
        invalidarAvaliacoes(f2, 'Fase II');
        limparNf2Nf();
        limparDefesa();
        data.resultado = 'REPROVADO';
        break;
      }
      case 'REPROVADO_FASE_2': {
        exigir(tcc.nf != null && !aprovadoFinal(tcc.nf), 'Reprovação na Fase II exige nota final apurada abaixo de 7 — o desfecho sai da validação da fase, não desta correção.');
        data.resultado = 'REPROVADO';
        data.concluidoEm = null;
        data.versaoFinalValidadaEm = null;
        break;
      }
    }

    if (!confirmar) return { aplicado: false, faseAtual: tcc.faseAtual, impactos };
    await this.prisma.$transaction(async (tx) => {
      for (const acao of acoes) await acao(tx);
      await tx.tcc.update({ where: { id: tccId }, data });
    });
    return { aplicado: true, faseAtual: fase, impactos };
  }

  // Edita metadados de um documento do TCC (não substitui o arquivo). Coordenador.
  // Tipo é IMUTÁVEL (mudar o tipo depois do upload quebraria formato e vínculos de banca) e
  // a versão é sempre automática — nenhum dos dois é editável, nem por aqui nem pela API.
  async editarDocumento(docId: string, dados: DadosEditarDocumento) {
    const doc = await this.prisma.documentoTcc.findUnique({ where: { id: docId } });
    if (!doc) throw new NotFoundException();
    await buscarTccAtivoOuFalhar(this.prisma, doc.tccId); // bloqueia edição em TCC excluído
    if (dados.status !== undefined && !TccsService.STATUS_DOC.includes(dados.status)) {
      throw new BadRequestException({ mensagem: 'Status de documento inválido.' });
    }
    const data: Record<string, unknown> = {};
    if (dados.status !== undefined) data.status = dados.status;
    if (dados.parecer !== undefined) data.parecer = dados.parecer || null;
    if (dados.nomeArquivo !== undefined) data.nomeArquivo = dados.nomeArquivo;
    return this.prisma.documentoTcc.update({ where: { id: docId }, data });
  }

  private static readonly TIPOS_DOC = ['PLANO_DESENVOLVIMENTO', 'TERMO_ACEITE', 'MONOGRAFIA', 'VERSAO_FINAL', 'AVALIACAO_BANCA'];
  private static readonly STATUS_DOC = ['PENDENTE', 'EM_ANALISE', 'APROVADO', 'REJEITADO', 'SUBSTITUIDA'];

  // Próxima versão de um tipo de documento dentro do TCC (versionamento automático).
  private async proximaVersao(tccId: string, tipo: string) {
    return (await this.prisma.documentoTcc.count({ where: { tccId, tipo } })) + 1;
  }

  // Coordenador adiciona administrativamente um documento ao TCC (upload). Versão automática.
  // Reaproveita o mesmo padrão seguro de gravação (nome interno aleatório, original como metadado).
  async adicionarDocumentoAdmin(tccId: string, tipo: string, status: string | undefined, parecer: string | undefined, arquivo: any) {
    await buscarTccAtivoOuFalhar(this.prisma, tccId); // 404 se TCC inexistente ou excluído
    if (!TccsService.TIPOS_DOC.includes(tipo)) {
      throw new BadRequestException({ mensagem: 'Tipo de documento inválido.' });
    }
    // AVALIACAO_BANCA só nasce/é substituído pelo fluxo próprio da banca (formar banca ou
    // substituir o arquivo do documento vinculado): um upload genérico criaria um documento
    // sem vínculo com banca nenhuma, invisível para os avaliadores.
    if (tipo === 'AVALIACAO_BANCA') {
      throw new BadRequestException({
        mensagem: 'Documento de avaliação da banca não pode ser adicionado avulso — forme a banca (ou substitua o arquivo do documento da banca existente).',
      });
    }
    const st = status || 'PENDENTE';
    if (!TccsService.STATUS_DOC.includes(st)) {
      throw new BadRequestException({ mensagem: 'Status de documento inválido.' });
    }
    this.validarFormato(tipo, arquivo); // valida pelo tipo selecionado
    const arq = await this.gravarArquivo(arquivo);
    try {
      const versao = await this.proximaVersao(tccId, tipo);
      return await this.prisma.documentoTcc.create({
        data: { tccId, tipo, status: st, parecer: parecer || null, versao, ...arq },
      });
    } catch (e) {
      await fs.rm(join(process.cwd(), arq.caminho), { force: true }).catch(() => {});
      throw e;
    }
  }

  // Coordenador substitui o ARQUIVO de um documento existente: o antigo vira SUBSTITUIDA e
  // cria-se uma nova versão (mesmo tipo) que passa a ser a mais recente. Não apaga o arquivo
  // físico antigo. O status do novo é o escolhido no formulário, herdando o do antigo por padrão.
  async substituirArquivoDocumento(docId: string, status: string | undefined, arquivo: any) {
    const antigo = await this.prisma.documentoTcc.findUnique({ where: { id: docId } });
    if (!antigo) throw new NotFoundException();
    await buscarTccAtivoOuFalhar(this.prisma, antigo.tccId); // bloqueia substituição em TCC excluído
    const st = status || antigo.status;
    if (!TccsService.STATUS_DOC.includes(st)) {
      throw new BadRequestException({ mensagem: 'Status de documento inválido.' });
    }
    this.validarFormato(antigo.tipo, arquivo); // valida pelo tipo original do documento
    const arq = await this.gravarArquivo(arquivo);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.documentoTcc.update({ where: { id: docId }, data: { status: 'SUBSTITUIDA' } });
        const versao = (await tx.documentoTcc.count({ where: { tccId: antigo.tccId, tipo: antigo.tipo } })) + 1;
        const novo = await tx.documentoTcc.create({
          data: { tccId: antigo.tccId, tipo: antigo.tipo, status: st, parecer: antigo.parecer, versao, ...arq },
        });
        // Se o documento substituído era o "documento para avaliação" de uma banca, o vínculo
        // acompanha a NOVA versão na MESMA transação — senão os avaliadores continuariam
        // baixando/visualizando o arquivo antigo (a banca aponta por id, não por tipo).
        await tx.banca.updateMany({ where: { documentoAvaliacaoId: docId }, data: { documentoAvaliacaoId: novo.id } });
        return novo;
      });
    } catch (e) {
      await fs.rm(join(process.cwd(), arq.caminho), { force: true }).catch(() => {});
      throw e;
    }
  }

  // Estado do prazo de abertura para o próprio aluno (Dashboard / tela de abrir TCC).
  aberturaPrazo(alunoId: string) {
    return this.prazos.aberturaParaAluno(alunoId);
  }

  async abrir(alunoId: string, dados: DadosAbrirTcc) {
    const semestre = await resolverSemestreAtivo(this.prisma);

    const jaTem = await this.prisma.tcc.findUnique({
      where: { alunoId_semestre: { alunoId, semestre } },
      include: { solicitacoes: { orderBy: { criadoEm: 'desc' }, take: 1 } },
    });
    // Recomeço: se já existe um TCC deste semestre, só dá para abrir outro quando o anterior
    // foi RECUSADO/CANCELADO e ainda está na abertura. NÃO apagamos nada aqui — a exclusão do
    // TCC antigo (e dos arquivos) só acontece DEPOIS de toda a validação passar e DENTRO de uma
    // transação, para que qualquer falha na nova solicitação deixe a anterior 100% íntegra.
    let recomeco: { tccId: string } | null = null;
    if (jaTem) {
      // TCC do semestre EXCLUÍDO logicamente pela coordenação/orientador: a vaga única
      // (aluno, semestre) continua ocupada — não dá para abrir outro sem intervenção. Mensagem
      // clara em vez do genérico "já tem um TCC" (o aluno nem vê o TCC excluído nas telas).
      if (jaTem.excluidoEm) {
        throw new BadRequestException({
          mensagem: 'Seu TCC deste semestre foi excluído pela coordenação. Fale com a coordenação para regularizar antes de abrir uma nova solicitação.',
        });
      }
      const ult = jaTem.solicitacoes[0];
      // Só dá pra recomeçar se o TCC anterior ainda está na abertura E foi recusado/cancelado.
      const podeRecomecar = jaTem.faseAtual === 'INICIALIZACAO' && (ult?.status === 'RECUSADA' || ult?.status === 'CANCELADA');
      if (!podeRecomecar) throw new BadRequestException({ mensagem: 'Você já tem um TCC neste semestre.' });
      recomeco = { tccId: jaTem.id };
    }

    // ----- Validações ANTES de qualquer exclusão/gravação (item 1) -----
    // Prazo de envio de documentos iniciais (calendário da coordenação). Se vencido e SEM
    // liberação individual para este aluno+semestre, bloqueia a abertura. hoje===prazo ainda
    // vale; sem data, não bloqueia. A liberação é por aluno+semestre (não depende de TCC).
    await this.prazos.exigirEtapaLiberada({ etapa: 'ENVIO_DOCUMENTOS', semestre, alunoId });

    const orientador = await this.prisma.usuario.findUnique({ where: { id: dados.orientadorId } });
    if (!orientador || orientador.papel !== 'PROFESSOR') {
      throw new BadRequestException({ mensagem: 'Orientador inválido.' });
    }
    // Orientador escolhido pelo aluno precisa estar DISPONÍVEL para orientar — regra no backend
    // (não só na tela): a lista some quando o professor se marca indisponível (item 5).
    if (!orientador.disponivelParaOrientar) {
      throw new BadRequestException({ mensagem: 'Este orientador não está disponível para novas orientações. Escolha outro.' });
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
      // Disponibilidade vale para o PROFESSOR interno; avaliador externo/coordenador
      // seguem elegíveis como coorientadores independentemente do toggle.
      if (co.papel === 'PROFESSOR' && !co.disponivelParaOrientar) {
        throw new BadRequestException({ mensagem: 'Este coorientador não está disponível para novas orientações. Escolha outro.' });
      }
    }

    // ----- Troca transacional (item 1) -----
    // Com tudo validado, criamos a nova solicitação. No recomeço, a exclusão do TCC antigo e a
    // criação da nova ficam na MESMA transação (a unique aluno+semestre é respeitada); se
    // qualquer passo falhar, o rollback preserva a solicitação anterior intacta.
    let caminhosAntigos: string[] = [];
    const tcc = await this.prisma.$transaction(async (tx) => {
      if (recomeco) {
        const docs = await tx.documentoTcc.findMany({ where: { tccId: recomeco.tccId }, select: { caminho: true } });
        caminhosAntigos = docs.map((d) => d.caminho);
        await tx.tcc.delete({ where: { id: recomeco.tccId } });
      }
      return tx.tcc.create({
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
    });

    // A nova solicitação já existe com sucesso: só AGORA removemos os arquivos físicos do TCC
    // anterior (item 1). Uma falha ao apagar arquivo não afeta o novo registro.
    for (const c of caminhosAntigos) await fs.rm(join(process.cwd(), c), { force: true }).catch(() => {});

    // Na abertura SÓ o coordenador é avisado. Orientador e coorientador só ficam sabendo
    // quando a solicitação for APROVADA (a indicação pode nem se concretizar).
    await this.eventos.emitirParaCoordenadores('coord_nova_solicitacao', 'Nova solicitação de TCC', `Há uma nova solicitação de abertura aguardando análise: "${tcc.titulo}".`, `/coordenador/solicitacoes?tccId=${tcc.id}`);
    return tcc;
  }

  // Pesos das FASES na nota final (NF = pesoFase1·NF1 + pesoFase2·NF2), do calendário do
  // semestre do TCC. Sem calendário salvo → defaults do domínio (60/40). Anexado aos TCCs
  // devolvidos para aluno/orientador/coorientador para que o card de notas use o peso vigente
  // (em vez de hardcode 60/40 no front).
  private async pesosFasesDoSemestre(semestre: string) {
    const cal: any = await this.prisma.calendario.findUnique({ where: { semestre } });
    return { pesoFase1: cal?.pesoFase1 ?? PESO_NF1, pesoFase2: cal?.pesoFase2 ?? PESO_NF2 };
  }

  // Mesmo que pesosFasesDoSemestre, mas para uma lista de TCCs de vários semestres:
  // busca um calendário por semestre distinto e devolve um mapa semestre → pesos.
  private async pesosFasesPorSemestre(semestres: string[]) {
    const distintos = [...new Set(semestres)];
    const cals: any[] = await this.prisma.calendario.findMany({ where: { semestre: { in: distintos } } });
    const mapa = new Map<string, any>(cals.map((c) => [c.semestre, c]));
    const out: Record<string, { pesoFase1: number; pesoFase2: number }> = {};
    for (const s of distintos) {
      const cal = mapa.get(s);
      out[s] = { pesoFase1: cal?.pesoFase1 ?? PESO_NF1, pesoFase2: cal?.pesoFase2 ?? PESO_NF2 };
    }
    return out;
  }

  async meu(alunoId: string) {
    const tcc = await this.prisma.tcc.findFirst({
      where: { alunoId, excluidoEm: null },
      orderBy: { criadoEm: 'desc' },
      include: {
        orientador: { select: { id: true, nomeCompleto: true, tratamento: true } },
        coorientador: { select: { id: true, nomeCompleto: true } },
        solicitacoes: { orderBy: { criadoEm: 'desc' } },
        // Banca só para as DATAS da timeline (sem expor notas/avaliadores ao aluno).
        bancas: { select: { fase: true, criadoEm: true, membros: { select: { avaliadoEm: true } } } },
        // O documento interno da banca (AVALIACAO_BANCA) não aparece para o aluno.
        documentos: { where: { tipo: { not: 'AVALIACAO_BANCA' } } },
      },
    });
    if (!tcc) return null;
    // bloqueios[etapa] = ação bloqueada por prazo vencido sem liberação (para desabilitar botões).
    // Aluno não é coordenador: esconde notas/resultado até a confirmação da nota final (tcc.nf).
    const base = {
      ...sanitizarNotasTcc(tcc),
      ...(await this.pesosFasesDoSemestre(tcc.semestre)),
      bloqueios: await this.prazos.bloqueiosDoTcc(tcc),
    };
    // Notas/avaliações da banca SÓ depois da confirmação da nota final da Fase II (nf != null)
    // OU em reprovação terminal (REPROVADO_FASE_1/2 — resultado definitivo; mesmo critério do
    // sanitizarNotasTcc). Antes disso, o payload traz apenas as DATAS da banca (para a
    // timeline) — nada de notas, parecer ou avaliadores. Depois da liberação, anexa as bancas
    // completas (avaliadores, notas por critério, total e parecer), sempre SEM o rascunho
    // privado do avaliador, e os pesos do calendário do semestre para os cards de notas.
    if (tcc.nf != null || FASES_NOTAS_LIBERADAS.includes(tcc.faseAtual)) {
      const bancas = await this.prisma.banca.findMany({
        where: { tccId: tcc.id },
        orderBy: { fase: 'asc' },
        include: { membros: { include: { avaliador: { select: { id: true, nomeCompleto: true, tratamento: true } } } } },
      });
      const cal = await this.prisma.calendario.findUnique({ where: { semestre: tcc.semestre } });
      return ocultarRascunho({ ...base, bancas, pesos: cal ?? null });
    }
    return base;
  }

  async cancelar(alunoId: string, tccId: string) {
    const tcc = await buscarTccAtivoOuFalhar(this.prisma, tccId);
    if (tcc.alunoId !== alunoId) throw new ForbiddenException();
    if (tcc.faseAtual !== 'INICIALIZACAO') {
      throw new BadRequestException({ mensagem: 'Só é possível cancelar enquanto aguarda aprovação.' });
    }
    // Cancelar apaga o TCC de vez (cascade em solicitações/documentos). Os arquivos físicos
    // precisam sair junto — senão viram órfãos no disco (item 4). Coletamos os caminhos DESTE
    // TCC antes de excluir; só removemos os arquivos DEPOIS de a exclusão dar certo (se o delete
    // falhar, nada é apagado do disco). O filtro por tccId garante não tocar em arquivo de outro TCC.
    const docs = await this.prisma.documentoTcc.findMany({ where: { tccId }, select: { caminho: true } });
    await this.prisma.tcc.delete({ where: { id: tccId } });
    for (const d of docs) await fs.rm(join(process.cwd(), d.caminho), { force: true }).catch(() => {});
    return { ok: true };
  }

  // Exclusão PERMANENTE por COORDENADOR (qualquer TCC) ou pelo PROFESSOR ORIENTADOR (só o
  // TCC dele). Não é soft delete e NÃO tem restauração: o registro sai do banco (o cascade
  // do schema leva junto solicitações, documentos, bancas, membros/avaliações e liberações
  // de prazo; as preferências de histórico, sem FK, saem na mesma transação) e os arquivos
  // físicos de upload são removidos DEPOIS de a transação confirmar — se o banco falhar,
  // nenhum arquivo é apagado. Notificações não têm vínculo por id com o TCC e ficam como
  // estão (nada de apagar por texto/título).
  async excluir(usuario: { sub: string; papel: string }, tccId: string) {
    const tcc = await this.prisma.tcc.findUnique({ where: { id: tccId } });
    if (!tcc) return { ok: true }; // já não existe: idempotente
    const ehCoordenador = usuario.papel === 'COORDENADOR';
    const ehOrientador = usuario.papel === 'PROFESSOR' && tcc.orientadorId === usuario.sub;
    if (!ehCoordenador && !ehOrientador) {
      throw new ForbiddenException({ mensagem: 'Você não tem permissão para excluir este TCC.' });
    }
    const docs = await this.prisma.documentoTcc.findMany({ where: { tccId }, select: { caminho: true } });
    await this.prisma.$transaction([
      this.prisma.historicoTccOculto.deleteMany({ where: { tccId } }),
      this.prisma.tcc.delete({ where: { id: tccId } }),
    ]);
    // Falha ao remover um arquivo (ex.: lock do Windows) não desfaz a exclusão do banco,
    // mas também não é engolida: fica no log e vai na resposta, para o órfão ser removível
    // manualmente depois.
    const arquivosNaoRemovidos: string[] = [];
    for (const d of docs) {
      try {
        await fs.rm(join(process.cwd(), d.caminho), { force: true });
      } catch {
        arquivosNaoRemovidos.push(d.caminho);
      }
    }
    if (arquivosNaoRemovidos.length > 0) {
      new Logger(TccsService.name).warn(
        `Exclusão do TCC ${tccId}: ${arquivosNaoRemovidos.length} arquivo(s) não removido(s) do disco: ${arquivosNaoRemovidos.join(', ')}`,
      );
      return { ok: true, arquivosNaoRemovidos };
    }
    return { ok: true };
  }

  // TCCs do período atual (visão do coordenador), com dados pra gerir banca/fase
  // e abrir o detalhe (aluno, orientador, coorientador, documentos, banca + notas).
  async todos() {
    const semestre = await resolverSemestreAtivo(this.prisma);
    const tccs = await this.prisma.tcc.findMany({
      where: { semestre, excluidoEm: null },
      include: {
        aluno: { select: { id: true, nomeCompleto: true, email: true, curso: true } },
        orientador: { select: { id: true, nomeCompleto: true, tratamento: true } },
        coorientador: { select: { id: true, nomeCompleto: true, tratamento: true } },
        bancas: { include: { membros: { include: { avaliador: { select: { nomeCompleto: true, tratamento: true } } } } } },
        documentos: { orderBy: { criadoEm: 'desc' } },
        solicitacoes: { orderBy: { criadoEm: 'desc' } },
      },
      orderBy: { criadoEm: 'desc' },
    });
    // Coordenador vê as notas oficiais, mas NUNCA o rascunho privado do avaliador.
    return tccs.map((t) => ocultarRascunho(t));
  }

  pendentes() {
    return this.prisma.tcc.findMany({
      where: { faseAtual: 'INICIALIZACAO', excluidoEm: null, solicitacoes: { some: { status: 'PENDENTE' } } },
      include: {
        aluno: { select: { id: true, nomeCompleto: true, email: true, curso: true } },
        orientador: { select: { id: true, nomeCompleto: true, tratamento: true, afiliacao: true } },
        coorientador: { select: { id: true, nomeCompleto: true, tratamento: true, afiliacao: true } },
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
    if (!tcc || tcc.excluidoEm) throw new NotFoundException({ mensagem: 'TCC não encontrado.' });
    if (tcc.faseAtual !== 'INICIALIZACAO' || tcc.solicitacoes.length === 0) {
      throw new BadRequestException({ mensagem: 'Este TCC não está aguardando aprovação de abertura.' });
    }
    // Não aprova sem os dois documentos obrigatórios da abertura VÁLIDOS: um plano/termo
    // REJEITADO (ou substituído) não conta — o aluno precisa reenviar antes da aprovação.
    const validos = tcc.documentos.filter((d) => ['PENDENTE', 'EM_ANALISE', 'APROVADO'].includes(d.status));
    const tipos = new Set(validos.map((d) => d.tipo));
    if (!tipos.has('PLANO_DESENVOLVIMENTO') || !tipos.has('TERMO_ACEITE')) {
      throw new BadRequestException({
        mensagem: 'A solicitação precisa do Plano de Desenvolvimento e do Termo de Aceite válidos (documento rejeitado não conta — peça o reenvio ao aluno).',
      });
    }
    // Reserva ATÔMICA da decisão dentro de UMA transação: a solicitação PENDENTE→ACEITA E a fase
    // INICIALIZACAO→DESENVOLVIMENTO precisam casar exatamente 1 linha CADA. Se qualquer uma falhar
    // — outra decisão concorrente venceu, ou a coordenação moveu a fase por edição no mesmo
    // instante — a transação é revertida (throw dentro do callback faz rollback). Assim nunca fica
    // solicitação ACEITA + documentos aprovados com o TCC parado em outra fase (item 2).
    await this.prisma.$transaction(async (tx) => {
      const reserva = await tx.solicitacaoOrientacao.updateMany({
        where: { tccId, status: 'PENDENTE' },
        data: { status: 'ACEITA', respondidoEm: new Date() },
      });
      if (reserva.count !== 1) {
        throw new ConflictException({ mensagem: 'Esta solicitação já foi decidida por outra pessoa. Atualize a página.' });
      }
      const transicao = await tx.tcc.updateMany({
        where: { id: tccId, faseAtual: 'INICIALIZACAO' },
        data: { faseAtual: 'DESENVOLVIMENTO' },
      });
      if (transicao.count !== 1) {
        throw new ConflictException({ mensagem: 'A fase deste TCC mudou durante a aprovação. Atualize a página e tente novamente.' });
      }
      // Ao aprovar a abertura, os documentos iniciais deixam de estar "em análise" e ficam
      // APROVADO (limpa parecer). Não toca em MONOGRAFIA/VERSAO_FINAL/AVALIACAO_BANCA nem
      // em versões SUBSTITUIDA (filtro por tipo e status).
      await tx.documentoTcc.updateMany({
        where: {
          tccId,
          tipo: { in: ['PLANO_DESENVOLVIMENTO', 'TERMO_ACEITE'] },
          status: { in: ['PENDENTE', 'EM_ANALISE'] },
        },
        data: { status: 'APROVADO', parecer: null },
      });
    });
    await this.eventos.emitirParaUsuario('aluno_solicitacao_aprovada', tcc.alunoId, 'Solicitação de TCC aprovada', `Sua solicitação do TCC "${tcc.titulo}" foi aprovada. O TCC entrou na fase de desenvolvimento.`);
    await this.eventos.emitirParaUsuario('orientador_definido', tcc.orientadorId, 'Você é orientador de um novo TCC', `Você foi confirmado como orientador do TCC "${tcc.titulo}".`);
    await this.eventos.emitirParaUsuario('orientador_confirmar_continuidade', tcc.orientadorId, 'Confirmar continuidade do TCC', `Quando puder, confirme a continuidade do TCC "${tcc.titulo}" na sua área de orientandos.`, `/professor/orientandos/${tcc.id}#acao`);
    await this.eventos.emitirParaUsuario('coorientador_indicado', tcc.coorientadorId, 'Você foi indicado como coorientador', `Você foi indicado como coorientador do TCC "${tcc.titulo}". A solicitação foi aprovada e o TCC entrou na fase de desenvolvimento.`);
    return { ok: true };
  }

  async recusar(tccId: string, parecer: string) {
    const tcc = await this.prisma.tcc.findUnique({
      where: { id: tccId },
      include: { solicitacoes: { where: { status: 'PENDENTE' } } },
    });
    if (!tcc || tcc.excluidoEm) throw new NotFoundException({ mensagem: 'TCC não encontrado.' });
    if (tcc.faseAtual !== 'INICIALIZACAO' || tcc.solicitacoes.length === 0) {
      throw new BadRequestException({ mensagem: 'Este TCC não está aguardando aprovação de abertura.' });
    }
    // Reserva ATÔMICA (item 2) dentro de uma transação: move a solicitação PENDENTE→RECUSADA e
    // confirma que o TCC AINDA está aguardando abertura (INICIALIZACAO). Se outro coordenador já
    // decidiu (casa 0 linhas) ou a coordenação moveu a fase por edição no mesmo instante, reverte —
    // a solicitação não é recusada isoladamente sobre um TCC que já saiu da inicialização.
    await this.prisma.$transaction(async (tx) => {
      const reserva = await tx.solicitacaoOrientacao.updateMany({
        where: { tccId, status: 'PENDENTE' },
        data: { status: 'RECUSADA', parecer, respondidoEm: new Date() },
      });
      if (reserva.count !== 1) {
        throw new ConflictException({ mensagem: 'Esta solicitação já foi decidida por outra pessoa. Atualize a página.' });
      }
      const atual = await tx.tcc.findUnique({ where: { id: tccId }, select: { faseAtual: true, excluidoEm: true } });
      if (!atual || atual.excluidoEm || atual.faseAtual !== 'INICIALIZACAO') {
        throw new ConflictException({ mensagem: 'A fase deste TCC mudou durante a recusa. Atualize a página e tente novamente.' });
      }
    });
    await this.eventos.emitirParaUsuario('aluno_solicitacao_recusada', tcc.alunoId, 'Solicitação de TCC recusada', `Sua solicitação do TCC "${tcc.titulo}" foi recusada.${parecer ? ' Parecer: ' + parecer : ''} Você pode corrigir os documentos e reenviar.`);
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
            excluidoEm: true,
            alunoId: true,
            orientadorId: true,
            coorientadorId: true,
            bancas: { select: { fase: true, documentoAvaliacaoId: true, membros: { select: { avaliadorId: true } } } },
          },
        },
      },
    });
    if (!doc) return null;
    // TCC excluído logicamente: ninguém baixa/visualiza documentos dele (nem o coordenador).
    // Vem ANTES do atalho do coordenador para o soft delete valer também aqui (404 na rota).
    if (doc.tcc.excluidoEm) return null;
    if (usuario.papel === 'COORDENADOR') return doc;
    const t = doc.tcc;

    // Documento interno da banca: só o coordenador (acima) e os membros da banca que
    // avalia este documento. Nem o aluno dono, nem orientador/coorientador acessam por
    // serem "donos" do TCC — apenas por serem membros da banca correspondente.
    if (doc.tipo === 'AVALIACAO_BANCA') {
      const banca = t.bancas.find((b) => b.documentoAvaliacaoId === doc.id);
      if (!banca || !banca.membros.some((m) => m.avaliadorId === usuario.sub)) return null;
      // DUPLO-CEGO (item 6): o avaliador da Fase I recebe o documento da banca, mas NUNCA o nome
      // ORIGINAL do arquivo — um "Avaliacao_JoaoSilva.docx" entregaria o aluno. Devolve um nome
      // genérico no lugar (o caminho real no disco é preservado, só o rótulo muda). O coordenador
      // já retornou acima com o nome real; AVALIACAO_BANCA só existe na Fase I, então todo acesso
      // que chega aqui é de um avaliador cego.
      return { ...doc, nomeArquivo: 'Documento para avaliação' };
    }

    const ehDono =
      t.alunoId === usuario.sub ||
      t.orientadorId === usuario.sub ||
      t.coorientadorId === usuario.sub;
    // Membro de banca acessa a monografia/versão final — mas SÓ o da banca da FASE II.
    // Na Fase I a avaliação é às cegas: o membro só acessa o documento anônimo da banca
    // (AVALIACAO_BANCA, tratado acima); a monografia original carrega o nome do aluno
    // (no arquivo e no conteúdo) e entregaria a identidade.
    const ehMembroBancaF2 = t.bancas.some(
      (b) => b.fase === 'FASE_2' && b.membros.some((m) => m.avaliadorId === usuario.sub),
    );
    const acessoBanca = ehMembroBancaF2 && ['MONOGRAFIA', 'VERSAO_FINAL'].includes(doc.tipo);
    return ehDono || acessoBanca ? doc : null;
  }

  // ---------- Fase de Desenvolvimento (monografia + continuidade) ----------

  // Validação REAL do formato pelo tipo de documento: EXTENSÃO do nome + ASSINATURA do
  // conteúdo (magic bytes). Vale para qualquer rota; é a fonte de verdade independente do
  // filtro do multer. Um .pdf/.docx com conteúdo falso é rejeitado com 400.
  private validarFormato(tipo: string, arquivo: any) {
    const formato = formatoDoTipoDoc(tipo);
    if (!arquivoPermitidoParaTipo(tipo, arquivo?.originalname ?? '')) {
      throw new BadRequestException({ mensagem: `Para este documento, envie ${formato.rotulo}.` });
    }
    if (!conteudoCompativel(arquivo?.buffer, formato.exts)) {
      throw new BadRequestException({ mensagem: `O arquivo não é um ${formato.rotulo} válido — o conteúdo não corresponde à extensão.` });
    }
  }

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

  // Teto de documentos por TCC nos envios do ALUNO. O fluxo normal usa ~10–15 registros
  // mesmo com reenvios; sem teto, um usuário autenticado poderia subir arquivos de 10 MB
  // sem parar e encher o disco. Ações administrativas do coordenador não passam por aqui.
  // Recebe o client (prisma OU tx): chamado DENTRO da mesma transação que cria o documento,
  // para a contagem e a gravação serem atômicas (sem corrida entre uploads paralelos).
  private static readonly LIMITE_DOCUMENTOS_POR_TCC = 40;
  private async exigirEspacoParaDocumento(db: { documentoTcc: { count: (args: any) => Promise<number> } }, tccId: string) {
    const total = await db.documentoTcc.count({ where: { tccId } });
    if (total >= TccsService.LIMITE_DOCUMENTOS_POR_TCC) {
      throw new BadRequestException({
        mensagem: 'Este TCC atingiu o limite de documentos enviados. Fale com a coordenação para remover versões antigas antes de enviar de novo.',
      });
    }
  }

  // Aluno envia (ou reenvia) a monografia. Substitui versões pendentes antigas e cria a nova
  // (PENDENTE) numa transação; se algo falhar, remove o arquivo recém-gravado (sem órfão).
  async enviarMonografia(alunoId: string, tccId: string, arquivo: any) {
    const tcc = await buscarTccAtivoOuFalhar(this.prisma, tccId);
    if (tcc.alunoId !== alunoId) throw new ForbiddenException();
    if (tcc.faseAtual !== 'DESENVOLVIMENTO') {
      throw new BadRequestException({ mensagem: 'O TCC não está na fase de desenvolvimento.' });
    }
    if (tcc.monografiaAprovada) {
      throw new BadRequestException({ mensagem: 'Sua monografia já foi aprovada pelo orientador.' });
    }
    await this.prazos.exigirEtapaLiberada({ etapa: 'SUBMISSAO_MONOGRAFIA', semestre: tcc.semestre, tccId: tcc.id, alunoId: tcc.alunoId });
    this.validarFormato('MONOGRAFIA', arquivo);
    const arq = await this.gravarArquivo(arquivo);
    try {
      const doc = await this.prisma.$transaction(async (tx) => {
        await this.exigirEspacoParaDocumento(tx, tccId); // dentro da tx: contagem+criação atômicas
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
      await this.eventos.emitirParaUsuario('orientador_monografia_enviada', tcc.orientadorId, 'Monografia enviada para avaliação', `O aluno enviou/reenviou a monografia do TCC "${tcc.titulo}" para sua avaliação.`, `/professor/orientandos/${tcc.id}#acao`);
      await this.eventos.emitirParaUsuario('coorientador_documentos', tcc.coorientadorId, 'Monografia enviada', `O aluno enviou/reenviou a monografia do TCC "${tcc.titulo}" (no qual você é coorientador).`);
      return doc;
    } catch (e) {
      await fs.rm(join(process.cwd(), arq.caminho), { force: true }).catch(() => {});
      throw e;
    }
  }

  // Lista os TCCs em que o usuário é orientador (com aluno, documentos e flags das trilhas).
  async orientandos(professorId: string) {
    const tccs = await this.prisma.tcc.findMany({
      where: { orientadorId: professorId, excluidoEm: null },
      include: {
        aluno: { select: { id: true, nomeCompleto: true, email: true, curso: true } },
        coorientador: { select: { id: true, nomeCompleto: true, tratamento: true, afiliacao: true, email: true } },
        bancas: { include: { membros: { include: { avaliador: { select: { nomeCompleto: true, tratamento: true } } } } } },
        // Documento interno da banca não aparece como metadado para o orientador.
        documentos: { where: { tipo: { not: 'AVALIACAO_BANCA' } }, orderBy: { criadoEm: 'desc' } },
        solicitacoes: { orderBy: { criadoEm: 'desc' } },
      },
      orderBy: { criadoEm: 'desc' },
    });
    // Orientador não é coordenador: esconde NF1/NF2/NF, resultado e as notas/parecer dos
    // membros da banca até a confirmação da nota final da Fase II (tcc.nf).
    const pesos = await this.pesosFasesPorSemestre(tccs.map((t) => t.semestre));
    return Promise.all(
      tccs.map(async (t) => ({
        ...ocultarRascunho(sanitizarNotasTcc(t)),
        ...pesos[t.semestre],
        bloqueios: await this.prazos.bloqueiosDoTcc(t),
      })),
    );
  }

  // Lista os TCCs em que o usuário é coorientador (visão de leitura: aluno, orientador e docs).
  async coorientacoes(usuarioId: string) {
    const tccs = await this.prisma.tcc.findMany({
      where: { coorientadorId: usuarioId, excluidoEm: null },
      include: {
        aluno: { select: { id: true, nomeCompleto: true, email: true, curso: true } },
        orientador: { select: { id: true, nomeCompleto: true, tratamento: true } },
        // Documento interno da banca não aparece como metadado para o coorientador.
        documentos: { where: { tipo: { not: 'AVALIACAO_BANCA' } }, orderBy: { criadoEm: 'desc' } },
      },
      orderBy: { criadoEm: 'desc' },
    });
    // Coorientador não é coordenador: esconde NF1/NF2/NF e resultado até a confirmação final.
    const pesos = await this.pesosFasesPorSemestre(tccs.map((t) => t.semestre));
    return tccs.map((t) => ({ ...sanitizarNotasTcc(t), ...pesos[t.semestre] }));
  }

  private async exigirOrientadorEmDesenvolvimento(profId: string, tccId: string) {
    const tcc = await buscarTccAtivoOuFalhar(this.prisma, tccId);
    if (tcc.orientadorId !== profId) throw new ForbiddenException();
    if (tcc.faseAtual !== 'DESENVOLVIMENTO') {
      throw new BadRequestException({ mensagem: 'O TCC não está na fase de desenvolvimento.' });
    }
    return tcc;
  }

  // Orientador aprova ou rejeita a monografia enviada (Trilha A).
  async avaliarMonografia(profId: string, tccId: string, decisao: 'APROVAR' | 'REJEITAR', parecer?: string) {
    const tcc = await this.exigirOrientadorEmDesenvolvimento(profId, tccId);
    // Mesmo prazo da submissão da monografia bloqueia a decisão do orientador (aprovar/rejeitar).
    await this.prazos.exigirEtapaLiberada({ etapa: 'SUBMISSAO_MONOGRAFIA', semestre: tcc.semestre, tccId: tcc.id, alunoId: tcc.alunoId });
    const mono = await this.prisma.documentoTcc.findFirst({
      where: { tccId, tipo: 'MONOGRAFIA' },
      orderBy: { versao: 'desc' },
    });
    if (!mono || mono.status !== 'PENDENTE') {
      throw new BadRequestException({ mensagem: 'Não há monografia aguardando avaliação.' });
    }
    if (decisao === 'APROVAR') {
      // Junção "E" ATÔMICA: liga a flag e, na MESMA transação, tenta a transição com um
      // update condicional que só casa se AS DUAS trilhas estiverem concluídas NO BANCO
      // (não no snapshot lido antes). Isso elimina a corrida em que monografia e
      // continuidade são decididas quase ao mesmo tempo e nenhuma das duas vê a outra —
      // o que deixava o TCC preso em DESENVOLVIMENTO com as duas flags ligadas.
      // A transição do DOCUMENTO é condicional a PENDENTE (item 3): se uma decisão concorrente
      // (aprovar/rejeitar) já mudou o status, casa 0 linhas → conflito, sem gravar estado
      // parcial — nunca fica "monografia aprovada (flag) com documento rejeitado".
      const vaiPraBanca = await this.prisma.$transaction(async (tx) => {
        const reserva = await tx.documentoTcc.updateMany({
          where: { id: mono.id, status: 'PENDENTE' },
          data: { status: 'APROVADO', parecer: null },
        });
        if (reserva.count !== 1) {
          throw new ConflictException({ mensagem: 'A monografia já foi avaliada — atualize a página.' });
        }
        // A flag monografiaAprovada SÓ é gravada se o TCC AINDA está em DESENVOLVIMENTO (item 3):
        // um update por id apenas gravaria a flag mesmo que a coordenação tivesse descontinuado ou
        // movido a fase neste instante. Com updateMany condicional, esse caso casa 0 linhas →
        // rollback (não liga a flag nem dispara notificação sobre um TCC que já saiu da fase).
        const flag = await tx.tcc.updateMany({
          where: { id: tccId, faseAtual: 'DESENVOLVIMENTO' },
          data: { monografiaAprovada: true, monografiaAprovadaEm: new Date() },
        });
        if (flag.count !== 1) {
          throw new ConflictException({ mensagem: 'A fase do TCC mudou durante a avaliação da monografia — atualize a página.' });
        }
        const transicao = await tx.tcc.updateMany({
          where: { id: tccId, faseAtual: 'DESENVOLVIMENTO', monografiaAprovada: true, continuidadeConfirmada: true },
          data: { faseAtual: 'FORMACAO_BANCA_FASE_1' },
        });
        return transicao.count === 1;
      });
      await this.eventos.emitirParaUsuario('aluno_monografia_aprovada', tcc.alunoId, 'Monografia aprovada', `Sua monografia do TCC "${tcc.titulo}" foi aprovada pelo orientador.${vaiPraBanca ? ' Com a continuidade confirmada, seu TCC avançou para a formação da banca da Fase I.' : ''}`);
      // Coorientador recebe pelo evento de documentos (a mensagem já carrega o avanço de fase,
      // então não dispara também o coorientador_mudanca_fase — seria e-mail dobrado).
      await this.eventos.emitirParaUsuario('coorientador_documentos', tcc.coorientadorId, 'Monografia aprovada', `A monografia do TCC "${tcc.titulo}" (no qual você é coorientador) foi aprovada pelo orientador.${vaiPraBanca ? ' Com a continuidade confirmada, o TCC avançou para a formação da banca da Fase I.' : ''}`);
      if (vaiPraBanca) {
        await this.eventos.emitirParaCoordenadores('coord_formar_banca_fase1', 'Formar banca da Fase I', `O TCC "${tcc.titulo}" teve monografia aprovada e continuidade confirmada — é preciso formar a banca da Fase I.`, `/coordenador/tccs/${tcc.id}`);
      }
    } else {
      // Rejeição CONDICIONAL a PENDENTE e à fase DESENVOLVIMENTO, na MESMA transação (item 3):
      // se uma aprovação concorrente já venceu (documento não-PENDENTE) OU a coordenação moveu a
      // fase no instante, reverte com conflito — sem sobrescrever a decisão que já valeu nem
      // notificar sobre um TCC que já saiu do desenvolvimento.
      await this.prisma.$transaction(async (tx) => {
        const reserva = await tx.documentoTcc.updateMany({
          where: { id: mono.id, status: 'PENDENTE' },
          data: { status: 'REJEITADO', parecer: parecer ?? null },
        });
        if (reserva.count !== 1) {
          throw new ConflictException({ mensagem: 'A monografia já foi avaliada — atualize a página.' });
        }
        const atual = await tx.tcc.findUnique({ where: { id: tccId }, select: { faseAtual: true, excluidoEm: true } });
        if (!atual || atual.excluidoEm || atual.faseAtual !== 'DESENVOLVIMENTO') {
          throw new ConflictException({ mensagem: 'A fase do TCC mudou durante a avaliação da monografia — atualize a página.' });
        }
      });
      await this.eventos.emitirParaUsuario('aluno_monografia_rejeitada', tcc.alunoId, 'Monografia precisa de ajustes', `O orientador pediu ajustes na sua monografia do TCC "${tcc.titulo}".${parecer ? ' Devolutiva: ' + parecer : ''}`);
      await this.eventos.emitirParaUsuario('coorientador_documentos', tcc.coorientadorId, 'Monografia precisa de ajustes', `O orientador pediu ajustes na monografia do TCC "${tcc.titulo}" (no qual você é coorientador).`);
    }
    return { ok: true };
  }

  // Orientador confirma ou rejeita a continuidade (Trilha B). Rejeição → Descontinuado.
  async avaliarContinuidade(profId: string, tccId: string, decisao: 'CONFIRMAR' | 'REJEITAR', parecer?: string) {
    const tcc = await this.exigirOrientadorEmDesenvolvimento(profId, tccId);
    // Prazo de avaliação de continuidade bloqueia AS DUAS decisões (confirmar e descontinuar).
    await this.prazos.exigirEtapaLiberada({ etapa: 'AVALIACAO_CONTINUIDADE', semestre: tcc.semestre, tccId: tcc.id, alunoId: tcc.alunoId });
    if (decisao === 'CONFIRMAR') {
      if (tcc.continuidadeConfirmada) {
        throw new BadRequestException({ mensagem: 'A continuidade já foi confirmada.' });
      }
      // Junção "E" ATÔMICA (espelha avaliarMonografia): liga a flag e tenta a transição
      // com update condicional na MESMA transação, olhando o estado real do banco.
      // A confirmação é RESERVADA condicionalmente (item 3): só casa se o TCC ainda está em
      // DESENVOLVIMENTO e a continuidade ainda NÃO foi decidida — impede a corrida com uma
      // rejeição simultânea (não vira DESCONTINUADO + continuidade=true, nem sobrescreve um
      // TCC que já avançou).
      const resultado = await this.prisma.$transaction(async (tx) => {
        const reserva = await tx.tcc.updateMany({
          where: { id: tccId, faseAtual: 'DESENVOLVIMENTO', continuidadeConfirmada: false },
          data: { continuidadeConfirmada: true, continuidadeAvaliadaEm: new Date() },
        });
        if (reserva.count !== 1) return { conflito: true, vaiPraBanca: false };
        const transicao = await tx.tcc.updateMany({
          where: { id: tccId, faseAtual: 'DESENVOLVIMENTO', monografiaAprovada: true, continuidadeConfirmada: true },
          data: { faseAtual: 'FORMACAO_BANCA_FASE_1' },
        });
        return { conflito: false, vaiPraBanca: transicao.count === 1 };
      });
      if (resultado.conflito) {
        throw new ConflictException({ mensagem: 'A continuidade deste TCC já foi decidida — atualize a página.' });
      }
      const vaiPraBanca = resultado.vaiPraBanca;
      await this.eventos.emitirParaUsuario('aluno_continuidade_confirmada', tcc.alunoId, 'Continuidade confirmada', `O orientador confirmou a continuidade do seu TCC "${tcc.titulo}".${vaiPraBanca ? ' Com a monografia aprovada, seu TCC avançou para a formação da banca da Fase I.' : ''}`);
      if (vaiPraBanca) {
        await this.eventos.emitirParaCoordenadores('coord_formar_banca_fase1', 'Formar banca da Fase I', `O TCC "${tcc.titulo}" teve monografia aprovada e continuidade confirmada — é preciso formar a banca da Fase I.`, `/coordenador/tccs/${tcc.id}`);
        await this.eventos.emitirParaUsuario('coorientador_mudanca_fase', tcc.coorientadorId, 'TCC avançou para a Fase I', `O TCC "${tcc.titulo}" (no qual você é coorientador) avançou para a Fase I.`);
      } else {
        await this.eventos.emitirParaUsuario('coorientador_mudanca_fase', tcc.coorientadorId, 'Continuidade confirmada', `O orientador confirmou a continuidade do TCC "${tcc.titulo}" (no qual você é coorientador).`);
        // Quando vaiPraBanca o coordenador já recebe o "formar banca" (que implica a
        // continuidade confirmada); aqui avisa só quando a monografia ainda está pendente.
        await this.eventos.emitirParaCoordenadores('coord_continuidade', 'Continuidade confirmada', `O orientador confirmou a continuidade do TCC "${tcc.titulo}".`, `/coordenador/tccs/${tcc.id}`);
      }
    } else {
      // Descontinuar também é CONDICIONAL (item 3): só a partir de DESENVOLVIMENTO com a
      // continuidade ainda não confirmada. Se uma confirmação concorrente já venceu (o TCC pode
      // até ter avançado de fase), casa 0 linhas → conflito, sem "puxar" o TCC de volta para
      // DESCONTINUADO nem apagar um avanço legítimo.
      const reserva = await this.prisma.tcc.updateMany({
        where: { id: tccId, faseAtual: 'DESENVOLVIMENTO', continuidadeConfirmada: false },
        data: { faseAtual: 'DESCONTINUADO', parecerContinuidade: parecer ?? null, continuidadeAvaliadaEm: new Date() },
      });
      if (reserva.count !== 1) {
        throw new ConflictException({ mensagem: 'A continuidade deste TCC já foi decidida — atualize a página.' });
      }
      await this.eventos.emitirParaUsuario('aluno_continuidade_rejeitada', tcc.alunoId, 'TCC descontinuado', `O orientador não confirmou a continuidade do TCC "${tcc.titulo}".${parecer ? ' Motivo: ' + parecer : ''}`);
      await this.eventos.emitirParaUsuario('coorientador_mudanca_fase', tcc.coorientadorId, 'TCC descontinuado', `O TCC "${tcc.titulo}" (no qual você é coorientador) foi descontinuado — o orientador não confirmou a continuidade.`);
      await this.eventos.emitirParaCoordenadores('coord_continuidade', 'TCC descontinuado', `O TCC "${tcc.titulo}" foi descontinuado — o orientador não confirmou a continuidade.`, `/coordenador/tccs/${tcc.id}`);
    }
    return { ok: true };
  }

  // ---------- Conclusão (versão final + validação do orientador) ----------

  // Aluno envia a versão final corrigida (após aprovado na defesa). → VALIDACAO_VERSAO_FINAL.
  async enviarVersaoFinal(alunoId: string, tccId: string, arquivo: any) {
    const tcc = await buscarTccAtivoOuFalhar(this.prisma, tccId);
    if (tcc.alunoId !== alunoId) throw new ForbiddenException();
    if (tcc.faseAtual !== 'AGUARDANDO_AJUSTES_FINAIS') {
      throw new BadRequestException({ mensagem: 'O TCC não está aguardando a versão final.' });
    }
    await this.prazos.exigirEtapaLiberada({ etapa: 'VERSAO_FINAL', semestre: tcc.semestre, tccId: tcc.id, alunoId: tcc.alunoId });
    const reenvio = (await this.prisma.documentoTcc.count({ where: { tccId, tipo: 'VERSAO_FINAL' } })) > 0;
    this.validarFormato('VERSAO_FINAL', arquivo);
    const arq = await this.gravarArquivo(arquivo);
    try {
      const doc = await this.prisma.$transaction(async (tx) => {
        await this.exigirEspacoParaDocumento(tx, tccId); // dentro da tx: contagem+criação atômicas
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
      await this.eventos.emitirParaUsuario(evento, tcc.orientadorId, 'Versão final enviada', `O aluno ${reenvio ? 'reenviou' : 'enviou'} a versão final do TCC "${tcc.titulo}" para sua validação.`, `/professor/orientandos/${tccId}#acao`);
      await this.eventos.emitirParaUsuario('coorientador_documentos', tcc.coorientadorId, 'Versão final enviada', `O aluno ${reenvio ? 'reenviou' : 'enviou'} a versão final do TCC "${tcc.titulo}" (no qual você é coorientador).`);
      return doc;
    } catch (e) {
      await fs.rm(join(process.cwd(), arq.caminho), { force: true }).catch(() => {});
      throw e;
    }
  }

  // Orientador valida a versão final: conclui (→ CONCLUIDO/APROVADO) ou pede ajustes (volta).
  async validarVersaoFinal(profId: string, tccId: string, decisao: 'CONCLUIR' | 'AJUSTES', parecer?: string) {
    const tcc = await buscarTccAtivoOuFalhar(this.prisma, tccId);
    if (tcc.orientadorId !== profId) throw new ForbiddenException();
    if (tcc.faseAtual !== 'VALIDACAO_VERSAO_FINAL') {
      throw new BadRequestException({ mensagem: 'O TCC não está aguardando validação da versão final.' });
    }
    // Mesmo prazo da versão final bloqueia a validação do ORIENTADOR (concluir/pedir ajustes).
    await this.prazos.exigirEtapaLiberada({ etapa: 'VERSAO_FINAL', semestre: tcc.semestre, tccId: tcc.id, alunoId: tcc.alunoId });
    if (decisao === 'CONCLUIR') {
      const agora = new Date(); // mesma marca para "validação do orientador" e "concluído"
      // Transição de fase CONDICIONAL a VALIDACAO_VERSAO_FINAL (item 3): a mudança de fase é o
      // guarda de vencedor único — duas decisões simultâneas (concluir/ajustes) nunca deixam a
      // fase CONCLUIDO com o documento REJEITADO (ou vice-versa). E EXIGE uma versão final PENDENTE
      // na MESMA transação (item 4): sem ela — ex.: a fase foi movida à mão pela coordenação sem
      // envio de versão — o throw reverte tudo e o TCC não é concluído sem versão final.
      await this.prisma.$transaction(async (tx) => {
        const reserva = await tx.tcc.updateMany({
          where: { id: tccId, faseAtual: 'VALIDACAO_VERSAO_FINAL' },
          data: { faseAtual: 'CONCLUIDO', resultado: 'APROVADO', versaoFinalValidadaEm: agora, concluidoEm: agora },
        });
        if (reserva.count !== 1) {
          throw new ConflictException({ mensagem: 'A versão final já foi avaliada — atualize a página.' });
        }
        const aprovaDoc = await tx.documentoTcc.updateMany({
          where: { tccId, tipo: 'VERSAO_FINAL', status: 'PENDENTE' },
          data: { status: 'APROVADO', parecer: null },
        });
        if (aprovaDoc.count < 1) {
          throw new BadRequestException({ mensagem: 'Não há versão final aguardando validação.' });
        }
      });
      await this.eventos.emitirParaUsuario('aluno_tcc_concluido', tcc.alunoId, 'TCC concluído 🎉', `Parabéns! Seu TCC "${tcc.titulo}" foi aprovado e concluído.`);
      await this.eventos.emitirParaCoordenadores('coord_tcc_concluido', 'TCC concluído', `O TCC "${tcc.titulo}" foi concluído — versão final validada pelo orientador.`, `/coordenador/tccs/${tccId}`);
      await this.eventos.emitirParaUsuario('coorientador_mudanca_fase', tcc.coorientadorId, 'TCC concluído', `O TCC "${tcc.titulo}" (no qual você é coorientador) foi concluído.`);
    } else {
      // Pedido de ajustes também é CONDICIONAL a VALIDACAO_VERSAO_FINAL (item 3): a fase é o
      // guarda de vencedor único; e EXIGE a versão final PENDENTE na MESMA transação (item 4) —
      // sem uma versão em avaliação não há o que devolver para ajustes, então reverte.
      await this.prisma.$transaction(async (tx) => {
        const reserva = await tx.tcc.updateMany({
          where: { id: tccId, faseAtual: 'VALIDACAO_VERSAO_FINAL' },
          data: { faseAtual: 'AGUARDANDO_AJUSTES_FINAIS' },
        });
        if (reserva.count !== 1) {
          throw new ConflictException({ mensagem: 'A versão final já foi avaliada — atualize a página.' });
        }
        const rejeitaDoc = await tx.documentoTcc.updateMany({
          where: { tccId, tipo: 'VERSAO_FINAL', status: 'PENDENTE' },
          data: { status: 'REJEITADO', parecer: parecer ?? null },
        });
        if (rejeitaDoc.count < 1) {
          throw new BadRequestException({ mensagem: 'Não há versão final aguardando validação.' });
        }
      });
      await this.eventos.emitirParaUsuario('aluno_versao_final_rejeitada', tcc.alunoId, 'Versão final precisa de ajustes', `O orientador pediu ajustes na versão final do TCC "${tcc.titulo}".${parecer ? ' Devolutiva: ' + parecer : ''}`);
      await this.eventos.emitirParaUsuario('coorientador_documentos', tcc.coorientadorId, 'Versão final precisa de ajustes', `O orientador pediu ajustes na versão final do TCC "${tcc.titulo}" (no qual você é coorientador).`);
    }
    return { ok: true };
  }

  // Documentos da ABERTURA (plano + termo). Só na fase de solicitação e só esses dois tipos.
  async adicionarDocumento(alunoId: string, tccId: string, tipo: string, arquivo: any) {
    const tcc = await buscarTccAtivoOuFalhar(this.prisma, tccId);
    if (tcc.alunoId !== alunoId) throw new ForbiddenException();
    if (!['PLANO_DESENVOLVIMENTO', 'TERMO_ACEITE'].includes(tipo)) {
      throw new BadRequestException({ mensagem: 'Tipo de documento inválido.' });
    }
    if (tcc.faseAtual !== 'INICIALIZACAO') {
      throw new BadRequestException({ mensagem: 'Os documentos de abertura só podem ser enviados na solicitação.' });
    }
    // Mesmo prazo da abertura (ENVIO_DOCUMENTOS) bloqueia subir PLANO/TERMO fora do prazo sem
    // liberação individual — fecha o caminho de chamar a API direto. Escopo aluno+semestre.
    await this.prazos.exigirEtapaLiberada({ etapa: 'ENVIO_DOCUMENTOS', semestre: tcc.semestre, tccId: tcc.id, alunoId: tcc.alunoId });
    this.validarFormato(tipo, arquivo);
    const arq = await this.gravarArquivo(arquivo);
    try {
      // Transação: teto de documentos + criação atômicos (sem corrida entre uploads paralelos).
      return await this.prisma.$transaction(async (tx) => {
        await this.exigirEspacoParaDocumento(tx, tccId);
        return tx.documentoTcc.create({
          data: { tccId, tipo, status: 'PENDENTE', ...arq },
        });
      });
    } catch (e) {
      await fs.rm(join(process.cwd(), arq.caminho), { force: true }).catch(() => {});
      throw e;
    }
  }
}
