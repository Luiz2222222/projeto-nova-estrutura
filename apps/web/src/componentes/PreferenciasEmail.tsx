import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../autenticacao/contexto';
import { apiGet, apiPut } from '../api';
import { EVENTOS_EMAIL, type Papel } from '@tcc/compartilhado';

// Descrição curta por evento (só apresentação — não muda evento/lógica/backend).
const DESC_EVENTO: Record<string, string> = {
  aluno_solicitacao_aprovada: 'Quando o coordenador aprovar a abertura do seu TCC.',
  aluno_solicitacao_recusada: 'Quando a abertura do seu TCC for recusada.',
  aluno_monografia_rejeitada: 'Quando o orientador pedir ajustes na sua monografia.',
  aluno_monografia_aprovada: 'Quando o orientador aprovar a sua monografia.',
  aluno_continuidade_confirmada: 'Quando o orientador confirmar a continuidade do seu TCC.',
  aluno_continuidade_rejeitada: 'Quando o orientador não confirmar a continuidade do TCC.',
  aluno_banca_fase1_formada: 'Quando a banca da Fase I do seu TCC for formada.',
  aluno_resultado_fase1: 'Quando o resultado da Fase I for validado.',
  aluno_resultado_fase2: 'Quando o resultado da Fase II for validado.',
  aluno_versao_final_solicitada: 'Quando for solicitado o envio da versão final.',
  aluno_versao_final_rejeitada: 'Quando o orientador pedir ajustes na versão final.',
  aluno_tcc_concluido: 'Quando o seu TCC for concluído e aprovado.',
  orientador_definido: 'Quando você for definido como orientador de um TCC aprovado.',
  orientador_monografia_enviada: 'Quando um orientando enviar ou reenviar a monografia.',
  orientador_confirmar_continuidade: 'Lembrete para confirmar a continuidade de um orientando.',
  orientador_agendar_defesa: 'Quando a Fase I for aprovada e você precisar agendar/liberar a defesa da Fase II.',
  orientador_versao_final_enviada: 'Quando um orientando enviar a versão final.',
  orientador_versao_final_reenviada: 'Quando a versão final for reenviada após ajustes.',
  orientador_tcc_concluido: 'Quando o TCC de um orientando for concluído.',
  coord_nova_solicitacao: 'Quando houver uma nova solicitação aguardando análise.',
  coord_formar_banca_fase1: 'Quando um TCC estiver pronto para formar a banca da Fase I.',
  coord_validar_fase1: 'Quando as notas da Fase I estiverem completas para validação.',
  coord_validar_fase2: 'Quando as notas da Fase II estiverem completas para validação.',
  avaliador_adicionado_fase1: 'Quando você for adicionado a uma banca da Fase I.',
  avaliador_fase1_liberada: 'Quando a avaliação da Fase I for liberada para você.',
  avaliador_adicionado_fase2: 'Quando você for adicionado a uma banca da Fase II.',
  avaliador_fase2_liberada: 'Quando a avaliação da Fase II for liberada para você.',
  coorientador_indicado: 'Quando você for indicado como coorientador de um TCC.',
  coorientador_mudanca_fase: 'Quando houver uma mudança de fase importante no TCC.',
};

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
            <div className="pref-lista">
              {lista.map((ev) => {
                const ativo = estaAtivo(ev.chave);
                return (
                  <div key={ev.chave} className="pref-item">
                    <div className="pref-texto">
                      <span className="pref-rotulo">{ev.rotulo}</span>
                      <span className="pref-desc">{DESC_EVENTO[ev.chave] ?? 'Receber e-mail quando este evento acontecer.'}</span>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={ativo}
                      aria-label={ev.rotulo}
                      className={`pref-switch${ativo ? ' on' : ''}`}
                      onClick={() => alternar(ev.chave)}
                    >
                      <span className="pref-switch-bolinha" aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </section>
  );
}
