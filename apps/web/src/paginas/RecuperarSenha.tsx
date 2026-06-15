import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutAuth } from '../componentes/LayoutAuth';
import { apiPost, type ErroApi } from '../api';

// "Esqueci minha senha": pede o e-mail e dispara o link de recuperação.
export function RecuperarSenha() {
  const navegar = useNavigate();
  const [email, setEmail] = useState('');
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    setEnviando(true);
    try {
      await apiPost('/autenticacao/recuperar-senha', { email });
      setEnviado(true);
    } catch (ex) {
      setErro((ex as ErroApi).mensagem || 'Não foi possível enviar o link.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <LayoutAuth>
      <img className="login-logo" src="/Logo.png" alt="DEE — Departamento de Engenharia Elétrica" />
      <h2 className="vidro-titulo">Recuperar senha</h2>

      {enviado ? (
        <>
          <div className="erro-geral" style={{ background: 'var(--aprovado-suave)', borderColor: 'rgba(21,128,61,0.25)', color: 'var(--aprovado)' }}>
            Se houver uma conta com esse e-mail, enviamos um link para redefinir a senha. O link vale por 1 hora.
          </div>
          <button className="botao-vidro" type="button" onClick={() => navegar('/login')}>Voltar ao login</button>
        </>
      ) : (
        <form onSubmit={enviar}>
          {erro && <div className="erro-geral">{erro}</div>}
          <p className="rodape" style={{ marginTop: 0, marginBottom: 14 }}>
            Informe o e-mail da sua conta e enviaremos um link para criar uma nova senha.
          </p>
          <div className="campo-icone">
            <svg className="icone" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="M3 7l9 6 9-6" />
            </svg>
            <input
              type="email"
              placeholder="E-mail"
              aria-label="E-mail"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <button className="botao-vidro" type="submit" disabled={enviando}>
            {enviando ? 'Enviando…' : 'Enviar link'}
          </button>
        </form>
      )}

      <p className="rodape">
        Lembrou a senha?{' '}
        <button type="button" className="link-inline" onClick={() => navegar('/login')}>Entrar</button>
      </p>
    </LayoutAuth>
  );
}
