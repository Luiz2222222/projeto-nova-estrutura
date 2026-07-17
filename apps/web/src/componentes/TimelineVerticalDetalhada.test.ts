import { describe, expect, it } from 'vitest';
import { estadoAtual } from './TimelineVerticalDetalhada';

// Mapeamento fase -> subestado linear da timeline vertical (índices 0..13).
// Qualquer mudança acidental aqui desloca TODA a timeline — por isso o teste é exaustivo.
describe('estadoAtual — mapeamento das fases para a timeline vertical', () => {
  it('Inicialização: aguardando aceite (1) e recusada é problema', () => {
    expect(estadoAtual({ faseAtual: 'INICIALIZACAO' })).toEqual({ indice: 1, problema: false, concluido: false });
    expect(estadoAtual({ faseAtual: 'INICIALIZACAO', solicitacoes: [{ status: 'RECUSADA' }] }))
      .toEqual({ indice: 1, problema: true, concluido: false });
  });

  it('Desenvolvimento: antes da monografia aprovada fica no envio (2); depois, na continuidade (4)', () => {
    expect(estadoAtual({ faseAtual: 'DESENVOLVIMENTO' }).indice).toBe(2);
    expect(estadoAtual({ faseAtual: 'DESENVOLVIMENTO', monografiaAprovada: true }).indice).toBe(4);
  });

  it('Fase I: formação (5), avaliação (6), análise/validação (7)', () => {
    expect(estadoAtual({ faseAtual: 'FORMACAO_BANCA_FASE_1' }).indice).toBe(5);
    expect(estadoAtual({ faseAtual: 'AVALIACAO_FASE_1' }).indice).toBe(6);
    expect(estadoAtual({ faseAtual: 'AGUARDANDO_ANALISE_COORDENACAO_FASE_1' }).indice).toBe(7);
    expect(estadoAtual({ faseAtual: 'VALIDACAO_FASE_1' }).indice).toBe(7);
  });

  it('Fase II: agendamento da defesa (8), avaliação (9), análise/validação (10)', () => {
    expect(estadoAtual({ faseAtual: 'AGENDAMENTO_DEFESA_FASE_2' }).indice).toBe(8);
    expect(estadoAtual({ faseAtual: 'AVALIACAO_FASE_2' }).indice).toBe(9);
    expect(estadoAtual({ faseAtual: 'AGUARDANDO_ANALISE_COORDENACAO_FASE_2' }).indice).toBe(10);
    expect(estadoAtual({ faseAtual: 'VALIDACAO_FASE_2' }).indice).toBe(10);
  });

  it('Finalização: versão final (11), validação do orientador (12), concluído (13)', () => {
    expect(estadoAtual({ faseAtual: 'AGUARDANDO_AJUSTES_FINAIS' }).indice).toBe(11);
    expect(estadoAtual({ faseAtual: 'VALIDACAO_VERSAO_FINAL' }).indice).toBe(12);
    expect(estadoAtual({ faseAtual: 'CONCLUIDO' })).toEqual({ indice: 13, problema: false, concluido: true });
  });

  it('estados-problema apontam para o subestado certo', () => {
    expect(estadoAtual({ faseAtual: 'REPROVADO_FASE_1' })).toEqual({ indice: 7, problema: true, concluido: false });
    expect(estadoAtual({ faseAtual: 'REPROVADO_FASE_2' })).toEqual({ indice: 10, problema: true, concluido: false });
    expect(estadoAtual({ faseAtual: 'DESCONTINUADO' })).toEqual({ indice: 4, problema: true, concluido: false });
  });

  it('fase desconhecida cai no início sem quebrar', () => {
    expect(estadoAtual({ faseAtual: 'INVENTADA' })).toEqual({ indice: 0, problema: false, concluido: false });
    expect(estadoAtual(null)).toEqual({ indice: 0, problema: false, concluido: false });
  });
});
