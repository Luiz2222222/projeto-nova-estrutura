import { useEffect, useState } from 'react';
import { apiGet, apiPost, URL_API, type ErroApi } from '../../api';
import { ROTULO_CURSO } from '@tcc/compartilhado';
import { ROTULO_TIPO_DOC } from '../../utils/fases';
import { Modal } from '../../componentes/Modal';

const ic = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {d.split('|').map((p, i) => <path key={i} d={p} />)}
  </svg>
);
const icoArquivo = ic('M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z|M14 2v6h6');
const icoOlho = ic('M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z|M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0');
const icoBaixar = ic('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4|M7 10l5 5 5-5|M12 15V3');

export function PainelCoordenador() {
  const [pendentes, setPendentes] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [recusando, setRecusando] = useState<any | null>(null);
  const [parecer, setParecer] = useState('');
  const [erroRecusa, setErroRecusa] = useState('');

  function carregar() {
    setCarregando(true);
    apiGet('/tccs/pendentes')
      .then(setPendentes)
      .catch(() => setPendentes([]))
      .finally(() => setCarregando(false));
  }
  useEffect(carregar, []);

  async function aprovar(id: string) {
    try {
      await apiPost(`/tccs/${id}/aprovar`, {});
      carregar();
    } catch (e) {
      window.alert((e as ErroApi).mensagem || 'Erro ao aprovar.');
    }
  }

  async function confirmarRecusa() {
    setErroRecusa('');
    try {
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
            return (
              <section key={t.id} className="cartao-secao">
                <h2>{t.titulo}</h2>
                <dl className="dados">
                  <div>
                    <dt>Aluno</dt>
                    <dd>
                      {t.aluno?.nomeCompleto}
                      {t.aluno?.curso ? ` · ${ROTULO_CURSO[t.aluno.curso as keyof typeof ROTULO_CURSO]}` : ''}
                    </dd>
                  </div>
                  <div>
                    <dt>Orientador</dt>
                    <dd>{t.orientador?.nomeCompleto ?? '—'}</dd>
                  </div>
                  {(t.coorientador || t.coorientadorNome) && (
                    <div>
                      <dt>Coorientador</dt>
                      <dd>{t.coorientador?.nomeCompleto ?? t.coorientadorNome}</dd>
                    </div>
                  )}
                </dl>
                {s?.mensagem && <p className="nota-vazio">Mensagem: “{s.mensagem}”</p>}

                <h3 style={{ marginTop: 14, fontSize: 14 }}>Documentos</h3>
                {t.documentos?.length ? (
                  t.documentos.map((d: any) => (
                    <div key={d.id} className="item-arquivo">
                      <div className="item-arquivo-info">
                        {icoArquivo}
                        <div>
                          <span className="nome">{ROTULO_TIPO_DOC[d.tipo] ?? d.tipo}</span>
                          <span className="meta">{d.nomeArquivo}</span>
                        </div>
                      </div>
                      <span className="acoes-doc">
                        <a className="botao-icone" title="Visualizar" href={`${URL_API}/tccs/documentos/${d.id}/visualizar`} target="_blank" rel="noreferrer">{icoOlho}</a>
                        <a className="botao-icone" title="Baixar" href={`${URL_API}/tccs/documentos/${d.id}/baixar`} target="_blank" rel="noreferrer">{icoBaixar}</a>
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="nota-vazio">Nenhum documento.</p>
                )}

                <div className="acoes">
                  <button
                    className="botao botao-secundario"
                    onClick={() => {
                      setRecusando(t);
                      setParecer('');
                      setErroRecusa('');
                    }}
                  >
                    Recusar
                  </button>
                  <button className="botao" onClick={() => aprovar(t.id)}>
                    Aprovar
                  </button>
                </div>
              </section>
            );
          })}
        </div>
      )}

      {recusando && (
        <Modal titulo="Recusar abertura" subtitulo={`TCC: ${recusando.titulo}`} aoFechar={() => setRecusando(null)}>
          {erroRecusa && <div className="erro-geral">{erroRecusa}</div>}
          <label className="campo">
            <span>Parecer (o aluno verá)</span>
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
    </>
  );
}
