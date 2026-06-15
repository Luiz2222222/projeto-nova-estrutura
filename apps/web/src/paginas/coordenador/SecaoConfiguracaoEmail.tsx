import { useEffect, useState } from 'react';
import { apiGet, apiPut } from '../../api';

// Configuração GLOBAL de e-mails (coordenador): dois interruptores independentes.
export function SecaoConfiguracaoEmail() {
  const [cfg, setCfg] = useState<any | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    apiGet('/email-config').then(setCfg).catch(() => setCfg(null));
  }, []);

  async function alternar(campo: 'recuperacaoSenhaAtiva' | 'fluxoTccAtivo') {
    if (!cfg || salvando) return;
    const anterior = cfg;
    const novo = { ...cfg, [campo]: !cfg[campo] };
    setCfg(novo);
    setSalvando(true);
    try {
      await apiPut('/email-config', { [campo]: novo[campo] });
    } catch {
      setCfg(anterior); // reverte em caso de erro
    } finally {
      setSalvando(false);
    }
  }

  return (
    <section className="cartao-secao bloco">
      <h2>Configuração de e-mails</h2>
      <p className="legenda" style={{ marginBottom: 14 }}>
        Controle global do envio de e-mails do sistema. Em modo de desenvolvimento (sem SMTP), os
        e-mails são apenas registrados no log.
      </p>
      {!cfg ? (
        <p className="nota-vazio">Carregando…</p>
      ) : (
        <div className="config-grupo">
          <label className="linha-check linha-toggle">
            <input type="checkbox" checked={!!cfg.recuperacaoSenhaAtiva} disabled={salvando} onChange={() => alternar('recuperacaoSenhaAtiva')} />
            <span>
              <strong>Enviar e-mails de recuperação de senha</strong>
              <span className="legenda">Quando desligado, o "Esqueci minha senha" continua respondendo, mas nenhum e-mail é enviado.</span>
            </span>
          </label>
          <label className="linha-check linha-toggle">
            <input type="checkbox" checked={!!cfg.fluxoTccAtivo} disabled={salvando} onChange={() => alternar('fluxoTccAtivo')} />
            <span>
              <strong>Enviar e-mails do fluxo do TCC</strong>
              <span className="legenda">Notificações de solicitações, monografia, banca, fases e versão final. As preferências individuais de cada usuário ainda valem.</span>
            </span>
          </label>
        </div>
      )}
    </section>
  );
}
