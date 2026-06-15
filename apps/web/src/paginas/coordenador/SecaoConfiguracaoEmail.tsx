import { useEffect, useState } from 'react';
import { apiGet, apiPut, type ErroApi } from '../../api';

// Configuração GLOBAL de e-mails (coordenador): 2 interruptores + servidor SMTP.
export function SecaoConfiguracaoEmail() {
  const [cfg, setCfg] = useState<any | null>(null);
  const [salvando, setSalvando] = useState(false);

  // Form do SMTP (separado; salva com botão).
  const [host, setHost] = useState('');
  const [porta, setPorta] = useState('');
  const [secure, setSecure] = useState(false);
  const [usuario, setUsuario] = useState('');
  const [remetente, setRemetente] = useState('');
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
    setRemetente(c.smtpRemetente ?? '');
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
        smtpRemetente: remetente,
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

          <div className="config-grupo">
            <h3>Servidor de e-mail (SMTP)</h3>
            <p className="legenda" style={{ marginBottom: 8 }}>
              Configure o servidor que envia os e-mails. Quando preenchido aqui, substitui as variáveis
              do servidor (.env). A senha é guardada criptografada e nunca é exibida.
            </p>
            {msg && <div className="erro-geral" style={{ background: 'var(--aprovado-suave)', borderColor: 'rgba(21,128,61,0.25)', color: 'var(--aprovado)' }}>{msg}</div>}
            {erro && <div className="erro-geral">{erro}</div>}
            <div className="grade-2">
              <label className="campo"><span>Servidor (host)</span><input value={host} onChange={(e) => setHost(e.target.value)} placeholder="smtp.seuprovedor.com" /></label>
              <label className="campo"><span>Porta</span><input type="number" value={porta} onChange={(e) => setPorta(e.target.value)} placeholder="587" /></label>
              <label className="campo"><span>Usuário</span><input value={usuario} onChange={(e) => setUsuario(e.target.value)} placeholder="usuario@dominio" /></label>
              <label className="campo"><span>E-mail remetente (From)</span><input value={remetente} onChange={(e) => setRemetente(e.target.value)} placeholder="Sistema de TCC <nao-responda@dominio>" /></label>
              <label className="campo">
                <span>Senha de app</span>
                <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder={cfg.temSenha ? '•••••• (deixe em branco para manter)' : 'Senha de app do provedor'} />
              </label>
              <label className="linha-check linha-toggle" style={{ alignSelf: 'end' }}>
                <input type="checkbox" checked={secure} onChange={(e) => setSecure(e.target.checked)} />
                <span><strong>Conexão segura (TLS/SSL)</strong><span className="legenda">Marque para porta 465 (SSL). Para 587 (STARTTLS), deixe desmarcado.</span></span>
              </label>
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
