import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet } from '../../api';
import { useAuth } from '../../autenticacao/contexto';

// Dashboard do coordenador (espelha o antigo): estatísticas do período + fila de
// ações pendentes. Respeita as regras novas — não há "análise final do coordenador"
// (a versão final é validada pelo orientador), então essa ação não entra na fila.
export function DashboardCoordenador() {
  const navegar = useNavigate();
  const { usuario } = useAuth();
  const [tccs, setTccs] = useState<any[]>([]);
  const [pendentes, setPendentes] = useState<any[]>([]);

  useEffect(() => {
    apiGet('/tccs').then((r: any) => setTccs(r ?? [])).catch(() => setTccs([]));
    apiGet('/tccs/pendentes').then((r: any) => setPendentes(r ?? [])).catch(() => setPendentes([]));
  }, []);

  const stats = useMemo(() => {
    const total = tccs.length;
    const aprovados = tccs.filter((t) => t.faseAtual === 'CONCLUIDO').length;
    const reprovados = tccs.filter((t) => ['REPROVADO_FASE_1', 'REPROVADO_FASE_2', 'DESCONTINUADO'].includes(t.faseAtual)).length;
    const emAndamento = total - aprovados - reprovados;
    const pct = (n: number) => (total > 0 ? `${Math.round((n / total) * 100)}% do total` : '0% do total');
    return { total, aprovados, reprovados, emAndamento, pct };
  }, [tccs]);

  const conta = (fase: string) => tccs.filter((t) => t.faseAtual === fase).length;
  const acoes = [
    { rotulo: 'Análise de documentos iniciais', qtd: pendentes.length, ir: () => navegar('/coordenador/solicitacoes') },
    { rotulo: 'Formação da banca — Fase I', qtd: conta('FORMACAO_BANCA_FASE_1'), ir: () => navegar('/coordenador/tccs') },
    { rotulo: 'Análise das avaliações — Fase I', qtd: conta('VALIDACAO_FASE_1'), ir: () => navegar('/coordenador/tccs') },
    { rotulo: 'Análise das avaliações — Fase II', qtd: conta('VALIDACAO_FASE_2'), ir: () => navegar('/coordenador/tccs') },
  ].filter((a) => a.qtd > 0);

  const primeiroNome = usuario?.nomeCompleto.split(' ')[0] ?? '';

  return (
    <>
      <h1>Olá, {primeiroNome} 👋</h1>
      <p className="legenda">Painel de coordenação do TCC.</p>

      <div className="cartoes-resumo bloco">
        <button className="cartao-resumo" onClick={() => navegar('/coordenador/tccs')}>
          <span className="resumo-numero">{stats.total}</span>
          <span className="resumo-rotulo">Total de TCCs</span>
        </button>
        <button className="cartao-resumo" onClick={() => navegar('/coordenador/tccs')}>
          <span className="resumo-numero">{stats.emAndamento}</span>
          <span className="resumo-rotulo">Em andamento</span>
          <span className="resumo-extra">{stats.pct(stats.emAndamento)}</span>
        </button>
        <button className="cartao-resumo" onClick={() => navegar('/coordenador/tccs')}>
          <span className="resumo-numero" style={{ color: 'var(--aprovado)' }}>{stats.aprovados}</span>
          <span className="resumo-rotulo">Aprovados</span>
          <span className="resumo-extra">{stats.pct(stats.aprovados)}</span>
        </button>
        <button className="cartao-resumo" onClick={() => navegar('/coordenador/tccs')}>
          <span className="resumo-numero" style={{ color: 'var(--reprovado)' }}>{stats.reprovados}</span>
          <span className="resumo-rotulo">Reprovados</span>
          <span className="resumo-extra">{stats.pct(stats.reprovados)}</span>
        </button>
      </div>

      <section className="cartao-secao bloco">
        <h2>Ações pendentes</h2>
        {acoes.length === 0 ? (
          <p className="nota-vazio">Nenhuma ação pendente no momento. 🎉</p>
        ) : (
          <table className="tabela">
            <tbody>
              {acoes.map((a) => (
                <tr key={a.rotulo}>
                  <td>{a.rotulo}</td>
                  <td style={{ width: 70 }}><span className="pilula pilula-alerta">{a.qtd} pendente{a.qtd > 1 ? 's' : ''}</span></td>
                  <td style={{ width: 90, textAlign: 'right' }}>
                    <button className="botao botao-secundario" onClick={a.ir}>Ver</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
