import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../autenticacao/contexto';
import { apiGet, apiPut } from '../api';
import { EVENTOS_EMAIL, type Papel } from '@tcc/compartilhado';

// Preferências de e-mail do próprio usuário: toggles por evento relevante ao papel.
// Recuperação de senha NÃO entra aqui (é controle global do coordenador).
export function PreferenciasEmail() {
  const { usuario } = useAuth();
  const [salvos, setSalvos] = useState<Record<string, boolean>>({});
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    apiGet<{ evento: string; ativo: boolean }[]>('/autenticacao/preferencias-email')
      .then((rows) => setSalvos(Object.fromEntries(rows.map((r) => [r.evento, r.ativo]))))
      .catch(() => setSalvos({}))
      .finally(() => setCarregando(false));
  }, []);

  const eventos = useMemo(
    () => (usuario ? EVENTOS_EMAIL.filter((e) => e.papeis.includes(usuario.papel as Papel)) : []),
    [usuario],
  );
  const grupos = useMemo(() => {
    const m = new Map<string, typeof eventos>();
    eventos.forEach((e) => {
      const a = m.get(e.grupo) ?? [];
      a.push(e);
      m.set(e.grupo, a);
    });
    return [...m.entries()];
  }, [eventos]);

  // Sem preferência salva = ligado (padrão dos e-mails importantes).
  const estaAtivo = (chave: string) => salvos[chave] ?? true;

  async function alternar(chave: string) {
    const novo = !estaAtivo(chave);
    setSalvos((s) => ({ ...s, [chave]: novo }));
    try {
      await apiPut('/autenticacao/preferencias-email', { evento: chave, ativo: novo });
    } catch {
      setSalvos((s) => ({ ...s, [chave]: !novo })); // reverte
    }
  }

  if (!usuario) return null;

  return (
    <section className="cartao-secao bloco">
      <h2>Preferências de e-mail</h2>
      <p className="legenda" style={{ marginBottom: 14 }}>
        Escolha quais e-mails do sistema você quer receber. A recuperação de senha não é controlada aqui.
      </p>
      {carregando ? (
        <p className="nota-vazio">Carregando…</p>
      ) : eventos.length === 0 ? (
        <p className="nota-vazio">Não há e-mails configuráveis para o seu perfil.</p>
      ) : (
        grupos.map(([grupo, lista]) => (
          <div key={grupo} className="config-grupo">
            <h3>{grupo}</h3>
            {lista.map((ev) => (
              <label key={ev.chave} className="linha-check linha-toggle">
                <input type="checkbox" checked={estaAtivo(ev.chave)} onChange={() => alternar(ev.chave)} />
                <span>{ev.rotulo}</span>
              </label>
            ))}
          </div>
        ))
      )}
    </section>
  );
}
