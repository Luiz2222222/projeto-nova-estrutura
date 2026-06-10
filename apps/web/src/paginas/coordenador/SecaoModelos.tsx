import { useEffect, useState } from 'react';
import { apiGet, apiDelete, apiUpload, URL_API, type ErroApi } from '../../api';
import { CampoArquivo } from '../../componentes/CampoArquivo';

function formatarTamanho(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Seção do Planejamento: documentos de referência (modelos para os alunos baixarem).
export function SecaoModelos() {
  const [docs, setDocs] = useState<any[]>([]);
  const [titulo, setTitulo] = useState('');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');

  function carregar() {
    apiGet('/documentos-referencia').then(setDocs).catch(() => setDocs([]));
  }
  useEffect(carregar, []);

  async function enviar() {
    setErro('');
    if (!titulo.trim()) return setErro('Informe um título.');
    if (!arquivo) return setErro('Selecione um arquivo.');
    setEnviando(true);
    try {
      const f = new FormData();
      f.append('titulo', titulo.trim());
      f.append('arquivo', arquivo);
      await apiUpload('/documentos-referencia', f);
      setTitulo('');
      setArquivo(null);
      carregar();
    } catch (e) {
      setErro((e as ErroApi).mensagem || 'Não foi possível enviar.');
    } finally {
      setEnviando(false);
    }
  }

  async function remover(id: string) {
    if (!window.confirm('Remover este documento?')) return;
    try {
      await apiDelete(`/documentos-referencia/${id}`);
      carregar();
    } catch (e) {
      window.alert((e as ErroApi).mensagem || 'Não foi possível remover.');
    }
  }

  return (
    <section className="cartao-secao bloco">
      <h2>Documentos de referência</h2>
      <p className="legenda" style={{ marginBottom: 18 }}>
        Modelos e orientações que ficam disponíveis para os alunos baixarem.
      </p>

      {erro && <div className="erro-geral">{erro}</div>}
      <label className="campo">
        <span>Título</span>
        <input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Template Word — TCC" />
      </label>
      <CampoArquivo rotulo="Arquivo" arquivo={arquivo} aoMudar={setArquivo} aceita="" dica="PDF, Word, etc." />
      <div className="acoes">
        <button className="botao" disabled={enviando} onClick={enviar}>
          {enviando ? 'Enviando…' : 'Adicionar'}
        </button>
      </div>

      {docs.length > 0 && (
        <ul className="lista-arquivos" style={{ marginTop: 18 }}>
          {docs.map((d) => (
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
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <a className="botao botao-secundario" href={`${URL_API}/documentos-referencia/${d.id}/baixar`} target="_blank" rel="noreferrer">
                  Baixar
                </a>
                <button className="botao botao-secundario" onClick={() => remover(d.id)}>Remover</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
