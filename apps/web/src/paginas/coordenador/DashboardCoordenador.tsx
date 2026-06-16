import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet } from '../../api';
import { useAuth } from '../../autenticacao/contexto';
import { MARCOS_CALENDARIO, ROTULO_MARCO, DESC_MARCO } from '@tcc/compartilhado';

const ic = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="22" height="22" strokeLinecap="round" strokeLinejoin="round">
    {d.split('|').map((p, i) => <path key={i} d={p} />)}
  </svg>
);
const icoDoc = ic('M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z|M14 2v6h6');
const icoRelogio = ic('M12 7v5l3 2|M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0');
const icoCheck = ic('M22 11.08V12a10 10 0 1 1-5.93-9.14|M22 4 12 14.01l-3-3');
const icoX = ic('M18 6 6 18|M6 6l12 12');
const icoAlerta = ic('M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z|M12 9v4|M12 17h.01');
const icoCalendario = ic('M16 2v4M8 2v4M3 10h18|M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2');
const icoBarras = ic('M3 3v18h18|M7 16v-5M12 16V8M17 16v-9');
const icoUsers = ic('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2|M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8|M22 21v-2a4 4 0 0 0-3-3.87|M16 3.13a4 4 0 0 1 0 7.75');
const icoPasta = ic('M20 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2|M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2');
const icoLivro = ic('M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z|M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z');

// Ícone + cor por marco (igual ao painel de datas do projeto antigo / aba Informações).
const MARCO_INFO: Record<string, { icone: ReactNode; cor: string }> = {
  reuniaoAlunos: { icone: icoUsers, cor: '#3b82f6' },
  envioDocumentos: { icone: icoDoc, cor: '#3b82f6' },
  avaliacaoContinuidade: { icone: icoRelogio, cor: '#eab308' },
  submissaoMonografia: { icone: icoDoc, cor: '#eab308' },
  preparacaoBancasFase1: { icone: icoPasta, cor: '#a855f7' },
  avaliacaoFase1: { icone: icoLivro, cor: '#a855f7' },
  preparacaoBancasFase2: { icone: icoPasta, cor: '#ef4444' },
  apresentacaoFase2: { icone: icoUsers, cor: '#3b82f6' },
  ajustesFinais: { icone: icoCheck, cor: '#22c55e' },
};

const fmtData = (iso?: string | null) => {
  if (!iso) return 'A definir';
  const [a, m, d] = iso.split('T')[0].split('-');
  return a && m && d ? `${d}/${m}/${a}` : 'A definir';
};

// 5 etapas macro (como no antigo). Reprovados contam na fase; descontinuado no desenvolvimento.
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
const ETAPAS = [
  { nome: 'Inicial', cor: 'azul' },
  { nome: 'Desenvolvimento', cor: 'amarelo' },
  { nome: 'Fase I', cor: 'roxo' },
  { nome: 'Fase II', cor: 'rosa' },
  { nome: 'Finalização', cor: 'verde' },
];

export function DashboardCoordenador() {
  const navegar = useNavigate();
  const { usuario } = useAuth();
  const [tccs, setTccs] = useState<any[]>([]);
  const [pendentes, setPendentes] = useState<any[]>([]);
  const [calendario, setCalendario] = useState<any | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    Promise.all([
      apiGet('/tccs').then((r: any) => setTccs(r ?? [])).catch(() => setTccs([])),
      apiGet('/tccs/pendentes').then((r: any) => setPendentes(r ?? [])).catch(() => setPendentes([])),
      apiGet('/calendario').then(setCalendario).catch(() => setCalendario(null)),
    ]).finally(() => setCarregando(false));
  }, []);

  const stats = useMemo(() => {
    const total = tccs.length;
    const aprovados = tccs.filter((t) => t.faseAtual === 'CONCLUIDO').length;
    const reprovados = tccs.filter((t) => ['REPROVADO_FASE_1', 'REPROVADO_FASE_2', 'DESCONTINUADO'].includes(t.faseAtual)).length;
    const emAndamento = total - aprovados - reprovados;
    const pct = (n: number) => (total > 0 ? `${Math.round((n / total) * 100)}% do total` : '0% do total');
    return { total, aprovados, reprovados, emAndamento, pct };
  }, [tccs]);

  // Fila de ações pendentes, item a item (com aluno/título), como no antigo.
  const acoes = useMemo(() => {
    const nome = (t: any) => t.aluno?.nomeCompleto ?? '—';
    const items: { id: string; cor: string; titulo: string; sub: string; link: string }[] = [];
    pendentes.forEach((t) => items.push({ id: 's' + t.id, cor: 'amarelo', titulo: 'Análise de documentos iniciais', sub: `${nome(t)} · ${t.titulo}`, link: '/coordenador/solicitacoes' }));
    tccs.filter((t) => t.faseAtual === 'FORMACAO_BANCA_FASE_1').forEach((t) => items.push({ id: 'b' + t.id, cor: 'roxo', titulo: 'Formar banca — Fase I', sub: `${nome(t)} · ${t.titulo}`, link: '/coordenador/tccs' }));
    tccs.filter((t) => t.faseAtual === 'VALIDACAO_FASE_1').forEach((t) => items.push({ id: 'v1' + t.id, cor: 'azul', titulo: 'Validar avaliações — Fase I', sub: `${nome(t)} · ${t.titulo}`, link: '/coordenador/tccs' }));
    tccs.filter((t) => t.faseAtual === 'VALIDACAO_FASE_2').forEach((t) => items.push({ id: 'v2' + t.id, cor: 'verde', titulo: 'Validar avaliações — Fase II', sub: `${nome(t)} · ${t.titulo}`, link: '/coordenador/tccs' }));
    return items;
  }, [tccs, pendentes]);

  const etapas = useMemo(() => {
    const counts = [0, 0, 0, 0, 0];
    const alunos: string[][] = [[], [], [], [], []];
    tccs.forEach((t) => {
      const b = bucketEtapa(t.faseAtual);
      if (b >= 0) { counts[b]++; alunos[b].push(t.aluno?.nomeCompleto ?? '—'); }
    });
    const total = tccs.length || 1;
    return ETAPAS.map((e, i) => ({ ...e, count: counts[i], pct: (counts[i] / total) * 100, alunos: alunos[i] }));
  }, [tccs]);

  const primeiroNome = usuario?.nomeCompleto.split(' ')[0] ?? '';

  const cards = [
    { rotulo: 'Total de TCCs', sub: 'TCCs cadastrados', valor: stats.total, icone: icoDoc, cor: 'azul', corNum: undefined as string | undefined },
    { rotulo: 'Em andamento', sub: stats.pct(stats.emAndamento), valor: stats.emAndamento, icone: icoRelogio, cor: 'amarelo', corNum: undefined },
    { rotulo: 'Aprovados', sub: stats.pct(stats.aprovados), valor: stats.aprovados, icone: icoCheck, cor: 'verde', corNum: 'var(--aprovado)' },
    { rotulo: 'Reprovados', sub: stats.pct(stats.reprovados), valor: stats.reprovados, icone: icoX, cor: 'vermelho', corNum: 'var(--reprovado)' },
  ];

  return (
    <>
      <h1>Seja bem-vindo(a), {primeiroNome}!</h1>

      {/* Linha 1: Ações pendentes + Datas do período */}
      <div className="grade-dash bloco">
        <section className="cartao-secao" style={{ display: 'flex', flexDirection: 'column' }}>
          <h2 className="h2-icone"><span className="h2-ico">{icoAlerta}</span>Ações pendentes</h2>
          {carregando ? (
            <p className="nota-vazio">Carregando…</p>
          ) : acoes.length === 0 ? (
            <div className="dash-vazio">
              {icoAlerta}
              <strong>Sem ações pendentes</strong>
              <span>Nenhuma ação aguardando sua aprovação</span>
            </div>
          ) : (
            <div className="acoes-fila">
              {acoes.map((a) => (
                <button key={a.id} className={`acao-item cor-${a.cor}`} onClick={() => navegar(a.link)}>
                  <span className="acao-texto">
                    <span className="acao-titulo">{a.titulo}</span>
                    <span className="acao-sub">{a.sub}</span>
                  </span>
                  <span className="acao-ir">Ir →</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="cartao-secao">
          <h2 className="h2-icone">
            <span className="h2-ico">{icoCalendario}</span>
            Datas do período{calendario?.semestre ? ` — ${calendario.semestre}` : ''}
          </h2>
          <div className="datas-compact">
            {MARCOS_CALENDARIO.map((m) => (
              <div key={m} className="data-linha">
                <span className="data-icone" style={{ background: `${MARCO_INFO[m].cor}1f`, color: MARCO_INFO[m].cor }}>{MARCO_INFO[m].icone}</span>
                <span className="data-texto">
                  <span className="data-titulo">{ROTULO_MARCO[m]}</span>
                  <span className="data-desc">{DESC_MARCO[m]}</span>
                </span>
                <span className={`data-quando${calendario?.[m] ? ' definida' : ''}`}>{fmtData(calendario?.[m])}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Linha 2: estatísticas */}
      <div className="cartoes-resumo bloco">
        {cards.map((c) => (
          <button key={c.rotulo} className="cartao-resumo" onClick={() => navegar('/coordenador/tccs')}>
            <span className={`resumo-icone cor-${c.cor}`}>{c.icone}</span>
            <span className="resumo-numero" style={c.corNum ? { color: c.corNum } : undefined}>{c.valor}</span>
            <span className="resumo-rotulo">{c.rotulo}</span>
            <span className="resumo-extra">{c.sub}</span>
          </button>
        ))}
      </div>

      {/* Linha 3: TCCs por etapa */}
      <section className="cartao-secao bloco">
        <h2 className="h2-icone"><span className="h2-ico">{icoBarras}</span>TCCs por etapa</h2>
        <div className="etapas-lista">
          {etapas.map((e) => (
            <div key={e.nome} className="etapa-linha">
              <span className="etapa-nome">{e.nome}</span>
              <div className="etapa-barra" title={e.count > 0 ? `${e.nome} (${e.count}):\n${e.alunos.join('\n')}` : `${e.nome}: nenhum TCC`}>
                {e.count > 0 && (
                  <button
                    className={`etapa-preenchida cor-${e.cor}`}
                    style={{ width: `${Math.max(e.pct, 6)}%` }}
                    onClick={() => navegar('/coordenador/tccs')}
                    title={`${e.nome} (${e.count}):\n${e.alunos.join('\n')}`}
                  >
                    {e.count}
                  </button>
                )}
              </div>
              <span className="etapa-pct">{e.pct.toFixed(0)}%</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
