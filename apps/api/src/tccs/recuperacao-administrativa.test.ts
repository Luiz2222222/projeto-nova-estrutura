// Testes de integração (serviços com Prisma falso) dos cenários de RECUPERAÇÃO
// ADMINISTRATIVA do coordenador: exclusão permanente, documento da banca, correção de
// fluxo, defesa pela coordenação, edição genérica sem notas/fase, troca de avaliadores,
// semestre com calendário e coorientação exclusiva.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { promises as fs } from 'fs';
import { TccsService } from './tccs.service';
import { BancasService } from '../bancas/bancas.service';
import { DefesasService } from '../bancas/defesas.service';
import { esquemaEditarTcc } from '@tcc/compartilhado';

// Prisma falso no padrão dos demais testes: cada método é um vi.fn(); $transaction(fn)
// executa a callback com o próprio mock como tx; a forma de array vira Promise.all.
function fakePrisma() {
  const p: any = {
    tcc: {
      findUnique: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      delete: vi.fn().mockResolvedValue({}),
    },
    documentoTcc: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn(),
      create: vi.fn().mockResolvedValue({ id: 'doc-novo' }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      count: vi.fn().mockResolvedValue(0),
    },
    banca: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    membroBanca: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      delete: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    historicoTccOculto: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }), findMany: vi.fn().mockResolvedValue([]) },
    solicitacaoOrientacao: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    usuario: { findUnique: vi.fn(), count: vi.fn().mockResolvedValue(0) },
    configuracaoSistema: { findUnique: vi.fn().mockResolvedValue({ semestreAtivo: '2026.1' }), upsert: vi.fn() },
    calendario: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue(null) },
  };
  p.$transaction = (arg: any) => (typeof arg === 'function' ? arg(p) : Promise.all(arg));
  return p;
}

function criarTccsService(p: any) {
  const eventos = { emitirParaCoordenadores: vi.fn(), emitirParaUsuario: vi.fn() };
  const prazos = { exigirEtapaLiberada: vi.fn().mockResolvedValue(undefined) };
  return { servico: new TccsService(p as any, eventos as any, prazos as any), eventos };
}
function criarBancasService(p: any) {
  const eventos = { emitirParaCoordenadores: vi.fn(), emitirParaUsuario: vi.fn() };
  const prazos = { exigirEtapaLiberada: vi.fn().mockResolvedValue(undefined), bloqueiosDoTcc: vi.fn().mockResolvedValue({}) };
  return { servico: new BancasService(p as any, eventos as any, prazos as any), eventos };
}
function criarDefesasService(p: any) {
  const eventos = { emitirParaCoordenadores: vi.fn(), emitirParaUsuario: vi.fn() };
  return { servico: new DefesasService(p as any, eventos as any), eventos };
}

beforeEach(() => vi.restoreAllMocks());

// ---------- 1. Exclusão permanente ----------

describe('Exclusão permanente do TCC (coordenador/orientador)', () => {
  const tcc = { id: 't1', orientadorId: 'prof', excluidoEm: null, titulo: 'T' };

  it('apaga banco em transação (com preferências de histórico) e remove arquivos DEPOIS', async () => {
    const rm = vi.spyOn(fs, 'rm').mockResolvedValue(undefined as any);
    const p = fakePrisma();
    p.tcc.findUnique.mockResolvedValue(tcc);
    p.documentoTcc.findMany.mockResolvedValue([{ caminho: 'uploads/a.pdf' }, { caminho: 'uploads/b.pdf' }]);
    const { servico } = criarTccsService(p);
    await expect(servico.excluir({ sub: 'coord', papel: 'COORDENADOR' }, 't1')).resolves.toEqual({ ok: true });
    expect(p.historicoTccOculto.deleteMany).toHaveBeenCalledWith({ where: { tccId: 't1' } });
    expect(p.tcc.delete).toHaveBeenCalledWith({ where: { id: 't1' } });
    expect(rm).toHaveBeenCalledTimes(2);
  });

  it('NÃO apaga nenhum arquivo se a transação do banco falhar', async () => {
    const rm = vi.spyOn(fs, 'rm').mockResolvedValue(undefined as any);
    const p = fakePrisma();
    p.tcc.findUnique.mockResolvedValue(tcc);
    p.documentoTcc.findMany.mockResolvedValue([{ caminho: 'uploads/a.pdf' }]);
    p.tcc.delete.mockRejectedValue(new Error('db off'));
    const { servico } = criarTccsService(p);
    await expect(servico.excluir({ sub: 'coord', papel: 'COORDENADOR' }, 't1')).rejects.toBeTruthy();
    expect(rm).not.toHaveBeenCalled();
  });

  it('professor que NÃO é o orientador → 403 e nada é apagado', async () => {
    const p = fakePrisma();
    p.tcc.findUnique.mockResolvedValue(tcc);
    const { servico } = criarTccsService(p);
    await expect(servico.excluir({ sub: 'outro', papel: 'PROFESSOR' }, 't1')).rejects.toMatchObject({ status: 403 });
    expect(p.tcc.delete).not.toHaveBeenCalled();
  });

  it('arquivo travado no disco não é engolido: exclusão conclui e devolve os órfãos', async () => {
    vi.spyOn(fs, 'rm')
      .mockResolvedValueOnce(undefined as any)
      .mockRejectedValueOnce(new Error('EBUSY: locked'));
    const p = fakePrisma();
    p.tcc.findUnique.mockResolvedValue(tcc);
    p.documentoTcc.findMany.mockResolvedValue([{ caminho: 'uploads/ok.pdf' }, { caminho: 'uploads/travado.pdf' }]);
    const { servico } = criarTccsService(p);
    const r: any = await servico.excluir({ sub: 'coord', papel: 'COORDENADOR' }, 't1');
    expect(r.ok).toBe(true);
    expect(r.arquivosNaoRemovidos).toEqual(['uploads/travado.pdf']);
  });
});

// ---------- 2. Documento da banca ----------

describe('Documento da banca (AVALIACAO_BANCA)', () => {
  const arquivoPdf = { originalname: 'novo.pdf', buffer: Buffer.from('%PDF-1.4\n conteudo'), size: 600 };

  it('substituir o arquivo migra o vínculo Banca.documentoAvaliacaoId para a nova versão na mesma transação', async () => {
    vi.spyOn(fs, 'mkdir').mockResolvedValue(undefined as any);
    vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined as any);
    const p = fakePrisma();
    p.documentoTcc.findUnique.mockResolvedValue({ id: 'd1', tccId: 't1', tipo: 'AVALIACAO_BANCA', status: 'APROVADO', parecer: null });
    p.tcc.findUnique.mockResolvedValue({ id: 't1', excluidoEm: null });
    p.documentoTcc.count.mockResolvedValue(1);
    p.documentoTcc.create.mockResolvedValue({ id: 'd2', tccId: 't1', tipo: 'AVALIACAO_BANCA' });
    const { servico } = criarTccsService(p);
    await servico.substituirArquivoDocumento('d1', undefined, arquivoPdf);
    // O avaliador baixa/visualiza pelo vínculo da banca — que agora aponta para o novo doc.
    expect(p.banca.updateMany).toHaveBeenCalledWith({
      where: { documentoAvaliacaoId: 'd1' },
      data: { documentoAvaliacaoId: 'd2' },
    });
    expect(p.documentoTcc.update).toHaveBeenCalledWith({ where: { id: 'd1' }, data: { status: 'SUBSTITUIDA' } });
  });

  it('upload administrativo AVULSO de AVALIACAO_BANCA é rejeitado (sem vínculo com banca)', async () => {
    const escrever = vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined as any);
    const p = fakePrisma();
    p.tcc.findUnique.mockResolvedValue({ id: 't1', excluidoEm: null });
    const { servico } = criarTccsService(p);
    await expect(servico.adicionarDocumentoAdmin('t1', 'AVALIACAO_BANCA', undefined, undefined, arquivoPdf))
      .rejects.toMatchObject({ status: 400 });
    expect(p.documentoTcc.create).not.toHaveBeenCalled();
    expect(escrever).not.toHaveBeenCalled();
  });
});

// ---------- 3. Correção administrativa de fluxo ----------

describe('Correção de fluxo (corrigirFase)', () => {
  const tccNaFase2 = {
    id: 't1', excluidoEm: null, titulo: 'T', semestre: '2026.1', faseAtual: 'AVALIACAO_FASE_2',
    nf1: 7.5, nf2: 6, nf: 6.9, resultado: null,
    defesaAgendadaPara: new Date('2026-07-01T13:00:00Z'), defesaLocal: 'Sala 1', defesaComentario: null,
    defesaAgendadaEm: new Date('2026-06-20T13:00:00Z'), defesaLiberadaEm: new Date('2026-07-01T13:00:00Z'),
    monografiaAprovada: true, continuidadeConfirmada: true, concluidoEm: null, versaoFinalValidadaEm: null,
    faseAnteriorDescontinuacao: null,
  };
  const bancas = [
    { id: 'b1', fase: 'FASE_1', membros: [{ id: 'm1', nota: 8, status: 'CONCLUIDO' }, { id: 'm2', nota: 7, status: 'CONCLUIDO' }] },
    { id: 'b2', fase: 'FASE_2', membros: [{ id: 'n1', nota: 8, status: 'ENVIADO' }, { id: 'n2', nota: null, status: 'PENDENTE' }, { id: 'n3', nota: null, status: 'PENDENTE' }] },
  ];

  it('confirmar=false devolve os impactos SEM gravar nada', async () => {
    const p = fakePrisma();
    p.tcc.findUnique.mockResolvedValue(tccNaFase2);
    p.banca.findMany.mockResolvedValue(bancas);
    const { servico } = criarTccsService(p);
    const r: any = await servico.corrigirFase('t1', 'AGENDAMENTO_DEFESA_FASE_2', false);
    expect(r.aplicado).toBe(false);
    expect(r.impactos.join(' ')).toMatch(/defesa/i);
    expect(r.impactos.join(' ')).toMatch(/avalia/i); // avaliações da F2 serão invalidadas
    expect(p.tcc.update).not.toHaveBeenCalled();
    expect(p.membroBanca.updateMany).not.toHaveBeenCalled();
  });

  it('voltar para o agendamento limpa a defesa INTEIRA (incl. defesaLiberadaEm), NF2/NF e invalida as avaliações da F2', async () => {
    const p = fakePrisma();
    p.tcc.findUnique.mockResolvedValue(tccNaFase2);
    p.banca.findMany.mockResolvedValue(bancas);
    const { servico } = criarTccsService(p);
    const r: any = await servico.corrigirFase('t1', 'AGENDAMENTO_DEFESA_FASE_2', true);
    expect(r.aplicado).toBe(true);
    expect(p.membroBanca.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { bancaId: 'b2' },
      data: expect.objectContaining({ status: 'PENDENTE', nota: null }),
    }));
    expect(p.tcc.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        faseAtual: 'AGENDAMENTO_DEFESA_FASE_2',
        defesaAgendadaPara: null,
        defesaLocal: null,
        defesaAgendadaEm: null,
        defesaLiberadaEm: null, // um valor antigo aqui impediria a próxima liberação automática
        nf2: null,
        nf: null,
        resultado: null,
      }),
    }));
  });

  it('reabrir a VALIDAÇÃO da Fase I preserva as notas da F1 (EM_ANALISE), limpa NF1 e invalida a F2', async () => {
    const p = fakePrisma();
    p.tcc.findUnique.mockResolvedValue(tccNaFase2);
    p.banca.findMany.mockResolvedValue(bancas);
    const { servico } = criarTccsService(p);
    await servico.corrigirFase('t1', 'VALIDACAO_FASE_1', true);
    // F1: quem tem nota vai para EM_ANALISE (nada é descartado).
    expect(p.membroBanca.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { bancaId: 'b1', nota: { not: null } },
      data: expect.objectContaining({ status: 'EM_ANALISE' }),
    }));
    // F2: avaliações invalidadas explicitamente (constam nos impactos).
    expect(p.membroBanca.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { bancaId: 'b2' },
      data: expect.objectContaining({ status: 'PENDENTE', nota: null }),
    }));
    expect(p.tcc.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ faseAtual: 'VALIDACAO_FASE_1', nf1: null, nf2: null, nf: null, defesaLiberadaEm: null }),
    }));
  });

  it('avançar para a Fase II sem NF1/banca formada é rejeitado (estado impossível)', async () => {
    const p = fakePrisma();
    p.tcc.findUnique.mockResolvedValue({ ...tccNaFase2, faseAtual: 'AVALIACAO_FASE_1', nf1: null, defesaAgendadaPara: null });
    p.banca.findMany.mockResolvedValue([bancas[0]]); // sem banca F2
    const { servico } = criarTccsService(p);
    await expect(servico.corrigirFase('t1', 'AGENDAMENTO_DEFESA_FASE_2', true)).rejects.toMatchObject({ status: 400 });
    expect(p.tcc.update).not.toHaveBeenCalled();
  });

  it('NÃO abre a avaliação da Fase II com defesa marcada para o FUTURO (liberação segue automática)', async () => {
    const p = fakePrisma();
    p.tcc.findUnique.mockResolvedValue({
      ...tccNaFase2,
      faseAtual: 'AGENDAMENTO_DEFESA_FASE_2',
      defesaAgendadaPara: new Date(Date.now() + 24 * 60 * 60 * 1000), // amanhã
      defesaLiberadaEm: null,
      nf2: null, nf: null,
    });
    p.banca.findMany.mockResolvedValue(bancas);
    const { servico } = criarTccsService(p);
    await expect(servico.corrigirFase('t1', 'AVALIACAO_FASE_2', true)).rejects.toMatchObject({ status: 400 });
    expect(p.tcc.update).not.toHaveBeenCalled();
  });

  it('CONCLUIDO exige versão final enviada (mesmo com NF aprovada)', async () => {
    const p = fakePrisma();
    p.tcc.findUnique.mockResolvedValue({ ...tccNaFase2, faseAtual: 'VALIDACAO_VERSAO_FINAL', nf: 8.2 });
    p.banca.findMany.mockResolvedValue(bancas);
    p.documentoTcc.findFirst.mockResolvedValue(null); // sem VERSAO_FINAL
    const { servico } = criarTccsService(p);
    await expect(servico.corrigirFase('t1', 'CONCLUIDO', true)).rejects.toMatchObject({ status: 400 });
    expect(p.tcc.update).not.toHaveBeenCalled();
  });
});

// ---------- 4. Defesa pela coordenação ----------

describe('Agendamento da defesa pela coordenação', () => {
  const tccAguardando = {
    id: 't1', excluidoEm: null, titulo: 'T', alunoId: 'al', orientadorId: 'prof', coorientadorId: null,
    faseAtual: 'AGENDAMENTO_DEFESA_FASE_2', defesaAgendadaPara: null, defesaAgendadaEm: null, defesaLiberadaEm: null,
    bancas: [{ fase: 'FASE_2', membros: [] }],
  };

  it('coordenador agenda com as MESMAS validações do orientador e notifica os envolvidos', async () => {
    const p = fakePrisma();
    p.tcc.findUnique
      .mockResolvedValueOnce(tccAguardando) // leitura inicial: ainda sem defesa
      .mockResolvedValue({ ...tccAguardando, defesaAgendadaPara: new Date('2027-01-10T13:00:00Z'), defesaLocal: 'Auditório' }); // releituras (notificação)
    p.banca.findUnique.mockResolvedValue({ id: 'b2', membros: [{ id: 'n1' }] });
    p.tcc.updateMany.mockResolvedValue({ count: 0 }); // data futura: não libera agora
    const { servico, eventos } = criarDefesasService(p);
    const r = await servico.agendarDefesa({ sub: 'coord', papel: 'COORDENADOR' }, 't1', {
      dataHora: '2027-01-10T13:00:00.000Z', local: 'Auditório', comentario: undefined,
    } as any);
    expect(r.ok).toBe(true);
    expect(p.tcc.update).toHaveBeenCalled(); // agendamento gravado
    expect(eventos.emitirParaUsuario).toHaveBeenCalled(); // aluno/banca avisados (mesmo fluxo)
    expect(eventos.emitirParaCoordenadores).toHaveBeenCalled();
  });

  it('professor que não é o orientador continua barrado (403)', async () => {
    const p = fakePrisma();
    p.tcc.findUnique.mockResolvedValue(tccAguardando);
    const { servico } = criarDefesasService(p);
    await expect(servico.agendarDefesa({ sub: 'intruso', papel: 'PROFESSOR' }, 't1', {
      dataHora: '2027-01-10T13:00:00.000Z', local: 'Auditório',
    } as any)).rejects.toMatchObject({ status: 403 });
    expect(p.tcc.update).not.toHaveBeenCalled();
  });

  it('após a reabertura (defesaLiberadaEm limpo), reagendar com data passada LIBERA a Fase II automaticamente', async () => {
    const p = fakePrisma();
    p.tcc.findUnique
      .mockResolvedValueOnce(tccAguardando)
      .mockResolvedValue({ ...tccAguardando, defesaAgendadaPara: new Date('2026-01-01T13:00:00Z'), defesaLocal: 'Auditório' });
    p.banca.findUnique.mockResolvedValue({ id: 'b2', membros: [{ id: 'n1' }] });
    p.tcc.updateMany.mockResolvedValue({ count: 1 }); // o updateMany condicional casa: libera
    const { servico, eventos } = criarDefesasService(p);
    const r = await servico.agendarDefesa({ sub: 'coord', papel: 'COORDENADOR' }, 't1', {
      dataHora: '2026-01-01T13:00:00.000Z', local: 'Auditório',
    } as any);
    expect(r).toMatchObject({ ok: true, liberada: true });
    // A liberação é o updateMany condicional (fase + defesaLiberadaEm null + horário vencido).
    expect(p.tcc.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ faseAtual: 'AGENDAMENTO_DEFESA_FASE_2', defesaLiberadaEm: null }),
      data: expect.objectContaining({ faseAtual: 'AVALIACAO_FASE_2' }),
    }));
    expect(eventos.emitirParaUsuario).toHaveBeenCalled();
  });
});

// ---------- 5. Edição genérica sem fase/notas ----------

describe('Edição genérica do TCC não aceita fase nem notas calculadas', () => {
  it('esquemaEditarTcc descarta faseAtual/nf1/nf2/nf/resultado', () => {
    const parsed: any = esquemaEditarTcc.parse({
      titulo: 'Novo título', faseAtual: 'CONCLUIDO', nf1: 9, nf2: 9, nf: 9, resultado: 'APROVADO',
    });
    expect(parsed.titulo).toBe('Novo título');
    expect(parsed.faseAtual).toBeUndefined();
    expect(parsed.nf1).toBeUndefined();
    expect(parsed.nf2).toBeUndefined();
    expect(parsed.nf).toBeUndefined();
    expect(parsed.resultado).toBeUndefined();
  });

  it('o service ignora nf1/faseAtual mesmo se chegarem por fora do esquema', async () => {
    const p = fakePrisma();
    p.tcc.findUnique.mockResolvedValue({ id: 't1', excluidoEm: null, semestre: '2026.1', alunoId: 'al', orientadorId: 'o', coorientadorId: null, faseAtual: 'DESENVOLVIMENTO' });
    const { servico } = criarTccsService(p);
    await servico.editarTcc('t1', { titulo: 'X', nf1: 9, faseAtual: 'CONCLUIDO' } as any);
    const data = p.tcc.update.mock.calls[0][0].data;
    expect(data.titulo).toBe('X');
    expect(data.nf1).toBeUndefined();
    expect(data.faseAtual).toBeUndefined();
  });
});

// ---------- 6. Troca de avaliadores × Fase II ----------

describe('Trocar avaliadores da Fase I não apaga avaliação existente da Fase II', () => {
  it('membro da F2 que sairia já avaliou → 400 (o caminho é a Correção de fluxo)', async () => {
    const p = fakePrisma();
    p.tcc.findUnique.mockResolvedValue({ id: 't1', excluidoEm: null, faseAtual: 'AVALIACAO_FASE_1', alunoId: 'al', orientadorId: 'prof', coorientadorId: null });
    const bancaF1 = { id: 'b1', membros: [{ id: 'm1', avaliadorId: 'a1' }, { id: 'm2', avaliadorId: 'a2' }] };
    const bancaF2 = { id: 'b2', membros: [{ id: 'f1', avaliadorId: 'prof', nota: null, status: 'PENDENTE' }, { id: 'f2', avaliadorId: 'a1', nota: 8, status: 'ENVIADO' }, { id: 'f3', avaliadorId: 'a2', nota: null, status: 'PENDENTE' }] };
    p.banca.findUnique.mockImplementation(({ where }: any) =>
      Promise.resolve(where.tccId_fase.fase === 'FASE_1' ? bancaF1 : bancaF2));
    p.usuario.count.mockResolvedValueOnce(2).mockResolvedValueOnce(0); // válidos; nenhum indisponível
    const { servico } = criarBancasService(p);
    // troca a1 (que já avaliou a F2) por novo1
    await expect(servico.editarAvaliadoresFase1('t1', ['novo1', 'a2'])).rejects.toMatchObject({ status: 400 });
  });

  it('fase pós-validação da Fase I → 400 (não troca só porque a fase mudaria na mão)', async () => {
    const p = fakePrisma();
    p.tcc.findUnique.mockResolvedValue({ id: 't1', excluidoEm: null, faseAtual: 'AGENDAMENTO_DEFESA_FASE_2', alunoId: 'al', orientadorId: 'prof', coorientadorId: null });
    const { servico } = criarBancasService(p);
    await expect(servico.editarAvaliadoresFase1('t1', ['x', 'y'])).rejects.toMatchObject({ status: 400 });
    expect(p.membroBanca.deleteMany).not.toHaveBeenCalled();
  });
});

// ---------- 7. Semestre com calendário ----------

describe('Semestre do TCC exige Calendário configurado', () => {
  const tccBase = { id: 't1', excluidoEm: null, semestre: '2026.1', alunoId: 'al', orientadorId: 'o', coorientadorId: null, faseAtual: 'DESENVOLVIMENTO' };

  it('semestre sem calendário → 400 e nada é gravado', async () => {
    const p = fakePrisma();
    p.tcc.findUnique.mockResolvedValue(tccBase);
    p.calendario.findUnique.mockResolvedValue(null);
    const { servico } = criarTccsService(p);
    await expect(servico.editarTcc('t1', { semestre: '2027.1' } as any)).rejects.toMatchObject({ status: 400 });
    expect(p.tcc.update).not.toHaveBeenCalled();
  });

  it('formato inválido (texto livre) → 400', async () => {
    const p = fakePrisma();
    p.tcc.findUnique.mockResolvedValue(tccBase);
    const { servico } = criarTccsService(p);
    await expect(servico.editarTcc('t1', { semestre: 'qualquer coisa' } as any)).rejects.toMatchObject({ status: 400 });
    expect(p.tcc.update).not.toHaveBeenCalled();
  });

  it('semestre com calendário e SEM avaliações → grava', async () => {
    const p = fakePrisma();
    p.tcc.findUnique.mockResolvedValue(tccBase);
    p.calendario.findUnique.mockResolvedValue({ semestre: '2027.1' });
    const { servico } = criarTccsService(p);
    await servico.editarTcc('t1', { semestre: '2027.1' } as any);
    expect(p.tcc.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ semestre: '2027.1' }) }));
  });

  it('TCC com NF apurada não troca de semestre (régua de pesos divergiria)', async () => {
    const p = fakePrisma();
    p.tcc.findUnique.mockResolvedValue({ ...tccBase, nf1: 7.5 });
    p.calendario.findUnique.mockResolvedValue({ semestre: '2027.1' });
    const { servico } = criarTccsService(p);
    await expect(servico.editarTcc('t1', { semestre: '2027.1' } as any)).rejects.toMatchObject({ status: 400 });
    expect(p.tcc.update).not.toHaveBeenCalled();
  });

  it('TCC com avaliação de banca registrada (mesmo sem NF) não troca de semestre', async () => {
    const p = fakePrisma();
    p.tcc.findUnique.mockResolvedValue(tccBase);
    p.calendario.findUnique.mockResolvedValue({ semestre: '2027.1' });
    p.membroBanca.findFirst.mockResolvedValue({ id: 'm1' }); // alguém já enviou nota
    const { servico } = criarTccsService(p);
    await expect(servico.editarTcc('t1', { semestre: '2027.1' } as any)).rejects.toMatchObject({ status: 400 });
    expect(p.tcc.update).not.toHaveBeenCalled();
  });
});

// ---------- 9. Trilhas do desenvolvimento fora da fase própria ----------

describe('Monografia aprovada / continuidade só mudam em DESENVOLVIMENTO', () => {
  it('desmarcar continuidade com o TCC na Fase II → 400', async () => {
    const p = fakePrisma();
    p.tcc.findUnique.mockResolvedValue({ id: 't1', excluidoEm: null, semestre: '2026.1', alunoId: 'al', orientadorId: 'o', coorientadorId: null, faseAtual: 'AVALIACAO_FASE_2', monografiaAprovada: true, continuidadeConfirmada: true });
    const { servico } = criarTccsService(p);
    await expect(servico.editarTcc('t1', { continuidadeConfirmada: false } as any)).rejects.toMatchObject({ status: 400 });
    expect(p.tcc.update).not.toHaveBeenCalled();
  });

  it('reenviar o MESMO valor fora do desenvolvimento não é bloqueado (salvar dados gerais segue ok)', async () => {
    const p = fakePrisma();
    p.tcc.findUnique.mockResolvedValue({ id: 't1', excluidoEm: null, semestre: '2026.1', alunoId: 'al', orientadorId: 'o', coorientadorId: null, faseAtual: 'AVALIACAO_FASE_2', monografiaAprovada: true, continuidadeConfirmada: true });
    const { servico } = criarTccsService(p);
    await servico.editarTcc('t1', { titulo: 'X', monografiaAprovada: true, continuidadeConfirmada: true } as any);
    expect(p.tcc.update).toHaveBeenCalled();
  });

  it('em DESENVOLVIMENTO a mudança é aceita', async () => {
    const p = fakePrisma();
    p.tcc.findUnique.mockResolvedValue({ id: 't1', excluidoEm: null, semestre: '2026.1', alunoId: 'al', orientadorId: 'o', coorientadorId: null, faseAtual: 'DESENVOLVIMENTO', monografiaAprovada: false, continuidadeConfirmada: false });
    const { servico } = criarTccsService(p);
    await servico.editarTcc('t1', { monografiaAprovada: true } as any);
    expect(p.tcc.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ monografiaAprovada: true }) }));
  });
});

// ---------- 8. Coorientação exclusiva ----------

describe('Coorientador interno × externo são mutuamente exclusivos', () => {
  const tccComExterno = { id: 't1', excluidoEm: null, semestre: '2026.1', alunoId: 'al', orientadorId: 'o', coorientadorId: null, coorientadorNome: 'Ext Antigo', faseAtual: 'DESENVOLVIMENTO' };

  it('selecionar interno LIMPA os campos externos no banco', async () => {
    const p = fakePrisma();
    p.tcc.findUnique.mockResolvedValue(tccComExterno);
    p.usuario.findUnique.mockResolvedValue({ id: 'c1', papel: 'PROFESSOR' });
    const { servico } = criarTccsService(p);
    await servico.editarTcc('t1', { coorientadorId: 'c1' } as any);
    const data = p.tcc.update.mock.calls[0][0].data;
    expect(data.coorientadorId).toBe('c1');
    expect(data.coorientadorNome).toBeNull();
    expect(data.coorientadorTitulacao).toBeNull();
    expect(data.coorientadorAfiliacao).toBeNull();
    expect(data.coorientadorLattes).toBeNull();
  });

  it('preencher externo LIMPA coorientadorId', async () => {
    const p = fakePrisma();
    p.tcc.findUnique.mockResolvedValue({ ...tccComExterno, coorientadorId: 'c1', coorientadorNome: null });
    const { servico } = criarTccsService(p);
    await servico.editarTcc('t1', { coorientadorNome: 'Novo Externo', coorientadorTitulacao: 'Doutor' } as any);
    const data = p.tcc.update.mock.calls[0][0].data;
    expect(data.coorientadorId).toBeNull();
    expect(data.coorientadorNome).toBe('Novo Externo');
  });

  it('mandar interno E externo juntos → 400', async () => {
    const p = fakePrisma();
    p.tcc.findUnique.mockResolvedValue(tccComExterno);
    p.usuario.findUnique.mockResolvedValue({ id: 'c1', papel: 'PROFESSOR' });
    const { servico } = criarTccsService(p);
    await expect(servico.editarTcc('t1', { coorientadorId: 'c1', coorientadorNome: 'Ext' } as any)).rejects.toMatchObject({ status: 400 });
    expect(p.tcc.update).not.toHaveBeenCalled();
  });

  it('remover o interno não ressuscita dados de externo antigo', async () => {
    const p = fakePrisma();
    p.tcc.findUnique.mockResolvedValue({ ...tccComExterno, coorientadorId: 'c1' });
    const { servico } = criarTccsService(p);
    await servico.editarTcc('t1', { coorientadorId: null } as any);
    const data = p.tcc.update.mock.calls[0][0].data;
    expect(data.coorientadorId).toBeNull();
    expect(data.coorientadorNome).toBeNull(); // o resto de externo antigo sai junto
  });
});
