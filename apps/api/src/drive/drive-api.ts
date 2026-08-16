import * as crypto from 'crypto';

// Cliente mínimo do Google OAuth 2.0 + Drive v3 usando o fetch nativo do Node.
// Sem dependência nova de propósito: o `googleapis` traz dezenas de MB para o punhado de
// chamadas que usamos (criar pasta, subir/atualizar/apagar/baixar arquivo).
//
// ESCOPO: drive.file — o app só enxerga e mexe no que ELE MESMO criou. É por isso que a
// pasta raiz precisa ser criada pelo sistema: uma pasta pré-existente do Drive seria
// invisível para este escopo.
export const ESCOPO_DRIVE = 'https://www.googleapis.com/auth/drive.file';

const URL_AUTORIZACAO = 'https://accounts.google.com/o/oauth2/v2/auth';
const URL_TOKEN = 'https://oauth2.googleapis.com/token';
const URL_ARQUIVOS = 'https://www.googleapis.com/drive/v3/files';
const URL_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const URL_SOBRE = 'https://www.googleapis.com/drive/v3/about';

export const MIME_PASTA = 'application/vnd.google-apps.folder';

export class ErroDrive extends Error {
  constructor(
    mensagem: string,
    readonly status?: number,
    readonly permanente = false,
  ) {
    super(mensagem);
    this.name = 'ErroDrive';
  }
}

export interface CredenciaisApp {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

// Base pública ÚNICA: o mesmo valor vale para o redirect do OAuth e para a volta à tela de
// Planejamento — senão o Google recusaria o callback ou o usuário cairia em outro host.
// Precisa ser estável: em produção exige domínio fixo (a URL do Quick Tunnel muda a cada
// reinício do túnel).
export function basePublica(): string {
  return (process.env.DRIVE_REDIRECT_BASE || process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

// Lê as credenciais do ambiente. NUNCA vêm do banco nem do frontend. A chave de
// criptografia entra na conta porque sem ela o refresh token não pode ser guardado.
export function credenciaisDoAmbiente(): CredenciaisApp | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const cripto = process.env.DRIVE_CRYPTO_SEGREDO?.trim();
  if (!clientId || !clientSecret || !cripto) return null;
  return { clientId, clientSecret, redirectUri: `${basePublica()}/api/drive/callback` };
}

export function gerarState(): string {
  return crypto.randomBytes(24).toString('hex');
}

export function urlDeAutorizacao(cred: CredenciaisApp, state: string): string {
  const q = new URLSearchParams({
    client_id: cred.clientId,
    redirect_uri: cred.redirectUri,
    response_type: 'code',
    scope: ESCOPO_DRIVE,
    // offline + consent: garante que o Google devolva refresh_token (sem isso, uma
    // reautorização da mesma conta volta só com access_token e a conexão morre em 1h).
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${URL_AUTORIZACAO}?${q.toString()}`;
}

async function lerErro(r: Response): Promise<string> {
  const txto = await r.text().catch(() => '');
  try {
    const j = JSON.parse(txto);
    return j?.error?.message || j?.error_description || j?.error || txto.slice(0, 300);
  } catch {
    return txto.slice(0, 300);
  }
}

// 4xx (fora 408/429) é erro PERMANENTE: repetir não resolve (credencial errada, permissão,
// arquivo inexistente). 5xx/rede/429 é temporário e vale retry.
function ehPermanente(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

async function pedir(url: string, init: RequestInit): Promise<Response> {
  let r: Response;
  try {
    r = await fetch(url, init);
  } catch (e) {
    throw new ErroDrive(`Falha de rede ao falar com o Google: ${(e as Error).message}`, undefined, false);
  }
  if (!r.ok) throw new ErroDrive(await lerErro(r), r.status, ehPermanente(r.status));
  return r;
}

export async function trocarCodigoPorTokens(cred: CredenciaisApp, codigo: string) {
  const r = await pedir(URL_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: codigo,
      client_id: cred.clientId,
      client_secret: cred.clientSecret,
      redirect_uri: cred.redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  });
  const j: any = await r.json();
  if (!j.refresh_token) {
    throw new ErroDrive(
      'O Google não devolveu refresh token. Remova o acesso do app na conta Google e autorize de novo.',
      undefined,
      true,
    );
  }
  return { refreshToken: j.refresh_token as string, accessToken: j.access_token as string };
}

export async function renovarAccessToken(cred: CredenciaisApp, refreshToken: string): Promise<string> {
  const r = await pedir(URL_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: cred.clientId,
      client_secret: cred.clientSecret,
      grant_type: 'refresh_token',
    }).toString(),
  });
  const j: any = await r.json();
  return j.access_token as string;
}

// E-mail da conta autorizada via Drive `about` — funciona com drive.file e evita pedir o
// escopo extra de perfil só para mostrar a conta na tela.
export async function emailDaConta(accessToken: string): Promise<string | null> {
  const r = await pedir(`${URL_SOBRE}?fields=user(emailAddress)`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const j: any = await r.json();
  return j?.user?.emailAddress ?? null;
}

// Procura um item pelo nome dentro de um pai. Com drive.file a busca só devolve o que o
// próprio app criou — que é exatamente o universo que a gente administra.
export async function buscarPorNome(
  accessToken: string,
  nome: string,
  paiId: string,
  apenasPasta = false,
): Promise<string | null> {
  const filtros = [
    `name = '${nome.replace(/'/g, "\\'")}'`,
    `'${paiId}' in parents`,
    'trashed = false',
    ...(apenasPasta ? [`mimeType = '${MIME_PASTA}'`] : []),
  ].join(' and ');
  const q = new URLSearchParams({ q: filtros, fields: 'files(id,name)', pageSize: '10' });
  const r = await pedir(`${URL_ARQUIVOS}?${q.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const j: any = await r.json();
  return j?.files?.[0]?.id ?? null;
}

// `appProperties` = metadados PRIVADOS do app (invisíveis para o usuário no Drive e para
// outros apps). Servem de identidade durável: se a API cair depois do Google criar a pasta e
// antes de gravar o mapeamento no banco, a pasta é reencontrada por aqui em vez de uma
// segunda ser criada.
export async function criarPasta(
  accessToken: string,
  nome: string,
  paiId?: string,
  appProperties?: Record<string, string>,
): Promise<string> {
  const r = await pedir(`${URL_ARQUIVOS}?fields=id`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: nome,
      mimeType: MIME_PASTA,
      ...(paiId ? { parents: [paiId] } : {}),
      ...(appProperties ? { appProperties } : {}),
    }),
  });
  return ((await r.json()) as any).id as string;
}

// Procura uma PASTA pela marca privada do app. É o que torna a criação idempotente mesmo
// atravessando um reinício da API. Devolve também o nome para o mapeamento no banco.
export async function buscarPastaPorMarca(
  accessToken: string,
  chave: string,
  valor: string,
  paiId?: string,
): Promise<{ id: string; nome: string } | null> {
  const filtros = [
    `appProperties has { key='${chave.replace(/'/g, "\\'")}' and value='${valor.replace(/'/g, "\\'")}' }`,
    `mimeType = '${MIME_PASTA}'`,
    'trashed = false',
    ...(paiId ? [`'${paiId}' in parents`] : []),
  ].join(' and ');
  const q = new URLSearchParams({ q: filtros, fields: 'files(id,name)', pageSize: '10' });
  const r = await pedir(`${URL_ARQUIVOS}?${q.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const j: any = await r.json();
  const f = j?.files?.[0];
  return f ? { id: f.id as string, nome: (f.name as string) ?? '' } : null;
}

// Manda para a LIXEIRA (recuperável), não apaga. Usado quando uma corrida deixou uma pasta
// sobrando: preferimos algo reversível a uma exclusão definitiva.
export async function moverParaLixeira(accessToken: string, driveId: string): Promise<void> {
  await pedir(`${URL_ARQUIVOS}/${encodeURIComponent(driveId)}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  });
}

// Metadados de uma pasta/arquivo — usado para conferir antes de mexer em algo já existente.
// PROPAGA o erro de propósito: quem confere antes de mover algo para a lixeira precisa
// distinguir "não existe mais" (404, permanente) de "não deu para perguntar agora" (rede/5xx,
// que merece nova tentativa). Engolir tudo em `null` misturaria os dois casos.
export interface MetadadosDrive {
  id: string;
  nome: string;
  mimeType: string;
  trashed: boolean;
  pais: string[];
  marcas: Record<string, string>;
  tamanho: number | null;
  md5: string | null;
}

export async function metadadosArquivo(accessToken: string, driveId: string): Promise<MetadadosDrive> {
  const r = await pedir(
    `${URL_ARQUIVOS}/${encodeURIComponent(driveId)}?fields=id,name,mimeType,trashed,parents,appProperties,size,md5Checksum`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const j: any = await r.json();
  return {
    id: j.id,
    nome: j.name ?? '',
    mimeType: j.mimeType ?? '',
    trashed: j.trashed === true,
    pais: j.parents ?? [],
    marcas: j.appProperties ?? {},
    tamanho: j.size != null ? Number(j.size) : null,
    md5: j.md5Checksum ?? null,
  };
}

// Resultado de "esse ID ainda serve?". Três estados, nunca dois:
//   ACESSIVEL — dá para usar;
//   AUSENTE   — o Google CONFIRMOU que não existe / não é visível para a conta de agora
//               (404/403) ou está na lixeira;
//   (exceção) — não deu para perguntar (rede, timeout, 429, 5xx). Quem chama NÃO pode
//               concluir nada daqui: criar uma cópia nova por causa de uma falha passageira
//               é justamente o erro que essa separação existe para impedir.
export type EstadoRemoto = { estado: 'ACESSIVEL'; meta: MetadadosDrive } | { estado: 'AUSENTE'; motivo: string };

export async function conferirRemoto(accessToken: string, driveId: string): Promise<EstadoRemoto> {
  if (!driveId) return { estado: 'AUSENTE', motivo: 'sem id' };
  try {
    const meta = await metadadosArquivo(accessToken, driveId);
    if (meta.trashed) return { estado: 'AUSENTE', motivo: 'está na lixeira' };
    return { estado: 'ACESSIVEL', meta };
  } catch (e) {
    const erro = e as ErroDrive;
    // 404 = não existe; 403 = existe mas não é desta conta/app. Os dois são resposta
    // DEFINITIVA do Google. Qualquer outro status volta como exceção.
    if (erro.status === 404) return { estado: 'AUSENTE', motivo: 'não encontrado' };
    if (erro.status === 403) return { estado: 'AUSENTE', motivo: 'sem acesso com a conta atual' };
    throw erro;
  }
}

// Renomeia mantendo o MESMO id — o nome é rótulo, a identidade é o id.
export async function renomearArquivo(accessToken: string, driveId: string, nome: string): Promise<void> {
  await pedir(`${URL_ARQUIVOS}/${encodeURIComponent(driveId)}?fields=id`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nome }),
  });
}

// Move (não copia) para outro pai, também mantendo o id.
export async function moverParaPasta(
  accessToken: string,
  driveId: string,
  novoPaiId: string,
  paisAntigos: string[],
): Promise<void> {
  const q = new URLSearchParams({ addParents: novoPaiId, fields: 'id' });
  const remover = paisAntigos.filter((p) => p !== novoPaiId);
  if (remover.length) q.set('removeParents', remover.join(','));
  await pedir(`${URL_ARQUIVOS}/${encodeURIComponent(driveId)}?${q.toString()}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
}

// Lista os filhos NÃO na lixeira de uma pasta (para provar que ela está vazia).
export async function listarFilhos(
  accessToken: string,
  pastaId: string,
): Promise<{ id: string; nome: string }[]> {
  const q = new URLSearchParams({
    q: `'${pastaId}' in parents and trashed = false`,
    fields: 'files(id,name)',
    pageSize: '100',
  });
  const r = await pedir(`${URL_ARQUIVOS}?${q.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const j: any = await r.json();
  return (j?.files ?? []).map((f: any) => ({ id: f.id as string, nome: (f.name as string) ?? '' }));
}

// Upload multipart montado na mão (metadados + conteúdo em uma requisição só).
export async function enviarArquivo(
  accessToken: string,
  dados: { nome: string; mimeType: string; conteudo: Buffer; paiId: string },
): Promise<string> {
  const limite = `limite-${crypto.randomBytes(12).toString('hex')}`;
  const meta = JSON.stringify({ name: dados.nome, parents: [dados.paiId] });
  const corpo = Buffer.concat([
    Buffer.from(`--${limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`),
    Buffer.from(`--${limite}\r\nContent-Type: ${dados.mimeType}\r\n\r\n`),
    dados.conteudo,
    Buffer.from(`\r\n--${limite}--\r\n`),
  ]);
  const r = await pedir(`${URL_UPLOAD}?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${limite}`,
    },
    body: corpo,
  });
  return ((await r.json()) as any).id as string;
}

// Substitui o CONTEÚDO de um arquivo existente (usado em dados.json/resumo.txt, que são
// reescritos a cada alteração em vez de virar dezenas de cópias).
export async function atualizarConteudo(
  accessToken: string,
  driveId: string,
  mimeType: string,
  conteudo: Buffer,
): Promise<void> {
  await pedir(`${URL_UPLOAD}/${encodeURIComponent(driveId)}?uploadType=media`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': mimeType },
    body: conteudo,
  });
}

export async function apagarArquivo(accessToken: string, driveId: string): Promise<void> {
  await pedir(`${URL_ARQUIVOS}/${encodeURIComponent(driveId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function baixarArquivo(accessToken: string, driveId: string): Promise<Buffer> {
  const r = await pedir(`${URL_ARQUIVOS}/${encodeURIComponent(driveId)}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return Buffer.from(await r.arrayBuffer());
}

// Confere se o arquivo ainda existe e não está na lixeira — usado antes de podar os
// arquivos intermediários no encerramento do período.
export async function arquivoValido(accessToken: string, driveId: string): Promise<boolean> {
  try {
    const r = await pedir(`${URL_ARQUIVOS}/${encodeURIComponent(driveId)}?fields=id,trashed,size`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const j: any = await r.json();
    return !!j?.id && j.trashed !== true;
  } catch {
    return false;
  }
}
