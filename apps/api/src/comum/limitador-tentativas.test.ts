import { describe, it, expect } from 'vitest';
import { LimitadorTentativas, ipDaRequisicao } from './limitador-tentativas';

describe('LimitadorTentativas', () => {
  it('permite até o limite e bloqueia a partir do excesso', () => {
    const lim = new LimitadorTentativas(3, 1000, () => 0);
    expect(lim.permitir('a')).toBe(true); // 1
    expect(lim.permitir('a')).toBe(true); // 2
    expect(lim.permitir('a')).toBe(true); // 3 (== limite)
    expect(lim.permitir('a')).toBe(false); // 4 -> bloqueia
    expect(lim.permitir('a')).toBe(false); // segue bloqueado
  });

  it('conta chaves de forma independente', () => {
    const lim = new LimitadorTentativas(1, 1000, () => 0);
    expect(lim.permitir('ip:1')).toBe(true);
    expect(lim.permitir('ip:1')).toBe(false);
    expect(lim.permitir('ip:2')).toBe(true); // outra chave não é afetada
  });

  it('reabre depois que a janela expira', () => {
    let agora = 0;
    const lim = new LimitadorTentativas(2, 1000, () => agora);
    expect(lim.permitir('a')).toBe(true);
    expect(lim.permitir('a')).toBe(true);
    expect(lim.permitir('a')).toBe(false); // estourou dentro da janela
    agora = 1000; // janela expirou
    expect(lim.permitir('a')).toBe(true); // janela nova
  });

  it('limpar() zera o contador da chave (ex.: login OK)', () => {
    const lim = new LimitadorTentativas(2, 1000, () => 0);
    lim.permitir('a');
    lim.permitir('a');
    expect(lim.permitir('a')).toBe(false);
    lim.limpar('a');
    expect(lim.permitir('a')).toBe(true);
  });

  it('ipDaRequisicao usa req.ip, com fallbacks', () => {
    expect(ipDaRequisicao({ ip: '1.2.3.4' })).toBe('1.2.3.4');
    expect(ipDaRequisicao({ socket: { remoteAddress: '5.6.7.8' } })).toBe('5.6.7.8');
    expect(ipDaRequisicao({})).toBe('desconhecido');
  });
});
