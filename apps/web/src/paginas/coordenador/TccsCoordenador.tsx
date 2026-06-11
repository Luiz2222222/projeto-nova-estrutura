import { useEffect, useState } from 'react';
import { apiGet, apiPost, URL_API, type ErroApi } from '../../api';
import { Modal } from '../../componentes/Modal';
import { ROTULO_FASE } from '../../utils/fases';

const bancaDe = (t: any, fase: string) => t.bancas?.find((b: any) => b.fase === fase);
const ultimaVF = (t: any) =>
  (t.documentos ?? []).filter((d: any) => d.tipo === 'VERSAO_FINAL').sort((a: any, b: any) => b.versao - a.versao)[0] ?? null;
const ehFormar = (f: string) => f === 'FORMACAO_BANCA_FASE_1' || f === 'FORMACAO_BANCA_FASE_2';
const ehValidar = (f: string) => f === 'VALIDACAO_FASE_1' || f === 'VALIDACAO_FASE_2';
const qtdBanca = (f: string) => (f === 'FORMACAO_BANCA_FASE_2' ? 3 : 2);
const faseValidando = (f: string) => (f === 'VALIDACAO_FASE_2' ? 'FASE_2' : 'FASE_1');

export function TccsCoordenador() {
  const [tccs, setTccs] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(true);

  const [formando, setFormando] = useState<any | null>(null);
  const [candidatos, setCandidatos] = useState<any[]>([]);
  const [selecionados, setSelecionados] = useState<string[]>([]);

  const [validando, setValidando] = useState<any | null>(null);
  const [resultado, setResultado] = useState<any | null>(null);

  const [analisando, setAnalisando] = useState<any | null>(null);
  const [parecerAnalise, setParecerAnalise] = useState('');

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
  function toggle(id: string, qtd: number) {
    setSelecionados((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length < qtd ? [...s, id] : s));
  }
  async function confirmarFormar() {
    const qtd = qtdBanca(formando.faseAtual);
    setErro('');
    if (selecionados.length !== qtd) return setErro(`Selecione exatamente ${qtd} avaliadores.`);
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

  function fecharAnalise() {
    setAnalisando(null);
    setParecerAnalise('');
    setErro('');
  }
  async function analiseFinal(decisao: 'CONCLUIR' | 'AJUSTES') {
    setErro('');
    if (decisao === 'AJUSTES' && parecerAnalise.trim().length < 3) return setErro('Escreva os ajustes necessários.');
    setEnviando(true);
    try {
      await apiPost(`/tccs/${analisando.id}/analise-final`, { decisao, parecer: parecerAnalise || undefined });
      fecharAnalise();
      carregar();
    } catch (e) {
      setErro((e as ErroApi).mensagem || 'Não foi possível concluir.');
    } finally {
      setEnviando(false);
    }
  }

  if (carregando) return <p className="nota-vazio">Carregando…</p>;

  return (
    <>
      <h1>TCCs</h1>
      <p className="legenda">TCCs do período e a gestão de cada um.</p>

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
                {t.nf2 != null ? ` · NF2: ${Number(t.nf2).toFixed(1)}` : ''}
                {t.nf != null ? ` · NF: ${Number(t.nf).toFixed(1)}` : ''}
              </p>
              {ehFormar(t.faseAtual) && (
                <div className="acoes" style={{ justifyContent: 'flex-start' }}>
                  <button className="botao" onClick={() => abrirFormar(t)}>
                    {t.faseAtual === 'FORMACAO_BANCA_FASE_2' ? 'Formar banca (Fase II)' : 'Formar banca'}
                  </button>
                </div>
              )}
              {ehValidar(t.faseAtual) && (
                <div className="acoes" style={{ justifyContent: 'flex-start' }}>
                  <button className="botao" onClick={() => { setValidando(t); setResultado(null); setErro(''); }}>
                    {t.faseAtual === 'VALIDACAO_FASE_2' ? 'Validar Fase II' : 'Validar Fase I'}
                  </button>
                </div>
              )}
              {t.faseAtual === 'ANALISE_FINAL_COORDENADOR' && (
                <div className="acoes" style={{ justifyContent: 'flex-start' }}>
                  <button className="botao" onClick={() => { setAnalisando(t); setParecerAnalise(''); setErro(''); }}>Análise final</button>
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      {formando && (() => {
        const qtd = qtdBanca(formando.faseAtual);
        const rotulo = formando.faseAtual === 'FORMACAO_BANCA_FASE_2' ? 'Fase II' : 'Fase I';
        return (
          <Modal titulo={`Formar banca (${rotulo})`} subtitulo={`Escolha ${qtd} avaliadores · ${formando.titulo}`} aoFechar={() => !enviando && setFormando(null)}>
            {erro && <div className="erro-geral">{erro}</div>}
            {candidatos.length === 0 ? (
              <p className="nota-vazio">Nenhum avaliador disponível (cadastre professores/avaliadores).</p>
            ) : (
              <div className="opcoes" style={{ flexDirection: 'column' }}>
                {candidatos.map((c) => (
                  <label key={c.id} className={`opcao${selecionados.includes(c.id) ? ' sel' : ''}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, width: '100%' }}>
                    <input type="checkbox" checked={selecionados.includes(c.id)} onChange={() => toggle(c.id, qtd)} />
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
              <button className="botao" disabled={enviando || selecionados.length !== qtd} onClick={confirmarFormar}>
                {enviando ? 'Formando…' : `Formar (${selecionados.length}/${qtd})`}
              </button>
            </div>
          </Modal>
        );
      })()}

      {validando && (() => {
        const fase = faseValidando(validando.faseAtual);
        const ehF2 = fase === 'FASE_2';
        const banca = bancaDe(validando, fase);
        const notas: number[] = (banca?.membros ?? []).map((m: any) => m.nota).filter((n: any) => n != null);
        const media = notas.length ? notas.reduce((s, n) => s + n, 0) / notas.length : null;
        const nfFinal = ehF2 && media != null ? 0.6 * (validando.nf1 ?? 0) + 0.4 * media : null;
        return (
          <Modal titulo={ehF2 ? 'Validar Fase II' : 'Validar Fase I'} subtitulo={validando.titulo} aoFechar={() => !enviando && fecharValidar()}>
            {erro && <div className="erro-geral">{erro}</div>}
            <dl className="dados">
              {banca?.membros?.map((m: any) => (
                <div key={m.id}>
                  <dt>{m.avaliador?.nomeCompleto}</dt>
                  <dd>{m.nota != null ? Number(m.nota).toFixed(1) : '—'}</dd>
                </div>
              ))}
              <div>
                <dt>{ehF2 ? 'NF2 (média)' : 'NF1 (média)'}</dt>
                <dd><strong>{media != null ? media.toFixed(2) : '—'}</strong></dd>
              </div>
              {ehF2 && (
                <div>
                  <dt>Nota final (NF)</dt>
                  <dd>
                    <strong>{nfFinal != null ? nfFinal.toFixed(2) : '—'}</strong>
                    {nfFinal != null ? (nfFinal >= 7 ? ' · aprovado' : ' · reprovado') : ''}
                  </dd>
                </div>
              )}
              {!ehF2 && media != null && (
                <div><dt>Corte</dt><dd>{media >= 6 ? 'aprovado (≥6)' : 'reprovado (<6)'}</dd></div>
              )}
            </dl>
            {resultado && (
              <div className="alerta" style={resultado.aprovado
                ? { background: 'var(--aprovado-suave)', color: 'var(--aprovado)', marginTop: 14 }
                : { background: 'var(--reprovado-suave)', color: 'var(--reprovado)', marginTop: 14 }}>
                {resultado.fase === 'FASE_1'
                  ? (resultado.aprovado
                      ? `Aprovado na Fase I (NF1 ${Number(resultado.nf1).toFixed(2)}). Segue para a Fase II.`
                      : `Reprovado na Fase I (NF1 ${Number(resultado.nf1).toFixed(2)}).`)
                  : (resultado.aprovado
                      ? `Aprovado na Fase II — NF ${Number(resultado.nf).toFixed(2)}. Agora o aluno deve enviar a versão final.`
                      : `Reprovado na Fase II. Nota final NF ${Number(resultado.nf).toFixed(2)}.`)}
              </div>
            )}
            <div className="acoes">
              <button className="botao botao-secundario" disabled={enviando} onClick={fecharValidar}>{resultado ? 'Fechar' : 'Voltar'}</button>
              {!resultado && (
                <button className="botao" disabled={enviando} onClick={confirmarValidar}>{enviando ? 'Validando…' : 'Validar'}</button>
              )}
            </div>
          </Modal>
        );
      })()}

      {analisando && (() => {
        const vf = ultimaVF(analisando);
        return (
          <Modal titulo="Análise final" subtitulo={analisando.titulo} aoFechar={() => !enviando && fecharAnalise()}>
            {erro && <div className="erro-geral">{erro}</div>}
            {vf ? (
              <div className="item-arquivo">
                <div className="item-arquivo-info">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  <div>
                    <span className="nome">Versão final</span>
                    <span className="meta">{vf.nomeArquivo}</span>
                  </div>
                </div>
                <a className="botao botao-secundario" href={`${URL_API}/tccs/documentos/${vf.id}/baixar`} target="_blank" rel="noreferrer">Baixar</a>
              </div>
            ) : (
              <p className="nota-vazio">Versão final não encontrada.</p>
            )}
            <label className="campo" style={{ marginTop: 14 }}>
              <span>Parecer (obrigatório só se pedir ajustes)</span>
              <textarea rows={3} value={parecerAnalise} onChange={(e) => setParecerAnalise(e.target.value)} placeholder="Ajustes a corrigir…" />
            </label>
            <div className="acoes">
              <button className="botao botao-secundario" disabled={enviando} onClick={() => analiseFinal('AJUSTES')}>Pedir ajustes</button>
              <button className="botao" disabled={enviando} onClick={() => analiseFinal('CONCLUIR')}>Concluir TCC</button>
            </div>
          </Modal>
        );
      })()}
    </>
  );
}
