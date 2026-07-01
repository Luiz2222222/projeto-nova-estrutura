// Período/semestre ATIVO do sistema — definido MANUALMENTE pela coordenação e persistido.
// O sistema NÃO troca de semestre sozinho pela data do relógio (isso causava listas vazias
// ao virar julho/dezembro). A data só serve como default inicial, uma única vez.
import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

const ID_CONFIG = 'global';
export const FORMATO_SEMESTRE = /^\d{4}\.[12]$/; // AAAA.1 ou AAAA.2

// Semestre pela data — usado APENAS como default inicial (nunca troca sozinho depois).
export function semestrePorData(d = new Date()): string {
  const s = d.getMonth() + 1 <= 6 ? 1 : 2;
  return `${d.getFullYear()}.${s}`;
}

// Semestre ativo persistido. Se ainda não houver configuração, apura um default inicial
// (calendário mais recente; senão a data) e PERSISTE — daí em diante respeita só o manual.
export async function resolverSemestreAtivo(prisma: PrismaService): Promise<string> {
  const cfg = await prisma.configuracaoSistema.findUnique({ where: { id: ID_CONFIG } });
  if (cfg?.semestreAtivo) return cfg.semestreAtivo;

  const [calRecente] = await prisma.calendario.findMany({ orderBy: { semestre: 'desc' }, take: 1 });
  const inicial = calRecente?.semestre ?? semestrePorData();
  await prisma.configuracaoSistema.upsert({
    where: { id: ID_CONFIG },
    update: { semestreAtivo: inicial },
    create: { id: ID_CONFIG, semestreAtivo: inicial },
  });
  return inicial;
}

// Define o semestre ativo (validando o formato AAAA.1 / AAAA.2). NÃO altera TCCs existentes.
export async function gravarSemestreAtivo(prisma: PrismaService, semestre: string): Promise<string> {
  const limpo = (semestre ?? '').trim();
  if (!FORMATO_SEMESTRE.test(limpo)) {
    throw new BadRequestException({
      mensagem: 'Período inválido. Use o formato AAAA.1 ou AAAA.2 (ex.: 2026.1).',
      erros: [{ campo: 'semestre', mensagem: 'Formato esperado: AAAA.1 ou AAAA.2' }],
    });
  }
  const cfg = await prisma.configuracaoSistema.upsert({
    where: { id: ID_CONFIG },
    update: { semestreAtivo: limpo },
    create: { id: ID_CONFIG, semestreAtivo: limpo },
  });
  return cfg.semestreAtivo!;
}
