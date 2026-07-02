// Página interna de detalhe do TCC (visão do coordenador).
// Espelha o layout do projeto antigo (TCCDetalhe.tsx): voltar, título + status,
// cards de aluno/orientação, seção de ação conforme a fase, documentos, banca/notas
// e a trilha do fluxo. Respeita as regras do projeto novo:
//  - só a banca da Fase I é formada manualmente pelo coordenador;
//  - a banca da Fase II é o orientador + os 2 avaliadores da Fase I (já composta);
//  - a versão final é validada pelo ORIENTADOR, não pelo coordenador.
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { apiGet, apiPost, apiUpload, URL_API, type ErroApi } from '../../api';
import { ROTULO_FASE } from '../../utils/fases';
import { ROTULO_CURSO, CRITERIOS_FASE1, CRITERIOS_FASE2, colunaNota, notaFinal, type Criterio } from '@tcc/compartilhado';
import { extrairSecao, fmtNota as fmtNotaAv, fmtNum, pesoDe, STATUS_AVAL } from '../../utils/avaliacao';
import { CardNotasFinais } from '../../componentes/CardNotasFinais';
import { TimelineVerticalDetalhada } from '../../componentes/TimelineVerticalDetalhada';
import { ModalEditarTcc } from '../../componentes/ModalEditarTcc';
import { ModalConfirmacao } from '../../componentes/ModalConfirmacao';
import { Modal } from '../../componentes/Modal';
import { LiberacoesPrazo } from '../../componentes/LiberacoesPrazo';

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
const icoLapis = ic('M12 20h9|M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z');

const cursoDe = (c?: string) => (c ? (ROTULO_CURSO as Record<string, string>)[c] ?? c : '—');
const nomeComTrat = (p?: any) => (p ? `${p.tratamento ? p.tratamento + ' ' : ''}${p.nomeCompleto}` : '—');
// Rótulo do candidato no dropdown: nome (com tratamento) + tipo/afiliação.
const rotuloCandidato = (c: any) =>
  `${c.tratamento ? c.tratamento + ' ' : ''}${c.nomeCompleto}${c.papel === 'AVALIADOR' ? ` (Externo${c.afiliacao ? ' · ' + c.afiliacao : ''})` : ' (Professor)'}`;

const ROTULO_DOC: Record<string, string> = {
  PLANO_DESENVOLVIMENTO: 'Plano de desenvolvimento',
  TERMO_ACEITE: 'Termo de aceite',
  MONOGRAFIA: 'Monografia',
  VERSAO_FINAL: 'Versão final',
  AVALIACAO_BANCA: 'Documento para avaliação (banca)',
};
const rotuloDoc = (t: string) => ROTULO_DOC[t] ?? t;
const rotuloStatusDoc = (s: string) =>
  ({ PENDENTE: 'Aguardando', EM_ANALISE: 'Em análise', APROVADO: 'Aprovado', REJEITADO: 'Rejeitado', SUBSTITUIDA: 'Substituída' } as Record<string, string>)[s] ?? s;

// Status visual (igual ao antigo): urgente/atenção/normal conforme a fase.
function statusDe(fase: string): { rotulo: string; classe: string } {
  if (fase === 'INICIALIZACAO') return { rotulo: 'Urgente', classe: 'status-urgente' };
  if (fase === 'FORMACAO_BANCA_FASE_1' || fase === 'VALIDACAO_FASE_1' || fase === 'VALIDACAO_FASE_2')
    return { rotulo: 'Atenção', classe: 'status-atencao' };
  return { rotulo: 'Normal', classe: 'status-normal' };
}

export function TccDetalheCoordenador() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [tccs, setTccs] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(true);

  const [candidatos, setCandidatos] = useState<any[]>([]);
  const [avaliador1, setAvaliador1] = useState('');
  const [avaliador2, setAvaliador2] = useState('');
  const [arquivoBanca, setArquivoBanca] = useState<File | null>(null);
  const [resultado, setResultado] = useState<any | null>(null);
  const [erroAcao, setErroAcao] = useState('');
  const [confirmando, setConfirmando] = useState<null | 'banca' | 'validar' | 'iniciar' | 'cancelarAjuste'>(null);
  const [ajusteMembro, setAjusteMembro] = useState<string | null>(null); // membroId p/ solicitar ajuste
  const [ajusteMotivo, setAjusteMotivo] = useState('');
  const [cancelarMembro, setCancelarMembro] = useState<string | null>(null); // membroId p/ cancelar ajuste
  const [enviando, setEnviando] = useState(false);
  const [editando, setEditando] = useState(false);
  const [pesos, setPesos] = useState<any | null>(null);

  function carregar() {
    setCarregando(true);
    apiGet('/tccs').then(setTccs).catch(() => setTccs([])).finally(() => setCarregando(false));
  }
  useEffect(carregar, []);

  const tcc = useMemo(() => tccs.find((t) => t.id === id), [tccs, id]);
  const tccId: string | undefined = tcc?.id;
  const tccFase: string | undefined = tcc?.faseAtual;

  // Carrega candidatos quando o TCC está na formação da banca da Fase I.
  useEffect(() => {
    if (tccId && tccFase === 'FORMACAO_BANCA_FASE_1') {
      apiGet(`/tccs/${tccId}/banca/candidatos`).then(setCandidatos).catch(() => setCandidatos([]));
    }
  }, [tccId, tccFase]);

  // Pesos do calendário do semestre do TCC (para a área de banca/notas).
  useEffect(() => {
    if (tccId) apiGet(`/tccs/${tccId}/banca/pesos`).then(setPesos).catch(() => setPesos(null));
  }, [tccId]);

  // Deep link: rola até a seção de validação (#validacao) e a destaca por alguns segundos.
  const location = useLocation();
  useEffect(() => {
    if (!tcc || !location.hash) return;
    const el = document.getElementById(location.hash.slice(1));
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('secao-destaque');
    const t = setTimeout(() => el.classList.remove('secao-destaque'), 2400);
    return () => clearTimeout(t);
  }, [tcc, location.hash]);

  if (carregando) return <p className="nota-vazio">Carregando…</p>;

  if (!tcc) {
    return (
      <div className="det-cabecalho">
        <button className="det-voltar" onClick={() => navigate('/coordenador/tccs')}>{icoVoltar} Voltar para lista de TCCs</button>
        <section className="cartao-secao bloco"><p className="nota-vazio">TCC não encontrado.</p></section>
      </div>
    );
  }

  const fase = tcc.faseAtual as string;
  const status = statusDe(fase);
  const coorient = tcc.coorientador
    ? nomeComTrat(tcc.coorientador)
    : tcc.coorientadorNome
      ? `${tcc.coorientadorTitulacao ? tcc.coorientadorTitulacao + ' ' : ''}${tcc.coorientadorNome}${tcc.coorientadorAfiliacao ? ' · ' + tcc.coorientadorAfiliacao : ''}`
      : null;
  const descricao = tcc.resumo || tcc.descricao || tcc.objetivos || null;
  const bancas = [...(tcc.bancas ?? [])].sort((a: any, b: any) => (a.fase < b.fase ? -1 : 1));

  async function formarBanca() {
    setErroAcao('');
    if (!avaliador1 || !avaliador2) return setErroAcao('Escolha o Avaliador 1 e o Avaliador 2.');
    if (avaliador1 === avaliador2) return setErroAcao('Os dois avaliadores devem ser pessoas diferentes.');
    if (!arquivoBanca) return setErroAcao('Envie o documento para avaliação da banca.');
    setEnviando(true);
    try {
      const form = new FormData();
      form.append('arquivo', arquivoBanca);
      form.append('avaliadorIds', JSON.stringify([avaliador1, avaliador2]));
      await apiUpload(`/tccs/${tcc.id}/banca`, form);
      setAvaliador1('');
      setAvaliador2('');
      setArquivoBanca(null);
      setConfirmando(null);
      carregar();
    } catch (e) {
      setErroAcao((e as ErroApi).mensagem || 'Não foi possível formar a banca.');
    } finally {
      setEnviando(false);
    }
  }

  async function validar() {
    setErroAcao('');
    setEnviando(true);
    try {
      const r = await apiPost(`/tccs/${tcc.id}/banca/validar`, {});
      setResultado(r);
      setConfirmando(null);
      carregar();
    } catch (e) {
      setErroAcao((e as ErroApi).mensagem || 'Não foi possível validar.');
    } finally {
      setEnviando(false);
    }
  }

  // Coordenador inicia a análise (AGUARDANDO_ANALISE_* → VALIDACAO_*, trava a banca).
  async function iniciarAnalise() {
    setErroAcao('');
    setEnviando(true);
    try {
      await apiPost(`/tccs/${tcc.id}/banca/iniciar-analise`, {});
      setConfirmando(null);
      carregar();
    } catch (e) {
      setErroAcao((e as ErroApi).mensagem || 'Não foi possível iniciar a análise.');
    } finally {
      setEnviando(false);
    }
  }

  // Aprova a avaliação de um membro (ação direta, sem modal).
  async function aprovarMembro(membroId: string) {
    setErroAcao('');
    try {
      await apiPost(`/bancas/membros/${membroId}/aprovar`, {});
      carregar();
    } catch (e) {
      window.alert((e as ErroApi).mensagem || 'Não foi possível aprovar a avaliação.');
    }
  }

  // Envia a solicitação de ajuste (motivo obrigatório) para o membro selecionado.
  async function enviarAjuste() {
    if (!ajusteMembro) return;
    setErroAcao('');
    setEnviando(true);
    try {
      await apiPost(`/bancas/membros/${ajusteMembro}/solicitar-ajuste`, { motivo: ajusteMotivo });
      setAjusteMembro(null);
      setAjusteMotivo('');
      carregar();
    } catch (e) {
      setErroAcao((e as ErroApi).mensagem || 'Não foi possível solicitar o ajuste.');
    } finally {
      setEnviando(false);
    }
  }

  // Cancela/desfaz a solicitação de ajuste (o membro volta a ficar travado).
  async function confirmarCancelarAjuste() {
    if (!cancelarMembro) return;
    setErroAcao('');
    setEnviando(true);
    try {
      await apiPost(`/bancas/membros/${cancelarMembro}/cancelar-ajuste`, {});
      setCancelarMembro(null);
      setConfirmando(null);
      carregar();
    } catch (e) {
      setErroAcao((e as ErroApi).mensagem || 'Não foi possível cancelar a solicitação.');
    } finally {
      setEnviando(false);
    }
  }

  // Fase II fica ACIMA da Fase I quando o TCC já está na Fase II (ou em etapa posterior).
  const fasesFaseIIouDepois = ['AGENDAMENTO_DEFESA_FASE_2', 'AVALIACAO_FASE_2', 'AGUARDANDO_ANALISE_COORDENACAO_FASE_2', 'VALIDACAO_FASE_2', 'AGUARDANDO_AJUSTES_FINAIS', 'VALIDACAO_VERSAO_FINAL', 'CONCLUIDO', 'REPROVADO_FASE_2'];
  const faseIIouDepois = fasesFaseIIouDepois.includes(fase);
  const faseCardAtiva = faseIIouDepois ? 'FASE_2' : 'FASE_1';
  const bancasOrdenadas = faseIIouDepois ? [...bancas].reverse() : bancas;

  // Status (rótulo + cor) do card de cada fase, conforme a fase atual do TCC.
  function statusFaseCard(bancaFase: 'FASE_1' | 'FASE_2'): { rotulo: string; classe: string } {
    if (bancaFase === 'FASE_1') {
      if (fase === 'FORMACAO_BANCA_FASE_1') return { rotulo: 'Formação da banca', classe: 'status-atencao' };
      if (fase === 'AVALIACAO_FASE_1') return { rotulo: 'Avaliação da banca', classe: 'status-atencao' };
      if (fase === 'AGUARDANDO_ANALISE_COORDENACAO_FASE_1') return { rotulo: 'Aguardando análise', classe: 'status-atencao' };
      if (fase === 'VALIDACAO_FASE_1') return { rotulo: 'Em análise da coordenação', classe: 'status-atencao' };
      if (fase === 'REPROVADO_FASE_1') return { rotulo: 'Reprovada', classe: 'status-urgente' };
      return { rotulo: 'Validada', classe: 'status-normal' };
    }
    if (fase === 'AGENDAMENTO_DEFESA_FASE_2') return { rotulo: 'Aguardando liberação da defesa', classe: 'status-atencao' };
    if (fase === 'AVALIACAO_FASE_2') return { rotulo: 'Avaliação da banca', classe: 'status-atencao' };
    if (fase === 'AGUARDANDO_ANALISE_COORDENACAO_FASE_2') return { rotulo: 'Aguardando análise', classe: 'status-atencao' };
    if (fase === 'VALIDACAO_FASE_2') return { rotulo: 'Em análise da coordenação', classe: 'status-atencao' };
    if (fase === 'REPROVADO_FASE_2') return { rotulo: 'Reprovada', classe: 'status-urgente' };
    if (fase === 'AGUARDANDO_AJUSTES_FINAIS' || fase === 'VALIDACAO_VERSAO_FINAL' || fase === 'CONCLUIDO') return { rotulo: 'Validada', classe: 'status-normal' };
    return { rotulo: '—', classe: 'status-atencao' };
  }

  return (
    <>
      {/* Cabeçalho com navegação */}
      <div className="det-cabecalho">
        <button className="det-voltar" onClick={() => navigate('/coordenador/tccs')}>{icoVoltar} Voltar para lista de TCCs</button>
        <div className="det-titulo-area">
          <div style={{ minWidth: 0 }}>
            <h1>{tcc.titulo}</h1>
            <div className="det-badges">
              <span className="badge-papel">{ROTULO_FASE[fase] ?? fase}</span>
              <span className={`status-pill ${status.classe}`}>{status.rotulo}</span>
            </div>
          </div>
          <button className="botao" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0 }} onClick={() => setEditando(true)}>
            {icoLapis} Editar informações
          </button>
        </div>
      </div>

      {/* Notas Finais (topo) — coordenador vê as notas assim que existem. */}
      <CardNotasFinais tcc={tcc} />

      {/* Informações gerais — aluno e orientação */}
      <div className="grade-detalhe bloco">
        <section className="cartao-secao">
          <h2>{icoUser} Informações do aluno</h2>
          <div className="info-lista">
            <div className="info-campo"><span className="info-rotulo">Nome</span><span className="info-valor">{tcc.aluno?.nomeCompleto ?? '—'}</span></div>
            <div className="info-campo"><span className="info-rotulo">E-mail</span><span className="info-valor">{tcc.aluno?.email ?? '—'}</span></div>
            <div className="info-campo"><span className="info-rotulo">Curso</span><span className="info-valor">{cursoDe(tcc.aluno?.curso)}</span></div>
            <div className="info-campo"><span className="info-rotulo">Semestre</span><span className="info-valor">{tcc.semestre ?? '—'}</span></div>
          </div>
        </section>
        <section className="cartao-secao">
          <h2>{icoUser} Orientação</h2>
          <div className="info-lista">
            <div className="info-campo"><span className="info-rotulo">Orientador</span><span className="info-valor">{nomeComTrat(tcc.orientador)}</span></div>
            <div className="info-campo"><span className="info-rotulo">Coorientador</span><span className="info-valor">{coorient ?? 'Sem coorientador'}</span></div>
          </div>
        </section>
        {descricao && (
          <section className="cartao-secao det-largura-total">
            <h2>Descrição do trabalho</h2>
            <p className="info-texto">{descricao}</p>
          </section>
        )}
      </div>

      {/* Seção de ação conforme a fase */}
      {fase === 'FORMACAO_BANCA_FASE_1' && (
        <section id="banca" className="cartao-secao bloco secao-acao">
          <h2>{icoBanca} Formar banca da Fase I</h2>
          <p className="legenda">Escolha <strong>2 avaliadores</strong> para a banca da Fase I. (A banca da Fase II será o orientador + estes 2 avaliadores.)</p>
          {candidatos.length === 0 ? (
            <p className="nota-vazio">Nenhum avaliador disponível (cadastre professores/avaliadores).</p>
          ) : (
            <div className="grade-2">
              <label className="campo">
                <span>Avaliador 1</span>
                <select value={avaliador1} onChange={(e) => setAvaliador1(e.target.value)}>
                  <option value="">Selecione…</option>
                  {candidatos.filter((c) => c.id !== avaliador2).map((c) => (
                    <option key={c.id} value={c.id}>{rotuloCandidato(c)}</option>
                  ))}
                </select>
              </label>
              <label className="campo">
                <span>Avaliador 2</span>
                <select value={avaliador2} onChange={(e) => setAvaliador2(e.target.value)}>
                  <option value="">Selecione…</option>
                  {candidatos.filter((c) => c.id !== avaliador1).map((c) => (
                    <option key={c.id} value={c.id}>{rotuloCandidato(c)}</option>
                  ))}
                </select>
              </label>
            </div>
          )}
          <label className="campo" style={{ marginTop: 16 }}>
            <span>Documento para avaliação (PDF ou Word)</span>
            <input type="file" accept=".pdf,.doc,.docx" onChange={(e) => setArquivoBanca(e.target.files?.[0] ?? null)} />
            <small className="legenda">A banca avaliará este documento (ex.: versão anônima da monografia). PDF ou Word (.doc, .docx). Obrigatório para formar a banca.</small>
          </label>
          <div className="acoes" style={{ justifyContent: 'flex-start' }}>
            <button className="botao" disabled={enviando || !avaliador1 || !avaliador2 || avaliador1 === avaliador2 || !arquivoBanca} onClick={() => { setErroAcao(''); setConfirmando('banca'); }}>
              {enviando ? 'Formando…' : 'Formar banca'}
            </button>
          </div>
        </section>
      )}

      {(fase === 'AGUARDANDO_AJUSTES_FINAIS' || fase === 'VALIDACAO_VERSAO_FINAL') && (
        <section className="cartao-secao bloco secao-acao">
          <h2>{icoBanca} Versão final</h2>
          <p className="legenda">A Fase II foi aprovada. O aluno envia a versão final e <strong>quem valida é o orientador</strong> — não há ação do coordenador nesta etapa.</p>
        </section>
      )}

      {/* Banca e avaliações — um card por fase (Fase II acima quando já estamos nela). */}
      {bancas.length === 0 ? (
        fase !== 'FORMACAO_BANCA_FASE_1' && (
          <section className="cartao-secao bloco">
            <h2>{icoBanca} Banca e avaliações</h2>
            <p className="nota-vazio">Banca ainda não formada.</p>
          </section>
        )
      ) : (
        bancasOrdenadas.map((b: any) => {
          const ehF2 = b.fase === 'FASE_2';
          const criterios: Criterio[] = ehF2 ? CRITERIOS_FASE2 : CRITERIOS_FASE1;
          const membros = b.membros ?? [];
          const emAguardando = fase === (ehF2 ? 'AGUARDANDO_ANALISE_COORDENACAO_FASE_2' : 'AGUARDANDO_ANALISE_COORDENACAO_FASE_1');
          const emValidacao = fase === (ehF2 ? 'VALIDACAO_FASE_2' : 'VALIDACAO_FASE_1');
          const stFase = statusFaseCard(b.fase);
          // Resumo da fase (só coordenador — esta tela). Média simples, nota com peso e resultado.
          const notas: number[] = membros.map((m: any) => m.nota).filter((n: any) => n != null);
          const media = notas.length ? notas.reduce((s: number, n: number) => s + n, 0) / notas.length : null;
          const notaPeso = media != null ? media * (ehF2 ? 0.4 : 0.6) : null;
          const nfEstimada = ehF2 && media != null && tcc.nf1 != null ? notaFinal(Number(tcc.nf1), media) : null;
          const resFase = media == null
            ? { txt: 'Pendente', cls: 'pend' }
            : !ehF2
              ? (media >= 6 ? { txt: 'Aprovado', cls: 'ok' } : { txt: 'Reprovado', cls: 'bad' })
              : (nfEstimada == null ? { txt: 'Pendente', cls: 'pend' } : (nfEstimada >= 7 ? { txt: 'Aprovado', cls: 'ok' } : { txt: 'Reprovado', cls: 'bad' }));
          const todosAprovados = membros.length > 0 && membros.every((m: any) => m.status === 'APROVADO');
          const resultadoDaFase = resultado && resultado.fase === b.fase ? resultado : null;
          let nAval = 0;
          return (
            <section key={b.id} id={b.fase === faseCardAtiva ? 'validacao' : undefined} className="cartao-secao bloco">
              <div className="banca-fase-cab" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <h2 style={{ margin: 0 }}>{icoBanca} {ehF2 ? 'Fase II' : 'Fase I'}</h2>
                <div className="acoes" style={{ margin: 0, alignItems: 'center', gap: 8 }}>
                  <span className={`status-pill ${stFase.classe}`}>{stFase.rotulo}</span>
                  {emAguardando && (
                    <button className="botao" disabled={enviando} onClick={() => { setErroAcao(''); setConfirmando('iniciar'); }}>Iniciar análise</button>
                  )}
                </div>
              </div>
              {ehF2 && <p className="legenda" style={{ marginTop: 6 }}>Banca derivada: <strong>orientador + os 2 avaliadores da Fase I</strong> (não é escolhida livremente).</p>}

              {membros.length === 0 ? (
                <p className="nota-vazio">Sem membros nesta banca.</p>
              ) : (
                membros.map((m: any) => {
                  const st = STATUS_AVAL[m.status] ?? { rotulo: m.status, classe: 'status-atencao' };
                  const parecerGeral = extrairSecao(m.parecer ?? '', 'Parecer geral');
                  return (
                    <div key={m.id} className="aval-card">
                      <div className="aval-card-top">
                        <span className="aval-nome">{nomeComTrat(m.avaliador)}</span>
                        <span className={`status-pill ${st.classe}`}>{st.rotulo}</span>
                      </div>
                      <div className="aval-criterios">
                        {criterios.map((c) => {
                          const com = extrairSecao(m.parecer ?? '', c.rotulo);
                          return (
                            <div key={c.chave} className="aval-criterio">
                              <span className="aval-criterio-rot">{c.rotulo}</span>
                              <span className="aval-criterio-nota">{fmtNotaAv(m[colunaNota(c.chave)])} <small>/ {fmtNum(Number(pesoDe(c, pesos).toFixed(1)))}</small></span>
                              {com && <span className="aval-criterio-com">{com}</span>}
                            </div>
                          );
                        })}
                      </div>
                      {parecerGeral && <p className="aval-parecer"><strong>Parecer geral:</strong> {parecerGeral}</p>}
                      <div className="aval-rodape">
                        <span className="aval-total">Nota total: <strong>{fmtNotaAv(m.nota)}</strong> / 10</span>
                      </div>
                      {m.ajusteMotivo && (
                        <p className="aval-parecer" style={{ color: 'var(--reprovado)' }}><strong>Ajuste solicitado:</strong> {m.ajusteMotivo}</p>
                      )}
                      {emValidacao && (
                        <div className="acoes" style={{ justifyContent: 'flex-start', marginTop: 8 }}>
                          {m.status === 'AJUSTE_SOLICITADO' ? (
                            <button className="botao botao-secundario" onClick={() => { setErroAcao(''); setCancelarMembro(m.id); setConfirmando('cancelarAjuste'); }}>Cancelar solicitação de ajuste</button>
                          ) : (
                            <>
                              {m.status !== 'APROVADO' && (
                                <button className="botao" onClick={() => aprovarMembro(m.id)}>Aprovar avaliação</button>
                              )}
                              <button className="botao botao-secundario" onClick={() => { setErroAcao(''); setAjusteMotivo(''); setAjusteMembro(m.id); }}>Solicitar ajuste</button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}

              {/* Resumo da fase */}
              {membros.length > 0 && (
                <div className="resumo-fase">
                  {membros.map((m: any) => {
                    const ehOrient = ehF2 && m.avaliadorId === tcc.orientadorId;
                    const rot = ehOrient ? 'Orientador' : `Avaliador ${++nAval}`;
                    return (
                      <div key={m.id} className="resumo-item">
                        <span className="resumo-item-rot">{rot}</span>
                        <span className="resumo-item-val">{fmtNotaAv(m.nota)}</span>
                      </div>
                    );
                  })}
                  <div className="resumo-item"><span className="resumo-item-rot">Média</span><span className="resumo-item-val">{media != null ? media.toFixed(2).replace('.', ',') : '—'}</span></div>
                  <div className="resumo-item destaque"><span className="resumo-item-rot">Nota com peso ({ehF2 ? '40%' : '60%'})</span><span className="resumo-item-val">{notaPeso != null ? notaPeso.toFixed(2).replace('.', ',') : '—'}</span></div>
                  <div className={`resumo-item ${resFase.cls}`}><span className="resumo-item-rot">{ehF2 ? 'Fase II' : 'Fase I'}</span><span className="resumo-item-val">{resFase.txt}</span></div>
                </div>
              )}

              {/* Confirmação do resultado (logo após validar) */}
              {resultadoDaFase && (
                <div className="alerta" style={resultadoDaFase.aprovado
                  ? { background: 'var(--aprovado-suave)', color: 'var(--aprovado)', marginTop: 14 }
                  : { background: 'var(--reprovado-suave)', color: 'var(--reprovado)', marginTop: 14 }}>
                  {resultadoDaFase.fase === 'FASE_1'
                    ? (resultadoDaFase.aprovado
                        ? `Aprovado na Fase I (NF1 ${Number(resultadoDaFase.nf1).toFixed(2)}). Segue para a Fase II.`
                        : `Reprovado na Fase I (NF1 ${Number(resultadoDaFase.nf1).toFixed(2)}).`)
                    : (resultadoDaFase.aprovado
                        ? `Aprovado na Fase II — NF ${Number(resultadoDaFase.nf).toFixed(2)}. Agora o aluno deve enviar a versão final (validada pelo orientador).`
                        : `Reprovado na Fase II. Nota final NF ${Number(resultadoDaFase.nf).toFixed(2)}.`)}
                </div>
              )}

              {/* Validar a fase (dentro do card, abaixo do resumo) */}
              {emValidacao && !resultadoDaFase && (
                <>
                  {!todosAprovados && (
                    <p className="legenda" style={{ color: 'var(--reprovado)', marginBottom: 0 }}>Aprove todas as avaliações para validar a fase.</p>
                  )}
                  <div className="acoes" style={{ justifyContent: 'flex-start', marginTop: 12 }}>
                    <button className="botao" disabled={enviando || !todosAprovados} onClick={() => { setErroAcao(''); setConfirmando('validar'); }}>{enviando ? 'Validando…' : (ehF2 ? 'Validar Fase II' : 'Validar Fase I')}</button>
                  </div>
                </>
              )}
            </section>
          );
        })
      )}

      {/* Conteúdo inferior: trilha do fluxo + documentos */}
      <div className="grade-detalhe-inferior bloco">
        <section className="cartao-secao">
          <h2>Fluxo do TCC</h2>
          <TimelineVerticalDetalhada tcc={tcc} />
        </section>
        <div className="det-coluna">
          <section className="cartao-secao">
            <h2>{icoDoc} Documentos do TCC</h2>
            {(tcc.documentos ?? []).length === 0 ? (
              <p className="nota-vazio">Nenhum documento enviado.</p>
            ) : (
              tcc.documentos.map((d: any) => (
                <div key={d.id} className="item-arquivo">
                  <div className="item-arquivo-info">
                    {icoDoc}
                    <div>
                      <span className="nome">{rotuloDoc(d.tipo)}</span>
                      <span className="meta">v{d.versao} · {rotuloStatusDoc(d.status)}</span>
                    </div>
                  </div>
                  <span className="acoes-doc">
                    {d.tipo !== 'MONOGRAFIA' && d.tipo !== 'VERSAO_FINAL' && (
                      <a className="botao-icone" title="Visualizar" href={`${URL_API}/tccs/documentos/${d.id}/visualizar`} target="_blank" rel="noreferrer">{icoOlho}</a>
                    )}
                    <a className="botao-icone" title="Baixar" href={`${URL_API}/tccs/documentos/${d.id}/baixar`} target="_blank" rel="noreferrer">{icoBaixar}</a>
                  </span>
                </div>
              ))
            )}
          </section>

          <LiberacoesPrazo tccId={tcc.id} />
        </div>
      </div>

      {editando && (
        <ModalEditarTcc tcc={tcc} pesos={pesos} aoFechar={() => setEditando(false)} aoSalvo={carregar} />
      )}

      {confirmando === 'banca' && (
        <ModalConfirmacao
          titulo="Formar banca da Fase I"
          mensagem="Deseja formar esta banca com os avaliadores e o documento selecionados?"
          textoConfirmar="Formar banca"
          textoProcessando="Formando…"
          processando={enviando}
          erro={erroAcao}
          aoConfirmar={formarBanca}
          aoCancelar={() => setConfirmando(null)}
        />
      )}

      {confirmando === 'validar' && (
        <ModalConfirmacao
          titulo={fase === 'VALIDACAO_FASE_2' ? 'Validar Fase II' : 'Validar Fase I'}
          mensagem={
            fase === 'VALIDACAO_FASE_2'
              ? 'Deseja validar a Fase II? Essa ação calcula a NF2 e o resultado da fase.'
              : 'Deseja validar a Fase I? Essa ação calcula a NF1 e muda o fluxo do TCC.'
          }
          textoConfirmar={fase === 'VALIDACAO_FASE_2' ? 'Validar Fase II' : 'Validar Fase I'}
          textoProcessando="Validando…"
          processando={enviando}
          erro={erroAcao}
          aoConfirmar={validar}
          aoCancelar={() => setConfirmando(null)}
        />
      )}

      {confirmando === 'iniciar' && (
        <ModalConfirmacao
          titulo="Iniciar análise"
          mensagem="Ao iniciar a análise, a banca é travada: os avaliadores não poderão mais reabrir a avaliação por conta própria. Deseja continuar?"
          textoConfirmar="Iniciar análise"
          textoProcessando="Iniciando…"
          processando={enviando}
          erro={erroAcao}
          aoConfirmar={iniciarAnalise}
          aoCancelar={() => setConfirmando(null)}
        />
      )}

      {ajusteMembro && (
        <Modal
          titulo="Solicitar ajuste"
          subtitulo="O avaliador poderá reenviar a avaliação. Informe o motivo do ajuste."
          aoFechar={() => !enviando && setAjusteMembro(null)}
        >
          {erroAcao && <div className="erro-geral">{erroAcao}</div>}
          <label className="campo">
            <span>Motivo do ajuste</span>
            <textarea rows={4} value={ajusteMotivo} onChange={(e) => setAjusteMotivo(e.target.value)} placeholder="Descreva o que precisa ser ajustado…" />
          </label>
          <div className="acoes">
            <button className="botao botao-secundario" disabled={enviando} onClick={() => setAjusteMembro(null)}>Cancelar</button>
            <button className="botao" disabled={enviando || !ajusteMotivo.trim()} onClick={enviarAjuste}>{enviando ? 'Enviando…' : 'Solicitar ajuste'}</button>
          </div>
        </Modal>
      )}

      {confirmando === 'cancelarAjuste' && (
        <ModalConfirmacao
          titulo="Cancelar solicitação de ajuste"
          mensagem="A solicitação de ajuste será desfeita e o avaliador voltará a ficar travado (sem poder reenviar por conta própria). Confirma?"
          textoConfirmar="Cancelar solicitação"
          textoProcessando="Cancelando…"
          processando={enviando}
          erro={erroAcao}
          aoConfirmar={confirmarCancelarAjuste}
          aoCancelar={() => { setConfirmando(null); setCancelarMembro(null); }}
        />
      )}
    </>
  );
}
