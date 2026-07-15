import { describe, it, expect, vi, beforeEach } from 'vitest';
import { promises as fs } from 'fs';
import { TccsService } from './tccs.service';

// Prisma falso: cada método é um vi.fn() com um default seguro; os testes sobrescrevem o que
// interessa. `$transaction(fn)` executa a callback passando o próprio mock como `tx` (as
// operações condicionais rodam contra os mesmos vi.fn()).
function fakePrisma() {
  const p: any = {
    tcc: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn().mockResolvedValue({ id: 'novo', titulo: 'T', solicitacoes: [] }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      delete: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
    },
    documentoTcc: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      count: vi.fn().mockResolvedValue(0),
    },
    solicitacaoOrientacao: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    usuario: { findUnique: vi.fn() },
    configuracaoSistema: { findUnique: vi.fn().mockResolvedValue({ semestreAtivo: '2026.1' }), upsert: vi.fn() },
    calendario: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn() },
  };
  p.$transaction = (arg: any) => (typeof arg === 'function' ? arg(p) : Promise.all(arg));
  return p;
}

function criarServico(p: any) {
  const eventos = { emitirParaCoordenadores: vi.fn(), emitirParaUsuario: vi.fn() };
  const prazos = { exigirEtapaLiberada: vi.fn().mockResolvedValue(undefined) };
  const servico = new TccsService(p as any, eventos as any, prazos as any);
  return { servico, eventos, prazos };
}

describe('Item 1 — reabertura valida ANTES de excluir e é transacional', () => {
  it('não apaga o TCC anterior quando a nova solicitação é inválida (orientador inexistente)', async () => {
    const p = fakePrisma();
    // TCC anterior recusado, elegível a recomeço.
    p.tcc.findUnique.mockResolvedValue({ id: 'old', excluidoEm: null, faseAtual: 'INICIALIZACAO', solicitacoes: [{ status: 'RECUSADA' }] });
    p.usuario.findUnique.mockResolvedValue(null); // orientador inválido → falha ANTES de excluir
    const { servico } = criarServico(p);
    await expect(servico.abrir('aluno', { titulo: 'Meu TCC', orientadorId: 'o' } as any)).rejects.toMatchObject({ status: 400 });
    expect(p.tcc.delete).not.toHaveBeenCalled();
    expect(p.documentoTcc.findMany).not.toHaveBeenCalled(); // nem chegou a coletar arquivos p/ apagar
    expect(p.tcc.create).not.toHaveBeenCalled();
  });
});

describe('Item 2 — corrida aprovar/recusar (reserva condicional da solicitação)', () => {
  const tccPendente = {
    id: 't1', excluidoEm: null, faseAtual: 'INICIALIZACAO', alunoId: 'a', orientadorId: 'o', coorientadorId: null, titulo: 'T',
    solicitacoes: [{ id: 's1', status: 'PENDENTE' }],
    documentos: [{ tipo: 'PLANO_DESENVOLVIMENTO', status: 'PENDENTE' }, { tipo: 'TERMO_ACEITE', status: 'PENDENTE' }],
  };

  it('aprovar: se outro já decidiu (0 linhas reservadas) → 409 sem mudar fase nem notificar', async () => {
    const p = fakePrisma();
    p.tcc.findUnique.mockResolvedValue(tccPendente);
    p.solicitacaoOrientacao.updateMany.mockResolvedValue({ count: 0 });
    const { servico, eventos } = criarServico(p);
    await expect(servico.aprovar('t1')).rejects.toMatchObject({ status: 409 });
    expect(p.tcc.updateMany).not.toHaveBeenCalled();
    expect(eventos.emitirParaUsuario).not.toHaveBeenCalled();
  });

  it('aprovar: reserva 1 linha → sucesso, muda fase e notifica', async () => {
    const p = fakePrisma();
    p.tcc.findUnique.mockResolvedValue(tccPendente);
    p.solicitacaoOrientacao.updateMany.mockResolvedValue({ count: 1 });
    const { servico, eventos } = criarServico(p);
    await expect(servico.aprovar('t1')).resolves.toEqual({ ok: true });
    expect(p.tcc.updateMany).toHaveBeenCalled();
    expect(eventos.emitirParaUsuario).toHaveBeenCalled();
  });

  it('recusar: se outro já decidiu → 409 sem notificar', async () => {
    const p = fakePrisma();
    p.tcc.findUnique.mockResolvedValue({ ...tccPendente });
    p.solicitacaoOrientacao.updateMany.mockResolvedValue({ count: 0 });
    const { servico, eventos } = criarServico(p);
    await expect(servico.recusar('t1', 'parecer')).rejects.toMatchObject({ status: 409 });
    expect(eventos.emitirParaUsuario).not.toHaveBeenCalled();
  });

  it('aprovar: reserva a solicitação mas a fase mudou no instante (transição casa 0) → 409 e reverte, sem notificar', async () => {
    const p = fakePrisma();
    p.tcc.findUnique.mockResolvedValue(tccPendente);
    p.solicitacaoOrientacao.updateMany.mockResolvedValue({ count: 1 }); // reserva OK…
    p.tcc.updateMany.mockResolvedValue({ count: 0 }); // …mas o TCC já não está em INICIALIZACAO
    const { servico, eventos } = criarServico(p);
    await expect(servico.aprovar('t1')).rejects.toMatchObject({ status: 409 });
    expect(eventos.emitirParaUsuario).not.toHaveBeenCalled();
  });

  it('recusar: reserva a solicitação mas a fase mudou no meio da transação → 409 e não notifica', async () => {
    const p = fakePrisma();
    p.tcc.findUnique
      .mockResolvedValueOnce({ ...tccPendente }) // pré-leitura: ainda INICIALIZACAO
      .mockResolvedValueOnce({ faseAtual: 'DESENVOLVIMENTO', excluidoEm: null }); // dentro da tx: mudou
    p.solicitacaoOrientacao.updateMany.mockResolvedValue({ count: 1 });
    const { servico, eventos } = criarServico(p);
    await expect(servico.recusar('t1', 'parecer')).rejects.toMatchObject({ status: 409 });
    expect(eventos.emitirParaUsuario).not.toHaveBeenCalled();
  });
});

describe('Item 3 — decisões concorrentes do orientador (transições condicionais)', () => {
  const emDesenvolvimento = { id: 't1', excluidoEm: null, orientadorId: 'prof', faseAtual: 'DESENVOLVIMENTO', alunoId: 'a', coorientadorId: null, titulo: 'T', semestre: '2026.1' };

  it('avaliarMonografia APROVAR: doc já não está PENDENTE → 409 sem ligar a flag de aprovação', async () => {
    const p = fakePrisma();
    p.tcc.findUnique.mockResolvedValue(emDesenvolvimento);
    p.documentoTcc.findFirst.mockResolvedValue({ id: 'm1', status: 'PENDENTE' });
    p.documentoTcc.updateMany.mockResolvedValue({ count: 0 }); // outra decisão venceu
    const { servico } = criarServico(p);
    await expect(servico.avaliarMonografia('prof', 't1', 'APROVAR')).rejects.toMatchObject({ status: 409 });
    expect(p.tcc.update).not.toHaveBeenCalled(); // não fica "aprovada" com documento rejeitado
  });

  it('avaliarContinuidade REJEITAR: continuidade já decidida/fase mudou → 409', async () => {
    const p = fakePrisma();
    p.tcc.findUnique.mockResolvedValue({ ...emDesenvolvimento, continuidadeConfirmada: false });
    p.tcc.updateMany.mockResolvedValue({ count: 0 });
    const { servico } = criarServico(p);
    await expect(servico.avaliarContinuidade('prof', 't1', 'REJEITAR', 'motivo do descarte')).rejects.toMatchObject({ status: 409 });
  });

  it('validarVersaoFinal CONCLUIR: fase já não está em validação → 409 sem aprovar o documento', async () => {
    const p = fakePrisma();
    p.tcc.findUnique.mockResolvedValue({ id: 't1', excluidoEm: null, orientadorId: 'prof', faseAtual: 'VALIDACAO_VERSAO_FINAL', alunoId: 'a', coorientadorId: null, titulo: 'T', semestre: '2026.1' });
    p.documentoTcc.findFirst.mockResolvedValue({ id: 'v1' });
    p.tcc.updateMany.mockResolvedValue({ count: 0 });
    const { servico } = criarServico(p);
    await expect(servico.validarVersaoFinal('prof', 't1', 'CONCLUIR')).rejects.toMatchObject({ status: 409 });
    expect(p.documentoTcc.update).not.toHaveBeenCalled();
  });

  it('avaliarMonografia APROVAR: reserva o doc mas a fase mudou (flag casa 0) → 409, sem transição nem notificação', async () => {
    const p = fakePrisma();
    p.tcc.findUnique.mockResolvedValue(emDesenvolvimento);
    p.documentoTcc.findFirst.mockResolvedValue({ id: 'm1', status: 'PENDENTE' });
    p.documentoTcc.updateMany.mockResolvedValue({ count: 1 }); // reserva do documento OK…
    p.tcc.updateMany.mockResolvedValue({ count: 0 }); // …mas o TCC já não está em DESENVOLVIMENTO (flag não grava)
    const { servico, eventos } = criarServico(p);
    await expect(servico.avaliarMonografia('prof', 't1', 'APROVAR')).rejects.toMatchObject({ status: 409 });
    expect(eventos.emitirParaUsuario).not.toHaveBeenCalled();
  });

  it('avaliarMonografia REJEITAR: reserva o doc mas a fase mudou no meio → 409, sem rejeitar de fato nem notificar', async () => {
    const p = fakePrisma();
    p.tcc.findUnique
      .mockResolvedValueOnce(emDesenvolvimento) // exigirOrientadorEmDesenvolvimento: passa
      .mockResolvedValueOnce({ faseAtual: 'DESCONTINUADO', excluidoEm: null }); // dentro da tx: fase mudou
    p.documentoTcc.findFirst.mockResolvedValue({ id: 'm1', status: 'PENDENTE' });
    p.documentoTcc.updateMany.mockResolvedValue({ count: 1 }); // doc reservado…
    const { servico, eventos } = criarServico(p);
    await expect(servico.avaliarMonografia('prof', 't1', 'REJEITAR', 'ajustes')).rejects.toMatchObject({ status: 409 });
    expect(eventos.emitirParaUsuario).not.toHaveBeenCalled();
  });

  it('avaliarMonografia REJEITAR: doc PENDENTE e TCC em DESENVOLVIMENTO → rejeita e notifica', async () => {
    const p = fakePrisma();
    p.tcc.findUnique.mockResolvedValue(emDesenvolvimento); // pré-checagem e checagem interna
    p.documentoTcc.findFirst.mockResolvedValue({ id: 'm1', status: 'PENDENTE' });
    p.documentoTcc.updateMany.mockResolvedValue({ count: 1 });
    const { servico, eventos } = criarServico(p);
    await expect(servico.avaliarMonografia('prof', 't1', 'REJEITAR', 'ajustes')).resolves.toEqual({ ok: true });
    expect(eventos.emitirParaUsuario).toHaveBeenCalled();
  });

  it('validarVersaoFinal CONCLUIR: fase reservada mas SEM versão final PENDENTE → 400 e NÃO conclui', async () => {
    const p = fakePrisma();
    p.tcc.findUnique.mockResolvedValue({ id: 't1', excluidoEm: null, orientadorId: 'prof', faseAtual: 'VALIDACAO_VERSAO_FINAL', alunoId: 'a', coorientadorId: null, titulo: 'T', semestre: '2026.1' });
    p.tcc.updateMany.mockResolvedValue({ count: 1 }); // fase reservada…
    p.documentoTcc.updateMany.mockResolvedValue({ count: 0 }); // …mas não há versão final PENDENTE
    const { servico, eventos } = criarServico(p);
    await expect(servico.validarVersaoFinal('prof', 't1', 'CONCLUIR')).rejects.toMatchObject({ status: 400 });
    expect(eventos.emitirParaUsuario).not.toHaveBeenCalled();
  });

  it('validarVersaoFinal CONCLUIR: com versão final PENDENTE → conclui e notifica', async () => {
    const p = fakePrisma();
    p.tcc.findUnique.mockResolvedValue({ id: 't1', excluidoEm: null, orientadorId: 'prof', faseAtual: 'VALIDACAO_VERSAO_FINAL', alunoId: 'a', coorientadorId: null, titulo: 'T', semestre: '2026.1' });
    p.tcc.updateMany.mockResolvedValue({ count: 1 }); // fase reservada
    p.documentoTcc.updateMany.mockResolvedValue({ count: 1 }); // versão final PENDENTE aprovada na mesma tx
    const { servico, eventos } = criarServico(p);
    await expect(servico.validarVersaoFinal('prof', 't1', 'CONCLUIR')).resolves.toEqual({ ok: true });
    expect(eventos.emitirParaUsuario).toHaveBeenCalled();
  });
});

describe('Item 4 — cancelamento remove os uploads (só após excluir com sucesso)', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('remove os arquivos DESTE TCC após o delete dar certo', async () => {
    const rm = vi.spyOn(fs, 'rm').mockResolvedValue(undefined as any);
    const p = fakePrisma();
    p.tcc.findUnique.mockResolvedValue({ id: 't1', excluidoEm: null, alunoId: 'aluno', faseAtual: 'INICIALIZACAO' });
    p.documentoTcc.findMany.mockResolvedValue([{ caminho: 'uploads/a.pdf' }, { caminho: 'uploads/b.pdf' }]);
    const { servico } = criarServico(p);
    await expect(servico.cancelar('aluno', 't1')).resolves.toEqual({ ok: true });
    expect(p.tcc.delete).toHaveBeenCalled();
    expect(rm).toHaveBeenCalledTimes(2);
  });

  it('NÃO remove arquivos se a exclusão do TCC falhar', async () => {
    const rm = vi.spyOn(fs, 'rm').mockResolvedValue(undefined as any);
    const p = fakePrisma();
    p.tcc.findUnique.mockResolvedValue({ id: 't1', excluidoEm: null, alunoId: 'aluno', faseAtual: 'INICIALIZACAO' });
    p.documentoTcc.findMany.mockResolvedValue([{ caminho: 'uploads/a.pdf' }]);
    p.tcc.delete.mockRejectedValue(new Error('db off'));
    const { servico } = criarServico(p);
    await expect(servico.cancelar('aluno', 't1')).rejects.toBeTruthy();
    expect(rm).not.toHaveBeenCalled();
  });
});

describe('Item 5 — orientador/coorientador indisponível é barrado no backend', () => {
  it('orientador com disponivelParaOrientar=false → 400', async () => {
    const p = fakePrisma();
    p.tcc.findUnique.mockResolvedValue(null); // sem TCC anterior
    p.usuario.findUnique.mockResolvedValue({ id: 'o', papel: 'PROFESSOR', disponivelParaOrientar: false });
    const { servico } = criarServico(p);
    await expect(servico.abrir('aluno', { titulo: 'Meu TCC', orientadorId: 'o' } as any)).rejects.toMatchObject({ status: 400 });
    expect(p.tcc.create).not.toHaveBeenCalled();
  });

  it('coorientador indisponível → 400', async () => {
    const p = fakePrisma();
    p.tcc.findUnique.mockResolvedValue(null);
    p.usuario.findUnique
      .mockResolvedValueOnce({ id: 'o', papel: 'PROFESSOR', disponivelParaOrientar: true })
      .mockResolvedValueOnce({ id: 'c', papel: 'PROFESSOR', disponivelParaOrientar: false });
    const { servico } = criarServico(p);
    await expect(servico.abrir('aluno', { titulo: 'Meu TCC', orientadorId: 'o', coorientadorId: 'c' } as any)).rejects.toMatchObject({ status: 400 });
    expect(p.tcc.create).not.toHaveBeenCalled();
  });
});

describe('Item 6 — duplo-cego: nome do arquivo da banca não vaza na Fase I', () => {
  const docBanca = {
    id: 'd1', tipo: 'AVALIACAO_BANCA', nomeArquivo: 'Avaliacao_JoaoSilva.docx', caminho: 'uploads/x',
    tcc: { excluidoEm: null, alunoId: 'a', orientadorId: 'o', coorientadorId: null,
      bancas: [{ fase: 'FASE_1', documentoAvaliacaoId: 'd1', membros: [{ avaliadorId: 'aval' }] }] },
  };

  it('avaliador da Fase I recebe nome genérico (mas o caminho real é preservado)', async () => {
    const p = fakePrisma();
    p.documentoTcc.findUnique.mockResolvedValue(docBanca);
    const { servico } = criarServico(p);
    const doc: any = await servico.documentoParaUsuario('d1', { sub: 'aval', papel: 'PROFESSOR' });
    expect(doc.nomeArquivo).toBe('Documento para avaliação');
    expect(doc.caminho).toBe('uploads/x');
  });

  it('coordenador mantém o nome real do arquivo', async () => {
    const p = fakePrisma();
    p.documentoTcc.findUnique.mockResolvedValue(docBanca);
    const { servico } = criarServico(p);
    const doc: any = await servico.documentoParaUsuario('d1', { sub: 'coord', papel: 'COORDENADOR' });
    expect(doc.nomeArquivo).toBe('Avaliacao_JoaoSilva.docx');
  });
});
