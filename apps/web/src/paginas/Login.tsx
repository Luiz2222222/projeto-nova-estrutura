import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../autenticacao/contexto';
import { LayoutAuth } from '../componentes/LayoutAuth';
import { LogoDee } from '../componentes/LogoDee';
import { ModalCadastro } from '../componentes/ModalCadastro';
import type { ErroApi } from '../api';

export function Login() {
  const { login } = useAuth();
  const navegar = useNavigate();

  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [manterLogin, setManterLogin] = useState(false);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [mostrarCadastro, setMostrarCadastro] = useState(false);
  const [sucessoCadastro, setSucessoCadastro] = useState('');

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    setSucessoCadastro('');
    setEnviando(true);
    try {
      await login({ email, senha, manterLogin });
      navegar('/');
    } catch (ex) {
      setErro((ex as ErroApi).mensagem || 'Não foi possível entrar.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <LayoutAuth>
      <LogoDee className="login-logo" />
      <h2 className="vidro-titulo">Entrar</h2>

      <form onSubmit={enviar}>
        {sucessoCadastro && (
          <div className="erro-geral" style={{ background: 'var(--aprovado-suave)', borderColor: 'rgba(21,128,61,0.25)', color: 'var(--aprovado)' }}>
            {sucessoCadastro}
          </div>
        )}
        {erro && <div className="erro-geral">{erro}</div>}

        <div className="campo-icone">
          <svg className="icone" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="M3 7l9 6 9-6" />
          </svg>
          <input
            type="text"
            placeholder="E-mail ou usuário"
            aria-label="E-mail ou usuário"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="campo-icone">
          <svg className="icone" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="4" y="10" width="16" height="11" rx="2" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" />
          </svg>
          <input
            type="password"
            placeholder="Senha"
            aria-label="Senha"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            required
          />
        </div>

        <div className="vidro-linha">
          <label className="linha-check">
            <input type="checkbox" checked={manterLogin} onChange={(e) => setManterLogin(e.target.checked)} />
            <span>Manter login</span>
          </label>
          <a className="vidro-link" href="/recuperar-senha" onClick={(e) => { e.preventDefault(); navegar('/recuperar-senha'); }}>
            Esqueci minha senha
          </a>
        </div>

        <button className="botao-vidro" type="submit" disabled={enviando}>
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>

      <p className="rodape">
        Não tem conta?{' '}
        <button type="button" className="link-inline" onClick={() => setMostrarCadastro(true)}>
          Cadastre-se
        </button>
      </p>

      {mostrarCadastro && (
        <ModalCadastro
          aoFechar={() => setMostrarCadastro(false)}
          aoSucesso={() => {
            setMostrarCadastro(false);
            setSucessoCadastro('Cadastro realizado! Faça login com seu e-mail e senha.');
          }}
        />
      )}
    </LayoutAuth>
  );
}
