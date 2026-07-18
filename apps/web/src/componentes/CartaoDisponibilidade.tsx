import { useState } from 'react';
import { apiPut, type ErroApi } from '../api';
import { useAuth } from '../autenticacao/contexto';
import type { UsuarioPublico } from '@tcc/compartilhado';

// Disponibilidade do PROFESSOR para novas orientações/coorientações/bancas.
// Morava no Dashboard do professor; hoje vive no fim da página Configurações.
// Indisponível = some das listas de escolha (orientador, coorientador e banca);
// vínculos já existentes não mudam.
export function CartaoDisponibilidade() {
  const { usuario, atualizarUsuario } = useAuth();
  const [salvando, setSalvando] = useState(false);
  if (usuario?.papel !== 'PROFESSOR') return null;
  const disponivel = usuario.disponivelParaOrientar ?? false;

  async function alternar() {
    setSalvando(true);
    try {
      const u = await apiPut<UsuarioPublico>('/autenticacao/disponibilidade', { disponivel: !disponivel });
      atualizarUsuario(u);
    } catch (e) {
      window.alert((e as ErroApi).mensagem || 'Não foi possível alterar.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <section className="cartao-secao bloco">
      <h2>Disponibilidade para orientar</h2>
      <div className="aviso-cabecalho">
        <p className="nota-vazio" style={{ margin: 0 }}>
          {disponivel
            ? 'Você está disponível — aparece nas listas de orientador, coorientador e banca.'
            : 'Você está indisponível — não aparece para novas orientações, coorientações ou bancas.'}
        </p>
        <span className={`selo ${disponivel ? 'selo-ok' : ''}`} style={disponivel ? {} : { background: 'var(--inset)', color: 'var(--tinta-3)' }}>
          {disponivel ? 'Disponível' : 'Indisponível'}
        </span>
      </div>
      <div className="acoes" style={{ justifyContent: 'flex-start' }}>
        <button className="botao botao-secundario" disabled={salvando} onClick={alternar}>
          {salvando ? 'Salvando…' : disponivel ? 'Ficar indisponível' : 'Ficar disponível'}
        </button>
      </div>
    </section>
  );
}
