import { useState } from 'react';
import { URL_API } from '../api';
import { Modal } from './Modal';

interface Props {
  titulo: string;
  subtitulo?: string; // ex.: nome do aluno/TCC quando for download individual
  caminhoBase: string; // '/exportar' ou `/tccs/${id}/exportar`
  nomeArquivo: string; // nome do arquivo .zip baixado
  aoFechar: () => void;
}

const OPCOES = [
  { chave: 'dados', rotulo: 'Dados', desc: 'Arquivo txt com dados das fases' },
  { chave: 'monografia', rotulo: 'Monografias', desc: 'Monografia aprovada pelo orientador' },
  { chave: 'documentos', rotulo: 'Documentos gerais', desc: 'Documentos gerais das fases' },
] as const;

// Modal de download (espelha o do projeto antigo): escolhe o que incluir e baixa um .zip.
export function ModalBaixarDados({ titulo, subtitulo, caminhoBase, nomeArquivo, aoFechar }: Props) {
  const [sel, setSel] = useState({ dados: true, monografia: true, documentos: true });
  const [baixando, setBaixando] = useState(false);
  const [erro, setErro] = useState('');
  const nenhum = !sel.dados && !sel.monografia && !sel.documentos;

  async function baixar() {
    if (nenhum) return;
    setErro('');
    setBaixando(true);
    try {
      const qs = `dados=${sel.dados}&monografia=${sel.monografia}&documentos=${sel.documentos}`;
      const r = await fetch(`${URL_API}${caminhoBase}?${qs}`, { credentials: 'include' });
      if (!r.ok) throw new Error('falha');
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = nomeArquivo;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      aoFechar();
    } catch {
      setErro('Não foi possível baixar. Tente novamente.');
    } finally {
      setBaixando(false);
    }
  }

  return (
    <Modal titulo={titulo} subtitulo={subtitulo} aoFechar={() => !baixando && aoFechar()}>
      {erro && <div className="erro-geral">{erro}</div>}
      <p className="modal-confirma-texto" style={{ marginBottom: 12 }}>Selecione o que deseja incluir no download:</p>
      <div className="baixar-opcoes">
        {OPCOES.map((o) => (
          <label key={o.chave} className="linha-toggle">
            <input
              type="checkbox"
              checked={sel[o.chave]}
              disabled={baixando}
              onChange={(e) => setSel((s) => ({ ...s, [o.chave]: e.target.checked }))}
            />
            <span><strong>{o.rotulo}</strong><span className="legenda">{o.desc}</span></span>
          </label>
        ))}
      </div>
      <div className="acoes">
        <button className="botao botao-secundario" disabled={baixando} onClick={aoFechar}>Cancelar</button>
        <button className="botao" disabled={baixando || nenhum} onClick={baixar}>{baixando ? 'Baixando…' : 'Baixar'}</button>
      </div>
    </Modal>
  );
}
