import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { UsuarioPublico, DadosCadastro, DadosLogin } from '@tcc/compartilhado';
import { apiGet, apiPost } from '../api';

interface ContextoAuth {
  usuario: UsuarioPublico | null;
  carregando: boolean;
  login: (dados: DadosLogin) => Promise<void>;
  cadastrar: (dados: DadosCadastro) => Promise<void>;
  sair: () => Promise<void>;
  atualizarUsuario: (u: UsuarioPublico) => void;
  // Zera a sessão local (sem chamada de rede) quando a API responde 401 no meio do uso —
  // o roteador `Protegido` redireciona para /login (fluxo de login existente).
  sessaoInvalida: () => void;
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
    // Só cria a conta — NÃO loga automaticamente. O usuário volta pra tela de login.
    await apiPost('/autenticacao/cadastro', dados);
  }

  async function sair() {
    await apiPost('/autenticacao/sair', {});
    setUsuario(null);
  }

  // Estável (useCallback) para poder entrar como dependência de useEffect/useCallback nas telas
  // sem recriar handlers a cada render.
  const sessaoInvalida = useCallback(() => setUsuario(null), []);

  return (
    <Contexto.Provider value={{ usuario, carregando, login, cadastrar, sair, atualizarUsuario: setUsuario, sessaoInvalida }}>
      {children}
    </Contexto.Provider>
  );
}
