// Modal de confirmação para EXCLUIR (soft delete) um TCC. Exige digitar exatamente "EXCLUIR"
// e permite um motivo opcional. Usado pelo coordenador e pelo orientador. A exclusão é lógica:
// nada é apagado fisicamente (documentos, banca, avaliações e arquivos permanecem).
import { useState } from 'react';
import { Modal } from './Modal';

export function ModalExcluirTcc({
  aoFechar,
  aoConfirmar,
  processando = false,
  erro,
}: {
  aoFechar: () => void;
  aoConfirmar: (motivo: string) => void;
  processando?: boolean;
  erro?: string;
}) {
  const [motivo, setMotivo] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const habilitado = confirmacao.trim() === 'EXCLUIR' && !processando;

  return (
    <Modal titulo="Excluir TCC" aoFechar={() => !processando && aoFechar()}>
      {erro && <div className="erro-geral">{erro}</div>}
      <div className="alerta alerta-erro" style={{ marginBottom: 14 }}>
        <strong>Atenção:</strong> o TCC será excluído e sairá das listas e dos fluxos ativos.
        Os documentos, a banca e as avaliações <strong>não</strong> são apagados — a exclusão é
        lógica e pode ser revertida pela coordenação.
      </div>
      <label className="campo">
        <span>Motivo (opcional)</span>
        <textarea rows={3} value={motivo} disabled={processando} onChange={(e) => setMotivo(e.target.value)} placeholder="Por que este TCC está sendo excluído?" />
      </label>
      <label className="campo" style={{ marginTop: 12 }}>
        <span>Para confirmar, digite <strong>EXCLUIR</strong></span>
        <input value={confirmacao} disabled={processando} onChange={(e) => setConfirmacao(e.target.value)} placeholder="EXCLUIR" autoComplete="off" />
      </label>
      <div className="acoes">
        <button className="botao botao-secundario" disabled={processando} onClick={aoFechar}>Cancelar</button>
        <button className="botao botao-perigo" disabled={!habilitado} onClick={() => aoConfirmar(motivo)}>
          {processando ? 'Excluindo…' : 'Excluir TCC'}
        </button>
      </div>
    </Modal>
  );
}
