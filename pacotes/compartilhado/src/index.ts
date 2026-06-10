// Tipos, listas e validações compartilhados entre a API e a tela.
import { z } from 'zod';

export const PAPEIS = ['ALUNO', 'PROFESSOR', 'AVALIADOR', 'COORDENADOR'] as const;
export type Papel = (typeof PAPEIS)[number];

// Papéis que podem se cadastrar sozinhos (coordenador é criado por fora).
export const PAPEIS_CADASTRO = ['ALUNO', 'PROFESSOR', 'AVALIADOR'] as const;
export type PapelCadastro = (typeof PAPEIS_CADASTRO)[number];

export const CURSOS = ['ENGENHARIA_ELETRICA', 'CONTROLE_E_AUTOMACAO'] as const;
export type Curso = (typeof CURSOS)[number];

export const ROTULO_PAPEL: Record<Papel, string> = {
  ALUNO: 'Aluno',
  PROFESSOR: 'Professor',
  AVALIADOR: 'Avaliador externo',
  COORDENADOR: 'Coordenador',
};

export const ROTULO_CURSO: Record<Curso, string> = {
  ENGENHARIA_ELETRICA: 'Engenharia Elétrica',
  CONTROLE_E_AUTOMACAO: 'Controle e Automação',
};

// Opções de tratamento/titulação. "Outros" abre um campo livre na tela.
export const TRATAMENTOS = ['Prof. Dr.', 'Prof. Ms.', 'Prof.', 'Dr.', 'Eng.', 'Outros'] as const;

// Opções de afiliação do avaliador externo. "Outros" abre campo livre.
export const AFILIACOES = ['UFPE', 'UFRPE', 'IFPE', 'Outros'] as const;

// ---------- Validações ----------

export const esquemaLogin = z.object({
  email: z.string().email('E-mail inválido'),
  senha: z.string().min(6, 'A senha precisa ter ao menos 6 caracteres'),
  manterLogin: z.boolean().optional().default(false),
});
export type DadosLogin = z.infer<typeof esquemaLogin>;

export const esquemaCadastro = z
  .object({
    papel: z.enum(PAPEIS_CADASTRO),
    nomeCompleto: z
      .string()
      .trim()
      .min(3, 'Informe o nome completo')
      .refine((v) => v.split(/\s+/).filter(Boolean).length >= 2, 'Informe o nome completo'),
    email: z.string().email('E-mail inválido'),
    senha: z.string().min(6, 'A senha precisa ter ao menos 6 caracteres'),
    codigo: z.string().min(1, 'Informe o código de cadastro'),
    curso: z.enum(CURSOS).optional(),
    tratamento: z.string().optional(),
    afiliacao: z.string().optional(),
  })
  .superRefine((d, ctx) => {
    if (d.papel === 'ALUNO' && !d.curso) {
      ctx.addIssue({ code: 'custom', path: ['curso'], message: 'Selecione o curso' });
    }
    if ((d.papel === 'PROFESSOR' || d.papel === 'AVALIADOR') && !d.tratamento) {
      ctx.addIssue({ code: 'custom', path: ['tratamento'], message: 'Selecione a titulação' });
    }
    if (d.papel === 'AVALIADOR' && !d.afiliacao) {
      ctx.addIssue({ code: 'custom', path: ['afiliacao'], message: 'Informe a afiliação' });
    }
  });
export type DadosCadastro = z.infer<typeof esquemaCadastro>;

// Usuário "público" (sem senha) devolvido pela API.
export interface UsuarioPublico {
  id: string;
  nomeCompleto: string;
  email: string;
  papel: Papel;
  curso: Curso | null;
  tratamento: string | null;
  afiliacao: string | null;
  disponivelParaOrientar: boolean;
}

// ---------- TCC: abertura ----------

export const TITULACOES_COORIENTADOR = ['Mestre', 'Doutor'] as const;

export const esquemaAbrirTcc = z
  .object({
    titulo: z.string().min(3, 'O título deve ter ao menos 3 caracteres'),
    orientadorId: z.string().min(1, 'Selecione um orientador'),
    mensagem: z.string().optional(),
    // coorientador cadastrado (interno)
    coorientadorId: z.string().optional(),
    // coorientador externo
    coorientadorNome: z.string().optional(),
    coorientadorTitulacao: z.string().optional(),
    coorientadorAfiliacao: z.string().optional(),
    coorientadorLattes: z.string().optional(),
  })
  .superRefine((d, ctx) => {
    const temExterno = !!(
      d.coorientadorNome ||
      d.coorientadorAfiliacao ||
      d.coorientadorLattes ||
      d.coorientadorTitulacao
    );
    if (d.coorientadorId && temExterno) {
      ctx.addIssue({ code: 'custom', path: ['coorientadorId'], message: 'Escolha coorientador cadastrado OU externo, não os dois' });
    }
    if (temExterno) {
      if (!d.coorientadorNome) ctx.addIssue({ code: 'custom', path: ['coorientadorNome'], message: 'Informe o nome do coorientador' });
      if (!d.coorientadorTitulacao) ctx.addIssue({ code: 'custom', path: ['coorientadorTitulacao'], message: 'Selecione a titulação' });
      if (!d.coorientadorAfiliacao) ctx.addIssue({ code: 'custom', path: ['coorientadorAfiliacao'], message: 'Informe a afiliação' });
      if (!d.coorientadorLattes) ctx.addIssue({ code: 'custom', path: ['coorientadorLattes'], message: 'Informe o Lattes' });
    }
  });
export type DadosAbrirTcc = z.infer<typeof esquemaAbrirTcc>;

export const esquemaRecusarAbertura = z.object({
  parecer: z.string().min(3, 'Escreva um parecer para o aluno'),
});
export type DadosRecusarAbertura = z.infer<typeof esquemaRecusarAbertura>;

// ---------- Coordenação ----------

export const esquemaAviso = z.object({
  titulo: z.string().trim().min(3, 'Informe um título'),
  conteudo: z.string().trim().min(3, 'Escreva o conteúdo do aviso'),
});
export type DadosAviso = z.infer<typeof esquemaAviso>;

// Marcos do calendário do semestre (todos opcionais; data ISO ou null).
export const MARCOS_CALENDARIO = [
  'reuniaoAlunos',
  'envioDocumentos',
  'avaliacaoContinuidade',
  'submissaoMonografia',
  'preparacaoBancasFase1',
  'avaliacaoFase1',
  'preparacaoBancasFase2',
  'apresentacaoFase2',
  'ajustesFinais',
] as const;
export type MarcoCalendario = (typeof MARCOS_CALENDARIO)[number];

export const ROTULO_MARCO: Record<MarcoCalendario, string> = {
  reuniaoAlunos: 'Reunião com alunos',
  envioDocumentos: 'Envio de documentos',
  avaliacaoContinuidade: 'Avaliação de continuidade',
  submissaoMonografia: 'Submissão da monografia + termo',
  preparacaoBancasFase1: 'Preparação das bancas (Fase I)',
  avaliacaoFase1: 'Avaliação — Fase I',
  preparacaoBancasFase2: 'Preparação das bancas (Fase II)',
  apresentacaoFase2: 'Apresentação dos trabalhos (Fase II)',
  ajustesFinais: 'Ajustes finais',
};

// ---------- Desenvolvimento (monografia + continuidade) ----------

export const esquemaAvaliarMonografia = z
  .object({
    decisao: z.enum(['APROVAR', 'REJEITAR']),
    parecer: z.string().trim().optional(),
  })
  .superRefine((d, ctx) => {
    if (d.decisao === 'REJEITAR' && (!d.parecer || d.parecer.length < 3)) {
      ctx.addIssue({ code: 'custom', path: ['parecer'], message: 'Explique o que o aluno precisa ajustar' });
    }
  });
export type DadosAvaliarMonografia = z.infer<typeof esquemaAvaliarMonografia>;

export const esquemaContinuidade = z
  .object({
    decisao: z.enum(['CONFIRMAR', 'REJEITAR']),
    parecer: z.string().trim().optional(),
  })
  .superRefine((d, ctx) => {
    if (d.decisao === 'REJEITAR' && (!d.parecer || d.parecer.length < 3)) {
      ctx.addIssue({ code: 'custom', path: ['parecer'], message: 'Explique o motivo da descontinuação' });
    }
  });
export type DadosContinuidade = z.infer<typeof esquemaContinuidade>;

export const DESC_MARCO: Record<MarcoCalendario, string> = {
  reuniaoAlunos: 'Orientações gerais sobre o TCC e o regulamento.',
  envioDocumentos: 'Prazo para envio do plano e do termo de aceite.',
  avaliacaoContinuidade: 'Prazo para o orientador avaliar o progresso.',
  submissaoMonografia: 'Entrega da versão final com o termo.',
  preparacaoBancasFase1: 'Período de formação das bancas avaliadoras.',
  avaliacaoFase1: 'Prazo final para avaliação pela banca.',
  preparacaoBancasFase2: 'Formação das bancas para a apresentação.',
  apresentacaoFase2: 'Prazo final para as apresentações orais.',
  ajustesFinais: 'Prazo para correções após a defesa.',
};
