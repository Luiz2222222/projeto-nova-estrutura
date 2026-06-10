import { useEffect, useState } from 'react';
import { apiGet, apiPost, URL_API, type ErroApi } from '../api';
import { Modal } from '../componentes/Modal';
import { ROTULO_FASE } from '../utils/fases';

function ultimaMonografia(docs: any[] = []) {
  return docs.filter((d) => d.tipo === 'MONOGRAFIA').sort((a, b) => b.versao - a.versao)[0] ?? null;
}

export function MinhasBancas() {
  const [itens, setItens] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [avaliando, setAvaliando] = useState<any | null>(null);
  const [nota, setNota] = useState('');
  const [parecer, setParecer] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  function carregar() {
    setCarregando(true);
    apiGet('/bancas/minhas').then(setItens).catch(() => setItens([])).finally(() => setCarregando(false));
  }
  useEffect(carregar, []);

  async function confirmar() {
    setErro('');
    const n = Number(nota);
    if (nota === '' || Number.isNaN(n) || n < 0 || n > 10) return setErro('Informe uma nota de 0 a 10.');
    setEnviando(true);
    try {
      await apiPost(`/bancas/${avaliando.bancaId}/avaliar`, { nota: n, parecer: parecer || undefined });
      setAvaliando(null);
      setNota('');
      setParecer('');
      carregar();
    } catch (e) {
      setErro((e as ErroApi).mensagem || 'Não foi possível enviar.');
    } finally {
      setEnviando(false);
    }
  }

  if (carregando) return <p className="nota-vazio">Carregando…</p>;

  return (
    <>
      <h1>Minhas bancas</h1>
      <p className="legenda">TCCs em que você é avaliador.</p>

      {itens.length === 0 ? (
        <section className="cartao-secao bloco">
          <p className="nota-vazio">Você não está em nenhuma banca no momento.</p>
        </section>
      ) : (
        <div className="lista bloco">
          {itens.map((m) => {
            const tcc = m.banca.tcc;
            const mono = ultimaMonografia(tcc.documentos);
            const faseAval = m.banca.fase === 'FASE_1' ? 'AVALIACAO_FASE_1' : 'AVALIACAO_FASE_2';
            const podeAvaliar = tcc.faseAtual === faseAval && m.nota === null;
            return (
              <section key={m.id} className="cartao-secao">
                <div className="aviso-cabecalho">
                  <h2>{tcc.titulo}</h2>
                  <span className="badge-papel">{m.banca.fase === 'FASE_1' ? 'Fase I' : 'Fase II'}</span>
                </div>
                <p className="nota-vazio" style={{ margin: '4px 0 14px' }}>
                  {tcc.aluno?.nomeCompleto} · {ROTULO_FASE[tcc.faseAtual] ?? tcc.faseAtual}
                </p>

                {mono && (
                  <div className="item-arquivo">
                    <div className="item-arquivo-info">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                      </svg>
                      <div>
                        <span className="nome">Monografia</span>
                        <span className="meta">{mono.nomeArquivo}</span>
                      </div>
                    </div>
                    <a className="botao botao-secundario" href={`${URL_API}/tccs/documentos/${mono.id}/baixar`} target="_blank" rel="noreferrer">
                      Baixar
                    </a>
                  </div>
                )}

                <div className="acoes" style={{ marginTop: 14, justifyContent: 'flex-start' }}>
                  {m.nota !== null ? (
                    <span className="selo selo-ok">Sua nota: {Number(m.nota).toFixed(1)}</span>
                  ) : podeAvaliar ? (
                    <button className="botao" onClick={() => { setAvaliando(m); setNota(''); setParecer(''); setErro(''); }}>
                      Avaliar
                    </button>
                  ) : (
                    <span className="nota-vazio" style={{ margin: 0 }}>Aguardando o momento de avaliação.</span>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {avaliando && (
        <Modal titulo="Avaliar TCC" subtitulo={avaliando.banca.tcc.titulo} aoFechar={() => !enviando && setAvaliando(null)}>
          {erro && <div className="erro-geral">{erro}</div>}
          <label className="campo">
            <span>Nota (0–10)</span>
            <input type="number" min="0" max="10" step="0.1" value={nota} onChange={(e) => setNota(e.target.value)} />
          </label>
          <label className="campo">
            <span>Parecer (opcional)</span>
            <textarea rows={4} value={parecer} onChange={(e) => setParecer(e.target.value)} placeholder="Comentários para o aluno e a coordenação…" />
          </label>
          <div className="acoes">
            <button className="botao botao-secundario" disabled={enviando} onClick={() => setAvaliando(null)}>Voltar</button>
            <button className="botao" disabled={enviando} onClick={confirmar}>{enviando ? 'Enviando…' : 'Enviar nota'}</button>
          </div>
        </Modal>
      )}
    </>
  );
}
