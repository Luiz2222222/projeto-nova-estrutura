import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  titulo: string;
  subtitulo?: string;
  aoFechar: () => void;
  children: ReactNode;
}

export function Modal({ titulo, subtitulo, aoFechar, children }: Props) {
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') aoFechar();
    };
    window.addEventListener('keydown', aoTeclar);
    // Trava o scroll do fundo enquanto o modal está aberto.
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', aoTeclar);
      document.body.style.overflow = overflowAnterior;
    };
  }, [aoFechar]);

  // Portal no body: escapa do cartão de vidro (backdrop-filter) e cobre a tela toda.
  return createPortal(
    <div className="modal-fundo" onClick={aoFechar}>
      <div className="modal-painel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <button className="modal-fechar" onClick={aoFechar} aria-label="Fechar">
          ✕
        </button>
        <h2 className="modal-titulo">{titulo}</h2>
        {subtitulo && <p className="modal-sub">{subtitulo}</p>}
        {children}
      </div>
    </div>,
    document.body,
  );
}
