// Página interna de detalhe do TCC (visão do coordenador).
// Espelha o layout do projeto antigo (TCCDetalhe.tsx): voltar, título + status,
// cards de aluno/orientação, seção de ação conforme a fase, documentos, banca/notas
// e a trilha do fluxo. Respeita as regras do projeto novo:
//  - só a banca da Fase I é formada manualmente pelo coordenador;
//  - a banca da Fase II é o orientador + os 2 avaliadores da Fase I (já composta);
//  - a versão final é validada pelo ORIENTADOR, não pelo coordenador.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiGet, apiPost, apiUpload, URL_API, type ErroApi } from '../../api';
import { ROTULO_FASE } from '../../utils/fases';
import { ROTULO_CURSO, CRITERIOS_FASE1, CRITERIOS_FASE2, colunaNota, type Criterio } from '@tcc/compartilhado';
import { extrairSecao, fmtNota as fmtNotaAv, fmtNum, pesoDe, STATUS_AVAL } from '../../utils/avaliacao';
import { TimelineVerticalDetalhada } from '../../componentes/TimelineVerticalDetalhada';
import { ModalEditarTcc } from '../../componentes/ModalEditarTcc';

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
const fmtNota = (v: any) => (v != null ? Number(v).toFixed(1).replace('.', ',') : '—');

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

const bancaDe = (t: any, fase: 'FASE_1' | 'FASE_2') => t.bancas?.find((b: any) => b.fase === fase);

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
  const [erro, setErro] = useState('');
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
  const concluido = fase === 'CONCLUIDO';

  async function formarBanca() {
    setErro('');
    if (!avaliador1 || !avaliador2) return setErro('Escolha o Avaliador 1 e o Avaliador 2.');
    if (avaliador1 === avaliador2) return setErro('Os dois avaliadores devem ser pessoas diferentes.');
    if (!arquivoBanca) return setErro('Envie o documento para avaliação da banca.');
    setEnviando(true);
    try {
      const form = new FormData();
      form.append('arquivo', arquivoBanca);
      form.append('avaliadorIds', JSON.stringify([avaliador1, avaliador2]));
      await apiUpload(`/tccs/${tcc.id}/banca`, form);
      setAvaliador1('');
      setAvaliador2('');
      setArquivoBanca(null);
      carregar();
    } catch (e) {
      setErro((e as ErroApi).mensagem || 'Não foi possível formar a banca.');
    } finally {
      setEnviando(false);
    }
  }

  async function validar() {
    setErro('');
    setEnviando(true);
    try {
      const r = await apiPost(`/tccs/${tcc.id}/banca/validar`, {});
      setResultado(r);
      carregar();
    } catch (e) {
      setErro((e as ErroApi).mensagem || 'Não foi possível validar.');
    } finally {
      setEnviando(false);
    }
  }

  // ----- Seção de notas/média de uma banca, reutilizada na validação. -----
  function blocoNotas(faseBanca: 'FASE_1' | 'FASE_2') {
    const banca = bancaDe(tcc, faseBanca);
    const membros = banca?.membros ?? [];
    const notas: number[] = membros.map((m: any) => m.nota).filter((n: any) => n != null);
    const media = notas.length ? notas.reduce((s, n) => s + n, 0) / notas.length : null;
    return { banca, membros, media };
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

      {/* Notas finais — só quando concluído */}
      {concluido && (
        <section className="cartao-secao bloco">
          <h2>Notas finais</h2>
          <div className="notas-grid">
            <div className="nota-box"><span className="nota-rotulo">Média — Fase I</span><span className="nota-num">{fmtNota(tcc.nf1)}</span></div>
            <div className="nota-box"><span className="nota-rotulo">Média — Fase II</span><span className="nota-num">{fmtNota(tcc.nf2)}</span></div>
            <div className="nota-box"><span className="nota-rotulo">Nota final</span><span className="nota-num">{fmtNota(tcc.nf)}</span></div>
            <div className={`nota-box ${tcc.resultado === 'APROVADO' ? 'nota-aprovado' : tcc.resultado === 'REPROVADO' ? 'nota-reprovado' : ''}`}>
              <span className="nota-rotulo">Resultado</span><span className="nota-num">{tcc.resultado ?? '—'}</span>
            </div>
          </div>
        </section>
      )}

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
        <section className="cartao-secao bloco secao-acao">
          <h2>{icoBanca} Formar banca da Fase I</h2>
          <p className="legenda">Escolha <strong>2 avaliadores</strong> para a banca da Fase I. (A banca da Fase II será o orientador + estes 2 avaliadores.)</p>
          {erro && <div className="erro-geral">{erro}</div>}
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
            <span>Documento para avaliação (PDF)</span>
            <input type="file" accept="application/pdf" onChange={(e) => setArquivoBanca(e.target.files?.[0] ?? null)} />
            <small className="legenda">A banca avaliará este documento (ex.: versão anônima da monografia). Obrigatório para formar a banca.</small>
          </label>
          <div className="acoes" style={{ justifyContent: 'flex-start' }}>
            <button className="botao" disabled={enviando || !avaliador1 || !avaliador2 || avaliador1 === avaliador2 || !arquivoBanca} onClick={formarBanca}>
              {enviando ? 'Formando…' : 'Formar banca'}
            </button>
          </div>
        </section>
      )}

      {(fase === 'VALIDACAO_FASE_1' || fase === 'VALIDACAO_FASE_2') && (() => {
        const ehF2 = fase === 'VALIDACAO_FASE_2';
        const { membros, media } = blocoNotas(ehF2 ? 'FASE_2' : 'FASE_1');
        const nfFinal = ehF2 && media != null ? 0.6 * (tcc.nf1 ?? 0) + 0.4 * media : null;
        return (
          <section className="cartao-secao bloco secao-acao">
            <h2>{icoBanca} {ehF2 ? 'Validar Fase II' : 'Validar Fase I'}</h2>
            {ehF2 && <p className="legenda">Banca da Fase II: orientador + os 2 avaliadores da Fase I.</p>}
            {erro && <div className="erro-geral">{erro}</div>}
            <dl className="dados">
              {membros.map((m: any) => (
                <div key={m.id}><dt>{nomeComTrat(m.avaliador)}</dt><dd>{fmtNota(m.nota)}</dd></div>
              ))}
              <div><dt>{ehF2 ? 'NF2 (média)' : 'NF1 (média)'}</dt><dd><strong>{media != null ? media.toFixed(2) : '—'}</strong></dd></div>
              {ehF2 && (
                <div><dt>Nota final (NF)</dt><dd><strong>{nfFinal != null ? nfFinal.toFixed(2) : '—'}</strong>{nfFinal != null ? (nfFinal >= 7 ? ' · aprovado' : ' · reprovado') : ''}</dd></div>
              )}
              {!ehF2 && media != null && (
                <div><dt>Corte</dt><dd>{media >= 6 ? 'aprovado (≥6)' : 'reprovado (<6)'}</dd></div>
              )}
            </dl>
            {resultado ? (
              <div className="alerta" style={resultado.aprovado
                ? { background: 'var(--aprovado-suave)', color: 'var(--aprovado)', marginTop: 14 }
                : { background: 'var(--reprovado-suave)', color: 'var(--reprovado)', marginTop: 14 }}>
                {resultado.fase === 'FASE_1'
                  ? (resultado.aprovado
                      ? `Aprovado na Fase I (NF1 ${Number(resultado.nf1).toFixed(2)}). Segue para a Fase II.`
                      : `Reprovado na Fase I (NF1 ${Number(resultado.nf1).toFixed(2)}).`)
                  : (resultado.aprovado
                      ? `Aprovado na Fase II — NF ${Number(resultado.nf).toFixed(2)}. Agora o aluno deve enviar a versão final (validada pelo orientador).`
                      : `Reprovado na Fase II. Nota final NF ${Number(resultado.nf).toFixed(2)}.`)}
              </div>
            ) : (
              <div className="acoes" style={{ justifyContent: 'flex-start' }}>
                <button className="botao" disabled={enviando} onClick={validar}>{enviando ? 'Validando…' : (ehF2 ? 'Validar Fase II' : 'Validar Fase I')}</button>
              </div>
            )}
          </section>
        );
      })()}

      {(fase === 'AGUARDANDO_AJUSTES_FINAIS' || fase === 'VALIDACAO_VERSAO_FINAL') && (
        <section className="cartao-secao bloco secao-acao">
          <h2>{icoBanca} Versão final</h2>
          <p className="legenda">A Fase II foi aprovada. O aluno envia a versão final e <strong>quem valida é o orientador</strong> — não há ação do coordenador nesta etapa.</p>
        </section>
      )}

      {/* Banca e notas — visão (a edição fica no modal "Editar TCC" → aba Banca) */}
      <section className="cartao-secao bloco">
        <h2>{icoBanca} Banca e notas</h2>
        {bancas.length > 0 && (
          <p className="legenda" style={{ marginTop: 0 }}>Para editar notas, comentários, status ou trocar avaliadores, use <strong>Editar informações</strong>.</p>
        )}
        {bancas.length === 0 ? (
          <p className="nota-vazio">Banca ainda não formada.</p>
        ) : (
          bancas.map((b: any) => {
            const ehF2 = b.fase === 'FASE_2';
            const criterios: Criterio[] = ehF2 ? CRITERIOS_FASE2 : CRITERIOS_FASE1;
            const membros = b.membros ?? [];
            return (
              <div key={b.id} className="banca-fase">
                <div className="banca-fase-cab">
                  <h3>{ehF2 ? 'Fase II' : 'Fase I'}</h3>
                </div>
                {ehF2 && <p className="legenda" style={{ marginTop: 0 }}>Banca derivada: <strong>orientador + os 2 avaliadores da Fase I</strong> (não é escolhida livremente).</p>}
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
                      </div>
                    );
                  })
                )}
              </div>
            );
          })
        )}
      </section>

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
        </div>
      </div>

      {editando && (
        <ModalEditarTcc tcc={tcc} pesos={pesos} aoFechar={() => setEditando(false)} aoSalvo={carregar} />
      )}
    </>
  );
}
