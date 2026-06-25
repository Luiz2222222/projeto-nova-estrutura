import { useEffect, useState } from 'react';
import { apiGet, apiPut, type ErroApi } from '../../api';

const icoOlho = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" /><circle cx="12" cy="12" r="3" />
  </svg>
);
const icoOlhoFechado = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><path d="M1 1l22 22" />
  </svg>
);

// Configuração GLOBAL de e-mails (coordenador): 2 interruptores + servidor SMTP.
export function SecaoConfiguracaoEmail() {
  const [cfg, setCfg] = useState<any | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [mostrarSenha, setMostrarSenha] = useState(false);

  // Form do SMTP (separado; salva com botão).
  const [host, setHost] = useState('');
  const [porta, setPorta] = useState('');
  const [secure, setSecure] = useState(false);
  const [usuario, setUsuario] = useState('');
  const [senha, setSenha] = useState(''); // vazio = manter a atual
  const [salvandoSmtp, setSalvandoSmtp] = useState(false);
  const [msg, setMsg] = useState('');
  const [erro, setErro] = useState('');

  function aplicar(c: any) {
    setCfg(c);
    setHost(c.smtpHost ?? '');
    setPorta(c.smtpPort != null ? String(c.smtpPort) : '');
    setSecure(!!c.smtpSecure);
    setUsuario(c.smtpUsuario ?? '');
    setSenha('');
  }

  useEffect(() => {
    apiGet('/email-config').then(aplicar).catch(() => setCfg(null));
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
      setCfg(anterior);
    } finally {
      setSalvando(false);
    }
  }

  async function salvarSmtp() {
    setMsg('');
    setErro('');
    setSalvandoSmtp(true);
    try {
      const c = await apiPut('/email-config', {
        smtpHost: host,
        smtpPort: porta ? Number(porta) : null,
        smtpSecure: secure,
        smtpUsuario: usuario,
        smtpRemetente: '', // sem campo From: o remetente cai no próprio e-mail (smtpUsuario)
        smtpSenha: senha, // vazio = mantém a atual
      });
      aplicar(c); // recarrega (atualiza temSenha e limpa o campo de senha)
      setMsg('Configuração de servidor salva.');
    } catch (e) {
      setErro((e as ErroApi).mensagem || 'Não foi possível salvar.');
    } finally {
      setSalvandoSmtp(false);
    }
  }

  return (
    <section className="cartao-secao bloco">
      <h2>Configuração de e-mails</h2>
      <p className="legenda" style={{ marginBottom: 14 }}>
        Controle global do envio de e-mails do sistema. Sem servidor SMTP configurado (aqui ou no
        servidor), os e-mails são apenas registrados no log (modo de desenvolvimento).
      </p>
      {!cfg ? (
        <p className="nota-vazio">Carregando…</p>
      ) : (
        <>
          <div className="config-grupo pref-lista">
            <div className="pref-item">
              <div className="pref-texto">
                <span className="pref-rotulo">Enviar e-mails de recuperação de senha</span>
                <span className="pref-desc">Quando desligado, o "Esqueci minha senha" continua respondendo, mas nenhum e-mail é enviado.</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={!!cfg.recuperacaoSenhaAtiva}
                aria-label="Enviar e-mails de recuperação de senha"
                disabled={salvando}
                className={`pref-switch${cfg.recuperacaoSenhaAtiva ? ' on' : ''}`}
                onClick={() => alternar('recuperacaoSenhaAtiva')}
              >
                <span className="pref-switch-bolinha" aria-hidden="true" />
              </button>
            </div>
            <div className="pref-item">
              <div className="pref-texto">
                <span className="pref-rotulo">Enviar e-mails do fluxo do TCC</span>
                <span className="pref-desc">Notificações de solicitações, monografia, banca, fases e versão final. As preferências individuais de cada usuário ainda valem.</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={!!cfg.fluxoTccAtivo}
                aria-label="Enviar e-mails do fluxo do TCC"
                disabled={salvando}
                className={`pref-switch${cfg.fluxoTccAtivo ? ' on' : ''}`}
                onClick={() => alternar('fluxoTccAtivo')}
              >
                <span className="pref-switch-bolinha" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="config-grupo">
            <h3>Servidor de e-mail (SMTP)</h3>
            <p className="legenda" style={{ marginBottom: 8 }}>
              Configure o servidor que envia os e-mails. Quando preenchido aqui, substitui as variáveis
              do servidor (.env). A senha é guardada criptografada e nunca é exibida.
            </p>
            {msg && <div className="erro-geral" style={{ background: 'var(--aprovado-suave)', borderColor: 'rgba(21,128,61,0.25)', color: 'var(--aprovado)' }}>{msg}</div>}
            {erro && <div className="erro-geral">{erro}</div>}
            <div className="grade-2">
              <label className="campo"><span>E-mail</span><input value={usuario} onChange={(e) => setUsuario(e.target.value)} placeholder="seu-email@provedor.com" /></label>
              <label className="campo">
                <span>Senha de app</span>
                <span className="campo-com-acao">
                  <input type={mostrarSenha ? 'text' : 'password'} value={senha} onChange={(e) => setSenha(e.target.value)} placeholder={cfg.temSenha ? '•••••• (deixe em branco para manter)' : 'Senha de app do provedor'} />
                  <button type="button" className="campo-acao" onClick={() => setMostrarSenha((v) => !v)} title={mostrarSenha ? 'Ocultar' : 'Mostrar'} aria-label={mostrarSenha ? 'Ocultar senha' : 'Mostrar senha'}>
                    {mostrarSenha ? icoOlhoFechado : icoOlho}
                  </button>
                </span>
                <small className="legenda">Use uma senha de app do provedor, não sua senha principal.</small>
              </label>
              <label className="campo"><span>Servidor (host)</span><input value={host} onChange={(e) => setHost(e.target.value)} placeholder="smtp.seuprovedor.com" /></label>
              <label className="campo"><span>Porta</span><input type="number" value={porta} onChange={(e) => setPorta(e.target.value)} placeholder="587" /></label>
              <div className="pref-item pref-item-span">
                <div className="pref-texto">
                  <span className="pref-rotulo">Conexão segura (TLS/SSL)</span>
                  <span className="pref-desc">Marque para porta 465 (SSL). Para 587 (STARTTLS), deixe desmarcado.</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={secure}
                  aria-label="Conexão segura (TLS/SSL)"
                  className={`pref-switch${secure ? ' on' : ''}`}
                  onClick={() => setSecure((v) => !v)}
                >
                  <span className="pref-switch-bolinha" aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="acoes" style={{ justifyContent: 'flex-start' }}>
              <button className="botao" disabled={salvandoSmtp} onClick={salvarSmtp}>{salvandoSmtp ? 'Salvando…' : 'Salvar servidor'}</button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
