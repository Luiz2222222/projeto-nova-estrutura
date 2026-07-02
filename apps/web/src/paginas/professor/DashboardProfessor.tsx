import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPut, type ErroApi } from '../../api';
import { useAuth } from '../../autenticacao/contexto';
import { MARCOS_CALENDARIO, ROTULO_MARCO, DESC_MARCO, type UsuarioPublico } from '@tcc/compartilhado';

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

// Ícone + cor por marco (igual ao painel de datas do coordenador / projeto antigo).
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

const FASES_AVALIACAO = ['FORMACAO_BANCA_FASE_1', 'AVALIACAO_FASE_1', 'AGUARDANDO_ANALISE_COORDENACAO_FASE_1', 'VALIDACAO_FASE_1', 'AVALIACAO_FASE_2', 'AGUARDANDO_ANALISE_COORDENACAO_FASE_2', 'VALIDACAO_FASE_2'];
const FASES_FINAL = ['AGUARDANDO_AJUSTES_FINAIS', 'VALIDACAO_VERSAO_FINAL', 'CONCLUIDO'];

// Pendência de banca: só conta quando o TCC está na fase de avaliação correspondente
// e ainda não lancei minha nota (mesma regra de MinhasBancas / DashboardAvaliador).
function bancaPendente(m: any): boolean {
  const faseAval = m.banca?.fase === 'FASE_1' ? 'AVALIACAO_FASE_1' : 'AVALIACAO_FASE_2';
  return m.banca?.tcc?.faseAtual === faseAval && m.nota === null;
}

// Ajuste pedido pela coordenação: só este avaliador pode reenviar, com o TCC em validação.
function ajustePendente(m: any): boolean {
  const faseValid = m.banca?.fase === 'FASE_1' ? 'VALIDACAO_FASE_1' : 'VALIDACAO_FASE_2';
  return m.banca?.tcc?.faseAtual === faseValid && m.status === 'AJUSTE_SOLICITADO';
}

export function DashboardProfessor() {
  const navegar = useNavigate();
  const { usuario, atualizarUsuario } = useAuth();
  const [tccs, setTccs] = useState<any[]>([]);
  const [bancas, setBancas] = useState<any[]>([]);
  const [calendario, setCalendario] = useState<any | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [salvandoDisp, setSalvandoDisp] = useState(false);
  const [tooltip, setTooltip] = useState<{ vis: boolean; x: number; y: number; texto: string }>({ vis: false, x: 0, y: 0, texto: '' });

  const mostrarTooltip = (ev: { clientX: number; clientY: number }, texto: string) => setTooltip({ vis: true, x: ev.clientX, y: ev.clientY, texto });
  const esconderTooltip = () => setTooltip((t) => ({ ...t, vis: false }));

  useEffect(() => {
    Promise.all([
      apiGet('/tccs/orientando').then((r: any) => setTccs(r ?? [])).catch(() => setTccs([])),
      apiGet('/bancas/minhas').then((r: any) => setBancas(r ?? [])).catch(() => setBancas([])),
      apiGet('/calendario').then(setCalendario).catch(() => setCalendario(null)),
    ]).finally(() => setCarregando(false));
  }, []);

  const primeiroNome = usuario?.nomeCompleto.split(' ')[0] ?? '';
  const disponivel = usuario?.disponivelParaOrientar ?? false;

  const stats = useMemo(() => {
    const total = tccs.length;
    const emDesenvolvimento = tccs.filter((t) => t.faseAtual === 'DESENVOLVIMENTO').length;
    const emAvaliacao = tccs.filter((t) => FASES_AVALIACAO.includes(t.faseAtual)).length;
    const emFinalizacao = tccs.filter((t) => FASES_FINAL.includes(t.faseAtual)).length;
    return { total, emDesenvolvimento, emAvaliacao, emFinalizacao };
  }, [tccs]);

  // Fila de ações pendentes, item a item (com aluno/título), como no antigo/coordenador.
  const acoes = useMemo(() => {
    const nome = (t: any) => t?.aluno?.nomeCompleto ?? '—';
    const items: { id: string; cor: string; titulo: string; sub: string; link: string }[] = [];
    tccs.forEach((t) => {
      const alvo = `/professor/orientandos/${t.id}#acao`; // página interna do orientando + âncora
      if (t.faseAtual === 'DESENVOLVIMENTO') {
        const mono = (t.documentos ?? []).filter((d: any) => d.tipo === 'MONOGRAFIA').sort((a: any, b: any) => b.versao - a.versao)[0];
        if (mono && mono.status === 'PENDENTE') {
          items.push({ id: 'mono' + t.id, cor: 'amarelo', titulo: 'Avaliar monografia', sub: `${nome(t)} · ${t.titulo}`, link: alvo });
        }
        if (!t.continuidadeConfirmada) {
          items.push({ id: 'cont' + t.id, cor: 'azul', titulo: 'Confirmar continuidade', sub: `${nome(t)} · ${t.titulo}`, link: alvo });
        }
      }
      if (t.faseAtual === 'AGENDAMENTO_DEFESA_FASE_2') {
        items.push({ id: 'def' + t.id, cor: 'roxo', titulo: 'Preparar bancas (Fase II)', sub: `${nome(t)} · ${t.titulo}`, link: `/professor/orientandos/${t.id}#acao-fase2` });
      }
      // Ajuste solicitado ao ORIENTADOR na banca da Fase II: a avaliação dele fica na página
      // do orientando, então a pendência aparece aqui (e não em "Participações em bancas").
      if (t.faseAtual === 'VALIDACAO_FASE_2') {
        const bancaF2 = (t.bancas ?? []).find((b: any) => b.fase === 'FASE_2');
        const meuMembro = bancaF2?.membros?.find((m: any) => m.avaliadorId === usuario?.id);
        if (meuMembro?.status === 'AJUSTE_SOLICITADO') {
          items.push({ id: 'ajuste-orient' + t.id, cor: 'amarelo', titulo: 'Ajustar avaliação — Fase II', sub: `${nome(t)} · ${t.titulo}`, link: `/professor/orientandos/${t.id}#acao-fase2` });
        }
      }
      if (t.faseAtual === 'VALIDACAO_VERSAO_FINAL') {
        items.push({ id: 'vf' + t.id, cor: 'verde', titulo: 'Validar versão final', sub: `${nome(t)} · ${t.titulo}`, link: alvo });
      }
    });
    // Bancas em que sou AVALIADOR (não do meu próprio orientando) — só pendência quando o
    // TCC está na fase de avaliação correspondente e eu ainda não lancei a nota.
    bancas.forEach((m: any) => {
      const t = m.banca?.tcc;
      if (t?.orientadorId === usuario?.id || t?.coorientadorId === usuario?.id) return; // próprio orientando: fica na página do orientando
      const ehF2 = m.banca?.fase === 'FASE_2';
      if (bancaPendente(m)) {
        items.push({ id: 'banca' + m.id, cor: 'roxo', titulo: `Avaliar banca — Fase ${ehF2 ? 'II' : 'I'}`, sub: `${nome(t)} · ${t?.titulo ?? ''}`, link: `/professor/bancas/${m.id}` });
      } else if (ajustePendente(m)) {
        items.push({ id: 'ajuste' + m.id, cor: 'amarelo', titulo: `Ajustar avaliação — Fase ${ehF2 ? 'II' : 'I'}`, sub: `${nome(t)} · ${t?.titulo ?? ''}`, link: `/professor/bancas/${m.id}` });
      }
    });
    return items;
  }, [tccs, bancas, usuario?.id]);

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

  const cards = [
    { rotulo: 'Total de orientandos', sub: `${stats.total} ${stats.total === 1 ? 'TCC ativo' : 'TCCs ativos'}`, valor: stats.total, icone: icoUsers, cor: 'azul' },
    { rotulo: 'Em desenvolvimento', sub: `${stats.emDesenvolvimento} na fase de desenvolvimento`, valor: stats.emDesenvolvimento, icone: icoDoc, cor: 'amarelo' },
    { rotulo: 'Em avaliação', sub: `${stats.emAvaliacao} em Fase I ou II`, valor: stats.emAvaliacao, icone: icoLivro, cor: 'roxo' },
    { rotulo: 'Em finalização', sub: `${stats.emFinalizacao} concluído(s) ou em ajustes`, valor: stats.emFinalizacao, icone: icoCheck, cor: 'verde' },
  ];

  async function alternarDisponibilidade() {
    setSalvandoDisp(true);
    try {
      const u = await apiPut<UsuarioPublico>('/autenticacao/disponibilidade', { disponivel: !disponivel });
      atualizarUsuario(u);
    } catch (e) {
      window.alert((e as ErroApi).mensagem || 'Não foi possível alterar.');
    } finally {
      setSalvandoDisp(false);
    }
  }

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
              <span>Nenhuma ação aguardando no momento</span>
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
          <button key={c.rotulo} className="cartao-resumo" onClick={() => navegar('/professor/orientandos')}>
            <span className="resumo-topo">
              <span className={`resumo-icone cor-${c.cor}`}>{c.icone}</span>
              <span className="resumo-rotulo-forte">{c.rotulo}</span>
            </span>
            <span className="resumo-numero">{c.valor}</span>
            <span className="resumo-extra">{c.sub}</span>
          </button>
        ))}
      </div>

      {/* Linha 3: Orientandos por etapa */}
      <section className="cartao-secao bloco">
        <h2 className="h2-icone"><span className="h2-ico">{icoBarras}</span>Orientandos por etapa</h2>
        <div className="etapas-lista">
          {etapas.map((e) => (
            <div key={e.nome} className="etapa-linha">
              <span className="etapa-nome">{e.nome}</span>
              <div className="etapa-barra">
                {e.count > 0 && (
                  <button
                    className={`etapa-preenchida cor-${e.cor}`}
                    style={{ width: `${Math.max(e.pct, 6)}%` }}
                    onClick={() => navegar('/professor/orientandos')}
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
      </section>

      {/* Linha 4: Disponibilidade para orientar (específico do projeto novo) */}
      <section className="cartao-secao bloco">
        <h2>Disponibilidade para orientar</h2>
        <div className="aviso-cabecalho">
          <p className="nota-vazio" style={{ margin: 0 }}>
            {disponivel
              ? 'Você está disponível — aparece na lista de orientadores que o aluno escolhe.'
              : 'Você está indisponível — não aparece para novos alunos abrirem TCC com você.'}
          </p>
          <span className={`selo ${disponivel ? 'selo-ok' : ''}`} style={disponivel ? {} : { background: 'var(--inset)', color: 'var(--tinta-3)' }}>
            {disponivel ? 'Disponível' : 'Indisponível'}
          </span>
        </div>
        <div className="acoes" style={{ justifyContent: 'flex-start' }}>
          <button className="botao botao-secundario" disabled={salvandoDisp} onClick={alternarDisponibilidade}>
            {salvandoDisp ? 'Salvando…' : disponivel ? 'Ficar indisponível' : 'Ficar disponível'}
          </button>
        </div>
      </section>

      {tooltip.vis && tooltip.texto && (
        <div className="dash-tooltip" style={{ top: tooltip.y, left: tooltip.x + 14 }}>{tooltip.texto}</div>
      )}
    </>
  );
}
