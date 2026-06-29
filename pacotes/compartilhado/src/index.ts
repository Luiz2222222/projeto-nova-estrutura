// Tipos, listas e validações compartilhados entre a API e a tela.
import { z } from 'zod';

// Domínio do TCC (fases, rótulos, cálculo de notas) — fonte única, com testes.
export * from './dominio';

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
  CONTROLE_E_AUTOMACAO: 'Engenharia de Controle e Automação',
};

// ---------- Formatos de arquivo aceitos por tipo de documento do TCC ----------
// Regra espelhada do projeto antigo: iniciais e versão final em PDF, monografia em
// Word, documento da banca em PDF ou Word. `accept` vai no input; `exts`/`rotulo`
// servem para validar de verdade no backend e montar as mensagens.
export const FORMATOS_ARQUIVO = {
  PDF: { exts: ['.pdf'], accept: '.pdf', rotulo: 'PDF' },
  WORD: { exts: ['.doc', '.docx'], accept: '.doc,.docx', rotulo: 'Word (.doc ou .docx)' },
  PDF_WORD: { exts: ['.pdf', '.doc', '.docx'], accept: '.pdf,.doc,.docx', rotulo: 'PDF ou Word (.doc, .docx)' },
} as const;
export type FormatoArquivo = keyof typeof FORMATOS_ARQUIVO;

// Tipo de documento -> formato exigido. Tipos não listados caem em PDF_WORD.
export const FORMATO_POR_TIPO_DOC: Record<string, FormatoArquivo> = {
  PLANO_DESENVOLVIMENTO: 'PDF',
  TERMO_ACEITE: 'PDF',
  MONOGRAFIA: 'WORD',
  AVALIACAO_BANCA: 'PDF_WORD',
  VERSAO_FINAL: 'PDF',
};

export function formatoDoTipoDoc(tipo: string) {
  return FORMATOS_ARQUIVO[FORMATO_POR_TIPO_DOC[tipo] ?? 'PDF_WORD'];
}

// Extensão (minúscula, com ponto) do nome do arquivo; '' se não houver.
export function extensaoArquivo(nome: string): string {
  const i = (nome ?? '').lastIndexOf('.');
  return i >= 0 ? nome.slice(i).toLowerCase() : '';
}

// Validação real (por extensão) usada no backend e no front.
export function arquivoPermitidoParaTipo(tipo: string, nomeArquivo: string): boolean {
  return (formatoDoTipoDoc(tipo).exts as readonly string[]).includes(extensaoArquivo(nomeArquivo));
}

// Opções de tratamento/titulação. "Outros" abre um campo livre na tela.
export const TRATAMENTOS = ['Prof. Dr.', 'Prof. Ms.', 'Prof.', 'Dr.', 'Eng.', 'Outros'] as const;

// Opções de afiliação do avaliador externo. "Outros" abre campo livre.
export const AFILIACOES = ['UFPE', 'UFRPE', 'IFPE', 'Outros'] as const;

// ---------- Validações ----------

// Login aceita e-mail OU usuário simples (ex.: "adm"); a validação forte de e-mail/senha
// fica no cadastro. Aqui só exigimos que os campos não estejam vazios.
export const esquemaLogin = z.object({
  email: z.string().min(1, 'Informe o e-mail ou usuário'),
  senha: z.string().min(1, 'Informe a senha'),
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

// Troca de senha (na tela "Meu perfil"): exige a senha atual e confirma a nova.
export const esquemaTrocarSenha = z
  .object({
    senhaAtual: z.string().min(1, 'Informe a senha atual'),
    novaSenha: z.string().min(6, 'A nova senha precisa ter ao menos 6 caracteres'),
    confirmarNovaSenha: z.string().min(1, 'Confirme a nova senha'),
  })
  .superRefine((d, ctx) => {
    if (d.novaSenha !== d.confirmarNovaSenha) {
      ctx.addIssue({ code: 'custom', path: ['confirmarNovaSenha'], message: 'As senhas não coincidem' });
    }
  });
export type DadosTrocarSenha = z.infer<typeof esquemaTrocarSenha>;

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

// Cores possíveis do card de aviso e perfis destinatários (mural, espelha o original).
export const CORES_AVISO = ['', 'azul', 'verde', 'amarelo', 'vermelho', 'roxo', 'laranja'] as const;
export const DESTINATARIOS_AVISO = ['ALUNO', 'PROFESSOR', 'AVALIADOR', 'COORDENADOR'] as const;

export const esquemaAviso = z.object({
  titulo: z.string().trim().min(3, 'Informe um título'),
  conteudo: z.string().trim().min(3, 'Escreva o conteúdo do aviso'),
  destinatarios: z.array(z.string()).min(1, 'Selecione ao menos um perfil destinatário'),
  cor: z.string().optional().default(''),
  fixado: z.boolean().optional().default(false),
});
export type DadosAviso = z.infer<typeof esquemaAviso>;

export const esquemaComentario = z.object({
  texto: z.string().trim().min(1, 'Escreva um comentário'),
});
export type DadosComentario = z.infer<typeof esquemaComentario>;

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
  envioDocumentos: 'Envio de documentos iniciais',
  avaliacaoContinuidade: 'Avaliação de continuidade',
  submissaoMonografia: 'Submissão da monografia',
  preparacaoBancasFase1: 'Preparação das bancas (Fase I)',
  avaliacaoFase1: 'Avaliação - Fase I',
  preparacaoBancasFase2: 'Agendamento da defesa (Fase II)',
  apresentacaoFase2: 'Apresentação dos trabalhos (Fase II)',
  ajustesFinais: 'Ajustes finais / versão final',
};

// ---------- Liberações de prazo individuais (por TCC ou por aluno+semestre) ----------
// Etapas com PRAZO RESTRITIVO: prazo global vencido bloqueia a ação, a menos que a
// coordenação tenha dado uma liberação individual. Cada etapa mapeia para um marco do
// calendário. (reuniaoAlunos, preparacaoBancasFase1 e preparacaoBancasFase2 são apenas
// informativos — não têm liberação e não bloqueiam ninguém.)
export const ETAPAS_PRAZO = [
  'ENVIO_DOCUMENTOS',
  'AVALIACAO_CONTINUIDADE',
  'SUBMISSAO_MONOGRAFIA',
  'AVALIACAO_FASE_1',
  'APRESENTACAO_FASE_2',
  'VERSAO_FINAL',
] as const;
export type EtapaPrazo = (typeof ETAPAS_PRAZO)[number];

export const CAMPO_CALENDARIO_ETAPA: Record<EtapaPrazo, MarcoCalendario> = {
  ENVIO_DOCUMENTOS: 'envioDocumentos',
  AVALIACAO_CONTINUIDADE: 'avaliacaoContinuidade',
  SUBMISSAO_MONOGRAFIA: 'submissaoMonografia',
  AVALIACAO_FASE_1: 'avaliacaoFase1',
  APRESENTACAO_FASE_2: 'apresentacaoFase2',
  VERSAO_FINAL: 'ajustesFinais',
};

export const ROTULO_ETAPA_PRAZO: Record<EtapaPrazo, string> = {
  ENVIO_DOCUMENTOS: 'Envio de documentos iniciais',
  AVALIACAO_CONTINUIDADE: 'Avaliação de continuidade',
  SUBMISSAO_MONOGRAFIA: 'Submissão da monografia',
  AVALIACAO_FASE_1: 'Avaliação — Fase I',
  APRESENTACAO_FASE_2: 'Apresentação dos trabalhos — Fase II',
  VERSAO_FINAL: 'Ajustes finais / versão final',
};

// Marcos do calendário que NÃO bloqueiam (informativos, sem liberar/bloquear).
export const MARCOS_INFORMATIVOS = ['reuniaoAlunos', 'preparacaoBancasFase1', 'preparacaoBancasFase2'] as const;

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

// ---------- Edição administrativa do TCC (coordenador) ----------
// Tudo opcional (atualização parcial). faseAtual/resultado são validados no backend
// contra as listas válidas. Números aceitam null (campo vazio limpa a nota).
export const esquemaEditarTcc = z.object({
  titulo: z.string().trim().min(1, 'Informe o título').optional(),
  semestre: z.string().trim().min(1, 'Informe o semestre').optional(),
  faseAtual: z.string().trim().min(1).optional(),
  monografiaAprovada: z.boolean().optional(),
  continuidadeConfirmada: z.boolean().optional(),
  parecerContinuidade: z.string().trim().nullable().optional(),
  nf1: z.coerce.number().min(0).max(10).nullable().optional(),
  nf2: z.coerce.number().min(0).max(10).nullable().optional(),
  nf: z.coerce.number().min(0).max(10).nullable().optional(),
  resultado: z.string().trim().nullable().optional(),
  alunoId: z.string().min(1).optional(),
  orientadorId: z.string().min(1).nullable().optional(),
  coorientadorId: z.string().min(1).nullable().optional(),
  coorientadorNome: z.string().trim().nullable().optional(),
  coorientadorTitulacao: z.string().trim().nullable().optional(),
  coorientadorAfiliacao: z.string().trim().nullable().optional(),
  coorientadorLattes: z.string().trim().nullable().optional(),
});
export type DadosEditarTcc = z.infer<typeof esquemaEditarTcc>;

// Edição de metadados de um documento do TCC (não troca o arquivo em si).
export const esquemaEditarDocumento = z.object({
  tipo: z.string().trim().min(1).optional(),
  status: z.string().trim().min(1).optional(),
  parecer: z.string().trim().nullable().optional(),
  versao: z.coerce.number().int().min(1).optional(),
  nomeArquivo: z.string().trim().min(1).optional(),
});
export type DadosEditarDocumento = z.infer<typeof esquemaEditarDocumento>;

// ---------- Banca / Fase I ----------

export const esquemaFormarBanca = z.object({
  avaliadorIds: z.array(z.string().min(1)).min(2, 'Selecione os avaliadores da banca'),
});
export type DadosFormarBanca = z.infer<typeof esquemaFormarBanca>;

// Status da avaliação de cada membro da banca.
export const STATUS_MEMBRO_BANCA = ['PENDENTE', 'ENVIADO', 'BLOQUEADO', 'CONCLUIDO'] as const;
export type StatusMembroBanca = (typeof STATUS_MEMBRO_BANCA)[number];

// Avaliação por critério: notas[chaveDoCriterio] = nota (cada uma capada no peso do critério).
// finalizar=false → salva rascunho (notas parciais permitidas); finalizar=true → envia
// (exige todas as notas). Default true mantém compatibilidade com chamadas antigas.
export const esquemaAvaliarBanca = z.object({
  notas: z.record(z.coerce.number()),
  parecer: z.string().trim().optional(),
  finalizar: z.boolean().optional().default(true),
});
export type DadosAvaliarBanca = z.infer<typeof esquemaAvaliarBanca>;

// Edição administrativa de uma avaliação de membro pelo COORDENADOR (notas por
// critério + parecer estruturado + status). Notas parciais só com status PENDENTE.
export const esquemaEditarAvaliacaoMembro = z.object({
  notas: z.record(z.coerce.number()),
  parecer: z.string().trim().optional(),
  status: z.enum(['PENDENTE', 'ENVIADO', 'BLOQUEADO', 'CONCLUIDO']),
});
export type DadosEditarAvaliacaoMembro = z.infer<typeof esquemaEditarAvaliacaoMembro>;

// Troca dos 2 avaliadores da banca da Fase I (coordenador).
export const esquemaTrocarAvaliadores = z.object({
  avaliadorIds: z.array(z.string().min(1)).length(2, 'A banca da Fase I deve ter exatamente 2 avaliadores'),
});
export type DadosTrocarAvaliadores = z.infer<typeof esquemaTrocarAvaliadores>;

// ---------- Conclusão (validação da versão final pelo orientador) ----------

export const esquemaAnaliseFinal = z
  .object({
    decisao: z.enum(['CONCLUIR', 'AJUSTES']),
    parecer: z.string().trim().optional(),
  })
  .superRefine((d, ctx) => {
    if (d.decisao === 'AJUSTES' && (!d.parecer || d.parecer.length < 3)) {
      ctx.addIssue({ code: 'custom', path: ['parecer'], message: 'Explique os ajustes necessários' });
    }
  });
export type DadosAnaliseFinal = z.infer<typeof esquemaAnaliseFinal>;

export const DESC_MARCO: Record<MarcoCalendario, string> = {
  reuniaoAlunos: 'Orientações gerais sobre o TCC e Regulamento',
  envioDocumentos: 'Prazo para envio do plano e termo',
  avaliacaoContinuidade: 'Prazo para orientador avaliar progresso',
  submissaoMonografia: 'Entrega da monografia para avaliação',
  preparacaoBancasFase1: 'Período de formação das bancas avaliadoras',
  avaliacaoFase1: 'Prazo final para avaliação pela banca',
  preparacaoBancasFase2: 'Preparação da apresentação; banca composta pelo orientador + 2 avaliadores da Fase I.',
  apresentacaoFase2: 'Prazo final para apresentações orais',
  ajustesFinais: 'Prazo para correções pós-defesa',
};

// ---------- E-mails do fluxo do TCC ----------
// Catálogo dos tipos de e-mail "normais" (de fluxo). A recuperação de senha NÃO
// entra aqui — é uma categoria à parte, controlada só pelo toggle global.
// `papeis` define quais usuários veem/ajustam a preferência do evento.
export interface EventoEmail {
  chave: string;
  rotulo: string;
  grupo: string;
  papeis: Papel[];
}

export const EVENTOS_EMAIL: EventoEmail[] = [
  // Aluno
  { chave: 'aluno_solicitacao_aprovada', rotulo: 'Solicitação aprovada', grupo: 'Aluno', papeis: ['ALUNO'] },
  { chave: 'aluno_solicitacao_recusada', rotulo: 'Solicitação recusada', grupo: 'Aluno', papeis: ['ALUNO'] },
  { chave: 'aluno_monografia_rejeitada', rotulo: 'Monografia rejeitada pelo orientador', grupo: 'Aluno', papeis: ['ALUNO'] },
  { chave: 'aluno_monografia_aprovada', rotulo: 'Monografia aprovada pelo orientador', grupo: 'Aluno', papeis: ['ALUNO'] },
  { chave: 'aluno_continuidade_confirmada', rotulo: 'Continuidade confirmada pelo orientador', grupo: 'Aluno', papeis: ['ALUNO'] },
  { chave: 'aluno_continuidade_rejeitada', rotulo: 'Continuidade rejeitada / descontinuação', grupo: 'Aluno', papeis: ['ALUNO'] },
  { chave: 'aluno_banca_fase1_formada', rotulo: 'Banca da Fase I formada', grupo: 'Aluno', papeis: ['ALUNO'] },
  { chave: 'aluno_resultado_fase1', rotulo: 'Resultado da Fase I validado', grupo: 'Aluno', papeis: ['ALUNO'] },
  { chave: 'aluno_resultado_fase2', rotulo: 'Resultado da Fase II validado', grupo: 'Aluno', papeis: ['ALUNO'] },
  { chave: 'aluno_versao_final_solicitada', rotulo: 'Versão final solicitada', grupo: 'Aluno', papeis: ['ALUNO'] },
  { chave: 'aluno_versao_final_rejeitada', rotulo: 'Versão final rejeitada pelo orientador', grupo: 'Aluno', papeis: ['ALUNO'] },
  { chave: 'aluno_tcc_concluido', rotulo: 'TCC concluído / aprovado', grupo: 'Aluno', papeis: ['ALUNO'] },
  // Orientador (professor)
  { chave: 'orientador_definido', rotulo: 'Definido como orientador de um TCC aprovado', grupo: 'Orientação', papeis: ['PROFESSOR'] },
  { chave: 'orientador_monografia_enviada', rotulo: 'Aluno enviou/reenviou monografia', grupo: 'Orientação', papeis: ['PROFESSOR'] },
  { chave: 'orientador_confirmar_continuidade', rotulo: 'Precisa confirmar continuidade', grupo: 'Orientação', papeis: ['PROFESSOR'] },
  { chave: 'orientador_versao_final_enviada', rotulo: 'Aluno enviou versão final', grupo: 'Orientação', papeis: ['PROFESSOR'] },
  { chave: 'orientador_versao_final_reenviada', rotulo: 'Versão final reenviada após ajustes', grupo: 'Orientação', papeis: ['PROFESSOR'] },
  { chave: 'orientador_tcc_concluido', rotulo: 'TCC concluído', grupo: 'Orientação', papeis: ['PROFESSOR'] },
  // Coordenador
  { chave: 'coord_nova_solicitacao', rotulo: 'Nova solicitação aguardando análise', grupo: 'Coordenação', papeis: ['COORDENADOR'] },
  // coord_solicitacao_corrigida removido por ora: o "Corrigir e reenviar" apaga o TCC recusado
  // e cria um novo (vira coord_nova_solicitacao); não há como distinguir reabertura sem mudar o fluxo.
  { chave: 'coord_formar_banca_fase1', rotulo: 'Monografia aprovada + continuidade: formar banca Fase I', grupo: 'Coordenação', papeis: ['COORDENADOR'] },
  { chave: 'coord_validar_fase1', rotulo: 'Notas da Fase I completas: validar', grupo: 'Coordenação', papeis: ['COORDENADOR'] },
  { chave: 'coord_validar_fase2', rotulo: 'Notas da Fase II completas: validar', grupo: 'Coordenação', papeis: ['COORDENADOR'] },
  // Avaliadores / membros da banca (professor ou avaliador)
  { chave: 'avaliador_adicionado_fase1', rotulo: 'Adicionado à banca da Fase I', grupo: 'Banca', papeis: ['PROFESSOR', 'AVALIADOR'] },
  { chave: 'avaliador_fase1_liberada', rotulo: 'Avaliação da Fase I liberada', grupo: 'Banca', papeis: ['PROFESSOR', 'AVALIADOR'] },
  { chave: 'avaliador_adicionado_fase2', rotulo: 'Adicionado à banca da Fase II', grupo: 'Banca', papeis: ['PROFESSOR', 'AVALIADOR'] },
  { chave: 'avaliador_fase2_liberada', rotulo: 'Avaliação da Fase II liberada', grupo: 'Banca', papeis: ['PROFESSOR', 'AVALIADOR'] },
  // Coorientador (professor ou avaliador)
  { chave: 'coorientador_indicado', rotulo: 'Indicado como coorientador', grupo: 'Coorientação', papeis: ['PROFESSOR', 'AVALIADOR'] },
  { chave: 'coorientador_mudanca_fase', rotulo: 'Mudança de fase importante do TCC', grupo: 'Coorientação', papeis: ['PROFESSOR', 'AVALIADOR'] },
];

export const CHAVES_EVENTO_EMAIL = EVENTOS_EMAIL.map((e) => e.chave);
