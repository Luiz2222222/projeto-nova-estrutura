import { useEffect, useState } from 'react';
import { apiGet, apiPost, apiPut, type ErroApi } from '../../api';
import { Modal } from '../../componentes/Modal';

const MASCARA = '••••••••••••'; // enfeite visual: nunca sai daqui para o backend

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

// Configuração GLOBAL de e-mails (coordenador): 2 interruptores + conta remetente.
// Host, porta e TLS não aparecem aqui: são fixos no backend (Google Workspace, 587 +
// STARTTLS obrigatório). A tela pede só o e-mail remetente e a senha de app.
export function SecaoConfiguracaoEmail() {
  const [cfg, setCfg] = useState<any | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [mostrarSenha, setMostrarSenha] = useState(false);

  // Form da conta remetente (separado; salva com botão).
  const [usuario, setUsuario] = useState('');
  // A senha guardada NUNCA chega aqui. O campo mostra uma máscara puramente visual e o que
  // vale para o backend é a AÇÃO explícita:
  //   não tocou           -> MANTER
  //   digitou algo        -> SUBSTITUIR (manda a senha nova)
  //   apagou o conteúdo   -> REMOVER
  const [senha, setSenha] = useState(''); // o que o coordenador digitou agora
  const [editandoSenha, setEditandoSenha] = useState(false); // máscara saiu do campo
  const [alterouSenha, setAlterouSenha] = useState(false); // realmente digitou/apagou
  const [salvandoSmtp, setSalvandoSmtp] = useState(false);
  const [msg, setMsg] = useState('');
  const [erro, setErro] = useState('');

  // Revelação da senha de app: tudo vive SÓ aqui e é zerado ao fechar o modal — nada de
  // localStorage/sessionStorage, e a senha nunca volta no GET normal da configuração.
  const [modalRevelar, setModalRevelar] = useState(false);
  const [senhaCoordenador, setSenhaCoordenador] = useState('');
  const [confirmou, setConfirmou] = useState(false);
  const [senhaRevelada, setSenhaRevelada] = useState('');
  const [verRevelada, setVerRevelada] = useState(false);
  const [revelando, setRevelando] = useState(false);
  const [erroRevelar, setErroRevelar] = useState('');

  function abrirRevelacao() {
    setSenhaCoordenador('');
    setConfirmou(false);
    setSenhaRevelada('');
    setVerRevelada(false);
    setErroRevelar('');
    setModalRevelar(true);
  }

  // Fechar SEMPRE limpa a senha revelada da memória do componente.
  function fecharRevelacao() {
    setModalRevelar(false);
    setSenhaCoordenador('');
    setSenhaRevelada('');
    setVerRevelada(false);
    setConfirmou(false);
    setErroRevelar('');
  }

  async function revelar() {
    setErroRevelar('');
    setRevelando(true);
    try {
      const r = await apiPost<{ senha: string }>('/email-config/revelar-senha', { senha: senhaCoordenador });
      setSenhaRevelada(r.senha);
      setSenhaCoordenador(''); // a senha do coordenador não precisa mais ficar em memória
    } catch (e) {
      setErroRevelar((e as ErroApi).mensagem || 'Não foi possível revelar a senha.');
    } finally {
      setRevelando(false);
    }
  }

  function aplicar(c: any) {
    setCfg(c);
    setUsuario(c.smtpUsuario ?? '');
    // Volta ao estado "mascarado e intocado": com senha salva o campo reaparece cheio de
    // pontos (nunca vazio); sem senha salva, vazio de verdade.
    setSenha('');
    setEditandoSenha(false);
    setAlterouSenha(false);
    setMostrarSenha(false);
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

  // Está digitando uma senha nova? Só aí o olho vira mostrar/ocultar local; com a máscara
  // no campo, ele abre o modal reautenticado.
  const digitando = editandoSenha && senha.length > 0;

  async function salvarSmtp() {
    setMsg('');
    setErro('');
    setSalvandoSmtp(true);
    try {
      // Só e-mail + AÇÃO: host/porta/TLS/remetente são definidos pelo backend. A máscara de
      // pontos jamais é enviada — quando a ação não é SUBSTITUIR, nem existe campo de senha.
      const acaoSenha = !alterouSenha ? 'MANTER' : senha ? 'SUBSTITUIR' : 'REMOVER';
      const c = await apiPut('/email-config', {
        smtpUsuario: usuario,
        acaoSenha,
        ...(acaoSenha === 'SUBSTITUIR' ? { smtpSenha: senha } : {}),
      });
      aplicar(c); // recarrega (atualiza temSenha e limpa o campo de senha)
      setMsg('Configuração de e-mail salva.');
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
            <h3>Conta que envia os e-mails</h3>
            <p className="legenda" style={{ marginBottom: 8 }}>
              Configuração global compartilhada entre os coordenadores. Use o e-mail institucional do
              setor e uma senha de app do Google. A senha é guardada criptografada e nunca é exibida.
            </p>
            {msg && <div className="erro-geral" style={{ background: 'var(--aprovado-suave)', borderColor: 'rgba(21,128,61,0.25)', color: 'var(--aprovado)' }}>{msg}</div>}
            {erro && <div className="erro-geral">{erro}</div>}
            <div className="grade-2">
              <label className="campo"><span>E-mail remetente</span><input value={usuario} onChange={(e) => setUsuario(e.target.value)} placeholder="coordenacaodee@ufpe.br" /></label>
              <label className="campo">
                <span>Senha de app</span>
                <span className="campo-com-acao">
                  <input
                    type={mostrarSenha && editandoSenha ? 'text' : 'password'}
                    value={editandoSenha ? senha : cfg.temSenha ? MASCARA : ''}
                    // Focar limpa a máscara para o coordenador digitar por cima.
                    onFocus={() => {
                      if (!editandoSenha && cfg.temSenha) {
                        setEditandoSenha(true);
                        setSenha('');
                      }
                    }}
                    onChange={(e) => {
                      setEditandoSenha(true);
                      setAlterouSenha(true); // agora o vazio significa "remover", não "manter"
                      setSenha(e.target.value);
                    }}
                    // Saiu sem digitar nada: volta a máscara e o estado "não tocado" — só
                    // focar no campo não pode virar remoção da senha.
                    onBlur={() => {
                      if (editandoSenha && !alterouSenha) setEditandoSenha(false);
                    }}
                    placeholder={cfg.temSenha ? 'Digite a nova senha ou apague para remover' : 'Senha de app do Google'}
                    // Sem autopreenchimento: senão o navegador reenche o campo e ele passa a
                    // mostrar algo que não é a senha guardada.
                    autoComplete="new-password"
                    name="senha-de-app-tcc"
                  />
                  {/* ÚNICA entrada para ver a senha. Com algo digitado, é um mostrar/ocultar
                      local do que está no campo. Com o campo vazio e senha já salva, abre o
                      modal seguro (senha do coordenador + confirmação) — nunca preenche o
                      formulário com a senha salva. */}
                  {(digitando || cfg.temSenha) && (
                    <button
                      type="button"
                      className="campo-acao"
                      onClick={() => (digitando ? setMostrarSenha((v) => !v) : abrirRevelacao())}
                      title={digitando ? (mostrarSenha ? 'Ocultar' : 'Mostrar') : 'Mostrar senha de app salva'}
                      aria-label={
                        digitando
                          ? mostrarSenha
                            ? 'Ocultar senha digitada'
                            : 'Mostrar senha digitada'
                          : 'Mostrar senha de app salva'
                      }
                    >
                      {digitando && mostrarSenha ? icoOlhoFechado : icoOlho}
                    </button>
                  )}
                </span>
                <small className="legenda">
                  {cfg.temSenha
                    ? 'Senha de app configurada. Digite uma nova senha para substituir; deixe em branco para manter a atual.'
                    : 'Use uma senha de app do Google, nunca a senha normal da conta.'}
                </small>
              </label>
            </div>
            <div className="acoes" style={{ justifyContent: 'flex-start' }}>
              <button className="botao" disabled={salvandoSmtp} onClick={salvarSmtp}>{salvandoSmtp ? 'Salvando…' : 'Salvar configuração'}</button>
            </div>

            {modalRevelar && (
              <Modal
                titulo="Mostrar senha de app"
                subtitulo="A configuração de e-mail é compartilhada por toda a coordenação. Confirme sua senha para ver a senha de app salva."
                aoFechar={() => !revelando && fecharRevelacao()}
              >
                {erroRevelar && <div className="erro-geral">{erroRevelar}</div>}

                {!senhaRevelada ? (
                  <>
                    <label className="campo">
                      <span>Sua senha</span>
                      <input
                        type="password"
                        value={senhaCoordenador}
                        onChange={(e) => setSenhaCoordenador(e.target.value)}
                        placeholder="Senha da sua conta de coordenador"
                      />
                    </label>
                    <label className="campo-checkbox" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <input type="checkbox" checked={confirmou} onChange={(e) => setConfirmou(e.target.checked)} />
                      <span>Confirmo que quero exibir a senha de app na tela agora.</span>
                    </label>
                    <div className="acoes">
                      <button className="botao botao-secundario" disabled={revelando} onClick={fecharRevelacao}>Cancelar</button>
                      <button className="botao" disabled={revelando || !confirmou || !senhaCoordenador} onClick={revelar}>
                        {revelando ? 'Verificando…' : 'Mostrar senha'}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <label className="campo">
                      <span>Senha de app</span>
                      <span className="campo-com-acao">
                        <input type={verRevelada ? 'text' : 'password'} value={senhaRevelada} readOnly />
                        <button type="button" className="campo-acao" onClick={() => setVerRevelada((v) => !v)} aria-label={verRevelada ? 'Ocultar senha' : 'Mostrar senha'}>
                          {verRevelada ? icoOlhoFechado : icoOlho}
                        </button>
                      </span>
                      <small className="legenda">Ela some desta tela ao fechar o modal.</small>
                    </label>
                    <div className="acoes">
                      <button className="botao" onClick={fecharRevelacao}>Fechar</button>
                    </div>
                  </>
                )}
              </Modal>
            )}
          </div>
        </>
      )}
    </section>
  );
}
