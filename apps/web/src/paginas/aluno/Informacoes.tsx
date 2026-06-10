// Aba "Informações" do aluno (espelha o projeto antigo): Datas importantes (calendário
// definido pela coordenação) + Documentos de referência (modelos enviados pela coordenação).
import { useEffect, useState } from 'react';
import { apiGet, URL_API } from '../../api';
import { MARCOS_CALENDARIO, ROTULO_MARCO, DESC_MARCO } from '@tcc/compartilhado';

function formatarData(valor: string | null | undefined): string {
  if (!valor) return 'A definir';
  // Datas do calendário são guardadas em UTC (meia-noite); exibe em UTC pra não "voltar" um dia.
  return new Date(valor).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
function formatarTamanho(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const IconeCalendario = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <path d="M16 2v4M8 2v4M3 10h18" />
  </svg>
);

export function Informacoes() {
  const [calendario, setCalendario] = useState<any | null>(null);
  const [modelos, setModelos] = useState<any[]>([]);

  useEffect(() => {
    apiGet('/calendario').then(setCalendario).catch(() => setCalendario(null));
    apiGet('/documentos-referencia').then(setModelos).catch(() => setModelos([]));
  }, []);

  return (
    <>
      <h1>Informações</h1>
      <p className="legenda">Datas importantes do semestre e documentos de referência.</p>

      <section className="cartao-secao bloco">
        <h2>Datas importantes</h2>
        <p className="legenda" style={{ marginBottom: 18 }}>
          As datas de cada etapa são definidas pela coordenação a cada semestre.
        </p>
        <div className="marcos-grid">
          {MARCOS_CALENDARIO.map((m) => {
            const data = calendario?.[m];
            return (
              <div key={m} className="marco-card">
                <span className="marco-icone">{IconeCalendario}</span>
                <div className="marco-texto">
                  <span className="marco-titulo">{ROTULO_MARCO[m]}</span>
                  <span className="marco-desc">{DESC_MARCO[m]}</span>
                </div>
                <span className={`marco-data${data ? ' definida' : ''}`}>{formatarData(data)}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="cartao-secao bloco">
        <h2>Documentos de referência</h2>
        <p className="legenda" style={{ marginBottom: 18 }}>
          Baixe os modelos e orientações disponibilizados pela coordenação.
        </p>
        {modelos.length ? (
          <ul className="lista-arquivos">
            {modelos.map((d) => (
              <li key={d.id} className="item-arquivo">
                <div className="item-arquivo-info">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  <div>
                    <span className="nome">{d.titulo}</span>
                    <span className="meta">
                      {d.nomeArquivo}
                      {d.tamanho ? ` · ${formatarTamanho(d.tamanho)}` : ''}
                    </span>
                  </div>
                </div>
                <a className="botao botao-secundario" href={`${URL_API}/documentos-referencia/${d.id}/baixar`} target="_blank" rel="noreferrer">
                  Baixar
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <div className="estado-vazio" style={{ padding: '12px 0' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <p className="nota-vazio" style={{ marginTop: 8 }}>Nenhum documento disponível no momento.</p>
          </div>
        )}
      </section>
    </>
  );
}
