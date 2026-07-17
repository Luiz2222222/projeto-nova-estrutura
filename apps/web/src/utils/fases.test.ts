import { describe, expect, it } from 'vitest';
import { FASES } from '@tcc/compartilhado';
import { chipsTrilha, formatarDefesa, mostrarVersaoFinal, notasTrilhaTcc, subfaseTcc } from './fases';

describe('subfaseTcc — status visível de cada fase', () => {
  it('INICIALIZACAO varia conforme a solicitação', () => {
    expect(subfaseTcc({ faseAtual: 'INICIALIZACAO', solicitacoes: [{ status: 'PENDENTE' }] })).toBe('Aguardando aprovação do coordenador');
    expect(subfaseTcc({ faseAtual: 'INICIALIZACAO', solicitacoes: [{ status: 'RECUSADA' }] })).toBe('Abertura recusada');
    expect(subfaseTcc({ faseAtual: 'INICIALIZACAO' })).toBe('Aguardando aceite/aprovação');
  });

  it('DESENVOLVIMENTO compõe monografia + continuidade (trilhas paralelas)', () => {
    expect(subfaseTcc({ faseAtual: 'DESENVOLVIMENTO' })).toBe('Aguardando monografia e continuidade');
    expect(subfaseTcc({ faseAtual: 'DESENVOLVIMENTO', monografiaAprovada: true })).toBe('Aguardando confirmação de continuidade');
    expect(subfaseTcc({ faseAtual: 'DESENVOLVIMENTO', continuidadeConfirmada: true })).toBe('Aguardando aprovação da monografia');
    expect(subfaseTcc({ faseAtual: 'DESENVOLVIMENTO', monografiaAprovada: true, continuidadeConfirmada: true })).toBe('Pronto para a Fase I');
  });

  it('AGENDAMENTO_DEFESA_FASE_2 muda quando a defesa é marcada', () => {
    expect(subfaseTcc({ faseAtual: 'AGENDAMENTO_DEFESA_FASE_2' })).toBe('Aguardando agendamento da defesa');
    expect(subfaseTcc({ faseAtual: 'AGENDAMENTO_DEFESA_FASE_2', defesaAgendadaPara: '2026-07-17T05:04:00.000Z' }))
      .toBe('Defesa agendada para 17/07/2026 às 02:04');
  });

  it('demais fases têm status fixo e nenhuma fase fica sem texto', () => {
    expect(subfaseTcc({ faseAtual: 'FORMACAO_BANCA_FASE_1' })).toBe('Formação da banca');
    expect(subfaseTcc({ faseAtual: 'AVALIACAO_FASE_1' })).toBe('Avaliação da banca');
    expect(subfaseTcc({ faseAtual: 'AGUARDANDO_ANALISE_COORDENACAO_FASE_1' })).toBe('Aguardando análise da coordenação');
    expect(subfaseTcc({ faseAtual: 'VALIDACAO_FASE_1' })).toBe('Validação da Fase I');
    expect(subfaseTcc({ faseAtual: 'AVALIACAO_FASE_2' })).toBe('Avaliação da banca');
    expect(subfaseTcc({ faseAtual: 'AGUARDANDO_ANALISE_COORDENACAO_FASE_2' })).toBe('Aguardando análise da coordenação');
    expect(subfaseTcc({ faseAtual: 'VALIDACAO_FASE_2' })).toBe('Validação da Fase II');
    expect(subfaseTcc({ faseAtual: 'AGUARDANDO_AJUSTES_FINAIS' })).toBe('Envio da versão final');
    expect(subfaseTcc({ faseAtual: 'VALIDACAO_VERSAO_FINAL' })).toBe('Versão final aguardando orientador');
    expect(subfaseTcc({ faseAtual: 'CONCLUIDO' })).toBe('Aprovado');
    expect(subfaseTcc({ faseAtual: 'REPROVADO_FASE_1' })).toBe('Reprovado na Fase I');
    expect(subfaseTcc({ faseAtual: 'REPROVADO_FASE_2' })).toBe('Reprovado na Fase II');
    expect(subfaseTcc({ faseAtual: 'DESCONTINUADO' })).toBe('Descontinuado');
    // Toda fase do domínio tem um texto de status (nenhuma cai no '' silenciosamente).
    for (const f of FASES) {
      expect(subfaseTcc({ faseAtual: f }), `fase sem status: ${f}`).not.toBe('');
    }
  });
});

describe('notasTrilhaTcc — visibilidade das notas', () => {
  const tcc = { nf1: 8.5, nf2: 7, nf: null, faseAtual: 'AGUARDANDO_ANALISE_COORDENACAO_FASE_2' };

  it('coordenador vê NF1/NF2 assim que existem, antes da nota final', () => {
    expect(notasTrilhaTcc(tcc, true)).toEqual({ fase1: 8.5, fase2: 7, final: null });
  });

  it('aluno/orientador/coorientador NÃO veem nada antes da nota final confirmada', () => {
    expect(notasTrilhaTcc(tcc, false)).toEqual({});
  });

  it('depois da nota final confirmada, todos veem', () => {
    expect(notasTrilhaTcc({ ...tcc, nf: 7.9, faseAtual: 'CONCLUIDO' }, false)).toEqual({ fase1: 8.5, fase2: 7, final: 7.9 });
  });

  it('reprovação terminal libera as notas mesmo sem nota final (critério do backend)', () => {
    expect(notasTrilhaTcc({ nf1: 4, nf2: null, nf: null, faseAtual: 'REPROVADO_FASE_1' }, false)).toEqual({ fase1: 4, fase2: null, final: null });
    expect(notasTrilhaTcc({ nf1: 8, nf2: 3, nf: null, faseAtual: 'REPROVADO_FASE_2' }, false)).toEqual({ fase1: 8, fase2: 3, final: null });
  });
});

describe('chipsTrilha — trilhas paralelas do Desenvolvimento', () => {
  it('fora do Desenvolvimento não há chips', () => {
    expect(chipsTrilha({ faseAtual: 'AVALIACAO_FASE_1' })).toEqual([]);
  });

  it('no Desenvolvimento mostra monografia + continuidade com estados coerentes', () => {
    const chips = chipsTrilha({
      faseAtual: 'DESENVOLVIMENTO',
      monografiaAprovada: false,
      continuidadeConfirmada: true,
      documentos: [{ tipo: 'MONOGRAFIA', versao: 1, status: 'PENDENTE' }],
    });
    expect(chips).toEqual([
      { texto: 'Monografia em análise', estado: 'pendente' },
      { texto: 'Continuidade confirmada', estado: 'ok' },
    ]);
  });

  it('monografia rejeitada vira alerta de ajustes', () => {
    const chips = chipsTrilha({
      faseAtual: 'DESENVOLVIMENTO',
      documentos: [{ tipo: 'MONOGRAFIA', versao: 2, status: 'REJEITADO' }],
    });
    expect(chips[0]).toEqual({ texto: 'Ajustes na monografia', estado: 'alerta' });
  });
});

describe('mostrarVersaoFinal', () => {
  it('só nas fases finais ou quando já existe documento', () => {
    expect(mostrarVersaoFinal('AGUARDANDO_AJUSTES_FINAIS')).toBe(true);
    expect(mostrarVersaoFinal('VALIDACAO_VERSAO_FINAL')).toBe(true);
    expect(mostrarVersaoFinal('CONCLUIDO')).toBe(true);
    expect(mostrarVersaoFinal('AVALIACAO_FASE_2')).toBe(false);
    expect(mostrarVersaoFinal('AVALIACAO_FASE_2', true)).toBe(true);
    expect(mostrarVersaoFinal(null)).toBe(false);
  });
});

describe('formatarDefesa', () => {
  it('formata em pt-BR no fuso de Fortaleza', () => {
    expect(formatarDefesa('2026-07-17T05:04:00.000Z')).toBe('17/07/2026 às 02:04');
  });

  it('entrada ausente ou inválida vira travessão', () => {
    expect(formatarDefesa(null)).toBe('—');
    expect(formatarDefesa(undefined)).toBe('—');
    expect(formatarDefesa('não-é-data')).toBe('—');
  });
});
