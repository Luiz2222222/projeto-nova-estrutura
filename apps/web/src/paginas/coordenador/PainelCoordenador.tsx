import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiGet, apiPost, URL_API, type ErroApi } from '../../api';
import type { Tcc, UsuarioResumo } from '../../tipos';
import { ROTULO_CURSO } from '@tcc/compartilhado';
import { ROTULO_TIPO_DOC } from '../../utils/fases';
import { Modal } from '../../componentes/Modal';
import { ModalConfirmacao } from '../../componentes/ModalConfirmacao';

const ic = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {d.split('|').map((p, i) => <path key={i} d={p} />)}
  </svg>
);
const icoOlho = ic('M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z|M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0');
const icoCheck = ic('M20 6 9 17l-5-5');
const icoX = ic('M18 6 6 18|M6 6l12 12');

const fmtData = (iso?: string | null) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR'); // dd/mm/aaaa, sem horário
};
const nomeComTrat = (p?: UsuarioResumo | null) => (p ? `${p.tratamento ? p.tratamento + ' ' : ''}${p.nomeCompleto}` : '—');
// Coorientador: interno (relação) ou externo (campos soltos). null se não houver.
const coorientadorDe = (t: Tcc) => {
  if (t.coorientador) return { nome: t.coorientador.nomeCompleto, titulacao: t.coorientador.tratamento, afiliacao: t.coorientador.afiliacao, lattes: null as string | null };
  if (t.coorientadorNome) return { nome: t.coorientadorNome, titulacao: t.coorientadorTitulacao, afiliacao: t.coorientadorAfiliacao, lattes: t.coorientadorLattes };
  return null;
};

export function PainelCoordenador() {
  const [pendentes, setPendentes] = useState<Tcc[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [recusando, setRecusando] = useState<Tcc | null>(null);
  const [parecer, setParecer] = useState('');
  const [erroRecusa, setErroRecusa] = useState('');
  const [aprovando, setAprovando] = useState<any | null>(null);
  const [erroAprovar, setErroAprovar] = useState('');
  const [processando, setProcessando] = useState(false);
  const [searchParams] = useSearchParams();
  const [destacado, setDestacado] = useState<string | null>(null);
  const cardRefs = useRef<Record<string, HTMLElement | null>>({});

  function carregar() {
    setCarregando(true);
    apiGet<Tcc[]>('/tccs/pendentes')
      .then(setPendentes)
      .catch(() => setPendentes([]))
      .finally(() => setCarregando(false));
  }
  useEffect(carregar, []);

  // Vindo do dashboard com ?tccId=: rola até o card e o destaca por alguns segundos.
  useEffect(() => {
    const tccId = searchParams.get('tccId');
    if (!tccId || carregando) return;
    const el = cardRefs.current[tccId];
    if (!el) return;
    const t = setTimeout(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setDestacado(tccId);
    }, 200);
    const t2 = setTimeout(() => setDestacado(null), 2600);
    return () => { clearTimeout(t); clearTimeout(t2); };
  }, [searchParams, carregando, pendentes]);

  async function confirmarAprovar() {
    if (!aprovando) return;
    setErroAprovar('');
    setProcessando(true);
    try {
      await apiPost(`/tccs/${aprovando.id}/aprovar`, {});
      setAprovando(null);
      setProcessando(false);
      carregar();
    } catch (e) {
      setErroAprovar((e as ErroApi).mensagem || 'Erro ao aprovar.');
      setProcessando(false);
    }
  }

  async function confirmarRecusa() {
    setErroRecusa('');
    try {
      if (!recusando) return;
      await apiPost(`/tccs/${recusando.id}/recusar`, { parecer });
      setRecusando(null);
      setParecer('');
      carregar();
    } catch (e) {
      const er = e as ErroApi;
      setErroRecusa(er.erros?.[0]?.mensagem || er.mensagem || 'Erro ao recusar.');
    }
  }

  return (
    <>
      <h1>Solicitações</h1>
      <p className="legenda">Solicitações de abertura aguardando aprovação.</p>

      {carregando ? (
        <p className="nota-vazio">Carregando…</p>
      ) : pendentes.length === 0 ? (
        <section className="cartao-secao bloco">
          <p className="nota-vazio">Nenhuma abertura pendente. 🎉</p>
        </section>
      ) : (
        <div className="lista bloco">
          {pendentes.map((t) => {
            const s = t.solicitacoes?.[0];
            const co = coorientadorDe(t);
            return (
              <section
                key={t.id}
                ref={(el) => { cardRefs.current[t.id] = el; }}
                className={`cartao-secao card-solicitacao${destacado === t.id ? ' destacado' : ''}`}
              >
                {/* Header: data + documentos (esq) · Aceitar/Rejeitar (dir) */}
                <div className="solic-cabecalho">
                  <div className="solic-cabecalho-esq">
                    <span className="solic-data"><strong>Data da solicitação:</strong> {fmtData(s?.criadoEm)}</span>
                    {(t.documentos?.length ?? 0) > 0 && (
                      <span className="solic-docs">
                        {(t.documentos ?? []).map((d) => (
                          <a key={d.id} className="botao-doc" href={`${URL_API}/tccs/documentos/${d.id}/visualizar`} target="_blank" rel="noreferrer" title="Visualizar">
                            {icoOlho}<span>{ROTULO_TIPO_DOC[d.tipo] ?? d.tipo}</span>
                          </a>
                        ))}
                      </span>
                    )}
                  </div>
                  <div className="solic-acoes">
                    <button className="botao" onClick={() => { setAprovando(t); setErroAprovar(''); }}>{icoCheck} Aceitar</button>
                    <button className="botao botao-perigo" onClick={() => { setRecusando(t); setParecer(''); setErroRecusa(''); }}>{icoX} Rejeitar</button>
                  </div>
                </div>

                {/* Dados do aluno (esq) · orientação (dir) */}
                <div className="solic-grid">
                  <div className="solic-bloco">
                    <p><strong>Aluno:</strong> {t.aluno?.nomeCompleto ?? '—'}</p>
                    <p><strong>Email:</strong> {t.aluno?.email ?? '—'}</p>
                    {t.aluno?.curso && <p><strong>Curso:</strong> {ROTULO_CURSO[t.aluno.curso as keyof typeof ROTULO_CURSO] ?? t.aluno.curso}</p>}
                    <p><strong>Título do TCC:</strong> {t.titulo}</p>
                  </div>
                  <div className="solic-bloco">
                    <p><strong>Orientador:</strong> {nomeComTrat(t.orientador)}{t.orientador?.afiliacao ? ` (${t.orientador.afiliacao})` : ''}</p>
                    {co ? (
                      <>
                        <p style={{ marginTop: 6 }}><strong>Co-orientador:</strong> {co.titulacao ? co.titulacao + ' ' : ''}{co.nome}{co.afiliacao ? ` (${co.afiliacao})` : ''}</p>
                        {co.lattes && (
                          <p className="solic-sub"><strong>Lattes:</strong> <a href={co.lattes} target="_blank" rel="noreferrer">{co.lattes}</a></p>
                        )}
                      </>
                    ) : (
                      <p className="solic-sub" style={{ fontStyle: 'italic' }}>Sem coorientador sugerido</p>
                    )}
                  </div>
                </div>

                {/* Mensagem do aluno */}
                {s?.mensagem && (
                  <div className="solic-mensagem">
                    <p className="solic-mensagem-rot">Mensagem do aluno:</p>
                    <p className="solic-mensagem-txt">{s.mensagem}</p>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {recusando && (
        <Modal titulo="Recusar abertura" subtitulo={`TCC: ${recusando.titulo}`} aoFechar={() => setRecusando(null)}>
          {erroRecusa && <div className="erro-geral">{erroRecusa}</div>}
          <label className="campo">
            <span>Parecer (opcional — o aluno verá)</span>
            <textarea
              rows={4}
              value={parecer}
              onChange={(e) => setParecer(e.target.value)}
              placeholder="Explique o que precisa ser corrigido…"
            />
          </label>
          <div className="acoes">
            <button className="botao botao-secundario" onClick={() => setRecusando(null)}>
              Voltar
            </button>
            <button className="botao" onClick={confirmarRecusa}>
              Confirmar recusa
            </button>
          </div>
        </Modal>
      )}

      {aprovando && (
        <ModalConfirmacao
          titulo="Aprovar abertura"
          mensagem={<>Deseja aprovar a abertura do TCC <strong>{aprovando.titulo}</strong>? O aluno avança para o desenvolvimento e os documentos iniciais são aprovados.</>}
          textoConfirmar="Aprovar"
          textoProcessando="Aprovando…"
          processando={processando}
          erro={erroAprovar}
          aoConfirmar={confirmarAprovar}
          aoCancelar={() => setAprovando(null)}
        />
      )}
    </>
  );
}
