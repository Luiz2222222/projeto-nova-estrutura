import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventosTccService } from '../eventos-tcc/eventos-tcc.service';
import { buscarTccAtivoOuFalhar } from '../comum/tcc-ativo';
import { type DadosAgendarDefesa } from '@tcc/compartilhado';

// Data/hora da defesa nos avisos: sempre pt-BR no fuso oficial do curso (America/Fortaleza);
// no banco a data fica em UTC.
function formatarDefesa(d: Date): string {
  const data = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Fortaleza', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
  const hora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Fortaleza', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return `${data} às ${hora}`;
}

// Agendamento e liberação da DEFESA (Fase II) — extraído do BancasService por coesão:
// este serviço cuida SÓ de marcar/alterar a defesa, liberar a avaliação na hora certa
// (idempotente) e avisar os envolvidos. Avaliação/validação seguem no BancasService.
@Injectable()
export class DefesasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventos: EventosTccService,
  ) {}

  // ORIENTADOR (do próprio TCC) ou COORDENADOR agenda (ou reagenda) a defesa: data/hora +
  // local + comentário — mesmas validações e mesmos avisos para os dois papéis. Pode marcar
  // QUALQUER data, inclusive passada — o calendário não bloqueia o agendamento (ele segue
  // valendo só como prazo final do envio das avaliações da Fase II). Data já vencida →
  // avaliação liberada imediatamente; data futura → o agendador libera na hora marcada.
  // Não existe rota que "libere" manualmente: a liberação continua automática na data.
  // Reagendar após a liberação só atualiza os dados e avisa todo mundo — NUNCA regride a
  // fase nem volta a bloquear avaliações.
  async agendarDefesa(usuario: { sub: string; papel: string }, tccId: string, dados: DadosAgendarDefesa) {
    const tcc = await buscarTccAtivoOuFalhar(this.prisma, tccId);
    if (usuario.papel !== 'COORDENADOR' && tcc.orientadorId !== usuario.sub) throw new ForbiddenException();
    // PRIMEIRO agendamento: só na fase própria (AGENDAMENTO_DEFESA_FASE_2). Depois disso o
    // orientador pode ALTERAR quando quiser (inclusive em análise/validação da coordenação),
    // mas SOMENTE se já existe defesa marcada — barra chamada direta à API "inventando"
    // defesa em TCC concluído/reprovado que nunca teve uma (dispararia avisos indevidos).
    // A alteração nunca regride a fase — a liberação só dispara se o TCC ainda aguarda.
    if (tcc.faseAtual !== 'AGENDAMENTO_DEFESA_FASE_2' && !tcc.defesaAgendadaPara) {
      throw new BadRequestException({ mensagem: 'Este TCC não está aguardando agendamento e não tem defesa marcada para alterar.' });
    }
    // Guarda: sem banca da Fase II (ou sem membros) a liberação deixaria o TCC preso em
    // AVALIACAO_FASE_2 sem avaliadores. validar() da Fase I cria a banca; isto barra
    // estados vindos de mexida administrativa/manual.
    const banca = await this.prisma.banca.findUnique({
      where: { tccId_fase: { tccId, fase: 'FASE_2' } },
      include: { membros: true },
    });
    if (!banca || banca.membros.length === 0) {
      throw new BadRequestException({ mensagem: 'A banca da Fase II não está formada — peça à coordenação para corrigir a banca antes de agendar a defesa.' });
    }
    const quando = new Date(dados.dataHora); // ISO → UTC no banco
    const reagendamento = !!tcc.defesaAgendadaEm;
    await this.prisma.tcc.update({
      where: { id: tccId },
      data: {
        defesaAgendadaPara: quando,
        defesaLocal: dados.local,
        defesaComentario: dados.comentario?.trim() ? dados.comentario.trim() : null,
        defesaAgendadaEm: new Date(),
      },
    });
    await this.notificarDefesaAgendada(tccId, reagendamento);
    const liberadaAgora = await this.liberarDefesaSeVencida(tccId);
    return { ok: true, liberada: liberadaAgora || !!tcc.defesaLiberadaEm };
  }

  // Liberação automática e IDEMPOTENTE da avaliação da Fase II: um único updateMany
  // condicional (fase + defesaLiberadaEm null + horário vencido) garante que agendador,
  // reagendamento e requisições simultâneas nunca liberem nem notifiquem duas vezes.
  async liberarDefesaSeVencida(tccId: string): Promise<boolean> {
    const agora = new Date();
    const r = await this.prisma.tcc.updateMany({
      where: {
        id: tccId,
        excluidoEm: null,
        faseAtual: 'AGENDAMENTO_DEFESA_FASE_2',
        defesaLiberadaEm: null,
        defesaAgendadaPara: { lte: agora },
      },
      data: { faseAtual: 'AVALIACAO_FASE_2', defesaLiberadaEm: agora },
    });
    if (r.count !== 1) return false;
    await this.notificarDefesaLiberada(tccId);
    return true;
  }

  // Varredura das defesas com horário vencido — chamada pelo agendador na inicialização
  // e a cada minuto, para liberar mesmo sem ninguém com a tela aberta.
  async liberarDefesasVencidas(): Promise<number> {
    const pendentes = await this.prisma.tcc.findMany({
      where: { excluidoEm: null, faseAtual: 'AGENDAMENTO_DEFESA_FASE_2', defesaLiberadaEm: null, defesaAgendadaPara: { lte: new Date() } },
      select: { id: true },
    });
    let liberadas = 0;
    for (const t of pendentes) if (await this.liberarDefesaSeVencida(t.id)) liberadas += 1;
    return liberadas;
  }

  // Avisos do agendamento/reagendamento: aluno, coorientador INTERNO (externo não tem
  // conta nem e-mail), coordenadores e todos os membros da banca F2 (inclui o orientador),
  // cada um UMA vez, com link para a própria área. Sem notas em nenhuma mensagem.
  private async notificarDefesaAgendada(tccId: string, reagendamento: boolean) {
    const tcc = await this.prisma.tcc.findUnique({
      where: { id: tccId },
      include: { bancas: { where: { fase: 'FASE_2' }, include: { membros: { include: { avaliador: { select: { id: true, papel: true } } } } } } },
    });
    if (!tcc?.defesaAgendadaPara) return;
    const titulo = reagendamento ? 'Defesa reagendada' : 'Defesa agendada';
    const detalhes =
      `Defesa do TCC "${tcc.titulo}" agendada para ${formatarDefesa(tcc.defesaAgendadaPara)}. Local: ${tcc.defesaLocal}.` +
      (tcc.defesaComentario ? ` Comentário: ${tcc.defesaComentario}` : '');
    const enviados = new Set<string>();
    const enviar = async (uid: string | null | undefined, link: string) => {
      if (!uid || enviados.has(uid)) return;
      enviados.add(uid);
      await this.eventos.emitirParaUsuario('defesa_agendada', uid, titulo, detalhes, link);
    };
    await enviar(tcc.alunoId, '/aluno/meu-tcc');
    await enviar(tcc.coorientadorId, '/coorientacoes');
    for (const m of tcc.bancas[0]?.membros ?? []) {
      const link = m.avaliadorId === tcc.orientadorId
        ? `/professor/orientandos/${tcc.id}`
        : `${m.avaliador.papel === 'AVALIADOR' ? '/avaliador/bancas' : '/professor/bancas'}/${m.id}`;
      await enviar(m.avaliadorId, link);
    }
    await this.eventos.emitirParaCoordenadores('defesa_agendada', titulo, detalhes, `/coordenador/tccs/${tcc.id}`);
  }

  // A banca é avisada de que a avaliação abriu (sem notas), com link direto por membro.
  private async notificarDefesaLiberada(tccId: string) {
    const tcc = await this.prisma.tcc.findUnique({
      where: { id: tccId },
      include: { bancas: { where: { fase: 'FASE_2' }, include: { membros: { include: { avaliador: { select: { id: true, papel: true } } } } } } },
    });
    if (!tcc) return;
    for (const m of tcc.bancas[0]?.membros ?? []) {
      // O ORIENTADOR avalia a Fase II na página do orientando (não em "Participações em
      // bancas") — o link dele aponta para lá; os demais vão direto para a avaliação.
      const base = m.avaliador.papel === 'AVALIADOR' ? '/avaliador/bancas' : '/professor/bancas';
      const link = m.avaliadorId === tcc.orientadorId ? `/professor/orientandos/${tcc.id}#acao-fase2` : `${base}/${m.id}`;
      await this.eventos.emitirParaUsuario('avaliador_fase2_liberada', m.avaliadorId, 'Avaliação da Fase II liberada', `A defesa do TCC "${tcc.titulo}" aconteceu — a avaliação da Fase II está liberada, você já pode avaliar.`, link);
    }
  }
}
