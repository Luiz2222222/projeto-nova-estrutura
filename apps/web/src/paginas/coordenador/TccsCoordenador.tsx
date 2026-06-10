import { useEffect, useState } from 'react';
import { apiGet, apiPost, type ErroApi } from '../../api';
import { Modal } from '../../componentes/Modal';
import { ROTULO_FASE } from '../../utils/fases';

const bancaFase1 = (t: any) => t.bancas?.find((b: any) => b.fase === 'FASE_1');

export function TccsCoordenador() {
  const [tccs, setTccs] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(true);

  const [formando, setFormando] = useState<any | null>(null);
  const [candidatos, setCandidatos] = useState<any[]>([]);
  const [selecionados, setSelecionados] = useState<string[]>([]);

  const [validando, setValidando] = useState<any | null>(null);
  const [resultado, setResultado] = useState<any | null>(null);

  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  function carregar() {
    setCarregando(true);
    apiGet('/tccs').then(setTccs).catch(() => setTccs([])).finally(() => setCarregando(false));
  }
  useEffect(carregar, []);

  async function abrirFormar(t: any) {
    setFormando(t);
    setSelecionados([]);
    setErro('');
    setCandidatos([]);
    try {
      setCandidatos(await apiGet(`/tccs/${t.id}/banca/candidatos`));
    } catch {
      /* lista vazia */
    }
  }
  function toggle(id: string) {
    setSelecionados((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length < 2 ? [...s, id] : s));
  }
  async function confirmarFormar() {
    setErro('');
    if (selecionados.length !== 2) return setErro('Selecione exatamente 2 avaliadores.');
    setEnviando(true);
    try {
      await apiPost(`/tccs/${formando.id}/banca`, { avaliadorIds: selecionados });
      setFormando(null);
      carregar();
    } catch (e) {
      setErro((e as ErroApi).mensagem || 'Não foi possível formar a banca.');
    } finally {
      setEnviando(false);
    }
  }

  function fecharValidar() {
    setValidando(null);
    setResultado(null);
  }
  async function confirmarValidar() {
    setErro('');
    setEnviando(true);
    try {
      const r = await apiPost(`/tccs/${validando.id}/banca/validar`, {});
      setResultado(r);
      carregar();
    } catch (e) {
      setErro((e as ErroApi).mensagem || 'Não foi possível validar.');
    } finally {
      setEnviando(false);
    }
  }

  if (carregando) return <p className="nota-vazio">Carregando…</p>;

  return (
    <>
      <h1>TCCs</h1>
      <p className="legenda">Todos os TCCs do período e a gestão de cada um.</p>

      {tccs.length === 0 ? (
        <section className="cartao-secao bloco">
          <p className="nota-vazio">Nenhum TCC ainda.</p>
        </section>
      ) : (
        <div className="lista bloco">
          {tccs.map((t) => (
            <section key={t.id} className="cartao-secao">
              <div className="aviso-cabecalho">
                <h2>{t.titulo}</h2>
                <span className="badge-papel">{ROTULO_FASE[t.faseAtual] ?? t.faseAtual}</span>
              </div>
              <p className="nota-vazio" style={{ margin: '4px 0 12px' }}>
                {t.aluno?.nomeCompleto} · Orientador: {t.orientador?.nomeCompleto ?? '—'}
                {t.nf1 != null ? ` · NF1: ${Number(t.nf1).toFixed(1)}` : ''}
              </p>
              {t.faseAtual === 'FORMACAO_BANCA_FASE_1' && (
                <div className="acoes" style={{ justifyContent: 'flex-start' }}>
                  <button className="botao" onClick={() => abrirFormar(t)}>Formar banca</button>
                </div>
              )}
              {t.faseAtual === 'VALIDACAO_FASE_1' && (
                <div className="acoes" style={{ justifyContent: 'flex-start' }}>
                  <button className="botao" onClick={() => { setValidando(t); setResultado(null); setErro(''); }}>
                    Validar Fase I
                  </button>
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      {formando && (
        <Modal titulo="Formar banca (Fase I)" subtitulo={`Escolha 2 avaliadores · ${formando.titulo}`} aoFechar={() => !enviando && setFormando(null)}>
          {erro && <div className="erro-geral">{erro}</div>}
          {candidatos.length === 0 ? (
            <p className="nota-vazio">Nenhum avaliador disponível (cadastre professores/avaliadores).</p>
          ) : (
            <div className="opcoes" style={{ flexDirection: 'column' }}>
              {candidatos.map((c) => (
                <label
                  key={c.id}
                  className={`opcao${selecionados.includes(c.id) ? ' sel' : ''}`}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, width: '100%' }}
                >
                  <input type="checkbox" checked={selecionados.includes(c.id)} onChange={() => toggle(c.id)} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="opcao-titulo">{c.tratamento ? c.tratamento + ' ' : ''}{c.nomeCompleto}</span>
                    <span className="opcao-desc">{c.papel === 'AVALIADOR' ? `Externo${c.afiliacao ? ' · ' + c.afiliacao : ''}` : 'Professor'}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
          <div className="acoes">
            <button className="botao botao-secundario" disabled={enviando} onClick={() => setFormando(null)}>Voltar</button>
            <button className="botao" disabled={enviando || selecionados.length !== 2} onClick={confirmarFormar}>
              {enviando ? 'Formando…' : `Formar (${selecionados.length}/2)`}
            </button>
          </div>
        </Modal>
      )}

      {validando && (
        <Modal titulo="Validar Fase I" subtitulo={validando.titulo} aoFechar={() => !enviando && fecharValidar()}>
          {erro && <div className="erro-geral">{erro}</div>}
          {(() => {
            const b1 = bancaFase1(validando);
            const notas: number[] = (b1?.membros ?? []).map((m: any) => m.nota).filter((n: any) => n != null);
            const nf1 = notas.length ? notas.reduce((s, n) => s + n, 0) / notas.length : null;
            return (
              <dl className="dados">
                {b1?.membros?.map((m: any) => (
                  <div key={m.id}>
                    <dt>{m.avaliador?.nomeCompleto}</dt>
                    <dd>{m.nota != null ? Number(m.nota).toFixed(1) : '—'}</dd>
                  </div>
                ))}
                <div>
                  <dt>NF1 (média)</dt>
                  <dd>
                    <strong>{nf1 != null ? nf1.toFixed(2) : '—'}</strong>
                    {nf1 != null ? (nf1 >= 6 ? ' · aprovado' : ' · reprovado') : ''}
                  </dd>
                </div>
              </dl>
            );
          })()}
          {resultado && (
            <div className="alerta" style={resultado.aprovado
              ? { background: 'var(--aprovado-suave)', color: 'var(--aprovado)', marginTop: 14 }
              : { background: 'var(--reprovado-suave)', color: 'var(--reprovado)', marginTop: 14 }}>
              {resultado.aprovado
                ? `Aprovado na Fase I (NF1 ${Number(resultado.nf1).toFixed(2)}). Segue para a Fase II.`
                : `Reprovado na Fase I (NF1 ${Number(resultado.nf1).toFixed(2)}).`}
            </div>
          )}
          <div className="acoes">
            <button className="botao botao-secundario" disabled={enviando} onClick={fecharValidar}>{resultado ? 'Fechar' : 'Voltar'}</button>
            {!resultado && (
              <button className="botao" disabled={enviando} onClick={confirmarValidar}>{enviando ? 'Validando…' : 'Validar'}</button>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
