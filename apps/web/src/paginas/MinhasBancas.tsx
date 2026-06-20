import { useEffect, useState } from 'react';
import { apiGet, apiPost, URL_API, type ErroApi } from '../api';
import { Modal } from '../componentes/Modal';
import { ROTULO_FASE } from '../utils/fases';
import { CRITERIOS_FASE1, CRITERIOS_FASE2, colunaPeso, soma, type Criterio } from '@tcc/compartilhado';

function ultimaMonografia(docs: any[] = []) {
  return docs.filter((d) => d.tipo === 'MONOGRAFIA').sort((a, b) => b.versao - a.versao)[0] ?? null;
}

const icoBaixar = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" />
  </svg>
);
const icoOlho = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" /><circle cx="12" cy="12" r="3" />
  </svg>
);
const fmt = (n: number) => n.toString().replace('.', ',');

export function MinhasBancas() {
  const [itens, setItens] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [avaliando, setAvaliando] = useState<any | null>(null);
  const [notas, setNotas] = useState<Record<string, string>>({});
  const [parecer, setParecer] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  function carregar() {
    setCarregando(true);
    apiGet('/bancas/minhas').then(setItens).catch(() => setItens([])).finally(() => setCarregando(false));
  }
  useEffect(carregar, []);

  const criteriosDe = (fase: string): Criterio[] => (fase === 'FASE_1' ? CRITERIOS_FASE1 : CRITERIOS_FASE2);
  // Pesos do semestre do próprio TCC (vêm anexados em cada banca pelo backend).
  const peso = (c: Criterio) => Number(avaliando?.pesos?.[colunaPeso(c.chave)] ?? c.pesoPadrao);
  const numNota = (chave: string) => {
    const n = parseFloat((notas[chave] ?? '').replace(',', '.'));
    return Number.isFinite(n) ? n : NaN;
  };

  function abrir(m: any) {
    setAvaliando(m);
    setNotas({});
    setParecer('');
    setErro('');
  }

  const criteriosAtual = avaliando ? criteriosDe(avaliando.banca.fase) : [];
  const totalPreview = soma(criteriosAtual.map((c) => { const n = numNota(c.chave); return Number.isFinite(n) ? n : 0; }));

  async function confirmar() {
    setErro('');
    const corpo: Record<string, number> = {};
    for (const c of criteriosAtual) {
      const n = numNota(c.chave);
      const p = peso(c);
      if (Number.isNaN(n) || n < 0 || n > p) {
        setErro(`Nota de "${c.rotulo}" deve estar entre 0 e ${fmt(p)}.`);
        return;
      }
      corpo[c.chave] = n;
    }
    setEnviando(true);
    try {
      await apiPost(`/bancas/${avaliando.bancaId}/avaliar`, { notas: corpo, parecer: parecer || undefined });
      setAvaliando(null);
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
            // Documento que a banca avalia: o enviado pelo coordenador ao formar a banca
            // (quando existe) substitui a monografia original.
            const docAval = m.banca.documentoAvaliacao ?? ultimaMonografia(tcc.documentos);
            const ehDocBanca = !!m.banca.documentoAvaliacao;
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

                {docAval && (
                  <div className="item-arquivo">
                    <div className="item-arquivo-info">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                      </svg>
                      <div>
                        <span className="nome">{ehDocBanca ? 'Documento para avaliação' : 'Monografia'}</span>
                        <span className="meta">{docAval.nomeArquivo}</span>
                      </div>
                    </div>
                    <span className="acoes-doc">
                      <a className="botao-icone" title="Visualizar" href={`${URL_API}/tccs/documentos/${docAval.id}/visualizar`} target="_blank" rel="noreferrer">{icoOlho}</a>
                      <a className="botao-icone" title="Baixar" href={`${URL_API}/tccs/documentos/${docAval.id}/baixar`} target="_blank" rel="noreferrer">{icoBaixar}</a>
                    </span>
                  </div>
                )}

                <div className="acoes" style={{ marginTop: 14, justifyContent: 'flex-start' }}>
                  {m.nota !== null ? (
                    <span className="selo selo-ok">Sua nota: {Number(m.nota).toFixed(1)}</span>
                  ) : podeAvaliar ? (
                    <button className="botao" onClick={() => abrir(m)}>Avaliar</button>
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
          <p className="legenda" style={{ marginTop: 0 }}>
            Pontue cada critério de 0 até o peso indicado. A nota total é a soma dos critérios.
          </p>
          {criteriosAtual.map((c) => (
            <label key={c.chave} className="campo">
              <span>
                {c.rotulo} <small className="muted">(0 – {fmt(peso(c))})</small>
              </span>
              <input
                inputMode="decimal"
                value={notas[c.chave] ?? ''}
                onChange={(e) => setNotas((v) => ({ ...v, [c.chave]: e.target.value }))}
                placeholder={`máx. ${fmt(peso(c))}`}
              />
            </label>
          ))}
          <div className="total-aval">
            Nota total: <strong>{totalPreview.toFixed(1).replace('.', ',')}</strong> / 10
          </div>
          <label className="campo">
            <span>Parecer (opcional)</span>
            <textarea rows={3} value={parecer} onChange={(e) => setParecer(e.target.value)} placeholder="Comentários para o aluno e a coordenação…" />
          </label>
          <div className="acoes">
            <button className="botao botao-secundario" disabled={enviando} onClick={() => setAvaliando(null)}>Voltar</button>
            <button className="botao" disabled={enviando} onClick={confirmar}>{enviando ? 'Enviando…' : 'Enviar avaliação'}</button>
          </div>
        </Modal>
      )}
    </>
  );
}
