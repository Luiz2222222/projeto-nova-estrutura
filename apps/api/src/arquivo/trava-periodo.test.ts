// Trava de período: enquanto um semestre está ENCERRANDO, nada dele pode ser criado ou
// alterado. Sem isso, um TCC nascido no meio do arquivamento seria apagado sem backup.
import { describe, it, expect, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { buscarTccAtivoOuFalhar, exigirPeriodoAberto } from '../comum/tcc-ativo';

// Prisma mínimo: um TCC ativo e a trava (ou não) do período.
function prisma(
  travaEm: string | null,
  tcc: Record<string, unknown> = { id: 't1', excluidoEm: null, semestre: '2026.2' },
  status: 'ENCERRANDO' | 'ENCERRADO' = 'ENCERRANDO',
) {
  return {
    tcc: { findUnique: vi.fn(async () => tcc) },
    periodoEncerramento: {
      // A trava é buscada PELO SEMESTRE (não por status): períodos já encerrados também
      // bloqueiam, senão um aluno abriria TCC num semestre arquivado.
      findFirst: vi.fn(async ({ where }: any) => (travaEm && where.semestre === travaEm ? { status } : null)),
    },
  } as any;
}

describe('exigirPeriodoAberto', () => {
  it('recusa (409) quando o semestre está sendo encerrado', async () => {
    await expect(exigirPeriodoAberto(prisma('2026.2'), '2026.2')).rejects.toBeInstanceOf(ConflictException);
  });

  it('libera outro semestre durante o encerramento', async () => {
    await expect(exigirPeriodoAberto(prisma('2026.2'), '2026.1')).resolves.toBeUndefined();
  });

  it('libera quando não há encerramento em curso', async () => {
    await expect(exigirPeriodoAberto(prisma(null), '2026.2')).resolves.toBeUndefined();
  });

  it('a mensagem de ENCERRANDO fala em processo em andamento', async () => {
    // A mensagem amigável vai no corpo da resposta (getResponse), não no .message do erro.
    await expect(exigirPeriodoAberto(prisma('2026.2'), '2026.2')).rejects.toMatchObject({
      response: { mensagem: expect.stringMatching(/sendo encerrado/i) },
    });
  });

  // A brecha: com o período ENCERRADO e o semestre ainda ativo no Planejamento, um aluno
  // conseguiria abrir TCC num período já arquivado.
  it('recusa (409) também quando o período JÁ FOI encerrado', async () => {
    const p = prisma('2026.2', undefined, 'ENCERRADO');
    await expect(exigirPeriodoAberto(p, '2026.2')).rejects.toBeInstanceOf(ConflictException);
  });

  it('a mensagem de ENCERRADO manda configurar outro semestre', async () => {
    const p = prisma('2026.2', undefined, 'ENCERRADO');
    await expect(exigirPeriodoAberto(p, '2026.2')).rejects.toMatchObject({
      response: { mensagem: expect.stringMatching(/já foi encerrado.*outro semestre/is) },
    });
  });

  it('semestre encerrado não afeta os demais', async () => {
    const p = prisma('2026.1', undefined, 'ENCERRADO');
    await expect(exigirPeriodoAberto(p, '2026.2')).resolves.toBeUndefined();
  });
});

// buscarTccAtivoOuFalhar é o ponto por onde passam todos os fluxos que agem sobre um TCC
// por id: envio de documento, avaliação, edição, defesa, correção de fase…
describe('Mutação concorrente durante o encerramento', () => {
  it('ação sobre TCC do período em encerramento recebe 409', async () => {
    await expect(buscarTccAtivoOuFalhar(prisma('2026.2'), 't1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('ação sobre TCC de OUTRO período continua funcionando', async () => {
    const p = prisma('2026.1'); // encerrando outro semestre
    await expect(buscarTccAtivoOuFalhar(p, 't1')).resolves.toMatchObject({ id: 't1' });
  });

  it('sem encerramento em curso, nada muda no fluxo normal', async () => {
    await expect(buscarTccAtivoOuFalhar(prisma(null), 't1')).resolves.toMatchObject({ id: 't1' });
  });

  it('pega o caso em que o chamador NÃO selecionou o semestre', async () => {
    // Alguns fluxos usam select sem `semestre`; a trava busca o semestre à parte.
    const p = prisma('2026.2', { id: 't1', excluidoEm: null }); // sem semestre no retorno
    p.tcc.findUnique = vi
      .fn()
      .mockResolvedValueOnce({ id: 't1', excluidoEm: null }) // consulta do chamador
      .mockResolvedValueOnce({ semestre: '2026.2' }); // consulta extra da trava

    await expect(buscarTccAtivoOuFalhar(p, 't1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('sem o semestre selecionado, período ENCERRADO também bloqueia', async () => {
    const p = prisma('2026.2', { id: 't1', excluidoEm: null }, 'ENCERRADO');
    p.tcc.findUnique = vi
      .fn()
      .mockResolvedValueOnce({ id: 't1', excluidoEm: null })
      .mockResolvedValueOnce({ semestre: '2026.2' });

    await expect(buscarTccAtivoOuFalhar(p, 't1')).rejects.toMatchObject({
      response: { mensagem: expect.stringMatching(/já foi encerrado/i) },
    });
  });

  it('ação em TCC de semestre ENCERRADO recebe 409', async () => {
    const p = prisma('2026.2', undefined, 'ENCERRADO');
    await expect(buscarTccAtivoOuFalhar(p, 't1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('TCC excluído continua dando 404 (a trava não muda isso)', async () => {
    const p = prisma(null, { id: 't1', excluidoEm: new Date(), semestre: '2026.2' });
    await expect(buscarTccAtivoOuFalhar(p, 't1')).rejects.toMatchObject({ status: 404 });
  });

  it('dublê de teste sem a tabela da trava não quebra', async () => {
    const p = { tcc: { findUnique: vi.fn(async () => ({ id: 't1', excluidoEm: null, semestre: '2026.2' })) } } as any;
    await expect(buscarTccAtivoOuFalhar(p, 't1')).resolves.toMatchObject({ id: 't1' });
  });
});
