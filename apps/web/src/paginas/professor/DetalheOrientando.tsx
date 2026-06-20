// Página interna de detalhe do orientando (visão do orientador/professor).
// Espelha o layout do projeto antigo (DetalheOrientandoProfessor.tsx) com o padrão
// visual novo (igual ao TccDetalheCoordenador): voltar, título + fase, informações
// do orientando, orientação/coorientação, descrição, timeline vertical detalhada,
// documentos iniciais, monografias, continuidade, versão final e notas.
// Regras do projeto NOVO:
//  - a banca da Fase II é o orientador + os 2 avaliadores da Fase I (o orientador
//    avalia a Fase II em "Minhas bancas"; não há formação manual nem agendamento aqui);
//  - a versão final pós-Fase II é validada pelo ORIENTADOR (aqui), não pelo coordenador;
//  - sem nenhuma etapa de análise final do coordenador.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiGet, apiPost, URL_API, type ErroApi } from '../../api';
import { Modal } from '../../componentes/Modal';
import { ROTULO_FASE } from '../../utils/fases';
import { ROTULO_CURSO } from '@tcc/compartilhado';
import { TimelineVerticalDetalhada } from '../../componentes/TimelineVerticalDetalhada';

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
const fmtNota1 = (v: any) => (v != null ? Number(v).toFixed(1).replace('.', ',') : '—');
const fmtData = (iso?: string | null) => {
  if (!iso) return '—';
  const [a, m, d] = iso.split('T')[0].split('-');
  return a && m && d ? `${d}/${m}/${a}` : '—';
};
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

  const [tccs, setTccs] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [recusa, setRecusa] = useState<{ tipo: 'monografia' | 'continuidade' | 'versaofinal' } | null>(null);
  const [parecer, setParecer] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  function carregar() {
    setCarregando(true);
    apiGet('/tccs/orientando').then(setTccs).catch(() => setTccs([])).finally(() => setCarregando(false));
  }
  useEffect(carregar, []);

  const tcc = useMemo(() => tccs.find((t) => t.id === id), [tccs, id]);

  async function acao(fn: () => Promise<unknown>) {
    setEnviando(true);
    try {
      await fn();
      carregar();
    } catch (e) {
      window.alert((e as ErroApi).mensagem || 'Não foi possível concluir a ação.');
    } finally {
      setEnviando(false);
    }
  }
  const aprovarMono = (tccId: string) => acao(() => apiPost(`/tccs/${tccId}/monografia/avaliar`, { decisao: 'APROVAR' }));
  const confirmarCont = (tccId: string) => acao(() => apiPost(`/tccs/${tccId}/continuidade`, { decisao: 'CONFIRMAR' }));
  const concluirVF = (tccId: string) => acao(() => apiPost(`/tccs/${tccId}/validar-versao-final`, { decisao: 'CONCLUIR' }));

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
  const temNotas = tcc.nf1 != null || tcc.nf2 != null || tcc.nf != null;

  return (
    <>
      {/* Cabeçalho */}
      <div className="det-cabecalho">
        <button className="det-voltar" onClick={() => navigate('/professor/orientandos')}>{icoVoltar} Voltar para meus orientandos</button>
        <div className="det-titulo-area">
          <h1>{tcc.titulo}</h1>
          <div className="det-badges">
            <span className="badge-papel">{ROTULO_FASE[fase] ?? fase}</span>
            {tcc.semestre && <span className="status-pill status-normal">Semestre {tcc.semestre}</span>}
          </div>
        </div>
      </div>

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
            <div className="acoes" style={{ justifyContent: 'flex-start' }}>
              <button className="botao botao-secundario" disabled={enviando} onClick={() => { setRecusa({ tipo: 'continuidade' }); setParecer(''); setErro(''); }}>Descontinuar</button>
              <button className="botao" disabled={enviando} onClick={() => confirmarCont(tcc.id)}>Confirmar continuidade</button>
            </div>
          )}
        </section>
      )}

      {/* Ação: versão final (validada pelo orientador) */}
      {(fase === 'VALIDACAO_VERSAO_FINAL' || versaoFinal) && (
        <section className="cartao-secao bloco secao-acao">
          <h2>{icoDoc} Versão final</h2>
          {fase === 'CONCLUIDO' && <p className="legenda">TCC concluído — versão final aprovada.</p>}
          {versaoFinal ? <ItemDoc d={versaoFinal} /> : <p className="nota-vazio">Aguardando o aluno enviar a versão final.</p>}
          {versaoFinal?.status === 'REJEITADO' && versaoFinal.parecer && (
            <div className="alerta alerta-erro" style={{ marginTop: 10 }}><strong>Devolutiva enviada:</strong> {versaoFinal.parecer}</div>
          )}
          {fase === 'VALIDACAO_VERSAO_FINAL' && (
            <div className="acoes" style={{ justifyContent: 'flex-start' }}>
              <button className="botao botao-secundario" disabled={enviando} onClick={() => { setRecusa({ tipo: 'versaofinal' }); setParecer(''); setErro(''); }}>Pedir ajustes</button>
              <button className="botao" disabled={enviando} onClick={() => concluirVF(tcc.id)}>Aprovar e concluir</button>
            </div>
          )}
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
              monografias.map((d) => <ItemDoc key={d.id} d={d} />)
            )}
            {ultimaMono?.status === 'REJEITADO' && ultimaMono.parecer && (
              <div className="alerta alerta-erro" style={{ marginTop: 10 }}><strong>Devolutiva enviada:</strong> {ultimaMono.parecer}</div>
            )}
            {emDesenvolvimento && ultimaMono?.status === 'PENDENTE' && (
              <div className="acoes" style={{ marginTop: 12, justifyContent: 'flex-start' }}>
                <button className="botao botao-secundario" disabled={enviando} onClick={() => { setRecusa({ tipo: 'monografia' }); setParecer(''); setErro(''); }}>Pedir ajustes</button>
                <button className="botao" disabled={enviando} onClick={() => aprovarMono(tcc.id)}>Aprovar monografia</button>
              </div>
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
              {bancas.length === 0 ? (
                <p className="nota-vazio">Banca ainda não formada.</p>
              ) : (
                bancas.map((b: any) => (
                  <div key={b.id} className="trilha-bloco">
                    <div className="trilha-titulo"><strong>{b.fase === 'FASE_1' ? 'Fase I' : 'Fase II'}</strong></div>
                    <dl className="dados">
                      {(b.membros ?? []).map((m: any) => (
                        <div key={m.id}>
                          <dt>{nomeComTrat(m.avaliador)}</dt>
                          <dd>{fmtNota1(m.nota)}{m.parecer ? ` · ${m.parecer}` : ''}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))
              )}
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
            ? { titulo: 'Pedir ajustes na monografia', sub: 'O aluno poderá reenviar uma nova versão.', label: 'O que precisa ser ajustado' }
            : recusa.tipo === 'versaofinal'
              ? { titulo: 'Pedir ajustes na versão final', sub: 'O aluno poderá reenviar a versão final corrigida.', label: 'O que precisa ser ajustado' }
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
    </>
  );
}
