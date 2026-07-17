// Página interna de detalhe do orientando (visão do orientador/professor).
// Espelha o layout do projeto antigo (DetalheOrientandoProfessor.tsx) com o padrão
// visual novo (igual ao TccDetalheCoordenador): voltar, título + fase, informações
// do orientando, orientação/coorientação, descrição, timeline vertical detalhada,
// documentos iniciais, monografias, continuidade, versão final e notas.
// Regras do projeto NOVO:
//  - a banca da Fase II é o orientador + os 2 avaliadores da Fase I (o orientador
//    AGENDA A DEFESA e avalia a Fase II AQUI mesmo, nesta página do orientando; a
//    avaliação da banca é liberada automaticamente na data/hora marcada);
//  - a versão final pós-Fase II é validada pelo ORIENTADOR (aqui), não pelo coordenador;
//  - sem nenhuma etapa de análise final do coordenador.
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { apiGet, apiPost, apiPut, apiDelete, URL_API, type ErroApi } from '../../api';
import { useAuth } from '../../autenticacao/contexto';
import { Modal } from '../../componentes/Modal';
import { ModalConfirmacao } from '../../componentes/ModalConfirmacao';
import { ROTULO_FASE } from '../../utils/fases';
import { ROTULO_CURSO } from '@tcc/compartilhado';
import { TimelineVerticalDetalhada } from '../../componentes/TimelineVerticalDetalhada';
import { CardNotasFinais } from '../../componentes/CardNotasFinais';
import { AvaliacaoBancaForm } from '../../componentes/AvaliacaoBancaForm';
import { BancaNotasTcc } from '../../componentes/BancaNotasTcc';
import { ModalExcluirTcc } from '../../componentes/ModalExcluirTcc';
import { CardDefesa } from '../../componentes/CardDefesa';

const ic = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {d.split('|').map((p, i) => <path key={i} d={p} />)}
  </svg>
);
const icoVoltar = ic('M19 12H5|M12 19l-7-7 7-7');
const icoOlho = ic('M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z|M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0');
const icoBaixar = ic('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4|M7 10l5 5 5-5|M12 15V3');
const icoUser = ic('M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2|M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8');
const icoDoc = ic('M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z|M14 2v6h6');
const icoBanca = ic('M12 2l9 4.5-9 4.5-9-4.5L12 2z|M3 12l9 4.5 9-4.5');
const icoCheck = ic('M22 11.08V12a10 10 0 1 1-5.93-9.14|M22 4 12 14.01l-3-3');

const cursoDe = (c?: string) => (c ? (ROTULO_CURSO as Record<string, string>)[c] ?? c : '—');
const nomeComTrat = (p?: any) => (p ? `${p.tratamento ? p.tratamento + ' ' : ''}${p.nomeCompleto}` : '—');
const fmtNota = (v: any) => (v != null ? Number(v).toFixed(2).replace('.', ',') : '—');
const fmtData = (iso?: string | null) => {
  if (!iso) return '—';
  const [a, m, d] = iso.split('T')[0].split('-');
  return a && m && d ? `${d}/${m}/${a}` : '—';
};
// O formulário de agendamento edita SEMPRE no fuso oficial do curso (America/Fortaleza,
// UTC-3 fixo, sem horário de verão) — independente do fuso do computador de quem edita.
// Abrir e salvar sem mexer em nada preserva exatamente o mesmo instante.
const OFFSET_FORTALEZA = '-03:00';
function partesDefesaFortaleza(iso: string): { data: string; hora: string } {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Fortaleza', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(iso));
  const p = (t: string) => partes.find((x) => x.type === t)?.value ?? '';
  return { data: `${p('year')}-${p('month')}-${p('day')}`, hora: `${p('hour')}:${p('minute')}` };
}

const rotuloStatusDoc = (s: string) =>
  ({ PENDENTE: 'Aguardando avaliação', EM_ANALISE: 'Em análise', APROVADO: 'Aprovada', REJEITADO: 'Rejeitada (aguardando reenvio)', SUBSTITUIDA: 'Substituída' } as Record<string, string>)[s] ?? s;

type Doc = { id: string; tipo: string; status: string; versao: number; parecer?: string | null; nomeArquivo: string };
const docsDe = (docs: Doc[] = [], tipo: string) => docs.filter((d) => d.tipo === tipo).sort((a, b) => b.versao - a.versao);

// Linha de documento com olho (visualizar) + baixar, no padrão visual novo.
function ItemDoc({ d, comOlho }: { d: Doc; comOlho?: boolean }) {
  return (
    <div className="item-arquivo">
      <div className="item-arquivo-info">
        {icoDoc}
        <div>
          <span className="nome">{d.nomeArquivo}</span>
          <span className="meta">Versão {d.versao} · {rotuloStatusDoc(d.status)}</span>
        </div>
      </div>
      <span className="acoes-doc">
        {comOlho && (
          <a className="botao-icone" title="Visualizar" href={`${URL_API}/tccs/documentos/${d.id}/visualizar`} target="_blank" rel="noreferrer">{icoOlho}</a>
        )}
        <a className="botao-icone" title="Baixar" href={`${URL_API}/tccs/documentos/${d.id}/baixar`} target="_blank" rel="noreferrer">{icoBaixar}</a>
      </span>
    </div>
  );
}

export function DetalheOrientando() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { usuario } = useAuth();

  const [tccs, setTccs] = useState<any[]>([]);
  const [bancasMinhas, setBancasMinhas] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [recusa, setRecusa] = useState<{ tipo: 'monografia' | 'continuidade' | 'versaofinal' } | null>(null);
  const [confirmarAcao, setConfirmarAcao] = useState<null | 'continuidade' | 'monografia' | 'versaofinal'>(null);
  // Agendamento da defesa (Fase II): modal com data/hora/local/comentário.
  const [agendando, setAgendando] = useState(false);
  const [defData, setDefData] = useState('');
  const [defHora, setDefHora] = useState('');
  const [defLocal, setDefLocal] = useState('');
  const [defComentario, setDefComentario] = useState('');
  const [erroDefesa, setErroDefesa] = useState('');
  const [parecer, setParecer] = useState('');
  const [erro, setErro] = useState('');
  const [erroAcao, setErroAcao] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [excluindo, setExcluindo] = useState(false); // modal "Excluir TCC"
  const [excluindoProc, setExcluindoProc] = useState(false);
  const [erroExcluir, setErroExcluir] = useState('');

  function carregar() {
    setCarregando(true);
    apiGet('/tccs/orientando').then(setTccs).catch(() => setTccs([])).finally(() => setCarregando(false));
    // Carrega também o membro da banca do próprio orientador (com pesos/bloqueio) para
    // avaliar a Fase II aqui mesmo, sem ir para "Participações em bancas".
    apiGet('/bancas/minhas').then(setBancasMinhas).catch(() => setBancasMinhas([]));
  }
  useEffect(carregar, []);

  // Exclusão LÓGICA do TCC pelo ORIENTADOR (o backend valida que o usuário é o orientador
  // deste TCC; senão 403). Após excluir, volta para "Meus orientandos".
  async function excluirTcc(motivo: string) {
    if (!tcc) return;
    setErroExcluir('');
    setExcluindoProc(true);
    try {
      await apiDelete(`/tccs/${tcc.id}`, { motivo });
      navigate('/professor/orientandos');
    } catch (e) {
      setErroExcluir((e as ErroApi).mensagem || 'Não foi possível excluir o TCC.');
      setExcluindoProc(false);
    }
  }

  const tcc = useMemo(() => tccs.find((t) => t.id === id), [tccs, id]);
  // Membro da banca da Fase II que é meu (orientador) neste TCC. /bancas/minhas já só
  // devolve membros do usuário atual, então basta casar fase + TCC.
  const meuMembroFase2 = useMemo(
    () => bancasMinhas.find((x) => x.banca?.fase === 'FASE_2' && x.banca?.tcc?.id === id) ?? null,
    [bancasMinhas, id],
  );

  // Deep link: rola até a seção (#acao / #acao-fase2) e destaca por alguns segundos.
  const location = useLocation();
  useEffect(() => {
    if (carregando || !tcc || !location.hash) return;
    const el = document.getElementById(location.hash.slice(1));
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('secao-destaque');
    const t = setTimeout(() => el.classList.remove('secao-destaque'), 2400);
    return () => clearTimeout(t);
  }, [carregando, tcc, location.hash]);

  // Ações positivas diretas (confirmar continuidade / aprovar monografia / aprovar e
  // concluir) passam por um modal de confirmação antes de executar.
  function pedirConfirmacao(qual: 'continuidade' | 'monografia' | 'versaofinal') {
    setErroAcao('');
    setConfirmarAcao(qual);
  }
  async function executarAcao() {
    if (!confirmarAcao || !tcc) return;
    setErroAcao('');
    setEnviando(true);
    try {
      if (confirmarAcao === 'continuidade') await apiPost(`/tccs/${tcc.id}/continuidade`, { decisao: 'CONFIRMAR' });
      else if (confirmarAcao === 'monografia') await apiPost(`/tccs/${tcc.id}/monografia/avaliar`, { decisao: 'APROVAR' });
      else await apiPost(`/tccs/${tcc.id}/validar-versao-final`, { decisao: 'CONCLUIR' });
      setConfirmarAcao(null);
      carregar();
    } catch (e) {
      setErroAcao((e as ErroApi).mensagem || 'Não foi possível concluir a ação.');
    } finally {
      setEnviando(false);
    }
  }

  // Abre o modal de agendamento pré-preenchido (edição) ou vazio (primeiro agendamento).
  // Pré-preenchimento SEMPRE no fuso de Fortaleza (não no fuso do navegador).
  function abrirAgendamento() {
    const d = tcc?.defesaAgendadaPara ? partesDefesaFortaleza(tcc.defesaAgendadaPara) : null;
    setDefData(d?.data ?? '');
    setDefHora(d?.hora ?? '');
    setDefLocal(tcc?.defesaLocal ?? '');
    setDefComentario(tcc?.defesaComentario ?? '');
    setErroDefesa('');
    setAgendando(true);
  }

  // Salva o agendamento (PUT idempotente). Qualquer data vale — se já passou, o backend
  // libera a avaliação da Fase II imediatamente; se é futura, libera na hora marcada.
  async function salvarDefesa() {
    if (!tcc) return;
    if (!defData || !defHora) { setErroDefesa('Informe a data e a hora da defesa.'); return; }
    if (!defLocal.trim()) { setErroDefesa('Informe o local da defesa.'); return; }
    // Interpreta o que foi digitado como horário de Fortaleza (UTC-3 fixo), não do navegador.
    const quando = new Date(`${defData}T${defHora}:00${OFFSET_FORTALEZA}`);
    if (Number.isNaN(quando.getTime())) { setErroDefesa('Data e hora inválidas.'); return; }
    setErroDefesa('');
    setEnviando(true);
    try {
      await apiPut(`/tccs/${tcc.id}/defesa`, {
        dataHora: quando.toISOString(),
        local: defLocal.trim(),
        comentario: defComentario.trim() || undefined,
      });
      setAgendando(false);
      carregar();
    } catch (e) {
      const er = e as ErroApi;
      setErroDefesa(er.erros?.[0]?.mensagem || er.mensagem || 'Não foi possível salvar o agendamento.');
    } finally {
      setEnviando(false);
    }
  }

  async function confirmarRecusa() {
    if (!recusa || !tcc) return;
    setErro('');
    setEnviando(true);
    try {
      if (recusa.tipo === 'monografia') {
        await apiPost(`/tccs/${tcc.id}/monografia/avaliar`, { decisao: 'REJEITAR', parecer });
      } else if (recusa.tipo === 'versaofinal') {
        await apiPost(`/tccs/${tcc.id}/validar-versao-final`, { decisao: 'AJUSTES', parecer });
      } else {
        await apiPost(`/tccs/${tcc.id}/continuidade`, { decisao: 'REJEITAR', parecer });
      }
      setRecusa(null);
      setParecer('');
      carregar();
    } catch (e) {
      const er = e as ErroApi;
      setErro(er.erros?.[0]?.mensagem || er.mensagem || 'Não foi possível concluir.');
    } finally {
      setEnviando(false);
    }
  }

  if (carregando) return <p className="nota-vazio">Carregando…</p>;

  if (!tcc) {
    return (
      <div className="det-cabecalho">
        <button className="det-voltar" onClick={() => navigate('/professor/orientandos')}>{icoVoltar} Voltar para meus orientandos</button>
        <section className="cartao-secao bloco"><p className="nota-vazio">Orientando não encontrado.</p></section>
      </div>
    );
  }

  const fase = tcc.faseAtual as string;
  const emDesenvolvimento = fase === 'DESENVOLVIMENTO';
  // Bloqueios por prazo vencido sem liberação (backend é a fonte real da regra).
  const blkCont = !!tcc.bloqueios?.AVALIACAO_CONTINUIDADE;
  const blkMono = !!tcc.bloqueios?.SUBMISSAO_MONOGRAFIA;
  const blkVf = !!tcc.bloqueios?.VERSAO_FINAL;
  // Fase II: o orientador também é membro da banca. A preparação das bancas e a avaliação
  // do orientador acontecem AQUI (não em "Participações em bancas").
  const bancaF2 = (tcc.bancas ?? []).find((b: any) => b.fase === 'FASE_2');
  const meuMembroF2 = bancaF2?.membros?.find((m: any) => m.avaliadorId === tcc.orientadorId) ?? null;
  // Agendar na fase própria; depois disso o orientador pode ALTERAR o agendamento quando
  // quiser (reagendar nunca regride a fase nem bloqueia avaliações — regra do backend).
  const podeEditarDefesa = fase === 'AGENDAMENTO_DEFESA_FASE_2' || !!tcc.defesaAgendadaPara;
  const mostrarCardDefesa = podeEditarDefesa;
  const podeAvaliarFase2 = (fase === 'AVALIACAO_FASE_2' || fase === 'AGUARDANDO_ANALISE_COORDENACAO_FASE_2' || fase === 'VALIDACAO_FASE_2') && !!meuMembroF2;
  const avisoPrazo = (rot: string) => <div className="aviso-prazo">⏰ O prazo de {rot} venceu. Peça à coordenação uma liberação individual deste TCC.</div>;
  const coorient = tcc.coorientador
    ? `${nomeComTrat(tcc.coorientador)}${tcc.coorientador.afiliacao ? ' · ' + tcc.coorientador.afiliacao : ''}`
    : tcc.coorientadorNome
      ? `${tcc.coorientadorTitulacao ? tcc.coorientadorTitulacao + ' ' : ''}${tcc.coorientadorNome}${tcc.coorientadorAfiliacao ? ' · ' + tcc.coorientadorAfiliacao : ''}`
      : null;
  const descricao = tcc.resumo || tcc.descricao || null;
  const monografias = docsDe(tcc.documentos, 'MONOGRAFIA');
  const ultimaMono = monografias[0] ?? null;
  const iniciais = [...docsDe(tcc.documentos, 'PLANO_DESENVOLVIMENTO'), ...docsDe(tcc.documentos, 'TERMO_ACEITE')];
  const versaoFinal = docsDe(tcc.documentos, 'VERSAO_FINAL')[0] ?? null;
  const bancas = [...(tcc.bancas ?? [])].sort((a: any, b: any) => (a.fase < b.fase ? -1 : 1));
  // Notas só ficam visíveis ao orientador DEPOIS da confirmação da nota final da Fase II
  // (tcc.nf é preenchido na validação da Fase II pela coordenação). Antes disso, nada de
  // NF1/NF2/NF, resultado ou nota por membro — mesma regra da timeline (notasTrilhaTcc).
  // Mesmo critério do backend (sanitizarNotasTcc): nf confirmada OU reprovação terminal.
  const notasLiberadas = tcc.nf != null || ['REPROVADO_FASE_1', 'REPROVADO_FASE_2'].includes(tcc.faseAtual);
  const temNotas = notasLiberadas && (tcc.nf1 != null || tcc.nf2 != null || tcc.nf != null);

  return (
    <>
      {/* Cabeçalho */}
      <div className="det-cabecalho">
        <button className="det-voltar" onClick={() => navigate('/professor/orientandos')}>{icoVoltar} Voltar para meus orientandos</button>
        <div className="det-titulo-area">
          <div style={{ minWidth: 0 }}>
            <h1>{tcc.titulo}</h1>
            <div className="det-badges">
              <span className="badge-papel">{ROTULO_FASE[fase] ?? fase}</span>
              {tcc.semestre && <span className="status-pill status-normal">Semestre {tcc.semestre}</span>}
            </div>
          </div>
          {/* Só o orientador do TCC exclui (esta página é dos orientandos dele). */}
          <button className="botao-perigo-sutil" style={{ flexShrink: 0 }} onClick={() => { setErroExcluir(''); setExcluindo(true); }}>Excluir TCC</button>
        </div>
      </div>

      {/* Notas Finais (topo) — só aparece quando há notas liberadas para este perfil.
          Pesos das fases vêm do calendário do semestre (backend); sem eles, o card usa 60/40. */}
      <CardNotasFinais tcc={tcc} pesoF1={tcc.pesoFase1} pesoF2={tcc.pesoFase2} />

      {/* Informações: orientando + orientação */}
      <div className="grade-detalhe bloco">
        <section className="cartao-secao">
          <h2>{icoUser} Informações do orientando</h2>
          <div className="info-lista">
            <div className="info-campo"><span className="info-rotulo">Aluno</span><span className="info-valor">{tcc.aluno?.nomeCompleto ?? '—'}</span></div>
            <div className="info-campo"><span className="info-rotulo">E-mail</span><span className="info-valor">{tcc.aluno?.email ?? '—'}</span></div>
            <div className="info-campo"><span className="info-rotulo">Curso</span><span className="info-valor">{cursoDe(tcc.aluno?.curso)}</span></div>
            <div className="info-campo"><span className="info-rotulo">Criado em</span><span className="info-valor">{fmtData(tcc.criadoEm)}</span></div>
          </div>
        </section>
        <section className="cartao-secao">
          <h2>{icoUser} Orientação</h2>
          <div className="info-lista">
            <div className="info-campo"><span className="info-rotulo">Orientador</span><span className="info-valor">Você</span></div>
            <div className="info-campo"><span className="info-rotulo">E-mail do orientador</span><span className="info-valor">{usuario?.email ?? '—'}</span></div>
            <div className="info-campo"><span className="info-rotulo">Coorientador</span><span className="info-valor">{coorient ?? 'Sem coorientador'}</span></div>
            {tcc.coorientador?.email && (
              <div className="info-campo"><span className="info-rotulo">E-mail do coorientador</span><span className="info-valor">{tcc.coorientador.email}</span></div>
            )}
          </div>
        </section>
        {descricao && (
          <section className="cartao-secao det-largura-total">
            <h2>Descrição do trabalho</h2>
            <p className="info-texto">{descricao}</p>
          </section>
        )}
      </div>

      <div id="acao" />

      {/* Ação: confirmação de continuidade (em desenvolvimento) */}
      {emDesenvolvimento && (
        <section className="cartao-secao bloco secao-acao">
          <h2>{icoCheck} Confirmação de continuidade</h2>
          <div className="aviso-cabecalho">
            <p className="nota-vazio" style={{ margin: 0 }}>
              {tcc.continuidadeConfirmada
                ? 'Você confirmou a continuidade deste TCC.'
                : 'Confirme se o orientando segue para a Fase I após a aprovação da monografia.'}
            </p>
            <span className={`selo ${tcc.continuidadeConfirmada ? 'selo-ok' : ''}`} style={tcc.continuidadeConfirmada ? {} : { background: 'var(--inset)', color: 'var(--tinta-3)' }}>
              {tcc.continuidadeConfirmada ? 'Confirmada' : 'Aguardando confirmação'}
            </span>
          </div>
          {!tcc.continuidadeConfirmada && (
            <>
              {blkCont && avisoPrazo('avaliação de continuidade')}
              <div className="acoes" style={{ justifyContent: 'flex-start' }}>
                <button className="botao botao-secundario" disabled={enviando || blkCont} onClick={() => { setRecusa({ tipo: 'continuidade' }); setParecer(''); setErro(''); }}>Descontinuar</button>
                <button className="botao" disabled={enviando || blkCont} onClick={() => pedirConfirmacao('continuidade')}>Confirmar continuidade</button>
              </div>
            </>
          )}
        </section>
      )}

      {/* Ação destacada: avaliação da monografia (espelha o card de continuidade) */}
      {emDesenvolvimento && ultimaMono?.status === 'PENDENTE' && (
        <section className="cartao-secao bloco secao-acao">
          <h2>{icoDoc} Avaliação da monografia</h2>
          <div className="aviso-cabecalho">
            <p className="nota-vazio" style={{ margin: 0 }}>
              O orientando enviou a monografia (versão {ultimaMono.versao}). Aprove ou solicite ajustes.
            </p>
            <span className="selo" style={{ background: 'var(--inset)', color: 'var(--tinta-3)' }}>Aguardando avaliação</span>
          </div>
          {blkMono && avisoPrazo('submissão da monografia')}
          <div className="acoes" style={{ justifyContent: 'flex-start' }}>
            <button className="botao botao-secundario" disabled={enviando || blkMono} onClick={() => { setRecusa({ tipo: 'monografia' }); setParecer(''); setErro(''); }}>Solicitar ajustes</button>
            <button className="botao" disabled={enviando || blkMono} onClick={() => pedirConfirmacao('monografia')}>Aprovar monografia</button>
          </div>
        </section>
      )}

      {/* Ação: versão final (validada pelo orientador) */}
      {(fase === 'VALIDACAO_VERSAO_FINAL' || versaoFinal) && (
        <section className="cartao-secao bloco secao-acao">
          <h2>{icoDoc} Versão final</h2>
          {fase === 'CONCLUIDO' && <p className="legenda">TCC concluído — versão final aprovada.</p>}
          {versaoFinal ? <ItemDoc d={versaoFinal} comOlho /> : <p className="nota-vazio">Aguardando o aluno enviar a versão final.</p>}
          {versaoFinal?.status === 'REJEITADO' && versaoFinal.parecer && (
            <div className="alerta alerta-erro" style={{ marginTop: 10 }}><strong>Devolutiva enviada:</strong> {versaoFinal.parecer}</div>
          )}
          {fase === 'VALIDACAO_VERSAO_FINAL' && (
            <>
              {blkVf && avisoPrazo('ajustes finais / versão final')}
              <div className="acoes" style={{ justifyContent: 'flex-start' }}>
                <button className="botao botao-secundario" disabled={enviando || blkVf} onClick={() => { setRecusa({ tipo: 'versaofinal' }); setParecer(''); setErro(''); }}>Solicitar ajustes</button>
                <button className="botao" disabled={enviando || blkVf} onClick={() => pedirConfirmacao('versaofinal')}>Aprovar e concluir</button>
              </div>
            </>
          )}
        </section>
      )}

      {/* Ação: agendamento da defesa (Fase II, orientador). A avaliação da banca é
          liberada automaticamente quando a data/hora marcada chega. */}
      {mostrarCardDefesa && (
        <section id={fase === 'AGENDAMENTO_DEFESA_FASE_2' ? 'acao-fase2' : undefined} className="cartao-secao bloco secao-acao">
          <h2>{icoBanca} Agendamento da defesa (Fase II)</h2>
          {tcc.defesaAgendadaPara ? (
            <>
              {fase === 'AGENDAMENTO_DEFESA_FASE_2' && (
                <div className="aviso-cabecalho">
                  <p className="nota-vazio" style={{ margin: 0 }}>
                    A avaliação da banca será liberada automaticamente na data e hora marcadas.
                  </p>
                  <span className="selo" style={{ background: 'var(--inset)', color: 'var(--tinta-3)' }}>Defesa agendada</span>
                </div>
              )}
              <CardDefesa tcc={tcc} />
              {podeEditarDefesa && (
                <div className="acoes" style={{ justifyContent: 'flex-start' }}>
                  <button className="botao botao-secundario" disabled={enviando} onClick={abrirAgendamento}>Editar agendamento</button>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="aviso-cabecalho">
                <p className="nota-vazio" style={{ margin: 0 }}>
                  Informe data, hora e local da defesa. A avaliação da banca abre automaticamente no horário marcado (datas já passadas liberam na hora).
                </p>
                <span className="selo" style={{ background: 'var(--inset)', color: 'var(--tinta-3)' }}>Aguardando agendamento</span>
              </div>
              <div className="acoes" style={{ justifyContent: 'flex-start' }}>
                <button className="botao" disabled={enviando} onClick={abrirAgendamento}>Agendar defesa</button>
              </div>
            </>
          )}
        </section>
      )}

      {/* Ação: avaliação da Fase II do orientador (mesma página do orientando) */}
      {podeAvaliarFase2 && (
        <section id="acao-fase2" className="cartao-secao bloco secao-acao">
          <h2>{icoBanca} Sua avaliação da Fase II</h2>
          {meuMembroFase2
            ? <AvaliacaoBancaForm membro={meuMembroFase2} aoAtualizar={carregar} />
            : <p className="nota-vazio">Carregando o formulário de avaliação…</p>}
        </section>
      )}

      {/* Inferior: fluxo (timeline) + documentos/notas */}
      <div className="grade-detalhe-inferior bloco">
        <section className="cartao-secao">
          <h2>Fluxo do TCC</h2>
          <TimelineVerticalDetalhada tcc={tcc} />
        </section>
        <div className="det-coluna">
          <section className="cartao-secao">
            <h2>{icoDoc} Monografias enviadas {tcc.monografiaAprovada && <span className="selo selo-ok">Aprovada</span>}</h2>
            {monografias.length === 0 ? (
              <p className="nota-vazio">Aguardando o aluno enviar a monografia.</p>
            ) : (
              <>
                <p className="subsecao-rotulo">Última versão enviada</p>
                <ItemDoc d={monografias[0]} />
                {ultimaMono?.status === 'REJEITADO' && ultimaMono.parecer && (
                  <div className="alerta alerta-erro" style={{ marginTop: 10 }}><strong>Devolutiva enviada:</strong> {ultimaMono.parecer}</div>
                )}
                {monografias.length > 1 && (
                  <>
                    <hr className="divisor-versoes" />
                    <p className="subsecao-rotulo">Versões anteriores</p>
                    {monografias.slice(1).map((d) => <ItemDoc key={d.id} d={d} />)}
                  </>
                )}
              </>
            )}
          </section>

          <section className="cartao-secao">
            <h2>{icoDoc} Documentos iniciais</h2>
            {iniciais.length === 0 ? (
              <p className="nota-vazio">Nenhum documento inicial.</p>
            ) : (
              iniciais.map((d) => <ItemDoc key={d.id} d={d} comOlho />)
            )}
          </section>

          {(bancas.length > 0 || temNotas) && (
            <section className="cartao-secao">
              <h2>{icoBanca} Banca e notas</h2>
              {/* Banca e notas (somente leitura) — componente compartilhado com o Histórico. */}
              <BancaNotasTcc tcc={tcc} pesos={meuMembroFase2?.pesos ?? null} />
              {temNotas && (
                <dl className="dados" style={{ marginTop: 12 }}>
                  {tcc.nf1 != null && <div><dt>NF1 (Fase I)</dt><dd>{fmtNota(tcc.nf1)}</dd></div>}
                  {tcc.nf2 != null && <div><dt>NF2 (Fase II)</dt><dd>{fmtNota(tcc.nf2)}</dd></div>}
                  {tcc.nf != null && <div><dt>Nota final (NF)</dt><dd><strong>{fmtNota(tcc.nf)}</strong></dd></div>}
                  {tcc.resultado && <div><dt>Resultado</dt><dd>{tcc.resultado}</dd></div>}
                </dl>
              )}
            </section>
          )}
        </div>
      </div>

      {recusa && (() => {
        const txt =
          recusa.tipo === 'monografia'
            ? { titulo: 'Solicitar ajustes na monografia', sub: 'O aluno poderá reenviar uma nova versão.', label: 'O que precisa ser ajustado' }
            : recusa.tipo === 'versaofinal'
              ? { titulo: 'Solicitar ajustes na versão final', sub: 'O aluno poderá reenviar a versão final corrigida.', label: 'O que precisa ser ajustado' }
              : { titulo: 'Descontinuar o TCC', sub: 'Atenção: isso encerra o TCC como descontinuado.', label: 'Motivo da descontinuação' };
        return (
          <Modal titulo={txt.titulo} subtitulo={txt.sub} aoFechar={() => !enviando && setRecusa(null)}>
            {erro && <div className="erro-geral">{erro}</div>}
            <label className="campo">
              <span>{txt.label}</span>
              <textarea rows={4} value={parecer} onChange={(e) => setParecer(e.target.value)} placeholder="Escreva uma devolutiva para o aluno…" />
            </label>
            <div className="acoes">
              <button className="botao botao-secundario" disabled={enviando} onClick={() => setRecusa(null)}>Voltar</button>
              <button className="botao" disabled={enviando} onClick={confirmarRecusa}>{enviando ? 'Enviando…' : 'Confirmar'}</button>
            </div>
          </Modal>
        );
      })()}

      {confirmarAcao === 'continuidade' && (
        <ModalConfirmacao
          titulo="Confirmar continuidade"
          mensagem="Deseja confirmar a continuidade deste TCC? O orientando segue para a próxima etapa do fluxo."
          textoConfirmar="Confirmar continuidade"
          textoProcessando="Confirmando…"
          processando={enviando}
          erro={erroAcao}
          aoConfirmar={executarAcao}
          aoCancelar={() => setConfirmarAcao(null)}
        />
      )}

      {confirmarAcao === 'monografia' && (
        <ModalConfirmacao
          titulo="Aprovar monografia"
          mensagem="Deseja aprovar a monografia? O orientando avança no fluxo do TCC."
          textoConfirmar="Aprovar monografia"
          textoProcessando="Aprovando…"
          processando={enviando}
          erro={erroAcao}
          aoConfirmar={executarAcao}
          aoCancelar={() => setConfirmarAcao(null)}
        />
      )}

      {confirmarAcao === 'versaofinal' && (
        <ModalConfirmacao
          titulo="Aprovar versão final"
          mensagem="Deseja aprovar a versão final e concluir o TCC? Essa ação encerra o trabalho como concluído."
          textoConfirmar="Aprovar e concluir"
          textoProcessando="Concluindo…"
          processando={enviando}
          erro={erroAcao}
          aoConfirmar={executarAcao}
          aoCancelar={() => setConfirmarAcao(null)}
        />
      )}

      {agendando && (
        <Modal
          titulo={tcc.defesaAgendadaPara ? 'Editar agendamento da defesa' : 'Agendar defesa'}
          subtitulo="A avaliação da banca é liberada automaticamente na data e hora marcadas."
          aoFechar={() => !enviando && setAgendando(false)}
        >
          {erroDefesa && <div className="erro-geral">{erroDefesa}</div>}
          <label className="campo">
            <span>Data</span>
            <input type="date" value={defData} onChange={(e) => setDefData(e.target.value)} />
          </label>
          <label className="campo">
            <span>Hora (horário de Fortaleza)</span>
            <input type="time" value={defHora} onChange={(e) => setDefHora(e.target.value)} />
          </label>
          <label className="campo">
            <span>Local (sala ou link HTTPS)</span>
            <input value={defLocal} onChange={(e) => setDefLocal(e.target.value)} placeholder="Ex.: Auditório do DEE ou https://meet.google.com/…" />
          </label>
          <label className="campo">
            <span>Comentário (opcional)</span>
            <textarea rows={3} value={defComentario} onChange={(e) => setDefComentario(e.target.value)} placeholder="Orientações para o aluno e a banca…" />
          </label>
          <div className="acoes">
            <button className="botao botao-secundario" disabled={enviando} onClick={() => setAgendando(false)}>Cancelar</button>
            <button className="botao" disabled={enviando} onClick={salvarDefesa}>{enviando ? 'Salvando…' : 'Salvar agendamento'}</button>
          </div>
        </Modal>
      )}

      {excluindo && (
        <ModalExcluirTcc aoFechar={() => setExcluindo(false)} aoConfirmar={excluirTcc} processando={excluindoProc} erro={erroExcluir} />
      )}
    </>
  );
}
