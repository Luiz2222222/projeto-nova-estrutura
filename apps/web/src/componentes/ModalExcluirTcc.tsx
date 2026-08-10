// Modal de confirmação para EXCLUIR PERMANENTEMENTE um TCC. Exige digitar exatamente
// "EXCLUIR". Usado pelo coordenador e pelo orientador. A exclusão apaga de verdade:
// registro, solicitações, documentos, bancas, avaliações e os arquivos enviados — e NÃO
// pode ser desfeita (não existe restauração).
import { useState } from 'react';
import { Modal } from './Modal';

export function ModalExcluirTcc({
  aoFechar,
  aoConfirmar,
  processando = false,
  erro,
}: {
  aoFechar: () => void;
  aoConfirmar: () => void;
  processando?: boolean;
  erro?: string;
}) {
  const [confirmacao, setConfirmacao] = useState('');
  const habilitado = confirmacao.trim() === 'EXCLUIR' && !processando;

  return (
    <Modal titulo="Excluir TCC permanentemente" aoFechar={() => !processando && aoFechar()}>
      {erro && <div className="erro-geral">{erro}</div>}
      <div className="alerta alerta-erro" style={{ marginBottom: 14 }}>
        <strong>Esta exclusão é permanente e não pode ser desfeita.</strong> O TCC, as
        solicitações, os documentos, as bancas, as avaliações e os arquivos enviados serão
        apagados de vez — nada fica em histórico e não existe restauração.
      </div>
      <label className="campo" style={{ marginTop: 12 }}>
        <span>Para confirmar, digite <strong>EXCLUIR</strong></span>
        <input value={confirmacao} disabled={processando} onChange={(e) => setConfirmacao(e.target.value)} placeholder="EXCLUIR" autoComplete="off" />
      </label>
      <div className="acoes">
        <button className="botao botao-secundario" disabled={processando} onClick={aoFechar}>Cancelar</button>
        <button className="botao botao-perigo" disabled={!habilitado} onClick={() => aoConfirmar()}>
          {processando ? 'Excluindo…' : 'Excluir permanentemente'}
        </button>
      </div>
    </Modal>
  );
}
