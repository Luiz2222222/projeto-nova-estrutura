// Cliente HTTP. `credentials: include` faz o navegador mandar o cookie de login.
// Em produção, defina VITE_API_URL no build do front; em dev cai no localhost.
export const URL_API = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export interface ErroApi {
  status: number;
  mensagem?: string;
  erros?: { campo: string; mensagem: string }[];
}

async function tratar<T>(r: Response): Promise<T> {
  const dados = await r.json().catch(() => null);
  if (!r.ok) throw { status: r.status, ...(dados ?? {}) } as ErroApi;
  return dados as T;
}

// 401 = sessão inválida/expirada. As telas usam isto para separar "não autorizado" (que segue
// o fluxo de login existente) de um erro genérico de rede/servidor. Uma falha de fetch (rede
// fora) rejeita com um TypeError, que não tem `status`, então cai no ramo de erro genérico.
export function ehNaoAutorizado(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as ErroApi).status === 401;
}

// Mensagem amigável de um erro de API/rede. Erros de rede não trazem `mensagem`, então usamos
// o texto padrão.
export function mensagemErro(e: unknown, padrao = 'Não foi possível carregar os dados. Verifique sua conexão e tente novamente.'): string {
  return (e as ErroApi)?.mensagem || padrao;
}

export async function apiGet<T = any>(caminho: string): Promise<T> {
  const r = await fetch(`${URL_API}${caminho}`, { credentials: 'include' });
  return tratar<T>(r);
}

export async function apiPost<T = any>(caminho: string, corpo: unknown): Promise<T> {
  const r = await fetch(`${URL_API}${caminho}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  return tratar<T>(r);
}

export async function apiPut<T = any>(caminho: string, corpo: unknown): Promise<T> {
  const r = await fetch(`${URL_API}${caminho}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  return tratar<T>(r);
}

export async function apiDelete<T = any>(caminho: string, corpo?: unknown): Promise<T> {
  const r = await fetch(`${URL_API}${caminho}`, {
    method: 'DELETE',
    credentials: 'include',
    ...(corpo !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) } : {}),
  });
  return tratar<T>(r);
}

// Upload de arquivo (multipart). Não setar Content-Type (o navegador cuida do boundary).
export async function apiUpload<T = any>(caminho: string, form: FormData): Promise<T> {
  const r = await fetch(`${URL_API}${caminho}`, { method: 'POST', credentials: 'include', body: form });
  return tratar<T>(r);
}
