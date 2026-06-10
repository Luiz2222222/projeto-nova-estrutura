import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet } from '../../api';
import { useAuth } from '../../autenticacao/contexto';

function precisaAcao(t: any): boolean {
  if (t.faseAtual !== 'DESENVOLVIMENTO') return false;
  const mono = (t.documentos ?? []).filter((d: any) => d.tipo === 'MONOGRAFIA').sort((a: any, b: any) => b.versao - a.versao)[0];
  const monoPendente = mono && mono.status === 'PENDENTE';
  return monoPendente || !t.continuidadeConfirmada;
}

export function DashboardProfessor() {
  const navegar = useNavigate();
  const { usuario } = useAuth();
  const [tccs, setTccs] = useState<any[]>([]);

  useEffect(() => {
    apiGet('/tccs/orientando').then(setTccs).catch(() => setTccs([]));
  }, []);

  const primeiroNome = usuario?.nomeCompleto.split(' ')[0] ?? '';
  const pendencias = tccs.filter(precisaAcao).length;

  return (
    <>
      <h1>Olá, {primeiroNome} 👋</h1>
      <p className="legenda">Painel de orientação.</p>

      <div className="cartoes-resumo bloco">
        <button className="cartao-resumo" onClick={() => navegar('/professor/orientandos')}>
          <span className="resumo-numero">{tccs.length}</span>
          <span className="resumo-rotulo">Orientandos</span>
        </button>
        <button className="cartao-resumo" onClick={() => navegar('/professor/orientandos')}>
          <span className="resumo-numero">{pendencias}</span>
          <span className="resumo-rotulo">Aguardando sua ação</span>
        </button>
      </div>

      <section className="cartao-secao bloco">
        <h2>Atalhos</h2>
        <div className="acoes" style={{ justifyContent: 'flex-start' }}>
          <button className="botao" onClick={() => navegar('/professor/orientandos')}>Ver meus orientandos</button>
        </div>
      </section>
    </>
  );
}
