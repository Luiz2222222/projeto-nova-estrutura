import { describe, it, expect } from 'vitest';
import { conteudoCompativel, conteudoReferenciaPermitido } from './assinatura-arquivo';

// Buffers com as assinaturas reais de cada formato.
const PDF = Buffer.from('%PDF-1.7\n...resto...');
const DOCX = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]); // "PK.." (zip/docx)
const DOC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00]); // OLE (.doc)
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const FALSO = Buffer.from('isto e so texto, nao e um arquivo real');

const PDF_EXTS = ['.pdf'] as const;
const WORD_EXTS = ['.doc', '.docx'] as const;
const PDF_WORD_EXTS = ['.pdf', '.doc', '.docx'] as const;

describe('conteudoCompativel (assinatura x extensões aceitas)', () => {
  it('PDF válido passa em formato PDF', () => {
    expect(conteudoCompativel(PDF, PDF_EXTS)).toBe(true);
  });

  it('rejeita .pdf falso (conteúdo não é %PDF)', () => {
    expect(conteudoCompativel(FALSO, PDF_EXTS)).toBe(false);
  });

  it('DOCX (PK/zip) e DOC (OLE) passam em formato WORD', () => {
    expect(conteudoCompativel(DOCX, WORD_EXTS)).toBe(true);
    expect(conteudoCompativel(DOC, WORD_EXTS)).toBe(true);
  });

  it('rejeita .docx falso (não é PK nem OLE)', () => {
    expect(conteudoCompativel(FALSO, WORD_EXTS)).toBe(false);
  });

  it('PDF não passa quando só Word é aceito, e vice-versa', () => {
    expect(conteudoCompativel(PDF, WORD_EXTS)).toBe(false);
    expect(conteudoCompativel(DOCX, PDF_EXTS)).toBe(false);
  });

  it('formato PDF_WORD aceita tanto PDF quanto Word', () => {
    expect(conteudoCompativel(PDF, PDF_WORD_EXTS)).toBe(true);
    expect(conteudoCompativel(DOCX, PDF_WORD_EXTS)).toBe(true);
    expect(conteudoCompativel(FALSO, PDF_WORD_EXTS)).toBe(false);
  });

  it('buffer vazio/ausente é rejeitado', () => {
    expect(conteudoCompativel(Buffer.alloc(0), PDF_EXTS)).toBe(false);
    expect(conteudoCompativel(undefined, PDF_EXTS)).toBe(false);
  });
});

describe('conteudoReferenciaPermitido (famílias aceitas em documentos de referência)', () => {
  it('aceita PDF, DOCX, DOC e imagem', () => {
    expect(conteudoReferenciaPermitido(PDF)).toBe(true);
    expect(conteudoReferenciaPermitido(DOCX)).toBe(true);
    expect(conteudoReferenciaPermitido(DOC)).toBe(true);
    expect(conteudoReferenciaPermitido(PNG)).toBe(true);
  });

  it('rejeita conteúdo que não é de nenhuma família permitida', () => {
    expect(conteudoReferenciaPermitido(FALSO)).toBe(false);
    expect(conteudoReferenciaPermitido(undefined)).toBe(false);
  });
});
