import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet } from '../../api';
import { useAuth } from '../../autenticacao/contexto';

export function DashboardCoordenador() {
  const navegar = useNavigate();
  const { usuario } = useAuth();
  const [solicitacoes, setSolicitacoes] = useState<number | null>(null);

  useEffect(() => {
    apiGet('/tccs/pendentes').then((p: any[]) => setSolicitacoes(p.length)).catch(() => setSolicitacoes(0));
  }, []);

  const primeiroNome = usuario?.nomeCompleto.split(' ')[0] ?? '';

  return (
    <>
      <h1>Olá, {primeiroNome} 👋</h1>
      <p className="legenda">Painel de coordenação do TCC.</p>

      <div className="cartoes-resumo bloco">
        <button className="cartao-resumo" onClick={() => navegar('/coordenador/solicitacoes')}>
          <span className="resumo-numero">{solicitacoes ?? '—'}</span>
          <span className="resumo-rotulo">Solicitações pendentes</span>
        </button>
      </div>
    </>
  );
}
