import { useId } from 'react';

interface Props {
  rotulo: string;
  arquivo: File | null;
  aoMudar: (a: File | null) => void;
  erro?: string;
  /** tipos aceitos no seletor (padrão: PDF) */
  aceita?: string;
  /** dica opcional abaixo do texto principal (some se não informada) */
  dica?: string;
}

function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Ícones inline (sem dependência externa)
const IconeUpload = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);
const IconeArquivo = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

export function CampoArquivo({ rotulo, arquivo, aoMudar, erro, aceita = '.pdf', dica }: Props) {
  const id = useId();
  return (
    <div className="arquivo-campo">
      <span className="arquivo-rotulo">{rotulo}</span>

      {arquivo ? (
        <div className="arquivo-selecionado">
          <div className="arquivo-info">
            {IconeArquivo}
            <div style={{ minWidth: 0 }}>
              <span className="nome">{arquivo.name}</span>
              <span className="tam">{formatarTamanho(arquivo.size)}</span>
            </div>
          </div>
          <button type="button" className="arquivo-remover" onClick={() => aoMudar(null)}>
            Remover
          </button>
        </div>
      ) : (
        <label htmlFor={id} className="arquivo-area">
          {IconeUpload}
          <span><b>Clique para selecionar</b> o arquivo</span>
          {dica && <span className="dica">{dica}</span>}
        </label>
      )}

      <input
        id={id}
        type="file"
        accept={aceita}
        hidden
        onChange={(e) => aoMudar(e.target.files?.[0] || null)}
      />
      {erro && <small className="erro">{erro}</small>}
    </div>
  );
}
