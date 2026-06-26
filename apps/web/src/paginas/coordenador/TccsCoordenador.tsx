// Gestão de TCCs do coordenador — lista espelhando o layout do projeto antigo:
// header "Gestão de TCCs", distribuição por etapa, busca com ícone, filtros de
// fase e curso, e cards com título/aluno/orientador/badge/timeline. O card abre
// a página interna de detalhe (/coordenador/tccs/:id); o botão "Editar" abre o
// modal de edição administrativa direto na lista (como no projeto antigo).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiGet } from '../../api';
import { ROTULO_FASE, faseParaIndice, subfaseTcc, notasTrilhaTcc, chipsTrilha } from '../../utils/fases';
import { ROTULO_CURSO, CURSOS } from '@tcc/compartilhado';
import { TrilhaFases } from '../../componentes/TrilhaFases';
import { ModalEditarTcc } from '../../componentes/ModalEditarTcc';
import { ModalBaixarDados } from '../../componentes/ModalBaixarDados';

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

// Mesmas 5 etapas macro do Dashboard do coordenador (bucketEtapa) — usadas para
// aplicar o filtro inicial vindo dos cards/barras do dashboard via ?grupo=.
function bucketEtapa(f: string): number {
  switch (f) {
    case 'INICIALIZACAO': return 0;
    case 'DESENVOLVIMENTO': case 'DESCONTINUADO': return 1;
    case 'FORMACAO_BANCA_FASE_1': case 'AVALIACAO_FASE_1': case 'VALIDACAO_FASE_1': case 'REPROVADO_FASE_1': return 2;
    case 'AVALIACAO_FASE_2': case 'VALIDACAO_FASE_2': case 'REPROVADO_FASE_2': return 3;
    case 'AGUARDANDO_AJUSTES_FINAIS': case 'VALIDACAO_VERSAO_FINAL': case 'CONCLUIDO': return 4;
    default: return -1;
  }
}
const REPROVADOS = ['REPROVADO_FASE_1', 'REPROVADO_FASE_2', 'DESCONTINUADO'];
const ROTULO_GRUPO: Record<string, string> = {
  total: 'Todos os TCCs',
  andamento: 'Em andamento',
  aprovados: 'Aprovados',
  reprovados: 'Reprovados',
  inicial: 'Etapa inicial',
  desenvolvimento: 'Desenvolvimento',
  fase1: 'Fase I',
  fase2: 'Fase II',
  finalizacao: 'Finalização',
};
// Predicados dos grupos vindos do dashboard. Espelham bucketEtapa + stats do DashboardCoordenador.
const GRUPOS: Record<string, (t: any) => boolean> = {
  total: () => true,
  andamento: (t) => t.faseAtual !== 'CONCLUIDO' && !REPROVADOS.includes(t.faseAtual),
  aprovados: (t) => t.faseAtual === 'CONCLUIDO',
  reprovados: (t) => REPROVADOS.includes(t.faseAtual),
  inicial: (t) => bucketEtapa(t.faseAtual) === 0,
  desenvolvimento: (t) => bucketEtapa(t.faseAtual) === 1,
  fase1: (t) => bucketEtapa(t.faseAtual) === 2,
  fase2: (t) => bucketEtapa(t.faseAtual) === 3,
  finalizacao: (t) => bucketEtapa(t.faseAtual) === 4,
};

export function TccsCoordenador() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [tccs, setTccs] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(true);

  const [busca, setBusca] = useState('');
  const [filtroFase, setFiltroFase] = useState('TODAS');
  const [filtroCurso, setFiltroCurso] = useState('TODOS');
  // Filtro inicial vindo do dashboard (cards/barras) via ?grupo=. Some assim que o
  // usuário mexe no filtro manual de Etapa, sem atrapalhar a filtragem normal.
  const [grupo, setGrupo] = useState<string | null>(() => {
    const g = searchParams.get('grupo');
    return g && GRUPOS[g] ? g : null;
  });
  const [tccEditando, setTccEditando] = useState<any | null>(null);
  const [tccBaixando, setTccBaixando] = useState<any | null>(null);

  // Ao escolher uma etapa manualmente (select ou cartão de distribuição), o filtro
  // de grupo do dashboard deixa de valer.
  const mudarFase = (v: string) => { setGrupo(null); setFiltroFase(v); };

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
      if (grupo && !GRUPOS[grupo](t)) return false;
      if (filtroFase !== 'TODAS' && t.faseAtual !== filtroFase) return false;
      if (filtroCurso !== 'TODOS' && t.aluno?.curso !== filtroCurso) return false;
      if (!termo) return true;
      return [t.titulo, t.aluno?.nomeCompleto, t.orientador?.nomeCompleto, t.coorientador?.nomeCompleto].some(
        (x) => (x ?? '').toLowerCase().includes(termo),
      );
    });
  }, [tccs, busca, filtroFase, filtroCurso, grupo]);

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
                <button key={d.fase} type="button" className={`dist-card${!grupo && filtroFase === d.fase ? ' ativo' : ''}`} onClick={() => mudarFase(!grupo && filtroFase === d.fase ? 'TODAS' : d.fase)}>
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
                <select value={grupo ? 'TODAS' : filtroFase} onChange={(e) => mudarFase(e.target.value)}>
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

          <p className="legenda" style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>Exibindo <strong>{filtrados.length}</strong> de <strong>{tccs.length}</strong> TCCs.</span>
            {grupo && grupo !== 'total' && (
              <button type="button" className="chip-filtro" onClick={() => setGrupo(null)}>
                {ROTULO_GRUPO[grupo]} <span aria-hidden="true">×</span>
              </button>
            )}
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
                        <button className="card-tcc-btn" title="Baixar dados do TCC" onClick={(e) => { e.stopPropagation(); setTccBaixando(t); }}>{icoBaixar} Download</button>
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

      {tccBaixando && (
        <ModalBaixarDados
          titulo="Baixar dados"
          subtitulo={nomeCurto(tccBaixando.aluno)}
          caminhoBase={`/tccs/${tccBaixando.id}/exportar`}
          nomeArquivo={`${nomeCurto(tccBaixando.aluno)}.zip`}
          aoFechar={() => setTccBaixando(null)}
        />
      )}
    </>
  );
}
