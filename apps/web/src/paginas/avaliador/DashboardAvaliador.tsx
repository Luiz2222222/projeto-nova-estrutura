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
const icoAlerta = ic('M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z|M12 9v4|M12 17h.01');
const icoCalendario = ic('M16 2v4M8 2v4M3 10h18|M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2');
const icoBarras = ic('M3 3v18h18|M7 16v-5M12 16V8M17 16v-9');
const icoUsers = ic('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2|M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8|M22 21v-2a4 4 0 0 0-3-3.87|M16 3.13a4 4 0 0 1 0 7.75');
const icoPasta = ic('M20 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2|M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2');
const icoLivro = ic('M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z|M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z');

// Ícone + cor por marco (igual ao painel de datas do coordenador/professor).
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
    case 'FORMACAO_BANCA_FASE_1': case 'AVALIACAO_FASE_1': case 'AGUARDANDO_ANALISE_COORDENACAO_FASE_1': case 'VALIDACAO_FASE_1': case 'REPROVADO_FASE_1': return 2;
    case 'AGENDAMENTO_DEFESA_FASE_2': case 'AVALIACAO_FASE_2': case 'AGUARDANDO_ANALISE_COORDENACAO_FASE_2': case 'VALIDACAO_FASE_2': case 'REPROVADO_FASE_2': return 3;
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

// Pode avaliar agora: o TCC está na fase de avaliação da banca e ainda não há nota.
function bancaPendente(m: any): boolean {
  const faseAval = m.banca?.fase === 'FASE_1' ? 'AVALIACAO_FASE_1' : 'AVALIACAO_FASE_2';
  return m.banca?.tcc?.faseAtual === faseAval && m.nota === null;
}

export function DashboardAvaliador() {
  const navegar = useNavigate();
  const { usuario } = useAuth();
  const [bancas, setBancas] = useState<any[]>([]);
  const [coorientacoes, setCoorientacoes] = useState<any[]>([]);
  const [calendario, setCalendario] = useState<any | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [tooltip, setTooltip] = useState<{ vis: boolean; x: number; y: number; texto: string }>({ vis: false, x: 0, y: 0, texto: '' });

  const mostrarTooltip = (ev: { clientX: number; clientY: number }, texto: string) => setTooltip({ vis: true, x: ev.clientX, y: ev.clientY, texto });
  const esconderTooltip = () => setTooltip((t) => ({ ...t, vis: false }));

  useEffect(() => {
    Promise.all([
      apiGet('/bancas/minhas').then((r: any) => setBancas(r ?? [])).catch(() => setBancas([])),
      apiGet('/tccs/coorientando').then((r: any) => setCoorientacoes(r ?? [])).catch(() => setCoorientacoes([])),
      apiGet('/calendario').then(setCalendario).catch(() => setCalendario(null)),
    ]).finally(() => setCarregando(false));
  }, []);

  const primeiroNome = usuario?.nomeCompleto.split(' ')[0] ?? '';

  // Não conta como "participação em banca" o TCC onde o usuário é orientador/coorientador
  // (banca da Fase II) — essa avaliação fica na página interna do orientando.
  const bancasReais = useMemo(
    () => bancas.filter((m: any) => m.banca?.tcc?.orientadorId !== usuario?.id && m.banca?.tcc?.coorientadorId !== usuario?.id),
    [bancas, usuario?.id],
  );

  const stats = useMemo(() => {
    const total = bancasReais.length;
    const pendentes = bancasReais.filter(bancaPendente).length;
    const avaliadas = bancasReais.filter((m) => m.nota != null).length;
    return { total, pendentes, avaliadas, coorientacoes: coorientacoes.length };
  }, [bancasReais, coorientacoes]);

  // Fila de ações pendentes: bancas que aguardam minha avaliação (link direto p/ a avaliação).
  const acoes = useMemo(() => {
    const items: { id: string; cor: string; titulo: string; sub: string; link: string }[] = [];
    bancasReais.forEach((m: any) => {
      if (bancaPendente(m)) {
        const t = m.banca?.tcc;
        const ehF2 = m.banca?.fase === 'FASE_2';
        items.push({ id: 'banca' + m.id, cor: 'roxo', titulo: `Avaliar banca — Fase ${ehF2 ? 'II' : 'I'}`, sub: `${t?.aluno?.nomeCompleto ?? '—'} · ${t?.titulo ?? ''}`, link: `/avaliador/bancas/${m.id}` });
      }
    });
    return items;
  }, [bancasReais]);

  // "Coorientações por etapa" (espelha o "Co-orientandos por grupo" do antigo).
  const etapas = useMemo(() => {
    const counts = [0, 0, 0, 0, 0];
    const alunos: string[][] = [[], [], [], [], []];
    coorientacoes.forEach((t) => {
      const b = bucketEtapa(t.faseAtual);
      if (b >= 0) { counts[b]++; alunos[b].push(t.aluno?.nomeCompleto ?? '—'); }
    });
    const total = coorientacoes.length || 1;
    return ETAPAS.map((e, i) => ({ ...e, count: counts[i], pct: (counts[i] / total) * 100, alunos: alunos[i] }));
  }, [coorientacoes]);

  const cards = [
    { rotulo: 'Participações em bancas', sub: `${stats.total} ${stats.total === 1 ? 'banca' : 'bancas'}`, valor: stats.total, icone: icoLivro, cor: 'azul', link: '/bancas' },
    { rotulo: 'Aguardando avaliação', sub: `${stats.pendentes} pendente(s)`, valor: stats.pendentes, icone: icoRelogio, cor: 'amarelo', link: '/bancas' },
    { rotulo: 'Avaliações concluídas', sub: `${stats.avaliadas} enviada(s)`, valor: stats.avaliadas, icone: icoCheck, cor: 'verde', link: '/bancas' },
    { rotulo: 'Coorientações', sub: `${stats.coorientacoes} ${stats.coorientacoes === 1 ? 'TCC' : 'TCCs'}`, valor: stats.coorientacoes, icone: icoUsers, cor: 'roxo', link: '/coorientacoes' },
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
              <span>Nenhuma ação aguardando sua avaliação</span>
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
          <button key={c.rotulo} className="cartao-resumo" onClick={() => navegar(c.link)}>
            <span className="resumo-topo">
              <span className={`resumo-icone cor-${c.cor}`}>{c.icone}</span>
              <span className="resumo-rotulo-forte">{c.rotulo}</span>
            </span>
            <span className="resumo-numero">{c.valor}</span>
            <span className="resumo-extra">{c.sub}</span>
          </button>
        ))}
      </div>

      {/* Linha 3: Coorientações por etapa */}
      <section className="cartao-secao bloco">
        <h2 className="h2-icone"><span className="h2-ico">{icoBarras}</span>Coorientações por etapa</h2>
        {coorientacoes.length === 0 ? (
          <p className="nota-vazio">Você ainda não possui coorientações ativas.</p>
        ) : (
          <div className="etapas-lista">
            {etapas.map((e) => (
              <div key={e.nome} className="etapa-linha">
                <span className="etapa-nome">{e.nome}</span>
                <div className="etapa-barra">
                  {e.count > 0 && (
                    <button
                      className={`etapa-preenchida cor-${e.cor}`}
                      style={{ width: `${Math.max(e.pct, 6)}%` }}
                      onClick={() => navegar('/coorientacoes')}
                      onMouseEnter={(ev) => mostrarTooltip(ev, e.alunos.join('\n'))}
                      onMouseMove={(ev) => mostrarTooltip(ev, e.alunos.join('\n'))}
                      onMouseLeave={esconderTooltip}
                    >
                      {e.count}
                    </button>
                  )}
                </div>
                <span className="etapa-pct">{e.pct.toFixed(0)}%</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {tooltip.vis && tooltip.texto && (
        <div className="dash-tooltip" style={{ top: tooltip.y, left: tooltip.x + 14 }}>{tooltip.texto}</div>
      )}
    </>
  );
}
