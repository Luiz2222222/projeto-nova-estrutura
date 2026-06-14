import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet } from '../../api';
import { useAuth } from '../../autenticacao/contexto';

// Pode avaliar agora: o TCC está na fase de avaliação da banca e ainda não há nota.
function pendente(m: any): boolean {
  const faseAval = m.banca?.fase === 'FASE_1' ? 'AVALIACAO_FASE_1' : 'AVALIACAO_FASE_2';
  return m.banca?.tcc?.faseAtual === faseAval && m.nota === null;
}

export function DashboardAvaliador() {
  const navegar = useNavigate();
  const { usuario } = useAuth();
  const [bancas, setBancas] = useState<any[]>([]);

  useEffect(() => {
    apiGet('/bancas/minhas').then(setBancas).catch(() => setBancas([]));
  }, []);

  const primeiroNome = usuario?.nomeCompleto.split(' ')[0] ?? '';
  const pendentes = bancas.filter(pendente).length;

  return (
    <>
      <h1>Olá, {primeiroNome} 👋</h1>
      <p className="legenda">Painel do avaliador.</p>

      <div className="cartoes-resumo bloco">
        <button className="cartao-resumo" onClick={() => navegar('/bancas')}>
          <span className="resumo-numero">{bancas.length}</span>
          <span className="resumo-rotulo">Participações em bancas</span>
        </button>
        <button className="cartao-resumo" onClick={() => navegar('/bancas')}>
          <span className="resumo-numero">{pendentes}</span>
          <span className="resumo-rotulo">Aguardando sua avaliação</span>
        </button>
      </div>

      <section className="cartao-secao bloco">
        <h2>Atalhos</h2>
        <div className="acoes" style={{ justifyContent: 'flex-start' }}>
          <button className="botao" onClick={() => navegar('/bancas')}>Participações em bancas</button>
          <button className="botao botao-secundario" onClick={() => navegar('/coorientacoes')}>Coorientações</button>
          <button className="botao botao-secundario" onClick={() => navegar('/avisos')}>Mural de avisos</button>
        </div>
      </section>
    </>
  );
}
