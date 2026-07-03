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
