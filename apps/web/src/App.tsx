import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import type { Papel } from '@tcc/compartilhado';
import { ProvedorAuth, useAuth } from './autenticacao/contexto';
import { ProvedorTema } from './tema/contexto';
import { LimiteErro } from './componentes/LimiteErro';
import { LayoutApp } from './componentes/LayoutApp';
// Telas de entrada ficam no bundle principal (primeira pintura sem espera extra).
import { Login } from './paginas/Login';
import { RecuperarSenha } from './paginas/RecuperarSenha';
import { RedefinirSenha } from './paginas/RedefinirSenha';
import { RedirecionarHome } from './paginas/RedirecionarHome';
import { PlaceholderPapel } from './paginas/PlaceholderPapel';

// Code splitting POR PÁGINA: cada rota vira um chunk próprio, carregado quando o
// usuário navega até ela (as páginas exportam componentes nomeados, daí o .then).
const DashboardAluno = lazy(() => import('./paginas/aluno/DashboardAluno').then((m) => ({ default: m.DashboardAluno })));
const PainelAluno = lazy(() => import('./paginas/aluno/PainelAluno').then((m) => ({ default: m.PainelAluno })));
const Documentos = lazy(() => import('./paginas/aluno/Documentos').then((m) => ({ default: m.Documentos })));
const Informacoes = lazy(() => import('./paginas/aluno/Informacoes').then((m) => ({ default: m.Informacoes })));
const MuralAvisos = lazy(() => import('./paginas/aluno/MuralAvisos').then((m) => ({ default: m.MuralAvisos })));
const AbrirTcc = lazy(() => import('./paginas/aluno/AbrirTcc').then((m) => ({ default: m.AbrirTcc })));
const DashboardCoordenador = lazy(() => import('./paginas/coordenador/DashboardCoordenador').then((m) => ({ default: m.DashboardCoordenador })));
const PainelCoordenador = lazy(() => import('./paginas/coordenador/PainelCoordenador').then((m) => ({ default: m.PainelCoordenador })));
const PlanejamentoCoordenador = lazy(() => import('./paginas/coordenador/PlanejamentoCoordenador').then((m) => ({ default: m.PlanejamentoCoordenador })));
const TccsCoordenador = lazy(() => import('./paginas/coordenador/TccsCoordenador').then((m) => ({ default: m.TccsCoordenador })));
const TccDetalheCoordenador = lazy(() => import('./paginas/coordenador/TccDetalheCoordenador').then((m) => ({ default: m.TccDetalheCoordenador })));
const HistoricoCoordenador = lazy(() => import('./paginas/coordenador/HistoricoCoordenador').then((m) => ({ default: m.HistoricoCoordenador })));
const DetalheHistoricoCoordenador = lazy(() => import('./paginas/coordenador/DetalheHistoricoCoordenador').then((m) => ({ default: m.DetalheHistoricoCoordenador })));
const AvisosCoordenador = lazy(() => import('./paginas/coordenador/AvisosCoordenador').then((m) => ({ default: m.AvisosCoordenador })));
const Relatorios = lazy(() => import('./paginas/coordenador/Relatorios').then((m) => ({ default: m.Relatorios })));
const Usuarios = lazy(() => import('./paginas/coordenador/Usuarios').then((m) => ({ default: m.Usuarios })));
const ListaDoPeriodo = lazy(() => import('./paginas/coordenador/ListaDoPeriodo').then((m) => ({ default: m.ListaDoPeriodo })));
const DashboardProfessor = lazy(() => import('./paginas/professor/DashboardProfessor').then((m) => ({ default: m.DashboardProfessor })));
const MeusOrientandos = lazy(() => import('./paginas/professor/MeusOrientandos').then((m) => ({ default: m.MeusOrientandos })));
const DetalheOrientando = lazy(() => import('./paginas/professor/DetalheOrientando').then((m) => ({ default: m.DetalheOrientando })));
const HistoricoProfessor = lazy(() => import('./paginas/professor/HistoricoProfessor').then((m) => ({ default: m.HistoricoProfessor })));
const DetalheHistorico = lazy(() => import('./paginas/professor/DetalheHistorico').then((m) => ({ default: m.DetalheHistorico })));
const DashboardAvaliador = lazy(() => import('./paginas/avaliador/DashboardAvaliador').then((m) => ({ default: m.DashboardAvaliador })));
const Coorientacoes = lazy(() => import('./paginas/Coorientacoes').then((m) => ({ default: m.Coorientacoes })));
const MinhasBancas = lazy(() => import('./paginas/MinhasBancas').then((m) => ({ default: m.MinhasBancas })));
const AvaliarBanca = lazy(() => import('./paginas/AvaliarBanca').then((m) => ({ default: m.AvaliarBanca })));
const Configuracoes = lazy(() => import('./paginas/Configuracoes').then((m) => ({ default: m.Configuracoes })));
const Perfil = lazy(() => import('./paginas/Perfil').then((m) => ({ default: m.Perfil })));

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
        <LimiteErro>
        {/* Fallback mínimo enquanto o chunk da página baixa — mesmo texto do Protegido. */}
        <Suspense fallback={<div className="centro">Carregando…</div>}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/recuperar-senha" element={<RecuperarSenha />} />
          <Route path="/redefinir-senha" element={<RedefinirSenha />} />

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
              <Route path="/coordenador/tccs" element={<TccsCoordenador />} />
              <Route path="/coordenador/tccs/:id" element={<TccDetalheCoordenador />} />
              <Route path="/coordenador/historico" element={<HistoricoCoordenador />} />
              <Route path="/coordenador/historico/:id" element={<DetalheHistoricoCoordenador />} />
              <Route path="/coordenador/relatorios" element={<Relatorios />} />
              <Route path="/coordenador/solicitacoes" element={<PainelCoordenador />} />
              <Route path="/coordenador/usuarios" element={<Usuarios />} />
              <Route path="/coordenador/lista-do-periodo" element={<ListaDoPeriodo />} />
              <Route path="/coordenador/avisos" element={<AvisosCoordenador />} />
              <Route path="/coordenador/planejamento" element={<PlanejamentoCoordenador />} />
            </Route>

            {/* Rotas do professor (orientador) */}
            <Route element={<ExigePapel papeis={['PROFESSOR']} />}>
              <Route path="/professor" element={<DashboardProfessor />} />
              <Route path="/professor/orientandos" element={<MeusOrientandos />} />
              <Route path="/professor/orientandos/:id" element={<DetalheOrientando />} />
              <Route path="/professor/historico" element={<HistoricoProfessor />} />
              <Route path="/professor/historico/:id" element={<DetalheHistorico />} />
            </Route>

            {/* Rotas do avaliador */}
            <Route element={<ExigePapel papeis={['AVALIADOR']} />}>
              <Route path="/avaliador" element={<DashboardAvaliador />} />
            </Route>

            {/* Bancas e coorientações — professor e avaliador são membros de banca/coorientadores.
                Lista + página interna de avaliação, com aliases por papel e compat /bancas. */}
            <Route element={<ExigePapel papeis={['PROFESSOR', 'AVALIADOR']} />}>
              <Route path="/bancas" element={<MinhasBancas />} />
              <Route path="/bancas/:membroId" element={<AvaliarBanca />} />
              <Route path="/professor/bancas" element={<MinhasBancas />} />
              <Route path="/professor/bancas/:membroId" element={<AvaliarBanca />} />
              <Route path="/avaliador/bancas" element={<MinhasBancas />} />
              <Route path="/avaliador/bancas/:membroId" element={<AvaliarBanca />} />
              <Route path="/coorientacoes" element={<Coorientacoes />} />
            </Route>

            {/* Comuns a qualquer usuário logado */}
            <Route path="/inicio" element={<PlaceholderPapel />} />
            {/* Mural comum (professor/avaliador); aluno e coordenador têm rota própria */}
            <Route path="/avisos" element={<MuralAvisos />} />
            <Route path="/perfil" element={<Perfil />} />
            <Route path="/configuracoes" element={<Configuracoes />} />
          </Route>

          <Route path="/" element={<RedirecionarHome />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
        </LimiteErro>
      </BrowserRouter>
    </ProvedorAuth>
    </ProvedorTema>
  );
}
