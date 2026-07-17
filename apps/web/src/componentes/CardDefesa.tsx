import { formatarDefesa } from '../utils/fases';

// Informações da defesa agendada (Fase II), reutilizadas em todas as visões (aluno,
// orientador, coorientador, coordenador e banca). Local e comentário NUNCA viram HTML:
// texto é renderizado como texto; só um local começando com https:// vira link seguro.
// Formato: "Data e hora: …" e "Local: …" na mesma linha; comentário com rótulo em cima.
export function CardDefesa({ tcc }: { tcc: any }) {
  if (!tcc?.defesaAgendadaPara) return null;
  const local = String(tcc.defesaLocal ?? '').trim();
  const ehLink = /^https:\/\//i.test(local);
  return (
    <div className="defesa-info">
      <div className="defesa-linha-inline">
        <span className="defesa-rotulo">Data e hora:</span>
        <strong className="defesa-valor">{formatarDefesa(tcc.defesaAgendadaPara)}</strong>
      </div>
      <div className="defesa-linha-inline">
        <span className="defesa-rotulo">Local:</span>
        {ehLink ? (
          <a className="defesa-valor" href={local} target="_blank" rel="noopener noreferrer">{local}</a>
        ) : (
          <strong className="defesa-valor">{local || '—'}</strong>
        )}
      </div>
      {tcc.defesaComentario && (
        <div className="defesa-linha">
          <span className="defesa-rotulo">Comentário</span>
          <span className="defesa-valor">{tcc.defesaComentario}</span>
        </div>
      )}
    </div>
  );
}
