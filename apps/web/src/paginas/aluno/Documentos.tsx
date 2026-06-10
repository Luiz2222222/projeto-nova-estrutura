import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, URL_API } from '../../api';
import { ROTULO_TIPO_DOC } from '../../utils/fases';

function formatarTamanho(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function Documentos() {
  const navegar = useNavigate();
  const [tcc, setTcc] = useState<any | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    apiGet('/tccs/meu')
      .then(setTcc)
      .catch(() => setTcc(null))
      .finally(() => setCarregando(false));
  }, []);

  if (carregando) return <p className="nota-vazio">Carregando…</p>;

  return (
    <>
      <h1>Documentos</h1>
      <p className="legenda">Arquivos enviados ao longo do seu TCC.</p>

      {!tcc ? (
        <section className="cartao-secao bloco" style={{ textAlign: 'center' }}>
          <p className="nota-vazio">Você ainda não abriu seu TCC, então não há documentos.</p>
          <button className="botao" style={{ marginTop: 16 }} onClick={() => navegar('/aluno/abrir')}>
            Abrir meu TCC
          </button>
        </section>
      ) : (
        <section className="cartao-secao bloco">
          <h2>Enviados</h2>
          {tcc.documentos?.length ? (
            <ul className="lista-arquivos">
              {tcc.documentos.map((d: any) => (
                <li key={d.id} className="item-arquivo">
                  <div className="item-arquivo-info">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    <div>
                      <span className="nome">{ROTULO_TIPO_DOC[d.tipo] ?? d.tipo}</span>
                      <span className="meta">
                        {d.nomeArquivo}
                        {d.tamanho ? ` · ${formatarTamanho(d.tamanho)}` : ''}
                      </span>
                    </div>
                  </div>
                  <a className="botao botao-secundario" href={`${URL_API}/tccs/documentos/${d.id}/baixar`} target="_blank" rel="noreferrer">
                    Baixar
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="nota-vazio">Nenhum documento enviado.</p>
          )}
        </section>
      )}
    </>
  );
}
