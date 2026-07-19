// Ações pendentes de VALIDAÇÃO/REENVIO do dashboard do coordenador (lógica pura,
// testável). Regra anti-duplicação: quando um TCC/fase tem reenvio(s) pós-ajuste
// aguardando decisão (ajusteReenviadoEm), aparece SÓ o card consolidado de reenvio —
// o genérico "Validar avaliações" fica escondido e volta quando os reenvios forem
// decididos (campo limpo pelo backend) com a fase ainda em validação.
import type { MembroBanca, TccResumo } from '../tipos';

export interface AcaoPendente {
  id: string;
  cor: string;
  titulo: string;
  sub: string;
  link: string;
}

const nomeDe = (m: MembroBanca): string =>
  m.avaliador ? `${m.avaliador.tratamento ? m.avaliador.tratamento + ' ' : ''}${m.avaliador.nomeCompleto}` : 'Avaliador';

export function acoesValidacaoReenvio(tccs: TccResumo[]): AcaoPendente[] {
  const items: AcaoPendente[] = [];
  for (const t of tccs) {
    const aluno = t.aluno?.nomeCompleto ?? '—';
    for (const fase of ['FASE_1', 'FASE_2'] as const) {
      const ehF1 = fase === 'FASE_1';
      const faseNome = ehF1 ? 'Fase I' : 'Fase II';
      const emValidacao = t.faseAtual === (ehF1 ? 'VALIDACAO_FASE_1' : 'VALIDACAO_FASE_2');
      // A ação de reenvio SÓ existe com o TCC na validação correspondente: marca antiga
      // de ajusteReenviadoEm num TCC movido de fase (edição administrativa) não gera card.
      if (!emValidacao) continue;
      const banca = (t.bancas ?? []).find((b) => b.fase === fase);
      const reenviados = (banca?.membros ?? []).filter((m) => m.ajusteReenviadoEm);
      if (reenviados.length > 0) {
        // UM card consolidado por TCC+fase, dizendo QUEM reenviou.
        items.push({
          id: `reenv-${t.id}-${fase}`,
          cor: 'amarelo',
          titulo: `${reenviados.length > 1 ? 'Avaliações reenviadas' : 'Avaliação reenviada'} — ${faseNome}`,
          sub: `${reenviados.map(nomeDe).join(', ')} · ${aluno} · ${t.titulo}`,
          link: `/coordenador/tccs/${t.id}#validacao`,
        });
      } else if (emValidacao) {
        items.push({
          id: (ehF1 ? 'v1' : 'v2') + t.id,
          cor: ehF1 ? 'azul' : 'verde',
          titulo: `Validar avaliações — ${faseNome}`,
          sub: `${aluno} · ${t.titulo}`,
          link: `/coordenador/tccs/${t.id}#validacao`,
        });
      }
    }
  }
  return items;
}
