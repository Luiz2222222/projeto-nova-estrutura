import { describe, it, expect } from 'vitest';
import { tccEstaAtivo, buscarTccAtivoOuFalhar } from './tcc-ativo';

describe('tccEstaAtivo (regra do export/rotas de TCC ativo)', () => {
  it('TCC ativo (excluidoEm null/ausente) é considerado ativo', () => {
    expect(tccEstaAtivo({ excluidoEm: null })).toBe(true);
    expect(tccEstaAtivo({})).toBe(true);
  });

  it('TCC com soft delete (excluidoEm != null) NÃO é ativo', () => {
    expect(tccEstaAtivo({ excluidoEm: new Date() })).toBe(false);
  });

  it('TCC inexistente (null/undefined) não é ativo', () => {
    expect(tccEstaAtivo(null)).toBe(false);
    expect(tccEstaAtivo(undefined)).toBe(false);
  });
});

// db falso: só o findUnique é usado pelo helper.
const fakeDb = (tcc: any) => ({ tcc: { findUnique: async () => tcc } });

describe('buscarTccAtivoOuFalhar (gate 404)', () => {
  it('retorna o TCC quando ativo', async () => {
    const ativo = { id: 't1', excluidoEm: null };
    await expect(buscarTccAtivoOuFalhar(fakeDb(ativo), 't1')).resolves.toEqual(ativo);
  });

  it('lança 404 quando o TCC está excluído (soft delete)', async () => {
    const excluido = { id: 't1', excluidoEm: new Date() };
    await expect(buscarTccAtivoOuFalhar(fakeDb(excluido), 't1')).rejects.toMatchObject({ status: 404 });
  });

  it('lança 404 quando o TCC não existe', async () => {
    await expect(buscarTccAtivoOuFalhar(fakeDb(null), 'x')).rejects.toMatchObject({ status: 404 });
  });
});
