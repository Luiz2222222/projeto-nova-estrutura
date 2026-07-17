// Página interna de avaliação da banca (professor/avaliador), espelhando o antigo:
// header com voltar + fase, dados do TCC, documento e o formulário por critério.
// O formulário em si (notas/comentários/parecer/ações) fica no componente reaproveitável
// AvaliacaoBancaForm, usado também na página do orientando (Fase II do orientador).
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiGet, URL_API } from '../api';
import { useAuth } from '../autenticacao/contexto';
import { AvaliacaoBancaForm } from '../componentes/AvaliacaoBancaForm';
import { CardDefesa } from '../componentes/CardDefesa';
import { ROTULO_FASE } from '../utils/fases';
import { CRITERIOS_FASE1, CRITERIOS_FASE2, colunaNota } from '@tcc/compartilhado';

const ic = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {d.split('|').map((p, i) => <path key={i} d={p} />)}
  </svg>
);
const icoVoltar = ic('M19 12H5|M12 19l-7-7 7-7');
const icoOlho = ic('M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z|M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0');
const icoBaixar = ic('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4|M7 10l5 5 5-5|M12 15V3');
const icoDoc = ic('M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z|M14 2v6h6');

const ultimaMonografia = (docs: any[] = []) => docs.filter((d) => d.tipo === 'MONOGRAFIA').sort((a, b) => b.versao - a.versao)[0] ?? null;

export function AvaliarBanca() {
  const { membroId } = useParams<{ membroId: string }>();
  const navigate = useNavigate();
  const { usuario } = useAuth();

  const [itens, setItens] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(true);

  const prefixoLista = usuario?.papel === 'AVALIADOR' ? '/avaliador/bancas' : usuario?.papel === 'PROFESSOR' ? '/professor/bancas' : '/bancas';

  useEffect(() => {
    apiGet('/bancas/minhas').then((r: any) => setItens(r ?? [])).catch(() => setItens([])).finally(() => setCarregando(false));
  }, []);

  const m = useMemo(() => itens.find((x) => x.id === membroId), [itens, membroId]);

  async function recarregar() {
    const r = await apiGet('/bancas/minhas').catch(() => null);
    if (r) setItens(r as any[]);
  }

  if (carregando) return <p className="nota-vazio">Carregando…</p>;

  if (!m) {
    return (
      <div className="det-cabecalho">
        <button className="det-voltar" onClick={() => navigate(prefixoLista)}>{icoVoltar} Voltar para lista</button>
        <section className="cartao-secao bloco"><p className="nota-vazio">Avaliação não encontrada.</p></section>
      </div>
    );
  }

  const ehF2 = m.banca?.fase === 'FASE_2';
  const criterios = ehF2 ? CRITERIOS_FASE2 : CRITERIOS_FASE1;
  const status: string = m.status ?? 'PENDENTE';
  const tcc = m.banca.tcc;
  const doc = m.banca.documentoAvaliacao ?? ultimaMonografia(tcc.documentos);
  const ehDocBanca = !!m.banca.documentoAvaliacao;

  const temRascunhoSalvo = criterios.some((c) => m[colunaNota(c.chave)] != null) || !!m.parecer;
  const STATUS_INFO: Record<string, { rotulo: string; classe: string }> = {
    ENVIADO: { rotulo: 'Enviada', classe: 'status-normal' },
    EM_ANALISE: { rotulo: 'Em análise', classe: 'status-atencao' },
    AJUSTE_SOLICITADO: { rotulo: 'Ajuste solicitado', classe: 'status-urgente' },
    APROVADO: { rotulo: 'Aprovada', classe: 'status-normal' },
    BLOQUEADO: { rotulo: 'Bloqueada', classe: 'status-urgente' },
    CONCLUIDO: { rotulo: 'Concluída', classe: 'status-normal' },
  };
  const statusRotulo = status === 'PENDENTE' ? (temRascunhoSalvo ? 'Rascunho' : 'Pendente') : STATUS_INFO[status]?.rotulo ?? status;
  const statusClasse = status === 'PENDENTE' ? 'status-atencao' : STATUS_INFO[status]?.classe ?? 'status-atencao';

  return (
    <>
      {/* Cabeçalho */}
      <div className="det-cabecalho">
        <button className="det-voltar" onClick={() => navigate(prefixoLista)}>{icoVoltar} Voltar para lista</button>
        <div className="det-titulo-area">
          <h1>{tcc.titulo}</h1>
          <div className="det-badges">
            <span className="badge-papel">{ehF2 ? 'Fase II' : 'Fase I'}</span>
            <span className={`status-pill ${statusClasse}`}>{statusRotulo}</span>
          </div>
        </div>
      </div>

      {/* Dados do TCC + documento */}
      <section className="cartao-secao bloco">
        <h2>{ehF2 ? 'Avaliação da Apresentação' : 'Avaliação da Monografia'}</h2>
        <div className="info-lista" style={{ marginBottom: 14 }}>
          {/* Duplo-cego: na Fase I o backend não envia a identidade do aluno (avaliação às cegas). */}
          <div className="info-campo"><span className="info-rotulo">Aluno</span><span className="info-valor">{ehF2 ? (tcc.aluno?.nomeCompleto ?? '—') : 'Anônimo — avaliação às cegas'}</span></div>
          <div className="info-campo"><span className="info-rotulo">Fase atual</span><span className="info-valor">{ROTULO_FASE[tcc.faseAtual] ?? tcc.faseAtual}</span></div>
        </div>
        {ehF2 && tcc.defesaAgendadaPara && (
          <div style={{ marginBottom: 14 }}>
            <CardDefesa tcc={tcc} />
          </div>
        )}
        {doc ? (
          <div className="item-arquivo">
            <div className="item-arquivo-info">
              {icoDoc}
              <div>
                <span className="nome">{ehDocBanca ? 'Documento para avaliação' : 'Monografia'}</span>
                <span className="meta">{doc.nomeArquivo}</span>
              </div>
            </div>
            <span className="acoes-doc">
              <a className="botao-icone" title="Visualizar" href={`${URL_API}/tccs/documentos/${doc.id}/visualizar`} target="_blank" rel="noreferrer">{icoOlho}</a>
              <a className="botao-icone" title="Baixar" href={`${URL_API}/tccs/documentos/${doc.id}/baixar`} target="_blank" rel="noreferrer">{icoBaixar}</a>
            </span>
          </div>
        ) : (
          <p className="nota-vazio">Documento ainda não disponível.</p>
        )}
      </section>

      {/* Formulário por critérios (reaproveitável) */}
      <section className="cartao-secao bloco">
        <AvaliacaoBancaForm membro={m} aoAtualizar={recarregar} />
      </section>
    </>
  );
}
