// Seção "Liberações de prazo" do coordenador, dentro do detalhe de um TCC.
// Cada etapa restritiva mostra o status do prazo e um botão Liberar/Bloquear (toggle).
// As etapas informativas (preparação de banca/agendamento) aparecem como "Sem bloqueio".
import { useEffect, useState } from 'react';
import { apiGet, apiPost, type ErroApi } from '../api';
import { ETAPAS_PRAZO, ROTULO_ETAPA_PRAZO } from '@tcc/compartilhado';
import { ModalConfirmacao } from './ModalConfirmacao';

type EstadoEtapa = { liberado: boolean; vencido: boolean; bloqueado: boolean; prazo: string | null };

function badge(e?: EstadoEtapa) {
  if (!e) return { txt: '—', cls: 'pz-sem' };
  if (e.liberado) return { txt: 'liberado por exceção', cls: 'pz-lib' };
  if (!e.prazo) return { txt: 'sem prazo', cls: 'pz-sem' };
  if (e.vencido) return { txt: 'prazo vencido', cls: 'pz-venc' };
  return { txt: 'dentro do prazo', cls: 'pz-ok' };
}

export function LiberacoesPrazo({ tccId }: { tccId: string }) {
  const [estado, setEstado] = useState<Record<string, EstadoEtapa> | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<{ etapa: string; liberado: boolean } | null>(null);
  const [erroAcao, setErroAcao] = useState('');

  const carregar = () => apiGet(`/tccs/${tccId}/liberacoes`).then(setEstado).catch(() => setEstado(null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { carregar(); }, [tccId]);

  function pedir(etapa: string, liberado: boolean) {
    setErroAcao('');
    setConfirmar({ etapa, liberado });
  }
  async function executarAlternar() {
    if (!confirmar) return;
    const { etapa } = confirmar;
    setErroAcao('');
    setOcupado(etapa);
    try {
      await apiPost(`/tccs/${tccId}/liberacoes/${etapa}`, {});
      await carregar();
      setConfirmar(null);
    } catch (e) {
      setErroAcao((e as ErroApi).mensagem || 'Não foi possível alterar a liberação.');
    } finally {
      setOcupado(null);
    }
  }

  return (
    <section className="cartao-secao">
      <h2>Liberações de prazo</h2>
      <p className="legenda" style={{ marginTop: 0 }}>
        Permite ou impede ações <strong>fora do prazo</strong> só para este TCC, sem mexer no calendário do semestre.
        Prazo vencido sem liberação bloqueia a ação; <em>hoje = prazo</em> ainda conta como dentro do prazo.
      </p>
      {!estado ? (
        <p className="nota-vazio">Carregando…</p>
      ) : (
        <div className="liberacoes-lista">
          {ETAPAS_PRAZO.map((etapa) => {
            const e = estado[etapa];
            const b = badge(e);
            return (
              <div key={etapa} className="liberacao-linha">
                <span className="liberacao-nome">{ROTULO_ETAPA_PRAZO[etapa]}</span>
                <span className={`pz-badge ${b.cls}`}>{b.txt}</span>
                <button
                  className={`botao ${e?.liberado ? 'botao-secundario' : ''}`}
                  disabled={ocupado === etapa}
                  onClick={() => pedir(etapa, !!e?.liberado)}
                >
                  {ocupado === etapa ? '…' : e?.liberado ? 'Bloquear' : 'Liberar'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {confirmar && (
        <ModalConfirmacao
          titulo={confirmar.liberado ? 'Bloquear etapa' : 'Liberar etapa'}
          mensagem={
            confirmar.liberado ? (
              <>Deseja bloquear novamente <strong>{ROTULO_ETAPA_PRAZO[confirmar.etapa as keyof typeof ROTULO_ETAPA_PRAZO]}</strong> para este TCC? As ações fora do prazo voltam a ser impedidas.</>
            ) : (
              <>Deseja liberar <strong>{ROTULO_ETAPA_PRAZO[confirmar.etapa as keyof typeof ROTULO_ETAPA_PRAZO]}</strong> fora do prazo só para este TCC? A ação poderá ser feita mesmo com o prazo vencido.</>
            )
          }
          textoConfirmar={confirmar.liberado ? 'Bloquear' : 'Liberar'}
          textoProcessando={confirmar.liberado ? 'Bloqueando…' : 'Liberando…'}
          perigo={confirmar.liberado}
          processando={ocupado === confirmar.etapa}
          erro={erroAcao}
          aoConfirmar={executarAlternar}
          aoCancelar={() => setConfirmar(null)}
        />
      )}
    </section>
  );
}
