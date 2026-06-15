import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { LayoutAuth } from '../componentes/LayoutAuth';
import { apiPost, type ErroApi } from '../api';

const icoCadeado = (
  <svg className="icone" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <rect x="4" y="10" width="16" height="11" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </svg>
);

// Redefinir senha a partir do token recebido por e-mail (?token=...).
export function RedefinirSenha() {
  const navegar = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  const [novaSenha, setNovaSenha] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState(false);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    if (novaSenha.length < 6) return setErro('A nova senha precisa ter ao menos 6 caracteres.');
    if (novaSenha !== confirmar) return setErro('As senhas não coincidem.');
    setEnviando(true);
    try {
      await apiPost('/autenticacao/redefinir-senha', { token, novaSenha, confirmarNovaSenha: confirmar });
      setOk(true);
    } catch (ex) {
      setErro((ex as ErroApi).mensagem || 'Não foi possível redefinir a senha.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <LayoutAuth>
      <img className="login-logo" src="/Logo.png" alt="DEE — Departamento de Engenharia Elétrica" />
      <h2 className="vidro-titulo">Redefinir senha</h2>

      {!token ? (
        <div className="erro-geral">Link inválido. Solicite a recuperação de senha novamente.</div>
      ) : ok ? (
        <>
          <div className="erro-geral" style={{ background: 'var(--aprovado-suave)', borderColor: 'rgba(21,128,61,0.25)', color: 'var(--aprovado)' }}>
            Senha redefinida com sucesso! Você já pode entrar com a nova senha.
          </div>
          <button className="botao-vidro" type="button" onClick={() => navegar('/login')}>Ir para o login</button>
        </>
      ) : (
        <form onSubmit={enviar}>
          {erro && <div className="erro-geral">{erro}</div>}
          <div className="campo-icone">
            {icoCadeado}
            <input type="password" placeholder="Nova senha" aria-label="Nova senha" value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} required />
          </div>
          <div className="campo-icone">
            {icoCadeado}
            <input type="password" placeholder="Confirmar nova senha" aria-label="Confirmar nova senha" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} required />
          </div>
          <button className="botao-vidro" type="submit" disabled={enviando}>
            {enviando ? 'Salvando…' : 'Redefinir senha'}
          </button>
        </form>
      )}

      <p className="rodape">
        <button type="button" className="link-inline" onClick={() => navegar('/login')}>Voltar ao login</button>
      </p>
    </LayoutAuth>
  );
}
