// Lista de orientandos do professor — espelha o projeto antigo:
// header com ícone, banner de monografias aguardando avaliação, e cards
// CLICÁVEIS (sem ações abertas na listagem). As ações de cada fase ficam na
// página interna /professor/orientandos/:id.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet } from '../../api';
import { ROTULO_FASE, faseParaIndice, subfaseTcc, notasTrilhaTcc } from '../../utils/fases';
import { TrilhaFases } from '../../componentes/TrilhaFases';

const ic = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {d.split('|').map((p, i) => <path key={i} d={p} />)}
  </svg>
);
const icoUsers = ic('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2|M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8|M22 21v-2a4 4 0 0 0-3-3.87|M16 3.13a4 4 0 0 1 0 7.75');
const icoUser = ic('M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2|M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8');
const icoDoc = ic('M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z|M14 2v6h6');
const icoSeta = ic('M5 12h14|M12 5l7 7-7 7');
const icoRelogio = ic('M12 7v5l3 2|M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0');

type Doc = { tipo: string; status: string; versao: number };
function monoPendente(t: any): boolean {
  if (t.faseAtual !== 'DESENVOLVIMENTO') return false;
  const mono = (t.documentos ?? []).filter((d: Doc) => d.tipo === 'MONOGRAFIA').sort((a: Doc, b: Doc) => b.versao - a.versao)[0];
  return !!mono && mono.status === 'PENDENTE';
}

// Status final do TCC (aprovado/reprovado/descontinuado), como no antigo.
function statusFinal(fase: string): { rotulo: string; classe: string } | null {
  switch (fase) {
    case 'CONCLUIDO': return { rotulo: 'Aprovado', classe: 'status-normal' };
    case 'REPROVADO_FASE_1': return { rotulo: 'Reprovado na Fase I', classe: 'status-urgente' };
    case 'REPROVADO_FASE_2': return { rotulo: 'Reprovado na Fase II', classe: 'status-urgente' };
    case 'DESCONTINUADO': return { rotulo: 'Descontinuado', classe: 'status-atencao' };
    default: return null;
  }
}

const fmtData = (iso?: string | null) => {
  if (!iso) return '—';
  const [a, m, d] = iso.split('T')[0].split('-');
  return a && m && d ? `${d}/${m}/${a}` : '—';
};

export function MeusOrientandos() {
  const navigate = useNavigate();
  const [tccs, setTccs] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    setCarregando(true);
    apiGet('/tccs/orientando').then(setTccs).catch(() => setTccs([])).finally(() => setCarregando(false));
  }, []);

  const pendentes = useMemo(() => tccs.filter(monoPendente), [tccs]);
  // INICIALIZACAO = convite encaminhado, aguardando o coordenador aprovar (separado dos ativos).
  const convites = useMemo(() => tccs.filter((t) => t.faseAtual === 'INICIALIZACAO'), [tccs]);
  const ativos = useMemo(() => tccs.filter((t) => t.faseAtual !== 'INICIALIZACAO'), [tccs]);

  if (carregando) return <p className="nota-vazio">Carregando…</p>;

  return (
    <>
      <h1 className="h1-icone"><span className="h1-ico">{icoUsers}</span>Meus orientandos</h1>

      {/* Banner: monografias aguardando avaliação */}
      {pendentes.length > 0 && (
        <div className="banner-aviso bloco">
          <span className="banner-ico">{icoDoc}</span>
          <div className="banner-texto">
            <strong>Monografias aguardando avaliação</strong>
            <span>{pendentes.length} {pendentes.length === 1 ? 'orientando precisa' : 'orientandos precisam'} de avaliação</span>
          </div>
          <button className="botao" onClick={() => navigate(`/professor/orientandos/${pendentes[0].id}`)}>Avaliar primeiro {icoSeta}</button>
        </div>
      )}

      {/* Convites encaminhados ao coordenador (TCCs em inicialização, aguardando aprovação) */}
      {convites.length > 0 && (
        <section className="cartao-secao bloco">
          <h2 className="h2-icone"><span className="h2-ico">{icoRelogio}</span>Convites encaminhados ao coordenador</h2>
          <div className="convites-lista">
            {convites.map((t) => (
              <div key={t.id} className="convite-item">
                <div className="card-tcc-info">
                  <h3>{t.titulo}</h3>
                  <p className="card-tcc-pessoas">
                    <span className="card-tcc-pessoa">{icoUser}<span><strong>Aluno:</strong> {t.aluno?.nomeCompleto ?? '—'}</span></span>
                  </p>
                </div>
                <span className="status-pill status-atencao">Aguardando coordenador</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {tccs.length === 0 ? (
        <section className="cartao-secao bloco"><p className="nota-vazio">Você ainda não tem orientandos.</p></section>
      ) : ativos.length === 0 ? (
        <section className="cartao-secao bloco"><p className="nota-vazio">Nenhum orientando ativo no momento.</p></section>
      ) : (
        <div className="lista bloco">
          {ativos.map((t) => {
            const sf = statusFinal(t.faseAtual);
            const co = t.coorientador?.nomeCompleto || t.coorientadorNome;
            return (
              <section key={t.id} className="cartao-secao card-tcc" onClick={() => navigate(`/professor/orientandos/${t.id}`)} role="button" tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/professor/orientandos/${t.id}`); }}>
                <div className="card-tcc-cabecalho">
                  <div className="card-tcc-info">
                    <h2>{t.titulo}</h2>
                    <p className="card-tcc-pessoas">
                      <span className="card-tcc-pessoa">{icoUser}<span><strong>Aluno:</strong> {t.aluno?.nomeCompleto ?? '—'}</span></span>
                      {co && <span className="card-tcc-pessoa">{icoUser}<span><strong>Coorientador:</strong> {co}</span></span>}
                    </p>
                  </div>
                  {sf ? <span className={`status-pill ${sf.classe}`}>{sf.rotulo}</span> : <span className="badge-papel">{ROTULO_FASE[t.faseAtual] ?? t.faseAtual}</span>}
                </div>
                <div className="tcc-trilha"><TrilhaFases atual={faseParaIndice(t.faseAtual)} sub={subfaseTcc(t)} notas={notasTrilhaTcc(t, false)} /></div>
                <p className="card-tcc-datas">Criado em {fmtData(t.criadoEm)}{t.atualizadoEm ? ` · Atualizado em ${fmtData(t.atualizadoEm)}` : ''}</p>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
