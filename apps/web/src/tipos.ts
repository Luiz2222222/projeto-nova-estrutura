// Tipos dos payloads REAIS da API (modelo Prisma serializado + campos anexados pelos
// services). São deliberadamente permissivos onde o backend varia por papel (ex.: o
// aluno anonimizado da Fase I vem null; notas sanitizadas somem do objeto).
// Datas viajam como string ISO (JSON).
import type { Papel } from '@tcc/compartilhado';

export interface UsuarioResumo {
  id: string;
  nomeCompleto: string;
  email?: string | null;
  papel?: Papel | string;
  tratamento?: string | null;
  disponivelParaOrientar?: boolean;
  _count?: { tccsComoOrientador?: number; tccsComoCoorientador?: number; bancasComoAvaliador?: number };
  afiliacao?: string | null;
  curso?: string | null;
}

export interface DocumentoTcc {
  id: string;
  tipo: string;
  status: string;
  versao: number;
  nomeArquivo: string;
  parecer?: string | null;
  tamanho?: number;
  criadoEm?: string;
}

export interface SolicitacaoTcc {
  id?: string;
  status: string;
  mensagem?: string | null;
  parecer?: string | null;
  criadoEm?: string;
  respondidoEm?: string | null;
}

// Notas por critério chegam em colunas dinâmicas (nota1..nota5/peso...), por isso a
// assinatura de índice com unknown — quem lê faz narrowing (Number(...) etc.).
export interface MembroBanca {
  id: string;
  avaliadorId: string;
  status?: string;
  nota?: number | null;
  parecer?: string | null;
  rascunho?: string | null;
  avaliadoEm?: string | null;
  ajusteMotivo?: string | null;
  ajusteReenviadoEm?: string | null;
  avaliador?: UsuarioResumo;
  banca?: Banca;
  pesos?: PesosCalendario | null;
  [coluna: string]: unknown;
}

// Linha do calendário do semestre com os pesos: pesoFase1/pesoFase2 + colunas dinâmicas
// de peso por critério (peso1F1...) — quem lê usa pesoDe() com fallback do domínio.
export interface PesosCalendario {
  pesoFase1?: number | null;
  pesoFase2?: number | null;
  [coluna: string]: unknown;
}

export interface Banca {
  id: string;
  fase: 'FASE_1' | 'FASE_2';
  criadoEm?: string;
  membros?: MembroBanca[];
  documentoAvaliacao?: DocumentoTcc | null;
  tcc?: Tcc;
}

export interface Tcc {
  id: string;
  titulo: string;
  semestre?: string;
  faseAtual: string;
  monografiaAprovada?: boolean;
  continuidadeConfirmada?: boolean;
  parecerContinuidade?: string | null;
  faseAnteriorDescontinuacao?: string | null;
  objetivos?: string | null;
  resumo?: string | null;
  descricao?: string | null;

  nf1?: number | null;
  nf2?: number | null;
  nf?: number | null;
  resultado?: string | null;

  // Agendamento da defesa (Fase II)
  defesaAgendadaPara?: string | null;
  defesaLocal?: string | null;
  defesaComentario?: string | null;
  defesaAgendadaEm?: string | null;
  defesaLiberadaEm?: string | null;

  // Datas reais dos atos (timeline)
  monografiaAprovadaEm?: string | null;
  continuidadeAvaliadaEm?: string | null;
  fase1ValidadaEm?: string | null;
  fase2ValidadaEm?: string | null;
  versaoFinalValidadaEm?: string | null;
  concluidoEm?: string | null;
  criadoEm?: string;
  atualizadoEm?: string;

  alunoId?: string | null;
  aluno?: UsuarioResumo | null;
  orientadorId?: string | null;
  orientador?: UsuarioResumo | null;
  coorientadorId?: string | null;
  coorientador?: UsuarioResumo | null;
  coorientadorNome?: string | null;
  coorientadorTitulacao?: string | null;
  coorientadorAfiliacao?: string | null;
  coorientadorLattes?: string | null;

  documentos?: DocumentoTcc[];
  bancas?: Banca[];
  solicitacoes?: SolicitacaoTcc[];

  // Anexos por papel/endpoint
  bloqueios?: Record<string, boolean>;
  pesoFase1?: number;
  pesoFase2?: number;
}

// Visões parciais úteis: telas que só leem alguns campos aceitam o objeto inteiro.
export type TccResumo = Partial<Tcc>;
