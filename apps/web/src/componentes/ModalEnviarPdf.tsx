import { useState } from 'react';
import { apiUpload, type ErroApi } from '../api';
import { Modal } from './Modal';
import { CampoArquivo } from './CampoArquivo';

interface Props {
  endpoint: string;
  titulo: string;
  subtitulo: string;
  rotulo: string;
  aceita?: string; // formatos do seletor (padrão: PDF)
  dica?: string; // dica abaixo do seletor (padrão: PDF, até 10MB)
  aoFechar: () => void;
  aoEnviado: () => void;
}

// Modal genérico de envio de arquivo (monografia em Word, versão final em PDF, etc.).
export function ModalEnviarPdf({ endpoint, titulo, subtitulo, rotulo, aceita = '.pdf', dica = 'PDF, até 10MB', aoFechar, aoEnviado }: Props) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');

  async function enviar() {
    setErro('');
    if (!arquivo) return setErro('Selecione o arquivo.');
    if (arquivo.size > 10 * 1024 * 1024) return setErro('Máximo 10MB.');
    setEnviando(true);
    try {
      const fd = new FormData();
      fd.append('arquivo', arquivo);
      await apiUpload(endpoint, fd);
      aoEnviado();
    } catch (e) {
      setErro((e as ErroApi).mensagem || 'Não foi possível enviar.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal titulo={titulo} subtitulo={subtitulo} aoFechar={() => !enviando && aoFechar()}>
      {erro && <div className="erro-geral">{erro}</div>}
      <CampoArquivo rotulo={rotulo} arquivo={arquivo} aoMudar={setArquivo} aceita={aceita} dica={dica} />
      <div className="acoes">
        <button className="botao botao-secundario" disabled={enviando} onClick={aoFechar}>Cancelar</button>
        <button className="botao" disabled={enviando} onClick={enviar}>
          {enviando ? 'Enviando…' : 'Enviar'}
        </button>
      </div>
    </Modal>
  );
}
