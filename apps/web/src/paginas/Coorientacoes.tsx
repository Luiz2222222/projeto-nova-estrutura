import { useEffect, useState } from 'react';
import { apiGet, URL_API } from '../api';
import { ROTULO_FASE } from '../utils/fases';

const icoBaixar = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" />
  </svg>
);

// Coorientações: TCCs em que o usuário (professor ou avaliador) é coorientador.
// Visão de leitura — o coorientador não toma as ações do orientador.

type Doc = { id: string; tipo: string; status: string; versao: number; nomeArquivo: string };

function ultima(docs: Doc[] = [], tipo: string): Doc | null {
  const m = docs.filter((d) => d.tipo === tipo).sort((a, b) => b.versao - a.versao);
  return m[0] ?? null;
}

export function Coorientacoes() {
  const [tccs, setTccs] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    apiGet('/tccs/coorientando')
      .then(setTccs)
      .catch(() => setTccs([]))
      .finally(() => setCarregando(false));
  }, []);

  if (carregando) return <p className="nota-vazio">Carregando…</p>;

  return (
    <>
      <h1>Coorientações</h1>
      <p className="legenda">TCCs em que você participa como coorientador.</p>

      {tccs.length === 0 ? (
        <section className="cartao-secao bloco">
          <p className="nota-vazio">Você ainda não é coorientador de nenhum TCC.</p>
        </section>
      ) : (
        <div className="lista bloco">
          {tccs.map((t) => {
            const mono = ultima(t.documentos, 'MONOGRAFIA');
            const vf = ultima(t.documentos, 'VERSAO_FINAL');
            return (
              <section key={t.id} className="cartao-secao">
                <div className="aviso-cabecalho">
                  <h2>{t.titulo}</h2>
                  <span className="badge-papel">{ROTULO_FASE[t.faseAtual] ?? t.faseAtual}</span>
                </div>
                <p className="nota-vazio" style={{ margin: '4px 0 16px' }}>
                  {t.aluno?.nomeCompleto}
                  {t.orientador?.nomeCompleto && (
                    <> · Orientador: {t.orientador.tratamento ? `${t.orientador.tratamento} ` : ''}{t.orientador.nomeCompleto}</>
                  )}
                </p>

                {(mono || vf) ? (
                  <div className="trilha-bloco">
                    <div className="trilha-titulo"><strong>Documentos</strong></div>
                    {[mono, vf].filter(Boolean).map((d: any) => (
                      <div key={d.id} className="item-arquivo">
                        <div className="item-arquivo-info">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                          </svg>
                          <div>
                            <span className="nome">{d.nomeArquivo}</span>
                            <span className="meta">{d.tipo === 'MONOGRAFIA' ? 'Monografia' : 'Versão final'} · versão {d.versao}</span>
                          </div>
                        </div>
                        <span className="acoes-doc">
                          <a className="botao-icone" title="Baixar" href={`${URL_API}/tccs/documentos/${d.id}/baixar`} target="_blank" rel="noreferrer">{icoBaixar}</a>
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="nota-vazio">Sem documentos enviados ainda.</p>
                )}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
