import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { extname, join } from 'path';

// Área de arquivamento permanente: FORA de uploads/, porque o encerramento apaga os
// arquivos ativos de uploads/ e o arquivo histórico precisa sobreviver a isso.
export const PASTA_ARQUIVO = 'arquivo-permanente';

export interface DocumentoParaArquivar {
  id: string;
  tipo: string;
  nomeArquivo: string;
  versao: number;
  status: string;
  caminho: string; // caminho ATIVO (uploads/...)
}

export interface DocumentoArquivadoLocal {
  tipo: string;
  nomeArquivo: string;
  versao: number;
  status: string;
  caminho: string; // caminho relativo NA ÁREA DE ARQUIVAMENTO
  tamanho: number;
  sha256: string;
  ehFinal: boolean;
}

export class FalhaArquivoLocal extends Error {}

export async function sha256Arquivo(caminhoAbsoluto: string): Promise<string> {
  const conteudo = await fs.readFile(caminhoAbsoluto);
  return createHash('sha256').update(conteudo).digest('hex');
}

// Nome estável e legível dentro da pasta do TCC: TIPO-v<versao>.<ext>.
function nomeArquivado(doc: DocumentoParaArquivar): string {
  const ext = extname(doc.nomeArquivo || doc.caminho || '').toLowerCase();
  return `${doc.tipo}-v${doc.versao}${ext}`;
}

export function pastaDoTcc(semestre: string, tccId: string): string {
  // Semestre e id vêm do banco (formato controlado), mas ainda assim nada de separador.
  const s = semestre.replace(/[^\w.-]/g, '_');
  const t = tccId.replace(/[^\w.-]/g, '_');
  return join(PASTA_ARQUIVO, s, t);
}

// Copia os documentos do TCC para a área de arquivamento e devolve os metadados com hash.
// NÃO apaga nada: a remoção dos arquivos ativos só acontece depois da validação.
export async function copiarDocumentos(
  raiz: string,
  semestre: string,
  tccId: string,
  documentos: DocumentoParaArquivar[],
  idFinal: string | null,
): Promise<DocumentoArquivadoLocal[]> {
  const relPasta = pastaDoTcc(semestre, tccId);
  const absPasta = join(raiz, relPasta);
  await fs.mkdir(absPasta, { recursive: true });

  const saida: DocumentoArquivadoLocal[] = [];
  for (const doc of documentos) {
    const origem = join(raiz, doc.caminho);
    const nome = nomeArquivado(doc);
    const destinoRel = join(relPasta, nome);
    const destinoAbs = join(raiz, destinoRel);

    let hashOrigem: string;
    let tamanhoOrigem: number;
    try {
      const st = await fs.stat(origem);
      tamanhoOrigem = st.size;
      hashOrigem = await sha256Arquivo(origem);
    } catch (e) {
      throw new FalhaArquivoLocal(
        `documento "${doc.nomeArquivo}" (${doc.tipo} v${doc.versao}) não pôde ser lido em ${doc.caminho}: ${(e as Error).message}`,
      );
    }

    try {
      await fs.copyFile(origem, destinoAbs);
    } catch (e) {
      throw new FalhaArquivoLocal(`falha ao copiar "${doc.nomeArquivo}" para o arquivo: ${(e as Error).message}`);
    }

    // Confere a CÓPIA (não a origem): tamanho e conteúdo precisam bater exatamente.
    const stDestino = await fs.stat(destinoAbs).catch(() => null);
    if (!stDestino) throw new FalhaArquivoLocal(`a cópia de "${doc.nomeArquivo}" não foi encontrada após copiar`);
    if (stDestino.size !== tamanhoOrigem) {
      throw new FalhaArquivoLocal(
        `a cópia de "${doc.nomeArquivo}" ficou com ${stDestino.size} bytes, esperado ${tamanhoOrigem}`,
      );
    }
    const hashDestino = await sha256Arquivo(destinoAbs);
    if (hashDestino !== hashOrigem) {
      throw new FalhaArquivoLocal(`a cópia de "${doc.nomeArquivo}" não confere (sha256 diferente do original)`);
    }

    saida.push({
      tipo: doc.tipo,
      nomeArquivo: doc.nomeArquivo,
      versao: doc.versao,
      status: doc.status,
      caminho: destinoRel,
      tamanho: stDestino.size,
      sha256: hashDestino,
      ehFinal: doc.id === idFinal,
    });
  }
  return saida;
}

// Arquivo do snapshot com o que a revalidação precisa conferir depois.
export interface ArquivoSnapshot {
  caminho: string;
  tamanho: number;
  sha256: string;
  nomeArquivo: string;
}

// Grava dados.json e resumo.txt na pasta do TCC, confere que foram escritos e devolve os
// metadados — dados.json e resumo.txt entram na MESMA revalidação dos documentos.
export async function gravarSnapshot(
  raiz: string,
  semestre: string,
  tccId: string,
  dados: unknown,
  resumo: string,
): Promise<{ pasta: string; arquivos: ArquivoSnapshot[] }> {
  const relPasta = pastaDoTcc(semestre, tccId);
  const absPasta = join(raiz, relPasta);
  await fs.mkdir(absPasta, { recursive: true });

  const alvos: [string, string][] = [
    ['dados.json', JSON.stringify(dados, null, 2)],
    ['resumo.txt', resumo],
  ];
  const arquivos: ArquivoSnapshot[] = [];
  for (const [nome, conteudo] of alvos) {
    const abs = join(absPasta, nome);
    await fs.writeFile(abs, conteudo, 'utf8');
    const lido = await fs.readFile(abs, 'utf8').catch(() => null);
    if (lido !== conteudo) {
      throw new FalhaArquivoLocal(`${nome} do TCC ${tccId} não foi gravado corretamente no arquivo local`);
    }
    const st = await fs.stat(abs);
    arquivos.push({ caminho: join(relPasta, nome), tamanho: st.size, sha256: await sha256Arquivo(abs), nomeArquivo: nome });
  }
  return { pasta: relPasta, arquivos };
}

// REVALIDAÇÃO final, imediatamente antes de apagar: relê cada cópia do disco e confere
// tamanho e sha256. É esta checagem que autoriza a exclusão dos dados ativos.
export async function validarArquivados(
  raiz: string,
  documentos: { caminho: string; tamanho: number; sha256: string; nomeArquivo: string }[],
): Promise<void> {
  for (const d of documentos) {
    const abs = join(raiz, d.caminho);
    const st = await fs.stat(abs).catch(() => null);
    if (!st) throw new FalhaArquivoLocal(`arquivo arquivado sumiu: ${d.caminho}`);
    if (st.size !== d.tamanho) {
      throw new FalhaArquivoLocal(`arquivo arquivado ${d.caminho} está com ${st.size} bytes, esperado ${d.tamanho}`);
    }
    const hash = await sha256Arquivo(abs);
    if (hash !== d.sha256) {
      throw new FalhaArquivoLocal(`arquivo arquivado ${d.caminho} não confere (sha256 diferente do gravado)`);
    }
  }
}
