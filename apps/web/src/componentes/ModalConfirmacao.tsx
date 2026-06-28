import type { ReactNode } from 'react';
import { Modal } from './Modal';

interface Props {
  titulo: string;
  // Consequência da ação (texto ou markup curto).
  mensagem: ReactNode;
  textoConfirmar: string; // ex.: "Aprovar", "Excluir", "Bloquear", "Confirmar envio"
  textoCancelar?: string; // padrão "Cancelar"
  // Rótulo do botão enquanto processa (ex.: "Excluindo…"). Cai num padrão se ausente.
  textoProcessando?: string;
  perigo?: boolean; // botão de ação vermelho (exclusão, reset, reprovação, descontinuação…)
  processando?: boolean; // desabilita os botões e troca o rótulo de ação
  erro?: string; // erro inline opcional
  aoConfirmar: () => void;
  aoCancelar: () => void;
}

// Modal visual de confirmação para ações críticas. Reaproveita o <Modal> base e o
// padrão de botões do sistema (.botao / .botao-secundario / .botao-perigo).
export function ModalConfirmacao({
  titulo,
  mensagem,
  textoConfirmar,
  textoCancelar = 'Cancelar',
  textoProcessando,
  perigo = false,
  processando = false,
  erro,
  aoConfirmar,
  aoCancelar,
}: Props) {
  return (
    <Modal titulo={titulo} aoFechar={() => !processando && aoCancelar()}>
      {erro && <div className="erro-geral">{erro}</div>}
      <p className="modal-confirma-texto">{mensagem}</p>
      <div className="acoes">
        <button className="botao botao-secundario" disabled={processando} onClick={aoCancelar}>
          {textoCancelar}
        </button>
        <button
          className={`botao${perigo ? ' botao-perigo' : ''}`}
          disabled={processando}
          onClick={aoConfirmar}
        >
          {processando ? textoProcessando ?? 'Processando…' : textoConfirmar}
        </button>
      </div>
    </Modal>
  );
}
