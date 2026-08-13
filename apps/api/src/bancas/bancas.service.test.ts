import { describe, it, expect, vi } from 'vitest';
import { BancasService } from './bancas.service';

function fakePrisma() {
  const p: any = {
    membroBanca: { findMany: vi.fn() },
    calendario: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return p;
}

function criarServico(p: any) {
  const eventos = {} as any;
  const prazos = { prazoBloqueado: vi.fn().mockResolvedValue(false) } as any;
  return new BancasService(p as any, eventos, prazos, { aoAprovarAbertura: async () => {}, aoEnviarDocumento: async () => {}, aoAlterarTcc: async () => {} } as any);
}

// Membro de banca da Fase I, com o documento da banca cujo nome ORIGINAL revelaria o aluno.
function membroFase1() {
  return {
    id: 'm1', avaliadorId: 'aval', nota: null, parecer: null, status: 'PENDENTE',
    banca: {
      id: 'b1', fase: 'FASE_1', criadoEm: new Date(),
      tcc: { id: 't1', semestre: '2026.1', alunoId: 'a', faseAtual: 'AVALIACAO_FASE_1', excluidoEm: null, aluno: { nomeCompleto: 'João Silva' }, documentos: [{ tipo: 'MONOGRAFIA', nomeArquivo: 'TCC_Joao.docx' }] },
      documentoAvaliacao: { id: 'd1', nomeArquivo: 'Avaliacao_JoaoSilva.docx', caminho: 'uploads/x' },
    },
  };
}

describe('Item 6 — minhasBancas (Fase I) anonimiza o TCC e o nome do arquivo da banca', () => {
  it('esconde o nome do arquivo do documento de avaliação e a identidade do aluno/documentos', async () => {
    const p = fakePrisma();
    p.membroBanca.findMany.mockResolvedValue([membroFase1()]);
    const servico = criarServico(p);
    const res: any[] = await servico.minhasBancas('aval');
    expect(res[0].banca.documentoAvaliacao.nomeArquivo).toBe('Documento para avaliação');
    // Anonimato do TCC na Fase I: aluno e documentos não vazam para o avaliador cego.
    expect(res[0].banca.tcc.aluno).toBeNull();
    expect(res[0].banca.tcc.documentos).toEqual([]);
  });
});
