import { describe, expect, it } from 'vitest';
import { OFFSET_FORTALEZA, ehLinkHttpsSeguro, montarInstanteDefesa, partesDefesaFortaleza } from './defesa';

describe('fuso da defesa (America/Fortaleza, UTC-3 fixo)', () => {
  it('converte ISO UTC para os campos do formulário no fuso de Fortaleza', () => {
    // 05:04 UTC = 02:04 em Fortaleza.
    expect(partesDefesaFortaleza('2026-07-17T05:04:00.000Z')).toEqual({ data: '2026-07-17', hora: '02:04' });
    // Virada de dia: 01:30 UTC = 22:30 do dia anterior em Fortaleza.
    expect(partesDefesaFortaleza('2026-07-17T01:30:00.000Z')).toEqual({ data: '2026-07-16', hora: '22:30' });
  });

  it('meia-noite sai como 00:00 (hourCycle h23, nunca "24:00")', () => {
    expect(partesDefesaFortaleza('2026-07-17T03:00:00.000Z').hora).toBe('00:00');
  });

  it('abrir e salvar sem mudar nada preserva o instante exato (roundtrip)', () => {
    const original = '2026-07-17T05:04:00.000Z';
    const { data, hora } = partesDefesaFortaleza(original);
    expect(montarInstanteDefesa(data, hora).toISOString()).toBe(original);
  });

  it('interpreta o formulário como UTC-3 explícito, não o fuso do processo', () => {
    expect(montarInstanteDefesa('2026-07-17', '02:04').toISOString()).toBe('2026-07-17T05:04:00.000Z');
    expect(OFFSET_FORTALEZA).toBe('-03:00');
  });
});

describe('link do local da defesa', () => {
  it('só https:// vira link clicável', () => {
    expect(ehLinkHttpsSeguro('https://meet.google.com/abc')).toBe(true);
    expect(ehLinkHttpsSeguro('  https://p1led.com.br  ')).toBe(true);
    expect(ehLinkHttpsSeguro('HTTPS://SITE.COM')).toBe(true);
  });

  it('texto, http:// e esquemas perigosos ficam como texto puro', () => {
    expect(ehLinkHttpsSeguro('Sala A-204')).toBe(false);
    expect(ehLinkHttpsSeguro('http://site.com')).toBe(false);
    expect(ehLinkHttpsSeguro('javascript:alert(1)')).toBe(false);
    expect(ehLinkHttpsSeguro('')).toBe(false);
    expect(ehLinkHttpsSeguro(null)).toBe(false);
    expect(ehLinkHttpsSeguro(undefined)).toBe(false);
  });
});
