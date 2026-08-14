// Fiação dos ganchos: os fluxos acadêmicos precisam MESMO chamar a fila do Drive depois de
// gravar. Sem isto, as funções de sincronização existiriam sem ninguém as chamar — que foi
// exatamente a falha corrigida aqui.
import { describe, it, expect, vi } from 'vitest';
import { TccsService } from '../tccs/tccs.service';
import { DefesasService } from '../bancas/defesas.service';
import { BancasService } from '../bancas/bancas.service';
import { BloqueioResetAntigo } from '../arquivo/bloqueio-reset-antigo';

function driveEspiao() {
  return {
    aoAprovarAbertura: vi.fn(async () => {}),
    aoEnviarDocumento: vi.fn(async () => {}),
    aoAlterarTcc: vi.fn(async () => {}),
  };
}

describe('TccsService chama a fila após gravar', () => {
  function servico(p: any) {
    const drive = driveEspiao();
    const eventos = { emitirParaCoordenadores: vi.fn(), emitirParaUsuario: vi.fn() };
    const prazos = { exigirEtapaLiberada: vi.fn().mockResolvedValue(undefined) };
    return { s: new TccsService(p, eventos as any, prazos as any, drive as any), drive };
  }

  it('editar documento enfileira a atualização dos dados', async () => {
    const p: any = {
      documentoTcc: {
        findUnique: vi.fn().mockResolvedValue({ id: 'd1', tccId: 't1', tipo: 'MONOGRAFIA' }),
        update: vi.fn().mockResolvedValue({ id: 'd1', tccId: 't1' }),
      },
      // buscarTccAtivoOuFalhar: o TCC precisa existir e não estar excluído.
      tcc: { findUnique: vi.fn().mockResolvedValue({ id: 't1', excluidoEm: null }) },
    };
    const { s, drive } = servico(p);
    await s.editarDocumento('d1', { status: 'APROVADO' } as any);

    expect(p.documentoTcc.update).toHaveBeenCalled();
    expect(drive.aoAlterarTcc).toHaveBeenCalledWith('t1');
  });

  it('falha da fila NÃO derruba a operação acadêmica', async () => {
    const p: any = {
      documentoTcc: {
        findUnique: vi.fn().mockResolvedValue({ id: 'd1', tccId: 't1', tipo: 'MONOGRAFIA' }),
        update: vi.fn().mockResolvedValue({ id: 'd1', tccId: 't1' }),
      },
      // buscarTccAtivoOuFalhar: o TCC precisa existir e não estar excluído.
      tcc: { findUnique: vi.fn().mockResolvedValue({ id: 't1', excluidoEm: null }) },
    };
    const { s, drive } = servico(p);
    drive.aoAlterarTcc.mockRejectedValue(new Error('banco da fila fora'));

    // A edição conclui normalmente mesmo com o Drive falhando.
    await expect(s.editarDocumento('d1', { status: 'APROVADO' } as any)).resolves.toMatchObject({ id: 'd1' });
  });
});

describe('DefesasService chama a fila após agendar/liberar', () => {
  it('liberar a defesa vencida enfileira a atualização', async () => {
    const drive = driveEspiao();
    const p: any = {
      tcc: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue(null), // notificação sai cedo
      },
    };
    const eventos = { emitirParaCoordenadores: vi.fn(), emitirParaUsuario: vi.fn() };
    const s = new DefesasService(p, eventos as any, drive as any);

    await expect(s.liberarDefesaSeVencida('t1')).resolves.toBe(true);
    expect(drive.aoAlterarTcc).toHaveBeenCalledWith('t1');
  });

  it('quando nada é liberado, nada é enfileirado', async () => {
    const drive = driveEspiao();
    const p: any = { tcc: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) } };
    const eventos = { emitirParaCoordenadores: vi.fn(), emitirParaUsuario: vi.fn() };
    const s = new DefesasService(p, eventos as any, drive as any);

    await expect(s.liberarDefesaSeVencida('t1')).resolves.toBe(false);
    expect(drive.aoAlterarTcc).not.toHaveBeenCalled();
  });
});

describe('BancasService: ações de validação da coordenação enfileiram o snapshot', () => {
  // membro em fase de validação, com o TCC embutido (é assim que o service carrega).
  function prismaMembro(status = 'ENVIADO') {
    return {
      membroBanca: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'm1',
          avaliadorId: 'av1',
          status,
          nota: 8,
          banca: { id: 'b1', fase: 'FASE_1', tcc: { id: 't1', excluidoEm: null, faseAtual: 'VALIDACAO_FASE_1', titulo: 'T' } },
          avaliador: { papel: 'PROFESSOR' },
        }),
        update: vi.fn().mockResolvedValue({}),
      },
    } as any;
  }

  function servico(p: any) {
    const drive = driveEspiao();
    const eventos = { emitirParaCoordenadores: vi.fn(), emitirParaUsuario: vi.fn() };
    const prazos = { exigirEtapaLiberada: vi.fn(), bloqueiosDoTcc: vi.fn().mockResolvedValue({}) };
    return { s: new BancasService(p, eventos as any, prazos as any, drive as any), drive };
  }

  it('aprovar avaliação individual enfileira', async () => {
    const p = prismaMembro();
    const { s, drive } = servico(p);
    await s.aprovarAvaliacaoMembro('m1');
    expect(drive.aoAlterarTcc).toHaveBeenCalledWith('t1');
  });

  it('solicitar ajuste enfileira', async () => {
    const p = prismaMembro();
    const { s, drive } = servico(p);
    await s.solicitarAjuste('m1', 'refazer o critério 2');
    expect(drive.aoAlterarTcc).toHaveBeenCalledWith('t1');
  });

  it('cancelar ajuste enfileira', async () => {
    const p = prismaMembro('AJUSTE_SOLICITADO');
    const { s, drive } = servico(p);
    await s.cancelarAjuste('m1');
    expect(drive.aoAlterarTcc).toHaveBeenCalledWith('t1');
  });

  it('o rascunho privado do avaliador NUNCA é mandado ao Drive', async () => {
    const p = prismaMembro('AJUSTE_SOLICITADO');
    const { s, drive } = servico(p);
    await s.cancelarAjuste('m1');
    // O gancho só pede a atualização do snapshot oficial (dados.json/resumo.txt) por tccId;
    // não existe caminho que envie rascunho.
    expect(drive.aoAlterarTcc).toHaveBeenCalledWith('t1');
    expect(drive.aoEnviarDocumento).not.toHaveBeenCalled();
  });
});

describe('Rota antiga de reset está indisponível', () => {
  it('responde 410 com orientação e NÃO segue para o handler destrutivo', () => {
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    new BloqueioResetAntigo().use({} as any, res, next);

    expect(res.status).toHaveBeenCalledWith(410);
    expect(next).not.toHaveBeenCalled(); // o handler antigo nunca roda
    expect(res.json.mock.calls[0][0].mensagem).toMatch(/Encerrar e arquivar período/i);
  });
});
