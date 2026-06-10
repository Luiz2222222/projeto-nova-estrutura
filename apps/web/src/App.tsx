import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import type { Papel } from '@tcc/compartilhado';
import { ProvedorAuth, useAuth } from './autenticacao/contexto';
import { ProvedorTema } from './tema/contexto';
import { Login } from './paginas/Login';
import { LayoutApp } from './componentes/LayoutApp';
import { RedirecionarHome } from './paginas/RedirecionarHome';
import { PlaceholderPapel } from './paginas/PlaceholderPapel';
import { DashboardAluno } from './paginas/aluno/DashboardAluno';
import { PainelAluno } from './paginas/aluno/PainelAluno';
import { Documentos } from './paginas/aluno/Documentos';
import { Informacoes } from './paginas/aluno/Informacoes';
import { MuralAvisos } from './paginas/aluno/MuralAvisos';
import { AbrirTcc } from './paginas/aluno/AbrirTcc';
import { DashboardCoordenador } from './paginas/coordenador/DashboardCoordenador';
import { PainelCoordenador } from './paginas/coordenador/PainelCoordenador';
import { PlanejamentoCoordenador } from './paginas/coordenador/PlanejamentoCoordenador';
import { AvisosCoordenador } from './paginas/coordenador/AvisosCoordenador';
import { EmConstrucao } from './paginas/EmConstrucao';
import { DashboardProfessor } from './paginas/professor/DashboardProfessor';
import { MeusOrientandos } from './paginas/professor/MeusOrientandos';
import { Configuracoes } from './paginas/Configuracoes';

function Protegido({ children }: { children: JSX.Element }) {
  const { usuario, carregando } = useAuth();
  if (carregando) return <div className="centro">Carregando…</div>;
  if (!usuario) return <Navigate to="/login" replace />;
  return children;
}

// Guarda de papel: quem não tem o papel certo é mandado pra sua própria home.
function ExigePapel({ papeis }: { papeis: Papel[] }) {
  const { usuario } = useAuth();
  if (usuario && !papeis.includes(usuario.papel)) return <Navigate to="/" replace />;
  return <Outlet />;
}

export function App() {
  return (
    <ProvedorTema>
    <ProvedorAuth>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route
            element={
              <Protegido>
                <LayoutApp />
              </Protegido>
            }
          >
            {/* Rotas do aluno */}
            <Route element={<ExigePapel papeis={['ALUNO']} />}>
              <Route path="/aluno" element={<DashboardAluno />} />
              <Route path="/aluno/meu-tcc" element={<PainelAluno />} />
              <Route path="/aluno/documentos" element={<Documentos />} />
              <Route path="/aluno/informacoes" element={<Informacoes />} />
              <Route path="/aluno/avisos" element={<MuralAvisos />} />
              <Route path="/aluno/abrir" element={<AbrirTcc />} />
            </Route>

            {/* Rotas do coordenador (estrutura espelha o projeto original) */}
            <Route element={<ExigePapel papeis={['COORDENADOR']} />}>
              <Route path="/coordenador" element={<DashboardCoordenador />} />
              <Route
                path="/coordenador/tccs"
                element={<EmConstrucao titulo="TCCs" descricao="Todos os TCCs do período e a gestão de cada um." />}
              />
              <Route
                path="/coordenador/relatorios"
                element={<EmConstrucao titulo="Relatórios" descricao="Relatórios e exportações do período." />}
              />
              <Route path="/coordenador/solicitacoes" element={<PainelCoordenador />} />
              <Route
                path="/coordenador/usuarios"
                element={<EmConstrucao titulo="Usuários" descricao="Professores, alunos e membros externos." />}
              />
              <Route
                path="/coordenador/lista-do-periodo"
                element={<EmConstrucao titulo="Lista do período" descricao="Alunos do período e quem ainda não enviou solicitação." />}
              />
              <Route path="/coordenador/avisos" element={<AvisosCoordenador />} />
              <Route path="/coordenador/planejamento" element={<PlanejamentoCoordenador />} />
            </Route>

            {/* Rotas do professor (orientador) */}
            <Route element={<ExigePapel papeis={['PROFESSOR']} />}>
              <Route path="/professor" element={<DashboardProfessor />} />
              <Route path="/professor/orientandos" element={<MeusOrientandos />} />
            </Route>

            {/* Comuns a qualquer usuário logado */}
            <Route path="/inicio" element={<PlaceholderPapel />} />
            <Route path="/configuracoes" element={<Configuracoes />} />
          </Route>

          <Route path="/" element={<RedirecionarHome />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ProvedorAuth>
    </ProvedorTema>
  );
}
