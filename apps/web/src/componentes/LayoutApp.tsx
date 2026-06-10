import { NavLink, Outlet } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../autenticacao/contexto';
import { ROTULO_PAPEL, type Papel } from '@tcc/compartilhado';

interface ItemNav {
  to: string;
  rotulo: string;
  icone: ReactNode;
  /** match exato da rota (para a home do papel não ficar ativa nas sub-rotas) */
  fim?: boolean;
}

const ico = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const icoCasa = ico('M3 10l9-7 9 7v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z');
const icoDoc = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </svg>
);
const icoPasta = ico('M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z');
const icoInfo = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 16v-4M12 8h.01" />
  </svg>
);
const icoMegafone = ico('M3 11v2a1 1 0 0 0 1 1h2l4 4V6L6 10H4a1 1 0 0 0-1 1zM15 8a4 4 0 0 1 0 8');
const icoCalendario = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <path d="M16 2v4M8 2v4M3 10h18" />
  </svg>
);
const icoRelatorio = ico('M3 3v18h18M8 17v-5M13 17V8M18 17v-9');
const icoUsuarios = ico('M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M8.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87');
const icoListaPeriodo = ico('M11 6h10M11 12h10M11 18h10M3 6l1 1 2-2M3 12l1 1 2-2M3 18l1 1 2-2');
const icoBanca = ico('M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9');
const icoLista = ico('M8 6h12M8 12h12M8 18h12M3 6h.01M3 12h.01M3 18h.01');
const icoEngrenagem = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const itemConfig: ItemNav = { to: '/configuracoes', rotulo: 'Configurações', icone: icoEngrenagem };

const NAV: Record<Papel, ItemNav[]> = {
  ALUNO: [
    { to: '/aluno', rotulo: 'Dashboard', icone: icoCasa, fim: true },
    { to: '/aluno/meu-tcc', rotulo: 'Meu TCC', icone: icoDoc },
    { to: '/aluno/documentos', rotulo: 'Documentos', icone: icoPasta },
    { to: '/aluno/informacoes', rotulo: 'Informações', icone: icoInfo },
    { to: '/aluno/avisos', rotulo: 'Mural de avisos', icone: icoMegafone },
    itemConfig,
  ],
  COORDENADOR: [
    { to: '/coordenador', rotulo: 'Dashboard', icone: icoCasa, fim: true },
    { to: '/coordenador/tccs', rotulo: 'TCCs', icone: icoDoc },
    { to: '/coordenador/relatorios', rotulo: 'Relatórios', icone: icoRelatorio },
    { to: '/coordenador/solicitacoes', rotulo: 'Solicitações', icone: icoLista },
    { to: '/coordenador/usuarios', rotulo: 'Usuários', icone: icoUsuarios },
    { to: '/coordenador/lista-do-periodo', rotulo: 'Lista do período', icone: icoListaPeriodo },
    { to: '/coordenador/avisos', rotulo: 'Mural de avisos', icone: icoMegafone },
    { to: '/coordenador/planejamento', rotulo: 'Planejamento', icone: icoCalendario },
    itemConfig,
  ],
  PROFESSOR: [
    { to: '/professor', rotulo: 'Início', icone: icoCasa, fim: true },
    { to: '/professor/orientandos', rotulo: 'Meus orientandos', icone: icoDoc },
    { to: '/bancas', rotulo: 'Minhas bancas', icone: icoBanca },
    itemConfig,
  ],
  AVALIADOR: [{ to: '/bancas', rotulo: 'Minhas bancas', icone: icoBanca }, itemConfig],
};

export function LayoutApp() {
  const { usuario, sair } = useAuth();
  if (!usuario) return null;

  const itens = NAV[usuario.papel] ?? NAV.PROFESSOR;
  const iniciais = usuario.nomeCompleto
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');

  return (
    <div className="app-shell">
      <header className="barra-topo">
        <div className="barra-marca">
          <img className="topo-logo" src="/Logo.png" alt="DEE" />
          <span>Sistema de TCC</span>
        </div>
        <div className="usuario">
          <span className="badge-papel">{ROTULO_PAPEL[usuario.papel]}</span>
          <div className="avatar">{iniciais}</div>
          <div className="usuario-info">
            <span className="usuario-nome">{usuario.nomeCompleto}</span>
            <span className="usuario-papel">{usuario.email}</span>
          </div>
          <button className="botao botao-secundario" onClick={sair}>
            Sair
          </button>
        </div>
      </header>

      <div className="corpo">
        <aside className="lateral">
          <nav className="lateral-nav">
            {itens.map((i) => (
              <NavLink
                key={i.to}
                to={i.to}
                end={i.fim}
                className={({ isActive }) => `lateral-link${isActive ? ' ativo' : ''}`}
              >
                {i.icone}
                <span>{i.rotulo}</span>
              </NavLink>
            ))}
          </nav>
        </aside>

        <div className="area">
          <main className="conteudo">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
