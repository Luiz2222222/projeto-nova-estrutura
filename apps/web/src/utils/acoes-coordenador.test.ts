import { describe, expect, it } from 'vitest';
import { acoesValidacaoReenvio } from './acoes-coordenador';
import type { Tcc } from '../tipos';

// Anti-duplicação: um TCC/fase com reenvio pós-ajuste pendente mostra SÓ o card
// consolidado de reenvio — nunca junto do genérico "Validar avaliações".
function tccEmValidacao(fase: 'FASE_1' | 'FASE_2', reenviados: Array<{ nome: string; quando: string | null }>): Tcc {
  return {
    id: 't1',
    titulo: 'TCC teste',
    faseAtual: fase === 'FASE_1' ? 'VALIDACAO_FASE_1' : 'VALIDACAO_FASE_2',
    aluno: { id: 'a1', nomeCompleto: 'Aluna Um' },
    bancas: [
      {
        id: 'b1',
        fase,
        membros: reenviados.map((r, i) => ({
          id: `m${i}`,
          avaliadorId: `av${i}`,
          status: 'ENVIADO',
          ajusteReenviadoEm: r.quando,
          avaliador: { id: `av${i}`, nomeCompleto: r.nome, tratamento: 'Prof. Dr.' },
        })),
      },
    ],
  };
}

describe('acoesValidacaoReenvio — cards do dashboard do coordenador', () => {
  it('fase em validação SEM reenvio → só o card genérico "Validar avaliações"', () => {
    const acoes = acoesValidacaoReenvio([tccEmValidacao('FASE_1', [{ nome: 'Maria', quando: null }])]);
    expect(acoes).toHaveLength(1);
    expect(acoes[0].titulo).toBe('Validar avaliações — Fase I');
  });

  it('UM reenvio pendente → só o card "Avaliação reenviada" (sem duplicar com o genérico)', () => {
    const acoes = acoesValidacaoReenvio([
      tccEmValidacao('FASE_1', [{ nome: 'Maria Silva', quando: '2026-07-18T10:00:00Z' }, { nome: 'José', quando: null }]),
    ]);
    expect(acoes).toHaveLength(1); // NUNCA dois cards para o mesmo TCC/fase
    expect(acoes[0].titulo).toBe('Avaliação reenviada — Fase I');
    expect(acoes[0].sub).toContain('Maria Silva'); // diz quem reenviou
    expect(acoes[0].sub).toContain('Aluna Um');
    expect(acoes[0].sub).toContain('TCC teste');
    expect(acoes[0].link).toBe('/coordenador/tccs/t1#validacao');
  });

  it('DOIS reenvios pendentes → um único card no plural com os dois nomes', () => {
    const acoes = acoesValidacaoReenvio([
      tccEmValidacao('FASE_2', [
        { nome: 'Maria Silva', quando: '2026-07-18T10:00:00Z' },
        { nome: 'José Souza', quando: '2026-07-18T11:00:00Z' },
      ]),
    ]);
    expect(acoes).toHaveLength(1);
    expect(acoes[0].titulo).toBe('Avaliações reenviadas — Fase II');
    expect(acoes[0].sub).toContain('Maria Silva');
    expect(acoes[0].sub).toContain('José Souza');
  });

  it('todos os reenvios decididos (campo limpo) e fase ainda em validação → genérico volta', () => {
    const acoes = acoesValidacaoReenvio([
      tccEmValidacao('FASE_2', [{ nome: 'Maria', quando: null }, { nome: 'José', quando: null }]),
    ]);
    expect(acoes).toHaveLength(1);
    expect(acoes[0].titulo).toBe('Validar avaliações — Fase II');
  });

  it('fora da validação e sem reenvio → nenhuma ação desta família', () => {
    const t = tccEmValidacao('FASE_1', [{ nome: 'Maria', quando: null }]);
    t.faseAtual = 'AVALIACAO_FASE_1';
    expect(acoesValidacaoReenvio([t])).toHaveLength(0);
  });

  it('marca ANTIGA de reenvio com o TCC movido de fase (edição administrativa) → nenhuma ação', () => {
    // ajusteReenviadoEm ficou para trás, mas o TCC não está mais em validação.
    const t = tccEmValidacao('FASE_1', [{ nome: 'Maria Silva', quando: '2026-07-18T10:00:00Z' }]);
    for (const fase of ['AVALIACAO_FASE_1', 'AGENDAMENTO_DEFESA_FASE_2', 'CONCLUIDO', 'DESENVOLVIMENTO']) {
      t.faseAtual = fase;
      expect(acoesValidacaoReenvio([t]), `fase ${fase}`).toHaveLength(0);
    }
    // Voltando à validação correspondente, o card consolidado reaparece.
    t.faseAtual = 'VALIDACAO_FASE_1';
    expect(acoesValidacaoReenvio([t])).toHaveLength(1);
    expect(acoesValidacaoReenvio([t])[0].titulo).toBe('Avaliação reenviada — Fase I');
  });
});
