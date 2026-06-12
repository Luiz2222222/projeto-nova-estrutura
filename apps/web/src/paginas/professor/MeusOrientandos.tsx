import { useEffect, useState } from 'react';
import { apiGet, apiPost, URL_API, type ErroApi } from '../../api';
import { Modal } from '../../componentes/Modal';
import { ROTULO_FASE } from '../../utils/fases';

type Doc = { id: string; tipo: string; status: string; versao: number; parecer?: string | null; nomeArquivo: string };

function ultimaMonografia(docs: Doc[] = []): Doc | null {
  const m = docs.filter((d) => d.tipo === 'MONOGRAFIA').sort((a, b) => b.versao - a.versao);
  return m[0] ?? null;
}
function ultimaVF(docs: Doc[] = []): Doc | null {
  const m = docs.filter((d) => d.tipo === 'VERSAO_FINAL').sort((a, b) => b.versao - a.versao);
  return m[0] ?? null;
}

export function MeusOrientandos() {
  const [tccs, setTccs] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(true);
  // modal de parecer (rejeitar monografia ou rejeitar continuidade)
  const [recusa, setRecusa] = useState<{ tccId: string; tipo: 'monografia' | 'continuidade' | 'versaofinal' } | null>(null);
  const [parecer, setParecer] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  function carregar() {
    setCarregando(true);
    apiGet('/tccs/orientando')
      .then(setTccs)
      .catch(() => setTccs([]))
      .finally(() => setCarregando(false));
  }
  useEffect(carregar, []);

  async function acao(fn: () => Promise<unknown>) {
    try {
      await fn();
      carregar();
    } catch (e) {
      window.alert((e as ErroApi).mensagem || 'Não foi possível concluir a ação.');
    }
  }

  const aprovarMono = (id: string) =>
    acao(() => apiPost(`/tccs/${id}/monografia/avaliar`, { decisao: 'APROVAR' }));
  const confirmarCont = (id: string) =>
    acao(() => apiPost(`/tccs/${id}/continuidade`, { decisao: 'CONFIRMAR' }));
  const concluirVF = (id: string) =>
    acao(() => apiPost(`/tccs/${id}/validar-versao-final`, { decisao: 'CONCLUIR' }));

  async function confirmarRecusa() {
    if (!recusa) return;
    setErro('');
    setEnviando(true);
    try {
      if (recusa.tipo === 'monografia') {
        await apiPost(`/tccs/${recusa.tccId}/monografia/avaliar`, { decisao: 'REJEITAR', parecer });
      } else if (recusa.tipo === 'versaofinal') {
        await apiPost(`/tccs/${recusa.tccId}/validar-versao-final`, { decisao: 'AJUSTES', parecer });
      } else {
        await apiPost(`/tccs/${recusa.tccId}/continuidade`, { decisao: 'REJEITAR', parecer });
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

  return (
    <>
      <h1>Meus orientandos</h1>
      <p className="legenda">TCCs sob sua orientação e as ações de cada fase.</p>

      {tccs.length === 0 ? (
        <section className="cartao-secao bloco">
          <p className="nota-vazio">Você ainda não tem orientandos.</p>
        </section>
      ) : (
        <div className="lista bloco">
          {tccs.map((t) => {
            const mono = ultimaMonografia(t.documentos);
            const vf = ultimaVF(t.documentos);
            const emDesenvolvimento = t.faseAtual === 'DESENVOLVIMENTO';
            return (
              <section key={t.id} className="cartao-secao">
                <div className="aviso-cabecalho">
                  <h2>{t.titulo}</h2>
                  <span className="badge-papel">{ROTULO_FASE[t.faseAtual] ?? t.faseAtual}</span>
                </div>
                <p className="nota-vazio" style={{ margin: '4px 0 16px' }}>
                  {t.aluno?.nomeCompleto}
                </p>

                {/* Trilha A — monografia */}
                <div className="trilha-bloco">
                  <div className="trilha-titulo">
                    <strong>Monografia</strong>
                    {t.monografiaAprovada && <span className="selo selo-ok">Aprovada</span>}
                  </div>
                  {mono ? (
                    <div className="item-arquivo">
                      <div className="item-arquivo-info">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                        </svg>
                        <div>
                          <span className="nome">{mono.nomeArquivo}</span>
                          <span className="meta">Versão {mono.versao} · {statusDoc(mono.status)}</span>
                        </div>
                      </div>
                      <a className="botao botao-secundario" href={`${URL_API}/tccs/documentos/${mono.id}/baixar`} target="_blank" rel="noreferrer">
                        Baixar
                      </a>
                    </div>
                  ) : (
                    <p className="nota-vazio">Aguardando o aluno enviar a monografia.</p>
                  )}
                  {emDesenvolvimento && mono?.status === 'PENDENTE' && (
                    <div className="acoes" style={{ marginTop: 12 }}>
                      <button className="botao botao-secundario" onClick={() => { setRecusa({ tccId: t.id, tipo: 'monografia' }); setParecer(''); setErro(''); }}>
                        Pedir ajustes
                      </button>
                      <button className="botao" onClick={() => aprovarMono(t.id)}>Aprovar monografia</button>
                    </div>
                  )}
                </div>

                {/* Trilha B — continuidade */}
                <div className="trilha-bloco">
                  <div className="trilha-titulo">
                    <strong>Continuidade</strong>
                    {t.continuidadeConfirmada && <span className="selo selo-ok">Confirmada</span>}
                  </div>
                  {emDesenvolvimento && !t.continuidadeConfirmada ? (
                    <div className="acoes" style={{ marginTop: 4 }}>
                      <button className="botao botao-secundario" onClick={() => { setRecusa({ tccId: t.id, tipo: 'continuidade' }); setParecer(''); setErro(''); }}>
                        Descontinuar
                      </button>
                      <button className="botao" onClick={() => confirmarCont(t.id)}>Confirmar continuidade</button>
                    </div>
                  ) : (
                    !t.continuidadeConfirmada && <p className="nota-vazio">—</p>
                  )}
                </div>

                {/* Trilha C — versão final (validada pelo orientador) */}
                {(t.faseAtual === 'VALIDACAO_VERSAO_FINAL' || vf) && (
                  <div className="trilha-bloco">
                    <div className="trilha-titulo">
                      <strong>Versão final</strong>
                      {t.faseAtual === 'CONCLUIDO' && <span className="selo selo-ok">Concluído</span>}
                    </div>
                    {vf ? (
                      <div className="item-arquivo">
                        <div className="item-arquivo-info">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                          </svg>
                          <div>
                            <span className="nome">{vf.nomeArquivo}</span>
                            <span className="meta">Versão {vf.versao}</span>
                          </div>
                        </div>
                        <a className="botao botao-secundario" href={`${URL_API}/tccs/documentos/${vf.id}/baixar`} target="_blank" rel="noreferrer">Baixar</a>
                      </div>
                    ) : (
                      <p className="nota-vazio">Aguardando o aluno enviar a versão final.</p>
                    )}
                    {vf?.status === 'REJEITADO' && vf.parecer && (
                      <div className="alerta alerta-erro" style={{ marginTop: 10 }}><strong>Devolutiva enviada:</strong> {vf.parecer}</div>
                    )}
                    {t.faseAtual === 'VALIDACAO_VERSAO_FINAL' && (
                      <div className="acoes" style={{ marginTop: 12 }}>
                        <button className="botao botao-secundario" onClick={() => { setRecusa({ tccId: t.id, tipo: 'versaofinal' }); setParecer(''); setErro(''); }}>Pedir ajustes</button>
                        <button className="botao" onClick={() => concluirVF(t.id)}>Aprovar e concluir</button>
                      </div>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

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
              <button className="botao" disabled={enviando} onClick={confirmarRecusa}>
                {enviando ? 'Enviando…' : 'Confirmar'}
              </button>
            </div>
          </Modal>
        );
      })()}
    </>
  );
}

function statusDoc(s: string): string {
  return s === 'APROVADO' ? 'aprovada' : s === 'REJEITADO' ? 'rejeitada (aguardando reenvio)' : 'aguardando avaliação';
}
