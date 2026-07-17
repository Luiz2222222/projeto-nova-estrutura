// Regras PURAS do agendamento da defesa (Fase II), compartilhadas pelo formulário do
// orientador e pelos cards. Ficam aqui (e não dentro dos componentes) para serem
// testáveis sem navegador.
//
// O formulário edita SEMPRE no fuso oficial do curso (America/Fortaleza, UTC-3 fixo,
// sem horário de verão) — independente do fuso do computador de quem estiver editando.
// Abrir e salvar sem mexer em nada preserva exatamente o mesmo instante.
export const OFFSET_FORTALEZA = '-03:00';

// ISO (UTC) -> campos do formulário (yyyy-mm-dd e HH:mm) no fuso de Fortaleza.
export function partesDefesaFortaleza(iso: string): { data: string; hora: string } {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Fortaleza', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(iso));
  const p = (t: string) => partes.find((x) => x.type === t)?.value ?? '';
  return { data: `${p('year')}-${p('month')}-${p('day')}`, hora: `${p('hour')}:${p('minute')}` };
}

// Campos do formulário (interpretados como horário de Fortaleza) -> instante real.
export function montarInstanteDefesa(data: string, hora: string): Date {
  return new Date(`${data}T${hora}:00${OFFSET_FORTALEZA}`);
}

// Local que começa com https:// pode virar link clicável seguro; qualquer outra coisa
// (texto, http://, javascript: etc.) é exibida como TEXTO puro — nunca HTML.
export function ehLinkHttpsSeguro(local?: string | null): boolean {
  return /^https:\/\//i.test(String(local ?? '').trim());
}
