import { useEffect, useState } from 'react';
import { apiGet } from '../../api';

function formatarData(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

export function MuralAvisos() {
  const [avisos, setAvisos] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    apiGet('/avisos')
      .then(setAvisos)
      .catch(() => setAvisos([]))
      .finally(() => setCarregando(false));
  }, []);

  return (
    <>
      <h1>Mural de avisos</h1>
      <p className="legenda">Comunicados e prazos publicados pela coordenação.</p>

      {carregando ? (
        <p className="nota-vazio">Carregando…</p>
      ) : avisos.length === 0 ? (
        <section className="cartao-secao bloco estado-vazio">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 11v2a1 1 0 0 0 1 1h2l4 4V6L6 10H4a1 1 0 0 0-1 1zM15 8a4 4 0 0 1 0 8" />
          </svg>
          <h2>Nenhum aviso por enquanto</h2>
          <p className="nota-vazio">Quando a coordenação publicar comunicados, eles aparecerão aqui.</p>
        </section>
      ) : (
        <div className="lista bloco">
          {avisos.map((a) => (
            <article key={a.id} className="cartao-secao aviso-item">
              <div className="aviso-cabecalho">
                <h3>{a.titulo}</h3>
              </div>
              <p className="aviso-conteudo">{a.conteudo}</p>
              <p className="aviso-meta">
                {a.autorNome ? `${a.autorNome} · ` : ''}
                {formatarData(a.criadoEm)}
              </p>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
