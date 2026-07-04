// Validação do CONTEÚDO real de um upload pelos "magic bytes" (assinatura), não só pela
// extensão do nome. Barra o caso do arquivo com extensão permitida (.pdf/.docx) mas conteúdo
// incompatível. Puro e sem dependência — fácil de testar.
//
// Assinaturas usadas:
//  - PDF:  "%PDF"                        (25 50 44 46)
//  - DOCX: é um ZIP → "PK"               (50 4B)  — .docx/.xlsx/.pptx são contêineres ZIP
//  - DOC:  OLE2 (Office antigo)          (D0 CF 11 E0 A1 B1 1A E1)

function ehPdf(b: Buffer): boolean {
  return b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46; // %PDF
}

function ehZipPk(b: Buffer): boolean {
  // "PK" — cabeçalho de arquivo ZIP (docx moderno). Cobre PK\x03\x04, PK\x05\x06, PK\x07\x08.
  return b.length >= 2 && b[0] === 0x50 && b[1] === 0x4b;
}

const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
function ehOleDoc(b: Buffer): boolean {
  return b.length >= 8 && OLE.every((x, i) => b[i] === x); // .doc antigo (OLE2)
}

function ehPng(b: Buffer): boolean {
  return b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47; // \x89PNG
}
function ehJpeg(b: Buffer): boolean {
  return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff; // JPEG (SOI)
}

// Documentos de REFERÊNCIA (modelos da coordenação) aceitam PDF/Word/Excel/PPT/imagem. Aqui
// validamos que o conteúdo pertence a alguma dessas famílias (bloqueia executável renomeado):
//  - PDF (%PDF), Office moderno/zip (PK: docx/xlsx/pptx), Office antigo (OLE: doc/xls/ppt),
//  - imagens PNG e JPEG.
export function conteudoReferenciaPermitido(buffer: Buffer | undefined | null): boolean {
  if (!buffer || buffer.length === 0) return false;
  return ehPdf(buffer) || ehZipPk(buffer) || ehOleDoc(buffer) || ehPng(buffer) || ehJpeg(buffer);
}

// true se o conteúdo do buffer bate com ALGUM formato aceito pelas extensões `exts`
// (ex.: as `exts` de FORMATOS_ARQUIVO / formatoDoTipoDoc). Aceita PDF se `.pdf` estiver
// entre as extensões; aceita Word (docx-zip ou doc-ole) se `.doc`/`.docx` estiverem.
export function conteudoCompativel(buffer: Buffer | undefined | null, exts: readonly string[]): boolean {
  if (!buffer || buffer.length === 0) return false;
  const aceitaPdf = exts.includes('.pdf');
  const aceitaWord = exts.includes('.doc') || exts.includes('.docx');
  if (aceitaPdf && ehPdf(buffer)) return true;
  if (aceitaWord && (ehZipPk(buffer) || ehOleDoc(buffer))) return true;
  return false;
}
