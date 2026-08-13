import * as crypto from 'crypto';

// Criptografia do refresh token do Google Drive (AES-256-GCM).
//
// Chave PRÓPRIA e OBRIGATÓRIA: DRIVE_CRYPTO_SEGREDO. De propósito NÃO cai no JWT_SEGREDO
// nem na chave de e-mail — girar o segredo do JWT (que derruba sessões) ou o do SMTP não
// pode invalidar a conexão com o Drive, e um vazamento de uma chave não expõe as outras.
// Sem a variável o serviço falha alto na hora de usar, em vez de gravar com uma chave fraca.
const TAMANHO_MINIMO = 16;

export function chaveDrive(): Buffer {
  const seg = process.env.DRIVE_CRYPTO_SEGREDO ?? '';
  if (seg.trim().length < TAMANHO_MINIMO) {
    throw new Error(
      `DRIVE_CRYPTO_SEGREDO ausente ou curto demais (mínimo ${TAMANHO_MINIMO} caracteres). ` +
        'Defina a variável no .env da API para usar a integração com o Google Drive.',
    );
  }
  return crypto.createHash('sha256').update(seg).digest(); // 32 bytes
}

export function criptografarDrive(texto: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', chaveDrive(), iv);
  const enc = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

// Devolve undefined (em vez de estourar) quando o blob não abre: a chave pode ter mudado.
// Quem chama trata como "Drive desconectado" e pede para reconectar.
export function descriptografarDrive(blob: string): string | undefined {
  try {
    const [ivB, tagB, dataB] = blob.split(':');
    if (!ivB || !tagB || !dataB) return undefined;
    const decipher = crypto.createDecipheriv('aes-256-gcm', chaveDrive(), Buffer.from(ivB, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return undefined;
  }
}

// Caracteres de controle (0–31 e 127) filtrados por código, sem regex: evita depender de
// escapes literais no arquivo e deixa a intenção explícita.
function semControle(valor: string): string {
  return Array.from(valor)
    .filter((c) => {
      const codigo = c.charCodeAt(0);
      return codigo >= 32 && codigo !== 127;
    })
    .join('');
}

// Nome de pasta/arquivo seguro para o Drive: sem separadores de caminho nem caracteres de
// controle, sem espaços duplicados, com tamanho limitado. Vazio vira um rótulo genérico.
export function sanitizarNome(valor: string, padrao = 'sem-nome'): string {
  const limpo = semControle(valor ?? '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
    .trim();
  return limpo || padrao;
}
