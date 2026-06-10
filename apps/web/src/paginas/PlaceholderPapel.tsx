import { useAuth } from '../autenticacao/contexto';
import { ROTULO_PAPEL } from '@tcc/compartilhado';
import { TrilhaFases } from '../componentes/TrilhaFases';

// Home temporária para papéis ainda sem telas (professor, avaliador).
export function PlaceholderPapel() {
  const { usuario } = useAuth();
  if (!usuario) return null;
  return (
    <>
      <h1>Olá, {usuario.nomeCompleto.split(' ')[0]} 👋</h1>
      <p className="legenda">{ROTULO_PAPEL[usuario.papel]}</p>
      <section className="cartao-secao bloco">
        <h2>Sua área está em construção</h2>
        <TrilhaFases atual={null} />
        <p className="nota-vazio">As telas do seu perfil virão nas próximas fatias.</p>
      </section>
    </>
  );
}
