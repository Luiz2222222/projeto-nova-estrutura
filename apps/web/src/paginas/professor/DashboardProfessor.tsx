import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPut, type ErroApi } from '../../api';
import { useAuth } from '../../autenticacao/contexto';
import type { UsuarioPublico } from '@tcc/compartilhado';

function precisaAcao(t: any): boolean {
  // Versão final aguardando o orientador validar (aprovar/pedir ajustes).
  if (t.faseAtual === 'VALIDACAO_VERSAO_FINAL') return true;
  if (t.faseAtual !== 'DESENVOLVIMENTO') return false;
  const mono = (t.documentos ?? []).filter((d: any) => d.tipo === 'MONOGRAFIA').sort((a: any, b: any) => b.versao - a.versao)[0];
  const monoPendente = mono && mono.status === 'PENDENTE';
  return monoPendente || !t.continuidadeConfirmada;
}

export function DashboardProfessor() {
  const navegar = useNavigate();
  const { usuario, atualizarUsuario } = useAuth();
  const [tccs, setTccs] = useState<any[]>([]);
  const [salvandoDisp, setSalvandoDisp] = useState(false);

  useEffect(() => {
    apiGet('/tccs/orientando').then(setTccs).catch(() => setTccs([]));
  }, []);

  const primeiroNome = usuario?.nomeCompleto.split(' ')[0] ?? '';
  const pendencias = tccs.filter(precisaAcao).length;
  const emDesenvolvimento = tccs.filter((t) => t.faseAtual === 'DESENVOLVIMENTO').length;
  const emAvaliacao = tccs.filter((t) =>
    ['FORMACAO_BANCA_FASE_1', 'AVALIACAO_FASE_1', 'VALIDACAO_FASE_1', 'AVALIACAO_FASE_2', 'VALIDACAO_FASE_2'].includes(t.faseAtual),
  ).length;
  const disponivel = usuario?.disponivelParaOrientar ?? false;

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
      <h1>Olá, {primeiroNome} 👋</h1>
      <p className="legenda">Painel de orientação.</p>

      <div className="cartoes-resumo bloco">
        <button className="cartao-resumo" onClick={() => navegar('/professor/orientandos')}>
          <span className="resumo-numero">{tccs.length}</span>
          <span className="resumo-rotulo">Total de orientandos</span>
        </button>
        <button className="cartao-resumo" onClick={() => navegar('/professor/orientandos')}>
          <span className="resumo-numero">{emDesenvolvimento}</span>
          <span className="resumo-rotulo">Em desenvolvimento</span>
        </button>
        <button className="cartao-resumo" onClick={() => navegar('/professor/orientandos')}>
          <span className="resumo-numero">{emAvaliacao}</span>
          <span className="resumo-rotulo">Em avaliação</span>
        </button>
        <button className="cartao-resumo" onClick={() => navegar('/professor/orientandos')}>
          <span className="resumo-numero">{pendencias}</span>
          <span className="resumo-rotulo">Aguardando sua ação</span>
        </button>
      </div>

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

      <section className="cartao-secao bloco">
        <h2>Atalhos</h2>
        <div className="acoes" style={{ justifyContent: 'flex-start' }}>
          <button className="botao" onClick={() => navegar('/professor/orientandos')}>Ver meus orientandos</button>
        </div>
      </section>
    </>
  );
}
