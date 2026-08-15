import { useEffect, useState } from 'react';
import { apiGet, apiPost, apiPut, type ErroApi } from '../../api';

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

  // Senha de app revelada: vive SÓ no estado deste componente enquanto estiver visível.
  // Some ao ocultar e ao desmontar a tela — nada de localStorage/sessionStorage, e o GET
  // normal da configuração continua sem trazer senha nenhuma.
  const [senhaRevelada, setSenhaRevelada] = useState('');
  const [revelando, setRevelando] = useState(false);

  // Mostra a senha salva direto no campo. Autorização = sessão de COORDENADOR (a
  // configuração é global e qualquer coordenador já pode trocá-la ou removê-la).
  async function revelar() {
    setErro('');
    setRevelando(true);
    try {
      const r = await apiPost<{ senha: string }>('/email-config/revelar-senha', {});
      setSenhaRevelada(r.senha);
    } catch (e) {
      setErro((e as ErroApi).mensagem || 'Não foi possível mostrar a senha.');
    } finally {
      setRevelando(false);
    }
  }

  function ocultarRevelada() {
    setSenhaRevelada(''); // volta à máscara e tira o valor real da memória
  }

  // Rede de segurança: sair da tela também descarta a senha revelada.
  useEffect(() => () => setSenhaRevelada(''), []);

  function aplicar(c: any) {
    setCfg(c);
    setUsuario(c.smtpUsuario ?? '');
    // Volta ao estado "mascarado e intocado": com senha salva o campo reaparece cheio de
    // pontos (nunca vazio); sem senha salva, vazio de verdade.
    setSenha('');
    setEditandoSenha(false);
    setAlterouSenha(false);
    setMostrarSenha(false);
    setSenhaRevelada(''); // salvou: o valor revelado nao vale mais
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

  // Está digitando uma senha NOVA? Só aí o olho vira mostrar/ocultar local; enquanto o campo
  // tiver a máscara (mesmo focada/selecionada), o olho revela/oculta a senha salva.
  const digitando = editandoSenha && alterouSenha && senha.length > 0 && senha !== MASCARA;

  async function salvarSmtp() {
    setMsg('');
    setErro('');
    setSalvandoSmtp(true);
    try {
      // Só e-mail + AÇÃO: host/porta/TLS/remetente são definidos pelo backend. A máscara de
      // pontos jamais é enviada — quando a ação não é SUBSTITUIR, nem existe campo de senha.
      // Rede de proteção: se o valor do campo ainda for a máscara, isso NÃO é senha —
      // vale como "não mexi". Os pontos falsos nunca podem virar segredo.
      const acaoSenha = !alterouSenha || senha === MASCARA ? 'MANTER' : senha ? 'SUBSTITUIR' : 'REMOVER';
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
                    type={(mostrarSenha && editandoSenha) || senhaRevelada ? 'text' : 'password'}
                    value={editandoSenha ? senha : senhaRevelada || (cfg.temSenha ? MASCARA : '')}
                    // Focar mantém a máscara no campo e a deixa SELECIONADA. É isso que faz o
                    // caminho natural funcionar: digitar substitui a seleção (SUBSTITUIR) e
                    // Delete/Backspace apaga a seleção gerando onChange com vazio (REMOVER).
                    // Limpar o campo no foco quebrava isso — o Delete não gerava evento nenhum.
                    onFocus={(e) => {
                      setSenhaRevelada(''); // ao entrar em edição, o valor real sai da memória
                      if (!editandoSenha && cfg.temSenha) {
                        setEditandoSenha(true);
                        setSenha(MASCARA);
                      }
                      e.target.select();
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
                      disabled={revelando}
                      onClick={() => {
                        if (digitando) return setMostrarSenha((v) => !v); // só o que foi digitado
                        return senhaRevelada ? ocultarRevelada() : revelar();
                      }}
                      aria-label={
                        digitando
                          ? mostrarSenha
                            ? 'Ocultar senha digitada'
                            : 'Mostrar senha digitada'
                          : senhaRevelada
                            ? 'Ocultar senha de app'
                            : 'Mostrar senha de app'
                      }
                    >
                      {(digitando && mostrarSenha) || senhaRevelada ? icoOlhoFechado : icoOlho}
                    </button>
                  )}
                </span>
                <small className="legenda">
                  {cfg.temSenha
                    ? 'Senha de app configurada. Não altere o campo para manter a atual; digite uma nova senha para substituir ou apague o conteúdo e salve para remover.'
                    : 'Use uma senha de app do Google, nunca a senha normal da conta.'}
                </small>
              </label>
            </div>
            <div className="acoes" style={{ justifyContent: 'flex-start' }}>
              <button className="botao" disabled={salvandoSmtp} onClick={salvarSmtp}>{salvandoSmtp ? 'Salvando…' : 'Salvar configuração'}</button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
