import { Navigate } from 'react-router-dom';
import { useAuth } from '../autenticacao/contexto';

// Manda cada papel para a sua área ao entrar em "/".
export function RedirecionarHome() {
  const { usuario, carregando } = useAuth();
  if (carregando) return <div className="centro">Carregando…</div>;
  if (!usuario) return <Navigate to="/login" replace />;

  const destino =
    usuario.papel === 'ALUNO'
      ? '/aluno'
      : usuario.papel === 'COORDENADOR'
        ? '/coordenador'
        : usuario.papel === 'PROFESSOR'
          ? '/professor'
          : usuario.papel === 'AVALIADOR'
            ? '/bancas'
            : '/inicio';
  return <Navigate to={destino} replace />;
}
