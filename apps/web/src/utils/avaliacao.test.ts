import { describe, expect, it } from 'vitest';
import { avaliacaoEntregue, resumoBanca } from './avaliacao';
import { contemBusca, normalizarBusca } from './texto';

// Item "médias parciais": a média só é OFICIAL com a banca completa (F1 = 2 membros,
// F2 = 3) e apenas com avaliações efetivamente ENTREGUES — nota + status entregue.
// PENDENTE/AJUSTE_SOLICITADO nunca contam, mesmo carregando nota antiga.
describe('resumoBanca — banca incompleta nunca vira nota oficial', () => {
  const enviado = (nota: number) => ({ nota, status: 'ENVIADO' });
  const pendente = (nota: number | null = null) => ({ nota, status: 'PENDENTE' });

  it('Fase I 0/2: sem média ("—"), incompleta e resultado Pendente', () => {
    const r = resumoBanca([pendente(), pendente()]);
    expect(r).toEqual({ enviadas: 0, esperadas: 2, completa: false, media: null });
  });

  it('Fase I 1/2: PREVISÃO divide pelo TOTAL esperado (8,7 → 4,35 / 10)', () => {
    const r = resumoBanca([enviado(8.7), pendente()]);
    expect(r.enviadas).toBe(1);
    expect(r.esperadas).toBe(2);
    expect(r.completa).toBe(false);
    expect(r.media).toBeCloseTo(4.35, 10); // 8,7 ÷ 2 — quem não enviou entra como zero
  });

  it('Fase I 2/2: completa, média oficial normal', () => {
    const r = resumoBanca([enviado(8), enviado(9)]);
    expect(r.completa).toBe(true);
    expect(r.media).toBe(8.5); // (8+9) ÷ 2 — com banca completa é a média de verdade
  });

  it('Fase II 1/3 e 2/3 dividem por 3; 3/3 vira média oficial', () => {
    expect(resumoBanca([pendente(), pendente(), pendente()]).media).toBeNull();
    expect(resumoBanca([enviado(7), pendente(), pendente()]).media).toBeCloseTo(7 / 3, 10);
    expect(resumoBanca([enviado(7), enviado(9), pendente()]).media).toBeCloseTo(16 / 3, 10);
    expect(resumoBanca([enviado(7), enviado(9), enviado(8)])).toMatchObject({ enviadas: 3, esperadas: 3, completa: true, media: 8 });
  });

  it('banca vazia não é "completa"', () => {
    expect(resumoBanca([]).completa).toBe(false);
    expect(resumoBanca([]).media).toBeNull();
  });
});

describe('resumoBanca — status conta tanto quanto a nota (bug do ajuste solicitado)', () => {
  it('AJUSTE_SOLICITADO com nota ANTIGA não conta: Fase I volta a parcial (1 de 2)', () => {
    // Coordenação pediu ajuste ao segundo membro; a nota anterior (9) segue salva.
    const r = resumoBanca([{ nota: 8, status: 'ENVIADO' }, { nota: 9, status: 'AJUSTE_SOLICITADO' }]);
    expect(r.enviadas).toBe(1);
    expect(r.completa).toBe(false); // nada de média oficial/resultado com reenvio pendente
    expect(r.media).toBe(4); // previsão: 8 ÷ 2 (a nota antiga NÃO entra na soma)
  });

  it('PENDENTE com nota lançada administrativamente não conta', () => {
    const r = resumoBanca([{ nota: 8, status: 'ENVIADO' }, { nota: 7, status: 'PENDENTE' }]);
    expect(r.enviadas).toBe(1);
    expect(r.completa).toBe(false);
    expect(r.media).toBe(4); // 8 ÷ 2
  });

  it('após o reenvio (status ENVIADO), o membro volta a contar e a banca completa', () => {
    const r = resumoBanca([{ nota: 8, status: 'ENVIADO' }, { nota: 9.5, status: 'ENVIADO' }]);
    expect(r).toMatchObject({ enviadas: 2, esperadas: 2, completa: true, media: 8.75 });
  });

  it('Fase II: ajuste solicitado num membro de 3 derruba a completude do mesmo jeito', () => {
    const r = resumoBanca([
      { nota: 7, status: 'APROVADO' },
      { nota: 9, status: 'EM_ANALISE' },
      { nota: 8, status: 'AJUSTE_SOLICITADO' }, // nota antiga preservada — não conta
    ]);
    expect(r.enviadas).toBe(2);
    expect(r.completa).toBe(false);
    expect(r.media).toBeCloseTo(16 / 3, 10); // (7+9) ÷ 3
  });

  it('avaliacaoEntregue: todos os status entregues contam; pendentes/ajuste nunca', () => {
    for (const status of ['ENVIADO', 'EM_ANALISE', 'APROVADO', 'BLOQUEADO', 'CONCLUIDO']) {
      expect(avaliacaoEntregue({ nota: 5, status }), status).toBe(true);
    }
    expect(avaliacaoEntregue({ nota: 5, status: 'PENDENTE' })).toBe(false);
    expect(avaliacaoEntregue({ nota: 5, status: 'AJUSTE_SOLICITADO' })).toBe(false);
    expect(avaliacaoEntregue({ nota: null, status: 'ENVIADO' })).toBe(false); // sem nota nunca conta
  });
});

describe('busca de avaliadores — sem acento e sem caixa', () => {
  it('normaliza acentos e maiúsculas', () => {
    expect(normalizarBusca('Cárlos ANDRÉ')).toBe('carlos andre');
  });

  it('"carlos" encontra "Prof. Dr. Cárlos Orientador"', () => {
    expect(contemBusca('Prof. Dr. Cárlos Orientador', 'carlos')).toBe(true);
    expect(contemBusca('Prof. Dr. Cárlos Orientador', 'CARLOS')).toBe(true);
    expect(contemBusca('Prof. Dr. Cárlos Orientador', 'joão')).toBe(false);
    expect(contemBusca('Maria João', 'joao')).toBe(true);
  });
});
