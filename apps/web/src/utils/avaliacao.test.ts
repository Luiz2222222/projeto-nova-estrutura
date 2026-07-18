import { describe, expect, it } from 'vitest';
import { resumoBanca } from './avaliacao';
import { contemBusca, normalizarBusca } from './texto';

// Item "médias parciais": a média só é OFICIAL com a banca completa (F1 = 2 membros,
// F2 = 3). Antes disso ela é apenas parcial/informativa — nunca vira NF nem resultado.
describe('resumoBanca — banca incompleta nunca vira nota oficial', () => {
  const m = (nota: number | null) => ({ nota });

  it('Fase I 0/2: sem média, incompleta', () => {
    const r = resumoBanca([m(null), m(null)]);
    expect(r).toEqual({ enviadas: 0, esperadas: 2, completa: false, media: null });
  });

  it('Fase I 1/2: média PARCIAL das enviadas, ainda incompleta', () => {
    const r = resumoBanca([m(8), m(null)]);
    expect(r.enviadas).toBe(1);
    expect(r.esperadas).toBe(2);
    expect(r.completa).toBe(false);
    expect(r.media).toBe(8); // informativa — o card NÃO usa como oficial
  });

  it('Fase I 2/2: completa, média oficial', () => {
    const r = resumoBanca([m(8), m(9)]);
    expect(r.completa).toBe(true);
    expect(r.media).toBe(8.5);
  });

  it('Fase II 0/3, 1/3 e 2/3: incompleta; 3/3: completa', () => {
    expect(resumoBanca([m(null), m(null), m(null)]).completa).toBe(false);
    expect(resumoBanca([m(7), m(null), m(null)])).toMatchObject({ enviadas: 1, esperadas: 3, completa: false, media: 7 });
    expect(resumoBanca([m(7), m(9), m(null)])).toMatchObject({ enviadas: 2, esperadas: 3, completa: false, media: 8 });
    expect(resumoBanca([m(7), m(9), m(8)])).toMatchObject({ enviadas: 3, esperadas: 3, completa: true, media: 8 });
  });

  it('banca vazia não é "completa"', () => {
    expect(resumoBanca([]).completa).toBe(false);
    expect(resumoBanca([]).media).toBeNull();
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
