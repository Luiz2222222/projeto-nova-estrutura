import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { UsuarioPublico, DadosCadastro, DadosLogin } from '@tcc/compartilhado';
import { apiGet, apiPost } from '../api';

interface ContextoAuth {
  usuario: UsuarioPublico | null;
  carregando: boolean;
  login: (dados: DadosLogin) => Promise<void>;
  cadastrar: (dados: DadosCadastro) => Promise<void>;
  sair: () => Promise<void>;
  atualizarUsuario: (u: UsuarioPublico) => void;
}

const Contexto = createContext<ContextoAuth>(null!);
export const useAuth = () => useContext(Contexto);

export function ProvedorAuth({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<UsuarioPublico | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    // Ao abrir o app, descobre se já existe sessão (cookie válido).
    apiGet<UsuarioPublico>('/autenticacao/eu')
      .then(setUsuario)
      .catch(() => setUsuario(null))
      .finally(() => setCarregando(false));
  }, []);

  async function login(dados: DadosLogin) {
    const u = await apiPost<UsuarioPublico>('/autenticacao/login', dados);
    setUsuario(u);
  }

  async function cadastrar(dados: DadosCadastro) {
    await apiPost('/autenticacao/cadastro', dados);
    // Após cadastrar, já entra automaticamente.
    await login({ email: dados.email, senha: dados.senha, manterLogin: false });
  }

  async function sair() {
    await apiPost('/autenticacao/sair', {});
    setUsuario(null);
  }

  return (
    <Contexto.Provider value={{ usuario, carregando, login, cadastrar, sair, atualizarUsuario: setUsuario }}>
      {children}
    </Contexto.Provider>
  );
}
