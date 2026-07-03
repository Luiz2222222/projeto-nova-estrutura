// Histórico administrativo do coordenador: TCCs de períodos anteriores (semestre != atual).
// Consulta somente leitura; cada card abre o detalhe administrativo (/coordenador/historico/:id).
// A ação "Ocultar do meu histórico" (preferência do coordenador) é adicionada à parte.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet } from '../../api';
import { ROTULO_FASE } from '../../utils/fases';

const ic = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {d.split('|').map((p, i) => <path key={i} d={p} />)}
  </svg>
);
const icoHist = ic('M3 3v5h5|M3.05 13a9 9 0 1 0 2.13-5.36L3 8|M12 7v5l4 2');
const icoUser = ic('M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2|M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8');
const icoBusca = ic('M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z|M21 21l-4.35-4.35');

const nomeCurto = (p?: any) => (p ? `${p.tratamento ? p.tratamento + ' ' : ''}${p.nomeCompleto}` : '—');

type Grupo = 'TODOS' | 'CONCLUIDO' | 'REPROVADO' | 'DESCONTINUADO' | 'ANDAMENTO';
const GRUPOS: { v: Grupo; r: string }[] = [
  { v: 'TODOS', r: 'Todos' },
  { v: 'CONCLUIDO', r: 'Concluídos' },
  { v: 'REPROVADO', r: 'Reprovados' },
  { v: 'DESCONTINUADO', r: 'Descontinuados' },
  { v: 'ANDAMENTO', r: 'Em andamento' },
];
function grupoDaFase(fase: string): Grupo {
  if (fase === 'CONCLUIDO') return 'CONCLUIDO';
  if (fase?.startsWith('REPROVADO')) return 'REPROVADO';
  if (fase === 'DESCONTINUADO') return 'DESCONTINUADO';
  return 'ANDAMENTO';
}
function statusPill(fase: string): { rotulo: string; classe: string } {
  switch (grupoDaFase(fase)) {
    case 'CONCLUIDO': return { rotulo: 'Concluído', classe: 'status-normal' };
    case 'REPROVADO': return { rotulo: fase === 'REPROVADO_FASE_1' ? 'Reprovado na Fase I' : 'Reprovado na Fase II', classe: 'status-urgente' };
    case 'DESCONTINUADO': return { rotulo: 'Descontinuado', classe: 'status-atencao' };
    default: return { rotulo: ROTULO_FASE[fase] ?? fase, classe: 'status-atencao' };
  }
}

export function HistoricoCoordenador() {
  const navigate = useNavigate();
  const [tccs, setTccs] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState('');
  const [semestre, setSemestre] = useState('TODOS');
  const [grupo, setGrupo] = useState<Grupo>('TODOS');

  useEffect(() => {
    setCarregando(true);
    apiGet('/tccs/historico-coordenador').then((r: any) => setTccs(r ?? [])).catch(() => setTccs([])).finally(() => setCarregando(false));
  }, []);

  const semestres = useMemo(() => [...new Set(tccs.map((t) => t.semestre))].sort().reverse(), [tccs]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return tccs.filter((t) => {
      if (grupo !== 'TODOS' && grupoDaFase(t.faseAtual) !== grupo) return false;
      if (semestre !== 'TODOS' && t.semestre !== semestre) return false;
      if (q) {
        const alvo = `${t.titulo ?? ''} ${t.aluno?.nomeCompleto ?? ''} ${t.orientador?.nomeCompleto ?? ''}`.toLowerCase();
        if (!alvo.includes(q)) return false;
      }
      return true;
    });
  }, [tccs, busca, semestre, grupo]);

  if (carregando) return <p className="nota-vazio">Carregando…</p>;

  return (
    <>
      <h1 className="h1-icone"><span className="h1-ico">{icoHist}</span>Histórico</h1>
      <p className="legenda">TCCs de períodos anteriores. Consulta administrativa.</p>

      {tccs.length === 0 ? (
        <section className="cartao-secao bloco"><p className="nota-vazio">Nenhum TCC de períodos anteriores.</p></section>
      ) : (
        <>
          <section className="cartao-secao bloco">
            <div className="rel-abas" style={{ marginBottom: 14 }}>
              {GRUPOS.map((g) => (
                <button key={g.v} className={`rel-aba${grupo === g.v ? ' ativa' : ''}`} onClick={() => setGrupo(g.v)}>{g.r}</button>
              ))}
            </div>
            <div className="filtros">
              <label className="campo" style={{ flex: 2 }}>
                <span>Buscar</span>
                <span className="campo-busca">{icoBusca}<input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Aluno, título ou orientador…" /></span>
              </label>
              <label className="campo">
                <span>Período</span>
                <select value={semestre} onChange={(e) => setSemestre(e.target.value)}>
                  <option value="TODOS">Todos os períodos</option>
                  {semestres.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
            </div>
          </section>

          {filtrados.length === 0 ? (
            <section className="cartao-secao bloco"><p className="nota-vazio">Nenhum TCC encontrado com esses filtros.</p></section>
          ) : (
            <div className="lista bloco">
              {filtrados.map((t) => {
                const sp = statusPill(t.faseAtual);
                return (
                  <section key={t.id} className="cartao-secao card-tcc" role="button" tabIndex={0}
                    onClick={() => navigate(`/coordenador/historico/${t.id}`)}
                    onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/coordenador/historico/${t.id}`); }}>
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
                      <span className={`status-pill ${sp.classe}`}>{sp.rotulo}</span>
                    </div>
                    <div className="card-tcc-tags">
                      <span className="pilula pilula-neutra">{t.semestre}</span>
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}
    </>
  );
}
