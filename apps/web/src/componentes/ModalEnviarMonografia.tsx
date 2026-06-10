import { useState } from 'react';
import { apiUpload, type ErroApi } from '../api';
import { Modal } from './Modal';
import { CampoArquivo } from './CampoArquivo';

interface Props {
  tccId: string;
  aoFechar: () => void;
  aoEnviado: () => void;
}

export function ModalEnviarMonografia({ tccId, aoFechar, aoEnviado }: Props) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');

  async function enviar() {
    setErro('');
    if (!arquivo) return setErro('Selecione o PDF da monografia.');
    if (arquivo.size > 10 * 1024 * 1024) return setErro('Máximo 10MB.');
    setEnviando(true);
    try {
      const fd = new FormData();
      fd.append('arquivo', arquivo);
      await apiUpload(`/tccs/${tccId}/monografia`, fd);
      aoEnviado();
    } catch (e) {
      setErro((e as ErroApi).mensagem || 'Não foi possível enviar.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal
      titulo="Enviar versão do TCC"
      subtitulo="Envie a monografia (PDF) para avaliação do seu orientador."
      aoFechar={() => !enviando && aoFechar()}
    >
      {erro && <div className="erro-geral">{erro}</div>}
      <CampoArquivo rotulo="Monografia" arquivo={arquivo} aoMudar={setArquivo} dica="PDF, até 10MB" />
      <div className="acoes">
        <button className="botao botao-secundario" disabled={enviando} onClick={aoFechar}>Cancelar</button>
        <button className="botao" disabled={enviando} onClick={enviar}>
          {enviando ? 'Enviando…' : 'Enviar'}
        </button>
      </div>
    </Modal>
  );
}
