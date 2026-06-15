// Prazo encerrado: existe a data e ela já passou (compara só a data; o próprio
// dia do prazo ainda conta como dentro do prazo). Espelha o `prazoExpirado` do antigo.
export function prazoEncerrado(iso?: string | null): boolean {
  if (!iso) return false;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const d = new Date(iso);
  const dia = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return hoje > dia;
}
