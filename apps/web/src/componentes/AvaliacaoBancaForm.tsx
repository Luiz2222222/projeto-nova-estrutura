// Formulário de avaliação da banca (notas + comentário por critério, parecer geral,
// nota total ao vivo) extraído da página AvaliarBanca para ser reaproveitado também
// DENTRO da página do orientando (DetalheOrientando), onde o ORIENTADOR avalia a Fase II.
// Fluxo (backend já suporta rascunho/reabertura): PENDENTE = editável, com "Salvar
// rascunho" (finalizar=false) e "Enviar" (finalizar=true). ENVIADO = leitura + "Editar"
// (POST .../reabrir → volta a PENDENTE). BLOQUEADO/CONCLUIDO = leitura sem reabrir.
import type { MembroBanca } from '../tipos';
import { useEffect, useMemo, useState } from 'react';
import { apiPost, type ErroApi } from '../api';
import { Modal } from './Modal';
import { ModalConfirmacao } from './ModalConfirmacao';
import { CRITERIOS_FASE1, CRITERIOS_FASE2, colunaNota, colunaPeso, type Criterio } from '@tcc/compartilhado';

// Erros do backend que significam "esta avaliação não pode mais ser editada" — a
// coordenação travou/cancelou/iniciou a análise enquanto o avaliador estava com a tela
// aberta. Nesses casos não adianta reeditar o formulário: o certo é avisar e recarregar.
// (O front já valida notas/campos ANTES de chamar a API, então esses erros só chegam do
// servidor por mudança de estado — daí a detecção por mensagem, sem tocar na regra.)
function ehAvaliacaoTravada(e: ErroApi): boolean {
  const msg = (e?.mensagem ?? '').toLowerCase();
  return [
    'iniciou a análise', // "A coordenação já iniciou a análise..."
    'travad', // "...travada pela coordenação. Atualize a página."
    'bloquead', // "Esta avaliação foi bloqueada/concluída..."
    'não está em fase de avaliação',
    'reabra antes de salvar',
    'só é possível reabrir', // reabrir com estado já mudado
    'não é possível reabrir',
  ].some((k) => msg.includes(k));
}

const fmt = (n: number) => String(n).replace('.', ',');
const parseBR = (v: string): number | null => {
  if (!v.trim()) return null;
  const n = parseFloat(v.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
// Máscara/clamp das notas: remove letras/símbolos, ponto vira vírgula, só uma vírgula,
// até 2 casas decimais, mantém estado intermediário ("1,") e a nota entre 0 e o peso.
function clampScore(raw: string, max: number, atual: string): string {
  if (raw === '') return '';
  const limpo = raw.replace(/[^\d,.]/g, '').replace(/\./g, ',');
  if ((limpo.match(/,/g) || []).length > 1) return atual;
  if (!/^\d{0,2}(,\d{0,2})?$/.test(limpo)) return atual;
  const num = parseBR(limpo);
  if (num !== null && !limpo.endsWith(',')) {
    const clamped = Math.max(0, Math.min(num, max));
    return String(clamped).replace('.', ',');
  }
  return limpo;
}
const numToStr = (v: unknown) => (v == null ? '' : String(v).replace('.', ','));

// Parecer estruturado: "=== Rótulo ===\ncomentário" por critério + "=== Parecer geral ===".
const stripHeader = (t: string) => t.replace(/^===\s*.+?\s*===\s*/i, '').trim();
function extrairSecao(parecer: string, secao: string): string {
  const re = new RegExp(`===\\s*${secao.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*===\\s*([\\s\\S]*?)(?=\\n===|$)`, 'i');
  const m = parecer.match(re);
  return m ? m[1].trim() : '';
}

interface Props {
  // Membro da banca do usuário (de /bancas/minhas): banca.fase, banca.tcc.faseAtual,
  // pesos, bloqueado, status, colunas de nota e parecer, bancaId.
  membro: MembroBanca;
  // Chamado após salvar/reabrir para o pai recarregar e repassar o membro atualizado.
  aoAtualizar: () => void | Promise<void>;
}

export function AvaliacaoBancaForm({ membro: m, aoAtualizar }: Props) {
  const [notas, setNotas] = useState<Record<string, string>>({});
  const [comentarios, setComentarios] = useState<Record<string, string>>({});
  const [parecerGeral, setParecerGeral] = useState('');
  const [erro, setErro] = useState('');
  const [mensagem, setMensagem] = useState('');
  // Ação em curso: só o botão da própria ação mostra "…"; os outros ficam desativados
  // (sem trocar o texto para o loading de outra ação).
  const [acaoEmCurso, setAcaoEmCurso] = useState<null | 'rascunho' | 'enviar' | 'editar'>(null);
  const enviando = acaoEmCurso !== null;
  const [confirmacao, setConfirmacao] = useState<null | 'enviar' | 'reabrir'>(null);
  const [erroConfirmacao, setErroConfirmacao] = useState('');
  // Mensagem do modal simples (só texto + "Ok") mostrado quando a avaliação foi travada/
  // cancelada pela coordenação. Ao fechar, recarrega os dados da avaliação.
  const [erroTravado, setErroTravado] = useState('');

  // Mostra o modal simples de "avaliação travada" e limpa qualquer outro erro/modal aberto
  // (para não exibir dois erros ao mesmo tempo — inclusive fecha o modal de confirmação).
  function mostrarTravada(msg?: string) {
    setErro('');
    setMensagem('');
    setErroConfirmacao('');
    setConfirmacao(null);
    setErroTravado(msg || 'Esta avaliação não pode mais ser editada. Atualize a página.');
  }
  // "Ok": fecha o modal e recarrega os dados — o avaliador passa a ver o estado correto,
  // sem o rascunho cancelado. (aoAtualizar re-busca no pai; erros dele não travam a tela.)
  async function fecharTravada() {
    setErroTravado('');
    try {
      await aoAtualizar();
    } catch {
      /* re-fetch do pai falhou: nada a fazer aqui além de já ter fechado o aviso */
    }
  }

  const fase: string | undefined = m?.banca?.fase;
  const ehF2 = fase === 'FASE_2';
  const criterios: Criterio[] = ehF2 ? CRITERIOS_FASE2 : CRITERIOS_FASE1;
  const status: string = m?.status ?? 'PENDENTE';
  const faseAval = ehF2 ? 'AVALIACAO_FASE_2' : 'AVALIACAO_FASE_1';
  const faseAguardando = ehF2 ? 'AGUARDANDO_ANALISE_COORDENACAO_FASE_2' : 'AGUARDANDO_ANALISE_COORDENACAO_FASE_1';
  const faseValid = ehF2 ? 'VALIDACAO_FASE_2' : 'VALIDACAO_FASE_1';
  const faseAtual: string | undefined = m?.banca?.tcc?.faseAtual;
  const emAvaliacao = faseAtual === faseAval;
  const emAguardando = faseAtual === faseAguardando;
  const emValidacao = faseAtual === faseValid;
  // Janela de edição normal: durante a avaliação ou enquanto aguarda a análise da coordenação.
  const emAberto = emAvaliacao || emAguardando;
  // Em VALIDACAO a banca está travada; só reenvia quem tem ajuste solicitado pela coordenação.
  const ajusteSolicitado = status === 'AJUSTE_SOLICITADO' && emValidacao;
  const editavel = !!m && ((status === 'PENDENTE' && emAberto) || ajusteSolicitado);
  // Rascunho: na avaliação normal (PENDENTE) OU durante um ajuste solicitado pela coordenação
  // (o avaliador pode salvar o progresso antes de reenviar).
  const podeRascunho = !!m && ((status === 'PENDENTE' && emAvaliacao) || ajusteSolicitado);
  const podeReabrir = !!m && status === 'ENVIADO' && emAberto; // reabrir só antes da análise
  const leitura = !editavel;
  const bloqueadoPrazo = !!m?.bloqueado;
  const numCor = ehF2 ? 'var(--roxo)' : 'var(--azul-forte)';

  // Carrega o que estiver salvo: rascunho PRIVADO (se houver) ou a avaliação enviada (colunas
  // oficiais). O rascunho fica na coluna `rascunho` (JSON), separado das colunas oficiais.
  useEffect(() => {
    if (!m) return;
    let notasFonte: Record<string, unknown> = {};
    let parecerFonte: string = m.parecer ?? '';
    let temRascunho = false;
    if (m.rascunho) {
      try {
        const r = JSON.parse(m.rascunho);
        notasFonte = r?.notas ?? {};
        parecerFonte = r?.parecer ?? '';
        temRascunho = true;
      } catch { /* rascunho inválido: usa as colunas oficiais */ }
    }
    const ns: Record<string, string> = {};
    const cs: Record<string, string> = {};
    for (const c of criterios) {
      ns[c.chave] = numToStr(temRascunho ? notasFonte[c.chave] : m[colunaNota(c.chave)]);
      cs[c.chave] = extrairSecao(parecerFonte, c.rotulo);
    }
    setNotas(ns);
    setComentarios(cs);
    setParecerGeral(extrairSecao(parecerFonte, 'Parecer geral'));
  }, [m?.id, m?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const peso = (c: Criterio) => Number(m?.pesos?.[colunaPeso(c.chave)] ?? c.pesoPadrao);

  const total = useMemo(() => {
    let soma = 0;
    for (const c of criterios) {
      const n = parseBR(notas[c.chave] ?? '');
      if (n == null) return null;
      soma += n;
    }
    return soma;
  }, [notas, criterios]);

  function construirParecer(): string {
    const partes: string[] = [];
    for (const c of criterios) {
      const t = stripHeader((comentarios[c.chave] ?? '').trim());
      if (t) partes.push(`=== ${c.rotulo} ===\n${t}`);
    }
    const g = stripHeader(parecerGeral.trim());
    if (g) partes.push(`=== Parecer geral ===\n${g}`);
    return partes.join('\n\n');
  }

  // finalizar=false → salva rascunho (notas parciais); finalizar=true → envia (exige todas).
  async function salvar(finalizar: boolean, reportar: (msg: string) => void): Promise<boolean> {
    reportar('');
    setMensagem('');
    const corpo: Record<string, number> = {};
    for (const c of criterios) {
      const n = parseBR(notas[c.chave] ?? '');
      if (n == null) {
        if (finalizar) { reportar(`Preencha a nota de "${c.rotulo}" para enviar.`); return false; }
        continue;
      }
      if (n < 0 || n > peso(c)) { reportar(`A nota de "${c.rotulo}" deve estar entre 0 e ${fmt(peso(c))}.`); return false; }
      corpo[c.chave] = n;
    }
    setAcaoEmCurso(finalizar ? 'enviar' : 'rascunho');
    try {
      await apiPost(`/bancas/${m.bancaId}/avaliar`, { notas: corpo, parecer: construirParecer() || undefined, finalizar });
      await aoAtualizar();
      setMensagem(finalizar ? 'Avaliação enviada.' : 'Rascunho salvo.');
      return true;
    } catch (e) {
      const er = e as ErroApi;
      // Vale para rascunho (finalizar=false) e envio (finalizar=true): se a coordenação
      // travou/cancelou a avaliação, mostra o modal simples com "Ok" (que recarrega), em
      // vez do erro comum da tela/modal.
      if (ehAvaliacaoTravada(er)) mostrarTravada(er.mensagem);
      else reportar(er.mensagem || 'Não foi possível salvar.');
      return false;
    } finally {
      setAcaoEmCurso(null);
    }
  }

  // Reabre a avaliação enviada para edição (ENVIADO → PENDENTE), preservando os dados.
  async function reabrir(reportar: (msg: string) => void): Promise<boolean> {
    reportar('');
    setMensagem('');
    setAcaoEmCurso('editar');
    try {
      await apiPost(`/bancas/${m.bancaId}/reabrir`, {});
      await aoAtualizar();
      setMensagem('Avaliação reaberta para edição.');
      return true;
    } catch (e) {
      const er = e as ErroApi;
      if (ehAvaliacaoTravada(er)) mostrarTravada(er.mensagem);
      else reportar(er.mensagem || 'Não foi possível reabrir a avaliação.');
      return false;
    } finally {
      setAcaoEmCurso(null);
    }
  }

  async function confirmarEnvio() {
    if (await salvar(true, setErroConfirmacao)) setConfirmacao(null);
  }
  async function confirmarReabrir() {
    if (await reabrir(setErroConfirmacao)) setConfirmacao(null);
  }

  if (!m) return null;

  return (
    <>
      {erro && <div className="erro-geral">{erro}</div>}
      {mensagem && <div className="alerta" style={{ background: 'var(--aprovado-suave)', color: 'var(--aprovado)', marginBottom: 14 }}>{mensagem}</div>}
      {bloqueadoPrazo && (
        <div className="aviso-prazo">⏰ O prazo desta etapa venceu. Para salvar/enviar a avaliação, peça à coordenação uma liberação individual deste TCC.</div>
      )}
      {ajusteSolicitado && (
        <div className="alerta" style={{ background: 'rgba(245,158,11,.12)', color: '#b45309', marginBottom: 14 }}>
          <strong>A coordenação solicitou um ajuste na sua avaliação.</strong>
          {m?.ajusteMotivo ? <span className="alerta-motivo">Motivo: {m.ajusteMotivo}</span> : null}
        </div>
      )}
      {leitura && (() => {
        const msgLeitura =
          status === 'ENVIADO'
            ? (emValidacao ? '' : 'Avaliação enviada. Para alterar as notas ou o parecer, clique em "Editar".')
            : status === 'EM_ANALISE'
              ? 'A coordenação iniciou a análise das avaliações — sua avaliação está travada (somente leitura).'
              : status === 'APROVADO'
                ? 'Sua avaliação foi aprovada pela coordenação (somente leitura).'
                : status === 'BLOQUEADO'
                  ? 'Avaliação bloqueada pela coordenação — não é possível editar.'
                  : status === 'CONCLUIDO'
                    ? 'Fase concluída — esta avaliação está encerrada (somente leitura).'
                    : 'Esta fase ainda não está liberada para avaliação. Você poderá avaliar quando o TCC chegar à fase correspondente.';
        return msgLeitura ? (
          <div className="alerta" style={{ background: 'rgba(245,158,11,.12)', color: '#b45309', marginBottom: 14 }}>{msgLeitura}</div>
        ) : null;
      })()}
      <div className="criterios-lista">
        {criterios.map((c, i) => (
          <div key={c.chave} className="criterio-card">
            <span className="criterio-num" style={{ background: numCor }}>{i + 1}</span>
            <div className="criterio-corpo">
              <div className="criterio-cabecalho">
                <span className="criterio-titulo">{c.rotulo}</span>
                <span className="criterio-nota">
                  <input
                    inputMode="decimal"
                    value={notas[c.chave] ?? ''}
                    disabled={leitura || enviando}
                    onChange={(e) => setNotas((v) => ({ ...v, [c.chave]: clampScore(e.target.value, peso(c), v[c.chave] ?? '') }))}
                    placeholder="–"
                  />
                  <span className="criterio-peso">/ {fmt(Number(peso(c).toFixed(1)))}</span>
                </span>
              </div>
              <p className="criterio-desc">{c.descricao}</p>
              <textarea
                rows={2}
                className="criterio-comentario"
                value={comentarios[c.chave] ?? ''}
                disabled={leitura || enviando}
                onChange={(e) => setComentarios((v) => ({ ...v, [c.chave]: e.target.value }))}
                placeholder={leitura ? 'Sem comentário.' : 'Justifique a nota atribuída…'}
              />
            </div>
          </div>
        ))}
      </div>

      <label className="campo" style={{ marginTop: 16 }}>
        <span>Parecer geral (opcional)</span>
        <textarea rows={4} value={parecerGeral} disabled={leitura || enviando} onChange={(e) => setParecerGeral(e.target.value)} placeholder={leitura ? 'Sem parecer geral.' : 'Comentários gerais sobre o trabalho…'} />
      </label>

      <div className="nota-total-box">
        <span>Nota total{ehF2 ? ' (NF2)' : ' (NF1)'}:</span>
        <strong>{total != null ? fmt(Number(total.toFixed(2))) : '—'}</strong>
        <span className="nota-total-max">/ 10,0</span>
      </div>

      <div className="acoes" style={{ justifyContent: 'flex-start' }}>
        {podeRascunho && !bloqueadoPrazo && (
          <button className="botao botao-secundario" disabled={enviando} onClick={() => salvar(false, setErro)}>
            {acaoEmCurso === 'rascunho' ? 'Salvando…' : 'Salvar rascunho'}
          </button>
        )}
        {podeReabrir ? (
          <button className="botao" disabled={enviando || bloqueadoPrazo} onClick={() => { setErro(''); setMensagem(''); setErroConfirmacao(''); setConfirmacao('reabrir'); }}>
            {acaoEmCurso === 'editar' ? 'Editando…' : 'Editar'}
          </button>
        ) : editavel ? (
          <button className="botao" disabled={enviando || total == null || bloqueadoPrazo} onClick={() => { setErro(''); setMensagem(''); setErroConfirmacao(''); setConfirmacao('enviar'); }}>
            {acaoEmCurso === 'enviar' ? 'Enviando…' : 'Enviar'}
          </button>
        ) : null}
      </div>

      {confirmacao === 'enviar' && (
        <ModalConfirmacao
          titulo="Enviar avaliação"
          mensagem="Deseja confirmar o envio da avaliação?"
          textoConfirmar="Confirmar envio"
          textoProcessando="Enviando…"
          processando={enviando}
          erro={erroConfirmacao}
          aoConfirmar={confirmarEnvio}
          aoCancelar={() => setConfirmacao(null)}
        />
      )}

      {confirmacao === 'reabrir' && (
        <ModalConfirmacao
          titulo="Editar avaliação enviada"
          mensagem="Deseja reabrir esta avaliação para edição? O status volta para pendente até você enviar novamente."
          textoConfirmar="Reabrir para editar"
          textoProcessando="Reabrindo…"
          processando={enviando}
          erro={erroConfirmacao}
          aoConfirmar={confirmarReabrir}
          aoCancelar={() => setConfirmacao(null)}
        />
      )}

      {/* Avaliação travada/cancelada pela coordenação: aviso simples só com a mensagem do
          backend e "Ok". Modal preso (sem X, sem clicar fora, sem Esc): só fecha no "Ok",
          que então recarrega os dados da avaliação. */}
      {erroTravado && (
        <Modal titulo="Avaliação indisponível" aoFechar={fecharTravada} semFechar>
          <p className="modal-confirma-texto">{erroTravado}</p>
          <div className="acoes" style={{ justifyContent: 'flex-end' }}>
            <button className="botao" onClick={fecharTravada}>Ok</button>
          </div>
        </Modal>
      )}
    </>
  );
}
