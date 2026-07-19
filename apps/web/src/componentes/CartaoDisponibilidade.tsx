import { useState } from 'react';
import { apiPut, type ErroApi } from '../api';
import { useAuth } from '../autenticacao/contexto';
import type { UsuarioPublico } from '@tcc/compartilhado';

// Disponibilidade do PROFESSOR — mesma linguagem visual das preferências de e-mail
// (linha compacta + switch à direita). Desligado: o professor não aparece para NOVAS
// orientações, coorientações ou bancas (o backend também recusa por API); vínculos já
// existentes não mudam. Fica no fim da página Configurações.
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
      <div className="pref-lista">
        <div className="pref-item">
          <div className="pref-texto">
            <span className="pref-rotulo">Disponibilidade para atividades</span>
            <span className="pref-desc">
              Desligado, você não aparece para novas orientações, coorientações ou bancas. O que já existe não muda.
            </span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={disponivel}
            aria-label="Disponibilidade para atividades"
            className={`pref-switch${disponivel ? ' on' : ''}`}
            disabled={salvando}
            onClick={alternar}
          >
            <span className="pref-switch-bolinha" aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  );
}
