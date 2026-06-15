import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { NotificacoesService } from '../notificacoes/notificacoes.service';

// Camada central de eventos do fluxo do TCC ("webhook interno").
// O fluxo (tccs/bancas) só EMITE eventos aqui; este serviço reage chamando
// e-mail e notificação interna. Falha em e-mail/notificação NUNCA quebra o fluxo
// (enviarEvento e criar já tratam os próprios erros).
@Injectable()
export class EventosTccService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly notificacoes: NotificacoesService,
  ) {}

  // Emite um evento para um usuário específico: e-mail (com gate global +
  // preferência individual) + notificação interna (link derivado do evento).
  async emitirParaUsuario(evento: string, usuarioId: string | null | undefined, titulo: string, mensagem: string, link?: string | null) {
    if (!usuarioId) return;
    const p = await this.prisma.usuario.findUnique({ where: { id: usuarioId }, select: { id: true, email: true, nomeCompleto: true } });
    if (p) await this.email.enviarEvento(evento, p, titulo, mensagem);
    await this.notificacoes.criar(usuarioId, evento, titulo, mensagem, link ?? undefined);
  }

  // Emite um evento para todos os coordenadores.
  async emitirParaCoordenadores(evento: string, titulo: string, mensagem: string, link?: string | null) {
    const coords = await this.prisma.usuario.findMany({ where: { papel: 'COORDENADOR' }, select: { id: true, email: true, nomeCompleto: true } });
    for (const c of coords) {
      await this.email.enviarEvento(evento, c, titulo, mensagem);
      await this.notificacoes.criar(c.id, evento, titulo, mensagem, link ?? undefined);
    }
  }
}
