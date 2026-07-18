// Busca "amigável" de nomes: ignora maiúsculas/minúsculas e acentos
// ("carlos" encontra "Cárlos", "JOÃO" encontra "joao").
export function normalizarBusca(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export function contemBusca(texto: string, termo: string): boolean {
  return normalizarBusca(texto).includes(normalizarBusca(termo));
}
