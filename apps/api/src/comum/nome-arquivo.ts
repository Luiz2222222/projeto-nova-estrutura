// Corrige o nome de arquivo enviado por upload.
//
// O multer (Express) entrega `originalname` com cada byte interpretado como latin1.
// Quando o navegador envia o nome em UTF-8 (caso comum, com acentos), isso vira
// mojibake (ex.: "OrientaÃ§Ã£o.pdf"). Reinterpretar latin1->UTF-8 conserta.
//
// Porém aplicar isso SEMPRE corromperia nomes que já chegam corretos. Então só
// aceitamos a reinterpretação quando ela é REVERSÍVEL: os bytes latin1 do nome
// original têm que formar exatamente o UTF-8 do nome reinterpretado. Se não bater
// (UTF-8 inválido / nome já correto), devolvemos o nome como veio.
export function corrigirNomeArquivo(nome?: string | null): string {
  if (!nome) return '';
  const reinterpretado = Buffer.from(nome, 'latin1').toString('utf8');
  // Reversível ⇒ o original era de fato a forma latin1 de um UTF-8 válido.
  if (Buffer.from(reinterpretado, 'utf8').toString('latin1') === nome) {
    return reinterpretado;
  }
  return nome;
}
