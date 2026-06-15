import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Notificações internas (sino). Separado do e-mail e das preferências de e-mail.
// Todas as operações são escopadas ao usuário dono (ninguém vê/altera a de outro).
@Injectable()
export class NotificacoesService {
  private readonly logger = new Logger('NotificacoesService');

  constructor(private readonly prisma: PrismaService) {}

  // Cria uma notificação. NUNCA lança — uma falha aqui não pode quebrar o fluxo.
  async criar(usuarioId: string | null | undefined, evento: string, titulo: string, mensagem: string, link?: string | null) {
    if (!usuarioId) return;
    try {
      await this.prisma.notificacao.create({
        data: { usuarioId, evento, titulo, mensagem, link: link ?? this.linkPadrao(evento) },
      });
    } catch (e) {
      this.logger.error(`Falha ao criar notificação "${evento}" para ${usuarioId}: ${(e as Error).message}`);
    }
  }

  // Link interno padrão por tipo de evento (leva o usuário à tela relacionada).
  private linkPadrao(evento: string): string | null {
    if (evento.startsWith('aluno_')) return '/aluno/meu-tcc';
    if (evento.startsWith('orientador_')) return '/professor/orientandos';
    if (evento === 'coord_nova_solicitacao') return '/coordenador/solicitacoes';
    if (evento.startsWith('coord_')) return '/coordenador/tccs';
    if (evento.startsWith('avaliador_')) return '/bancas';
    if (evento.startsWith('coorientador_')) return '/coorientacoes';
    return null;
  }

  listar(usuarioId: string) {
    return this.prisma.notificacao.findMany({
      where: { usuarioId },
      orderBy: { criadoEm: 'desc' },
      take: 30,
    });
  }

  async contarNaoLidas(usuarioId: string) {
    const total = await this.prisma.notificacao.count({ where: { usuarioId, lida: false } });
    return { total };
  }

  // updateMany/deleteMany com usuarioId no where garante que só o dono altera a própria.
  async marcarLida(id: string, usuarioId: string) {
    await this.prisma.notificacao.updateMany({
      where: { id, usuarioId, lida: false },
      data: { lida: true, lidaEm: new Date() },
    });
    return { ok: true };
  }

  async marcarTodasLidas(usuarioId: string) {
    await this.prisma.notificacao.updateMany({
      where: { usuarioId, lida: false },
      data: { lida: true, lidaEm: new Date() },
    });
    return { ok: true };
  }

  async apagar(id: string, usuarioId: string) {
    await this.prisma.notificacao.deleteMany({ where: { id, usuarioId } });
    return { ok: true };
  }
}
