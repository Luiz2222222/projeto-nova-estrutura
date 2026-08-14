// Testes REAIS de disco: copiam arquivos de verdade para uma pasta temporária e conferem
// tamanho e sha256. É a garantia que autoriza o encerramento a apagar os dados ativos.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  FalhaArquivoLocal,
  copiarDocumentos,
  gravarSnapshot,
  pastaDoTcc,
  sha256Arquivo,
  validarArquivados,
} from './arquivo-local';

let raiz: string;

beforeEach(async () => {
  raiz = await fs.mkdtemp(join(tmpdir(), 'tcc-arquivo-'));
  await fs.mkdir(join(raiz, 'uploads'), { recursive: true });
});
afterEach(async () => {
  await fs.rm(raiz, { recursive: true, force: true });
});

async function criarUpload(nome: string, conteudo: string) {
  const rel = join('uploads', nome);
  await fs.writeFile(join(raiz, rel), conteudo);
  return rel.replace(/\\/g, '/');
}

const doc = (over: Record<string, unknown> = {}) => ({
  id: 'd1',
  tipo: 'VERSAO_FINAL',
  nomeArquivo: 'monografia final.pdf',
  versao: 2,
  status: 'APROVADO',
  caminho: 'uploads/final.pdf',
  ...over,
});

describe('Cópia dos documentos para o arquivo permanente', () => {
  it('copia o arquivo e devolve tamanho e sha256 da CÓPIA', async () => {
    const caminho = await criarUpload('final.pdf', 'conteudo do pdf final');
    const r = await copiarDocumentos(raiz, '2026.2', 't1', [doc({ caminho })], 'd1');

    expect(r).toHaveLength(1);
    expect(r[0].ehFinal).toBe(true);
    expect(r[0].tamanho).toBe('conteudo do pdf final'.length);
    expect(r[0].sha256).toBe(await sha256Arquivo(join(raiz, caminho)));

    // O arquivo existe MESMO na área de arquivamento, com o conteúdo certo.
    const copiado = await fs.readFile(join(raiz, r[0].caminho), 'utf8');
    expect(copiado).toBe('conteudo do pdf final');
  });

  it('a cópia fica FORA de uploads/ (sobrevive à limpeza do encerramento)', async () => {
    const caminho = await criarUpload('final.pdf', 'x');
    const r = await copiarDocumentos(raiz, '2026.2', 't1', [doc({ caminho })], 'd1');

    expect(r[0].caminho.replace(/\\/g, '/')).toContain('arquivo-permanente/2026.2/t1');
    expect(r[0].caminho).not.toContain('uploads');

    // Apagar uploads/ não afeta o arquivo.
    await fs.rm(join(raiz, 'uploads'), { recursive: true, force: true });
    await expect(fs.readFile(join(raiz, r[0].caminho), 'utf8')).resolves.toBe('x');
  });

  it('preserva TODAS as versões, sem sobrescrever', async () => {
    const c1 = await criarUpload('m1.docx', 'versao um');
    const c2 = await criarUpload('m2.docx', 'versao dois');
    const r = await copiarDocumentos(
      raiz,
      '2026.2',
      't1',
      [
        doc({ id: 'a', tipo: 'MONOGRAFIA', versao: 1, caminho: c1, nomeArquivo: 'm1.docx' }),
        doc({ id: 'b', tipo: 'MONOGRAFIA', versao: 2, caminho: c2, nomeArquivo: 'm2.docx' }),
      ],
      'b',
    );

    expect(r).toHaveLength(2);
    expect(new Set(r.map((x) => x.caminho)).size).toBe(2);
    await expect(fs.readFile(join(raiz, r[0].caminho), 'utf8')).resolves.toBe('versao um');
    await expect(fs.readFile(join(raiz, r[1].caminho), 'utf8')).resolves.toBe('versao dois');
    expect(r.filter((x) => x.ehFinal)).toHaveLength(1);
  });

  it('documento com arquivo faltando no disco ABORTA a cópia', async () => {
    await expect(
      copiarDocumentos(raiz, '2026.2', 't1', [doc({ caminho: 'uploads/nao-existe.pdf' })], 'd1'),
    ).rejects.toBeInstanceOf(FalhaArquivoLocal);
  });

  it('a mensagem de erro identifica o documento problemático', async () => {
    await expect(
      copiarDocumentos(raiz, '2026.2', 't1', [doc({ caminho: 'uploads/sumiu.pdf' })], 'd1'),
    ).rejects.toThrow(/monografia final\.pdf/);
  });
});

describe('Snapshot local (dados.json + resumo.txt)', () => {
  it('grava e relê os dois arquivos', async () => {
    const { pasta } = await gravarSnapshot(raiz, '2026.2', 't1', { tcc: { titulo: 'T' } }, 'resumo legível');

    expect(pasta.replace(/\\/g, '/')).toBe('arquivo-permanente/2026.2/t1');
    const json = JSON.parse(await fs.readFile(join(raiz, pasta, 'dados.json'), 'utf8'));
    expect(json.tcc.titulo).toBe('T');
    await expect(fs.readFile(join(raiz, pasta, 'resumo.txt'), 'utf8')).resolves.toBe('resumo legível');
  });

  it('pastaDoTcc não deixa separador de caminho passar', () => {
    expect(pastaDoTcc('../fora', 'x/y').replace(/\\/g, '/')).toBe('arquivo-permanente/.._fora/x_y');
  });
});

describe('Validação final antes de apagar', () => {
  it('passa quando a cópia está íntegra', async () => {
    const caminho = await criarUpload('final.pdf', 'conteudo integro');
    const [c] = await copiarDocumentos(raiz, '2026.2', 't1', [doc({ caminho })], 'd1');

    await expect(validarArquivados(raiz, [c])).resolves.toBeUndefined();
  });

  it('ACUSA quando o arquivo arquivado sumiu', async () => {
    const caminho = await criarUpload('final.pdf', 'conteudo');
    const [c] = await copiarDocumentos(raiz, '2026.2', 't1', [doc({ caminho })], 'd1');
    await fs.rm(join(raiz, c.caminho));

    await expect(validarArquivados(raiz, [c])).rejects.toThrow(/sumiu/);
  });

  it('ACUSA quando o conteúdo foi corrompido (sha256 diferente)', async () => {
    const caminho = await criarUpload('final.pdf', 'conteudo bom');
    const [c] = await copiarDocumentos(raiz, '2026.2', 't1', [doc({ caminho })], 'd1');
    await fs.writeFile(join(raiz, c.caminho), 'conteudo RUIM'); // mesmo tamanho? não importa

    await expect(validarArquivados(raiz, [c])).rejects.toThrow(/não confere|bytes/);
  });

  it('ACUSA quando o tamanho não bate', async () => {
    const caminho = await criarUpload('final.pdf', 'conteudo');
    const [c] = await copiarDocumentos(raiz, '2026.2', 't1', [doc({ caminho })], 'd1');
    await fs.writeFile(join(raiz, c.caminho), 'conteudo muito maior do que o original');

    await expect(validarArquivados(raiz, [c])).rejects.toThrow(/bytes/);
  });
});
