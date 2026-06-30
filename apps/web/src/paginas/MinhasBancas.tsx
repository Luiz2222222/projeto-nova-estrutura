// Participações em bancas (professor/avaliador): lista AGRUPADA POR TCC, com o
// documento da banca (ou monografia) e dois botões grandes — Fase I (Monografia)
// e Fase II (Apresentação) — que abrem a PÁGINA INTERNA de avaliação (sem modal).
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, URL_API } from '../api';
import { useAuth } from '../autenticacao/contexto';
import { ROTULO_FASE } from '../utils/fases';

const ic = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {d.split('|').map((p, i) => <path key={i} d={p} />)}
  </svg>
);
const icoOlho = ic('M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z|M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0');
const icoBaixar = ic('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4|M7 10l5 5 5-5|M12 15V3');
const icoDoc = ic('M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z|M14 2v6h6');
const icoApresentacao = ic('M2 3h20|M3 3v11a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V3|M12 16v5|M8 21h8');
const icoCheck = ic('M20 6 9 17l-5-5');

const ultimaMonografia = (docs: any[] = []) => docs.filter((d) => d.tipo === 'MONOGRAFIA').sort((a, b) => b.versao - a.versao)[0] ?? null;

type Grupo = { tcc: any; fase1?: any; fase2?: any };

// Colunas de nota por critério (Fase I usa as 5 primeiras; Fase II as 5 últimas).
const NOTA_COLS = ['notaResumo', 'notaIntroducao', 'notaRevisao', 'notaDesenvolvimento', 'notaConclusoes', 'notaCoerencia', 'notaQualidade', 'notaDominio', 'notaClareza', 'notaObservancia'];
const temRascunho = (m: any) => !!m && (NOTA_COLS.some((k) => m[k] != null) || !!m.parecer);

// Estado de uma fase para o card (cor do botão + texto de status + se abre a página).
// Usa o status do membro: PENDENTE (com rascunho → "Rascunho salvo") / ENVIADO / BLOQUEADO
// / CONCLUIDO. Fase ainda não chegada/sem membro fica sem texto e com o botão indisponível.
function estadoFase(membro: any, tcc: any, faseAval: string) {
  if (!membro) return { classe: 'indisponivel', status: '', clicavel: false, feito: false };
  const st = membro.status;
  if (st === 'CONCLUIDO') return { classe: 'feito', status: 'Concluída', clicavel: true, feito: true };
  if (st === 'BLOQUEADO') return { classe: 'feito', status: 'Bloqueada', clicavel: true, feito: true };
  if (st === 'ENVIADO') return { classe: 'feito', status: 'Avaliação enviada', clicavel: true, feito: true };
  // PENDENTE
  if (temRascunho(membro)) return { classe: 'disponivel', status: 'Rascunho salvo', clicavel: true, feito: false };
  if (tcc.faseAtual === faseAval) return { classe: 'disponivel', status: 'Avaliação pendente', clicavel: true, feito: false };
  return { classe: 'aguardando', status: '', clicavel: false, feito: false };
}

export function MinhasBancas() {
  const navigate = useNavigate();
  const { usuario } = useAuth();
  const [itens, setItens] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    apiGet('/bancas/minhas').then((r: any) => setItens(r ?? [])).catch(() => setItens([])).finally(() => setCarregando(false));
  }, []);

  const prefixo = usuario?.papel === 'AVALIADOR' ? '/avaliador/bancas' : usuario?.papel === 'PROFESSOR' ? '/professor/bancas' : '/bancas';

  // Agrupa os membros por TCC (Fase I e Fase II do mesmo TCC viram um só card).
  const grupos = useMemo(() => {
    const map = new Map<string, Grupo>();
    itens.forEach((m) => {
      const tcc = m.banca?.tcc;
      if (!tcc) return;
      // Não lista o TCC onde o próprio usuário é orientador/coorientador (banca da Fase II):
      // essa avaliação aparece na página interna do orientando, não aqui.
      if (tcc.orientadorId === usuario?.id || tcc.coorientadorId === usuario?.id) return;
      const g = map.get(tcc.id) ?? { tcc };
      if (m.banca.fase === 'FASE_1') g.fase1 = m;
      else g.fase2 = m;
      g.tcc = tcc;
      map.set(tcc.id, g);
    });
    return [...map.values()];
  }, [itens, usuario?.id]);

  if (carregando) return <p className="nota-vazio">Carregando…</p>;

  return (
    <>
      <h1>Participações em bancas</h1>
      <p className="legenda">TCCs para avaliação anônima — Fase I (Monografia) e Fase II (Apresentação).</p>

      {grupos.length === 0 ? (
        <section className="cartao-secao bloco">
          <p className="nota-vazio">Você não foi designado como avaliador em nenhuma banca no momento.</p>
        </section>
      ) : (
        <div className="lista bloco">
          {grupos.map((g) => {
            const tcc = g.tcc;
            const doc = g.fase1?.banca?.documentoAvaliacao ?? ultimaMonografia(tcc.documentos);
            const ehDocBanca = !!g.fase1?.banca?.documentoAvaliacao;
            const e1 = estadoFase(g.fase1, tcc, 'AVALIACAO_FASE_1');
            const e2 = estadoFase(g.fase2, tcc, 'AVALIACAO_FASE_2');
            const abrir = (membro: any) => membro && navigate(`${prefixo}/${membro.id}`);
            return (
              <section key={tcc.id} className="cartao-secao banca-card">
                <div className="banca-card-topo">
                  <div style={{ minWidth: 0 }}>
                    <h2>{tcc.titulo}</h2>
                    <p className="nota-vazio" style={{ margin: '4px 0 0' }}>
                      {tcc.aluno?.nomeCompleto ?? '—'} · {ROTULO_FASE[tcc.faseAtual] ?? tcc.faseAtual}
                    </p>
                  </div>
                  {doc && (
                    <a className="botao" href={`${URL_API}/tccs/documentos/${doc.id}/baixar`} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      {icoBaixar} Baixar {ehDocBanca ? 'documento' : 'monografia'}
                    </a>
                  )}
                </div>

                {doc && (
                  <div className="item-arquivo" style={{ marginTop: 12 }}>
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
                )}

                <div className="fase-botoes">
                  <div className="fase-coluna">
                    <button className={`fase-btn ${e1.classe}`} disabled={!e1.clicavel} onClick={() => abrir(g.fase1)}>
                      {icoDoc}<span>Fase I – Monografia</span>{e1.feito && icoCheck}
                    </button>
                    {e1.status && <span className={`fase-status ${e1.classe}`}>{e1.status}</span>}
                  </div>
                  <div className="fase-coluna">
                    <button className={`fase-btn ${e2.classe}`} disabled={!e2.clicavel} onClick={() => abrir(g.fase2)}>
                      {icoApresentacao}<span>Fase II – Apresentação</span>{e2.feito && icoCheck}
                    </button>
                    {e2.status && <span className={`fase-status ${e2.classe}`}>{e2.status}</span>}
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
