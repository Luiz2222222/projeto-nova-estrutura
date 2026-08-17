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
  orientador_lembrete_continuidade: 'Lembretes do prazo para avaliar a continuidade de um orientando (2 dias antes, 1 dia antes e no dia).',
  orientador_banca_formada: 'Quando a banca da Fase I de um orientando for formada.',
  orientador_agendar_defesa: 'Quando a Fase I for aprovada e você precisar agendar a defesa (Fase II).',
  orientador_versao_final_enviada: 'Quando um orientando enviar a versão final.',
  orientador_versao_final_reenviada: 'Quando a versão final for reenviada após ajustes.',
  coord_nova_solicitacao: 'Quando houver uma nova solicitação aguardando análise.',
  coord_formar_banca_fase1: 'Quando um TCC estiver pronto para formar a banca da Fase I.',
  coord_validar_fase1: 'Quando todos enviarem as avaliações da Fase I (aguardando análise).',
  coord_validar_fase2: 'Quando todos enviarem as avaliações da Fase II (aguardando análise).',
  coord_avaliacao_reenviada: 'Quando um avaliador reenviar a avaliação após um ajuste solicitado.',
  coord_continuidade: 'Quando o orientador confirmar a continuidade ou descontinuar um TCC.',
  coord_tcc_concluido: 'Quando um TCC for concluído (versão final validada pelo orientador).',
  avaliador_adicionado_fase1: 'Quando você for adicionado a uma banca da Fase I (a avaliação já fica liberada).',
  avaliador_fase2_liberada: 'Quando a defesa acontecer e a avaliação da Fase II for liberada para você.',
  defesa_agendada: 'Quando a defesa de um TCC que envolve você for agendada ou reagendada.',
  avaliador_ajuste_solicitado: 'Quando a coordenação solicitar um ajuste na sua avaliação.',
  avaliador_ajuste_cancelado: 'Quando a coordenação cancelar uma solicitação de ajuste.',
  fase_avaliacoes_concluidas: 'Quando todos os membros enviarem as avaliações e a fase seguir para análise.',
  fase_analise_iniciada: 'Quando a coordenação iniciar a análise das avaliações.',
  fase_validada: 'Quando a coordenação validar a fase.',
  coorientador_indicado: 'Quando a abertura de um TCC no qual você foi indicado coorientador for aprovada.',
  coorientador_mudanca_fase: 'Quando houver uma mudança de fase importante no TCC.',
  coorientador_documentos: 'Quando a monografia ou a versão final for enviada, aprovada ou devolvida para ajustes.',
};

// Agrupamento de EXIBIÇÃO por papel (só apresentação — o grupo do domínio segue no registro):
// aluno e coordenador enxergam as etapas do TCC; professor e avaliador, o tipo de participação.
// Eventos que ficarem fora do mapa (ex.: um evento novo) caem no grupo "Outros" no final.
const CHAVES_BANCA = [
  'avaliador_adicionado_fase1',
  'defesa_agendada',
  'avaliador_fase2_liberada',
  'avaliador_ajuste_solicitado',
  'avaliador_ajuste_cancelado',
  'fase_avaliacoes_concluidas',
  'fase_analise_iniciada',
  'fase_validada',
];
const CHAVES_COORIENTACAO = ['coorientador_indicado', 'coorientador_documentos', 'coorientador_mudanca_fase'];

const GRUPOS_EXIBICAO: Record<string, [string, string[]][]> = {
  ALUNO: [
    ['Abertura', ['aluno_solicitacao_aprovada', 'aluno_solicitacao_recusada']],
    ['Desenvolvimento', ['aluno_monografia_aprovada', 'aluno_monografia_rejeitada', 'aluno_continuidade_confirmada', 'aluno_continuidade_rejeitada']],
    ['Bancas e avaliação', ['aluno_banca_fase1_formada', 'fase_avaliacoes_concluidas', 'fase_analise_iniciada', 'fase_validada', 'aluno_resultado_fase1', 'defesa_agendada', 'aluno_resultado_fase2']],
    ['Conclusão', ['aluno_versao_final_solicitada', 'aluno_versao_final_rejeitada', 'aluno_tcc_concluido']],
  ],
  PROFESSOR: [
    ['Orientação', ['orientador_definido', 'orientador_monografia_enviada', 'orientador_lembrete_continuidade', 'orientador_banca_formada', 'orientador_agendar_defesa', 'orientador_versao_final_enviada', 'orientador_versao_final_reenviada']],
    ['Coorientação', CHAVES_COORIENTACAO],
    ['Participação em banca', CHAVES_BANCA],
  ],
  AVALIADOR: [
    ['Participação em banca', CHAVES_BANCA],
    ['Coorientação', CHAVES_COORIENTACAO],
  ],
  COORDENADOR: [
    ['Abertura', ['coord_nova_solicitacao']],
    ['Desenvolvimento', ['coord_continuidade']],
    ['Bancas e avaliação', ['coord_formar_banca_fase1', 'coord_validar_fase1', 'defesa_agendada', 'coord_validar_fase2', 'coord_avaliacao_reenviada']],
    ['Conclusão', ['coord_tcc_concluido']],
  ],
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
    const porChave = new Map(eventos.map((e) => [e.chave, e]));
    const usados = new Set<string>();
    const out: [string, typeof eventos][] = [];
    for (const [rotulo, chaves] of GRUPOS_EXIBICAO[usuario?.papel ?? ''] ?? []) {
      const lista = chaves.flatMap((c) => {
        const ev = porChave.get(c);
        if (!ev || usados.has(c)) return [];
        usados.add(c);
        return [ev];
      });
      if (lista.length) out.push([rotulo, lista]);
    }
    const resto = eventos.filter((e) => !usados.has(e.chave));
    if (resto.length) out.push(['Outros', resto]);
    return out;
  }, [eventos, usuario]);

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
