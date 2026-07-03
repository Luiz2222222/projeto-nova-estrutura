// Página interna de CONSULTA (somente leitura) de um TCC do histórico do professor.
// Reaproveita os blocos de exibição já existentes (timeline, notas finais, banca e notas) e
// NÃO mostra nenhuma ação de fluxo (aprovar, avaliar, validar, excluir, etc.). Os dados vêm
// do endpoint /tccs/historico-professor (escopado pelo JWT), então só chega o que o professor
// tem vínculo real, com notas já sanitizadas pelo backend.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiGet, URL_API } from '../../api';
import { ROTULO_CURSO } from '@tcc/compartilhado';
import { ROTULO_FASE } from '../../utils/fases';
import { TimelineVerticalDetalhada } from '../../componentes/TimelineVerticalDetalhada';
import { CardNotasFinais } from '../../componentes/CardNotasFinais';
import { BancaNotasTcc } from '../../componentes/BancaNotasTcc';

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

const cursoDe = (c?: string) => (c ? (ROTULO_CURSO as Record<string, string>)[c] ?? c : '—');
const nomeComTrat = (p?: any) => (p ? `${p.tratamento ? p.tratamento + ' ' : ''}${p.nomeCompleto}` : '—');
const rotuloStatusDoc = (s: string) =>
  ({ PENDENTE: 'Aguardando avaliação', EM_ANALISE: 'Em análise', APROVADO: 'Aprovada', REJEITADO: 'Ajustes solicitados', SUBSTITUIDA: 'Substituída', CONCLUIDO: 'Concluída' } as Record<string, string>)[s] ?? s;

const ROTULO_TIPO_DOC: Record<string, string> = { PLANO_DESENVOLVIMENTO: 'Plano de desenvolvimento', TERMO_ACEITE: 'Termo de aceite', MONOGRAFIA: 'Monografia', VERSAO_FINAL: 'Versão final' };

function ItemDoc({ d }: { d: any }) {
  return (
    <div className="item-arquivo">
      <div className="item-arquivo-info">
        {icoDoc}
        <div>
          <span className="nome">{d.nomeArquivo}</span>
          <span className="meta">{ROTULO_TIPO_DOC[d.tipo] ?? d.tipo} · Versão {d.versao} · {rotuloStatusDoc(d.status)}</span>
        </div>
      </div>
      <span className="acoes-doc">
        <a className="botao-icone" title="Visualizar" href={`${URL_API}/tccs/documentos/${d.id}/visualizar`} target="_blank" rel="noreferrer">{icoOlho}</a>
        <a className="botao-icone" title="Baixar" href={`${URL_API}/tccs/documentos/${d.id}/baixar`} target="_blank" rel="noreferrer">{icoBaixar}</a>
      </span>
    </div>
  );
}

export function DetalheHistorico() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [tccs, setTccs] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    setCarregando(true);
    apiGet('/tccs/historico-professor').then((r: any) => setTccs(r ?? [])).catch(() => setTccs([])).finally(() => setCarregando(false));
  }, []);

  const tcc = useMemo(() => tccs.find((t) => t.id === id), [tccs, id]);

  if (carregando) return <p className="nota-vazio">Carregando…</p>;

  if (!tcc) {
    return (
      <div className="det-cabecalho">
        <button className="det-voltar" onClick={() => navigate('/professor/historico')}>{icoVoltar} Voltar para o histórico</button>
        <section className="cartao-secao bloco"><p className="nota-vazio">TCC não encontrado no seu histórico.</p></section>
      </div>
    );
  }

  const fase = tcc.faseAtual as string;
  const coorient = tcc.coorientador
    ? `${nomeComTrat(tcc.coorientador)}${tcc.coorientador.afiliacao ? ' · ' + tcc.coorientador.afiliacao : ''}`
    : tcc.coorientadorNome
      ? `${tcc.coorientadorTitulacao ? tcc.coorientadorTitulacao + ' ' : ''}${tcc.coorientadorNome}${tcc.coorientadorAfiliacao ? ' · ' + tcc.coorientadorAfiliacao : ''}`
      : null;
  const descricao = tcc.resumo || tcc.descricao || null;
  const docs = [...(tcc.documentos ?? [])].sort((a: any, b: any) => (a.tipo < b.tipo ? -1 : a.tipo > b.tipo ? 1 : b.versao - a.versao));

  return (
    <>
      {/* Cabeçalho */}
      <div className="det-cabecalho">
        <button className="det-voltar" onClick={() => navigate('/professor/historico')}>{icoVoltar} Voltar para o histórico</button>
        <div className="det-titulo-area">
          <h1>{tcc.titulo}</h1>
          <div className="det-badges">
            <span className="badge-papel">{ROTULO_FASE[fase] ?? fase}</span>
            <span className="status-pill status-normal">Período {tcc.semestre}</span>
            {(tcc.vinculos ?? []).map((v: string) => (
              <span key={v} className="pilula">{({ ORIENTADOR: 'Orientador', COORIENTADOR: 'Coorientador', AVALIADOR: 'Avaliador' } as Record<string, string>)[v] ?? v}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Notas Finais (topo) — só aparece quando há notas liberadas (regra de visibilidade). */}
      <CardNotasFinais tcc={tcc} />

      {/* Informações: aluno + orientação */}
      <div className="grade-detalhe bloco">
        <section className="cartao-secao">
          <h2>{icoUser} Informações do aluno</h2>
          <div className="info-lista">
            <div className="info-campo"><span className="info-rotulo">Aluno</span><span className="info-valor">{tcc.aluno?.nomeCompleto ?? '—'}</span></div>
            <div className="info-campo"><span className="info-rotulo">E-mail</span><span className="info-valor">{tcc.aluno?.email ?? '—'}</span></div>
            <div className="info-campo"><span className="info-rotulo">Curso</span><span className="info-valor">{cursoDe(tcc.aluno?.curso)}</span></div>
            <div className="info-campo"><span className="info-rotulo">Período</span><span className="info-valor">{tcc.semestre}</span></div>
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

      {/* Fluxo (timeline) + documentos + banca e notas */}
      <div className="grade-detalhe-inferior bloco">
        <section className="cartao-secao">
          <h2>Fluxo do TCC</h2>
          <TimelineVerticalDetalhada tcc={tcc} />
        </section>
        <div className="det-coluna">
          <section className="cartao-secao">
            <h2>{icoDoc} Documentos</h2>
            {docs.length === 0 ? <p className="nota-vazio">Nenhum documento.</p> : docs.map((d: any) => <ItemDoc key={d.id} d={d} />)}
          </section>
          <section className="cartao-secao">
            <h2>{icoBanca} Banca e notas</h2>
            <BancaNotasTcc tcc={tcc} />
          </section>
        </div>
      </div>
    </>
  );
}
