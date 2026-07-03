// Histórico do professor: TCCs de períodos anteriores (semestre != atual) em que ele teve
// vínculo — orientador, coorientador ou avaliador (banca). Somente leitura: os cards abrem a
// página interna de CONSULTA (/professor/historico/:id), sem ações de fluxo.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPost, type ErroApi } from '../../api';
import { ROTULO_FASE } from '../../utils/fases';
import { ModalConfirmacao } from '../../componentes/ModalConfirmacao';

const ic = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {d.split('|').map((p, i) => <path key={i} d={p} />)}
  </svg>
);
const icoHist = ic('M3 3v5h5|M3.05 13a9 9 0 1 0 2.13-5.36L3 8|M12 7v5l4 2');
const icoUser = ic('M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2|M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8');
const icoBusca = ic('M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z|M21 21l-4.35-4.35');
const icoOcultar = ic('M17.94 17.94A10 10 0 0 1 12 20c-7 0-11-8-11-8a18 18 0 0 1 5.06-5.94|M9.9 4.24A9 9 0 0 1 12 4c7 0 11 8 11 8a18 18 0 0 1-2.16 3.19|M14.12 14.12a3 3 0 1 1-4.24-4.24|M1 1l22 22');

const ROTULO_VINCULO: Record<string, string> = { ORIENTADOR: 'Orientador', COORIENTADOR: 'Coorientador', AVALIADOR: 'Avaliador' };

// Status final (aprovado/reprovado/descontinuado) para o pill do card; senão mostra a fase.
function statusFinal(fase: string): { rotulo: string; classe: string } | null {
  switch (fase) {
    case 'CONCLUIDO': return { rotulo: 'Concluído', classe: 'status-normal' };
    case 'REPROVADO_FASE_1': return { rotulo: 'Reprovado na Fase I', classe: 'status-urgente' };
    case 'REPROVADO_FASE_2': return { rotulo: 'Reprovado na Fase II', classe: 'status-urgente' };
    case 'DESCONTINUADO': return { rotulo: 'Descontinuado', classe: 'status-atencao' };
    default: return null;
  }
}

export function HistoricoProfessor() {
  const navigate = useNavigate();
  const [tccs, setTccs] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [vinculo, setVinculo] = useState<'TODOS' | 'ORIENTADOR' | 'COORIENTADOR' | 'AVALIADOR'>('TODOS');
  const [semestre, setSemestre] = useState('TODOS');
  const [busca, setBusca] = useState('');
  const [ocultarAlvo, setOcultarAlvo] = useState<any | null>(null); // TCC a ocultar (abre modal)
  const [ocultando, setOcultando] = useState(false);
  const [erroOcultar, setErroOcultar] = useState('');

  useEffect(() => {
    setCarregando(true);
    apiGet('/tccs/historico-professor').then((r: any) => setTccs(r ?? [])).catch(() => setTccs([])).finally(() => setCarregando(false));
  }, []);

  // Oculta o TCC APENAS do histórico deste professor (não apaga nada do sistema). Ao concluir,
  // remove o card da lista sem recarregar tudo.
  async function confirmarOcultar() {
    if (!ocultarAlvo) return;
    setErroOcultar('');
    setOcultando(true);
    try {
      await apiPost(`/tccs/${ocultarAlvo.id}/historico/ocultar`, {});
      setTccs((prev) => prev.filter((t) => t.id !== ocultarAlvo.id));
      setOcultarAlvo(null);
    } catch (e) {
      setErroOcultar((e as ErroApi).mensagem || 'Não foi possível ocultar.');
    } finally {
      setOcultando(false);
    }
  }

  const semestres = useMemo(() => [...new Set(tccs.map((t) => t.semestre))].sort().reverse(), [tccs]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return tccs.filter((t) => {
      if (vinculo !== 'TODOS' && !(t.vinculos ?? []).includes(vinculo)) return false;
      if (semestre !== 'TODOS' && t.semestre !== semestre) return false;
      if (q) {
        const alvo = `${t.titulo ?? ''} ${t.aluno?.nomeCompleto ?? ''}`.toLowerCase();
        if (!alvo.includes(q)) return false;
      }
      return true;
    });
  }, [tccs, vinculo, semestre, busca]);

  if (carregando) return <p className="nota-vazio">Carregando…</p>;

  return (
    <>
      <h1 className="h1-icone"><span className="h1-ico">{icoHist}</span>Histórico</h1>
      <p className="legenda">TCCs de períodos anteriores em que você participou (orientação, coorientação ou banca). Consulta somente leitura.</p>

      {tccs.length === 0 ? (
        <section className="cartao-secao bloco"><p className="nota-vazio">Você ainda não tem TCCs em períodos anteriores.</p></section>
      ) : (
        <>
          {/* Filtros */}
          <section className="cartao-secao bloco">
            <div className="rel-abas" style={{ marginBottom: 14 }}>
              {(['TODOS', 'ORIENTADOR', 'COORIENTADOR', 'AVALIADOR'] as const).map((v) => (
                <button key={v} className={`rel-aba${vinculo === v ? ' ativa' : ''}`} onClick={() => setVinculo(v)}>
                  {v === 'TODOS' ? 'Todos' : ROTULO_VINCULO[v]}
                </button>
              ))}
            </div>
            <div className="filtros">
              <label className="campo" style={{ flex: 2 }}>
                <span>Buscar</span>
                <span className="campo-busca">{icoBusca}<input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Aluno ou título…" /></span>
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
                const sf = statusFinal(t.faseAtual);
                return (
                  <section key={t.id} className="cartao-secao card-tcc" role="button" tabIndex={0}
                    onClick={() => navigate(`/professor/historico/${t.id}`)}
                    onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/professor/historico/${t.id}`); }}>
                    <div className="card-tcc-cabecalho">
                      <div className="card-tcc-info">
                        <h2>{t.titulo}</h2>
                        <p className="card-tcc-pessoas">
                          <span className="card-tcc-pessoa">{icoUser}<span><strong>Aluno:</strong> {t.aluno?.nomeCompleto ?? '—'}</span></span>
                        </p>
                      </div>
                      {sf ? <span className={`status-pill ${sf.classe}`}>{sf.rotulo}</span> : <span className="badge-papel">{ROTULO_FASE[t.faseAtual] ?? t.faseAtual}</span>}
                    </div>
                    <div className="card-tcc-tags" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        <span className="pilula pilula-neutra">{t.semestre}</span>
                        {(t.vinculos ?? []).map((v: string) => <span key={v} className="pilula">{ROTULO_VINCULO[v] ?? v}</span>)}
                      </span>
                      <button className="card-tcc-btn" title="Ocultar do meu histórico"
                        onClick={(e) => { e.stopPropagation(); setErroOcultar(''); setOcultarAlvo(t); }}>
                        {icoOcultar} Ocultar do meu histórico
                      </button>
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}

      {ocultarAlvo && (
        <ModalConfirmacao
          titulo="Ocultar do histórico"
          mensagem="Este TCC sairá apenas do seu histórico. Ele não será apagado do sistema."
          textoConfirmar="Ocultar"
          textoProcessando="Ocultando…"
          processando={ocultando}
          erro={erroOcultar}
          aoConfirmar={confirmarOcultar}
          aoCancelar={() => setOcultarAlvo(null)}
        />
      )}
    </>
  );
}
