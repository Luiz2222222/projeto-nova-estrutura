// Gestão de TCCs do coordenador — lista espelhando o layout do projeto antigo:
// header "Gestão de TCCs", distribuição por etapa, busca com ícone, filtros de
// fase e curso, e cards com título/aluno/orientador/badge/timeline. O card abre
// a página interna de detalhe (/coordenador/tccs/:id); o botão "Editar" abre o
// modal de edição administrativa direto na lista (como no projeto antigo).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, URL_API } from '../../api';
import { ROTULO_FASE, faseParaIndice, subfaseTcc, notasTrilhaTcc, chipsTrilha } from '../../utils/fases';
import { ROTULO_CURSO, CURSOS } from '@tcc/compartilhado';
import { TrilhaFases } from '../../componentes/TrilhaFases';
import { ModalEditarTcc } from '../../componentes/ModalEditarTcc';

const ic = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {d.split('|').map((p, i) => <path key={i} d={p} />)}
  </svg>
);
const icoBusca = ic('M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z|M21 21l-4.35-4.35');
const icoUser = ic('M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2|M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8');
const icoLapis = ic('M12 20h9|M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z');
const icoBaixar = ic('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4|M7 10l5 5 5-5|M12 15V3');

const nomeCurto = (p?: any) => p?.nomeCompleto ?? '—';

// Documento principal para download: versão final (mais recente) ou, na falta, a monografia.
function docPrincipal(t: any): any | null {
  const docs: any[] = t.documentos ?? [];
  const ultima = (tipo: string) => docs.filter((d) => d.tipo === tipo).sort((a, b) => b.versao - a.versao)[0] ?? null;
  return ultima('VERSAO_FINAL') ?? ultima('MONOGRAFIA') ?? null;
}

export function TccsCoordenador() {
  const navigate = useNavigate();
  const [tccs, setTccs] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(true);

  const [busca, setBusca] = useState('');
  const [filtroFase, setFiltroFase] = useState('TODAS');
  const [filtroCurso, setFiltroCurso] = useState('TODOS');
  const [tccEditando, setTccEditando] = useState<any | null>(null);

  // Recarrega a lista e, se o modal estiver aberto, sincroniza o TCC em edição com o
  // dado fresco (mantém o modal aberto após salvar, refletindo as alterações).
  const carregar = useCallback(async () => {
    try {
      const lista: any[] = (await apiGet('/tccs')) ?? [];
      setTccs(lista);
      setTccEditando((prev: any) => (prev ? lista.find((x) => x.id === prev.id) ?? prev : prev));
    } catch {
      setTccs([]);
    }
  }, []);

  useEffect(() => {
    setCarregando(true);
    carregar().finally(() => setCarregando(false));
  }, [carregar]);

  // Distribuição por etapa: uma "carta" por fase presente, com contagem e barra (como no antigo).
  const distribuicao = useMemo(() => {
    const counts: Record<string, number> = {};
    tccs.forEach((t) => { counts[t.faseAtual] = (counts[t.faseAtual] || 0) + 1; });
    return Object.keys(counts).map((f) => ({ fase: f, count: counts[f] }));
  }, [tccs]);
  const fasesPresentes = useMemo(() => distribuicao.map((d) => d.fase), [distribuicao]);

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return tccs.filter((t) => {
      if (filtroFase !== 'TODAS' && t.faseAtual !== filtroFase) return false;
      if (filtroCurso !== 'TODOS' && t.aluno?.curso !== filtroCurso) return false;
      if (!termo) return true;
      return [t.titulo, t.aluno?.nomeCompleto, t.orientador?.nomeCompleto, t.coorientador?.nomeCompleto].some(
        (x) => (x ?? '').toLowerCase().includes(termo),
      );
    });
  }, [tccs, busca, filtroFase, filtroCurso]);

  if (carregando) return <p className="nota-vazio">Carregando…</p>;

  return (
    <>
      <h1>Gestão de TCCs</h1>
      <p className="legenda">Acompanhe todos os trabalhos de conclusão de curso.</p>

      {tccs.length === 0 ? (
        <section className="cartao-secao bloco"><p className="nota-vazio">Ainda não há TCCs cadastrados no período.</p></section>
      ) : (
        <>
          {/* Distribuição por etapa */}
          <section className="cartao-secao bloco">
            <h2>Distribuição por etapa</h2>
            <div className="dist-grid">
              {distribuicao.map((d) => (
                <button key={d.fase} type="button" className={`dist-card${filtroFase === d.fase ? ' ativo' : ''}`} onClick={() => setFiltroFase(filtroFase === d.fase ? 'TODAS' : d.fase)}>
                  <span className="dist-num">{d.count}</span>
                  <span className="dist-nome">{ROTULO_FASE[d.fase] ?? d.fase}</span>
                  <span className="dist-barra"><span className="dist-barra-preenchida" style={{ width: `${(d.count / tccs.length) * 100}%` }} /></span>
                </button>
              ))}
            </div>
          </section>

          {/* Filtros e busca */}
          <section className="cartao-secao bloco">
            <div className="filtros">
              <label className="campo" style={{ flex: 2 }}>
                <span>Pesquisar</span>
                <span className="campo-busca">
                  {icoBusca}
                  <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por título, aluno ou orientador…" />
                </span>
              </label>
              <label className="campo">
                <span>Etapa</span>
                <select value={filtroFase} onChange={(e) => setFiltroFase(e.target.value)}>
                  <option value="TODAS">Todas as etapas ({tccs.length})</option>
                  {fasesPresentes.map((f) => {
                    const n = distribuicao.find((d) => d.fase === f)?.count ?? 0;
                    return <option key={f} value={f}>{(ROTULO_FASE[f] ?? f)} ({n})</option>;
                  })}
                </select>
              </label>
              <label className="campo">
                <span>Curso</span>
                <select value={filtroCurso} onChange={(e) => setFiltroCurso(e.target.value)}>
                  <option value="TODOS">Todos os cursos</option>
                  {CURSOS.map((c) => <option key={c} value={c}>{ROTULO_CURSO[c]}</option>)}
                </select>
              </label>
            </div>
          </section>

          <p className="legenda" style={{ marginTop: 10 }}>
            Exibindo <strong>{filtrados.length}</strong> de <strong>{tccs.length}</strong> TCCs.
          </p>

          {filtrados.length === 0 ? (
            <section className="cartao-secao bloco"><p className="nota-vazio">Nenhum TCC encontrado com os filtros aplicados.</p></section>
          ) : (
            <div className="lista bloco">
              {filtrados.map((t) => (
                <section key={t.id} className="cartao-secao card-tcc" onClick={() => navigate(`/coordenador/tccs/${t.id}`)} role="button" tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/coordenador/tccs/${t.id}`); }}>
                  <div className="card-tcc-cabecalho">
                    <div className="card-tcc-info">
                      <h2>{t.titulo}</h2>
                      <p className="card-tcc-pessoas">
                        <span className="card-tcc-pessoa">{icoUser}<span><strong>Aluno:</strong> {nomeCurto(t.aluno)}</span></span>
                        <span><strong>Orientador:</strong> {nomeCurto(t.orientador)}</span>
                        {(t.coorientador?.nomeCompleto || t.coorientadorNome) && (
                          <span className="card-tcc-co">(Co: {t.coorientador?.nomeCompleto || t.coorientadorNome})</span>
                        )}
                      </p>
                    </div>
                    <div className="card-tcc-lado">
                      <span className="badge-papel">{ROTULO_FASE[t.faseAtual] ?? t.faseAtual}</span>
                      <div className="card-tcc-acoes">
                        <button className="card-tcc-btn" title="Editar (edição administrativa)" onClick={(e) => { e.stopPropagation(); setTccEditando(t); }}>{icoLapis} Editar</button>
                        {(() => {
                          const doc = docPrincipal(t);
                          return doc ? (
                            <a className="card-tcc-btn" href={`${URL_API}/tccs/documentos/${doc.id}/baixar`} target="_blank" rel="noreferrer"
                              title={`Baixar ${doc.tipo === 'VERSAO_FINAL' ? 'versão final' : 'monografia'}`} onClick={(e) => e.stopPropagation()}>{icoBaixar} Download</a>
                          ) : (
                            <button className="card-tcc-btn" disabled title="Sem documento para baixar">{icoBaixar} Download</button>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                  <div className="tcc-trilha"><TrilhaFases atual={faseParaIndice(t.faseAtual)} sub={subfaseTcc(t)} chips={chipsTrilha(t)} notas={notasTrilhaTcc(t, true)} /></div>
                </section>
              ))}
            </div>
          )}
        </>
      )}

      {tccEditando && (
        <ModalEditarTcc tcc={tccEditando} aoFechar={() => setTccEditando(null)} aoSalvo={carregar} />
      )}
    </>
  );
}
