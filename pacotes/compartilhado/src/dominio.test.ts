import { describe, it, expect } from 'vitest';
import {
  FASES,
  FASES_TERMINAIS_RUINS,
  INDICE_FASE,
  ROTULO_FASE,
  indiceFase,
  mediaNotas,
  notaFinal,
  aprovadoFase1,
  aprovadoFinal,
  CRITERIOS_FASE1,
  CRITERIOS_FASE2,
  colunaPeso,
  colunaNota,
  soma,
  pesosSomam10,
} from './dominio';

describe('fases', () => {
  it('toda fase tem rótulo (pega o bug de fase nova sem rótulo)', () => {
    for (const f of FASES) {
      expect(ROTULO_FASE[f], `faltou rótulo para ${f}`).toBeTruthy();
    }
  });

  it('toda fase de progresso tem índice na trilha; terminais ruins não', () => {
    for (const f of FASES) {
      if (FASES_TERMINAIS_RUINS.includes(f)) {
        expect(indiceFase(f), `${f} não devia ter índice`).toBeNull();
      } else {
        expect(typeof INDICE_FASE[f], `faltou índice para ${f}`).toBe('number');
      }
    }
  });

  it('Fase II (avaliação/validação) cai no índice 3 — regressão do bug', () => {
    expect(indiceFase('AVALIACAO_FASE_2')).toBe(3);
    expect(indiceFase('VALIDACAO_FASE_2')).toBe(3);
    expect(ROTULO_FASE['AVALIACAO_FASE_2']).toBe('Avaliação — Fase II');
    expect(ROTULO_FASE['VALIDACAO_FASE_2']).toBe('Validação — Fase II');
  });

  it('Agendamento da defesa (Fase II) tem índice 3 e rótulo próprio', () => {
    expect(indiceFase('AGENDAMENTO_DEFESA_FASE_2')).toBe(3);
    expect(ROTULO_FASE['AGENDAMENTO_DEFESA_FASE_2']).toBe('Agendamento da defesa — Fase II');
  });

  it('indiceFase devolve null para fase desconhecida', () => {
    expect(indiceFase('FASE_INEXISTENTE')).toBeNull();
  });
});

describe('notas', () => {
  it('média', () => {
    expect(mediaNotas([9, 8, 10])).toBe(9);
    expect(mediaNotas([9, 7])).toBe(8);
    expect(mediaNotas([])).toBe(0);
  });

  it('nota final ponderada NF = 0,6·NF1 + 0,4·NF2', () => {
    expect(notaFinal(8, 9)).toBeCloseTo(8.4, 10);
    expect(notaFinal(6, 10)).toBeCloseTo(7.6, 10);
    expect(notaFinal(10, 10)).toBe(10);
  });

  it('cortes de aprovação (Fase I ≥6, final ≥7)', () => {
    expect(aprovadoFase1(6)).toBe(true);
    expect(aprovadoFase1(5.9)).toBe(false);
    expect(aprovadoFinal(7)).toBe(true);
    expect(aprovadoFinal(6.99)).toBe(false);
  });
});

describe('critérios e pesos', () => {
  it('cada fase tem 5 critérios e os pesos padrão somam 10', () => {
    expect(CRITERIOS_FASE1).toHaveLength(5);
    expect(CRITERIOS_FASE2).toHaveLength(5);
    expect(pesosSomam10(CRITERIOS_FASE1.map((c) => c.pesoPadrao))).toBe(true);
    expect(pesosSomam10(CRITERIOS_FASE2.map((c) => c.pesoPadrao))).toBe(true);
  });

  it('colunaPeso/colunaNota derivam o nome da coluna da chave', () => {
    expect(colunaPeso('resumo')).toBe('pesoResumo');
    expect(colunaNota('resumo')).toBe('notaResumo');
    expect(colunaPeso('observancia')).toBe('pesoObservancia');
    expect(colunaNota('clareza')).toBe('notaClareza');
  });

  it('pesosSomam10 tolera ponto flutuante e rejeita somas erradas', () => {
    expect(soma([1, 2, 2, 3.5, 1.5])).toBeCloseTo(10, 10);
    expect(pesosSomam10([2, 2, 2, 2, 2])).toBe(true);
    expect(pesosSomam10([2, 2, 2, 2, 3])).toBe(false);
  });
});
