import type { ReactNode } from 'react';

// Telas de acesso: cartão de vidro fosco sobre gradiente azul (cores do projeto original).
export function LayoutAuth({ children, largo = false }: { children: ReactNode; largo?: boolean }) {
  return (
    <div className="palco">
      <span className="brilho b1" />
      <span className="brilho b2" />
      <span className="brilho b3" />
      <div className={`palco-conteudo${largo ? ' largo' : ''}`}>
        <p className="palco-marca">Sistema de Gestão de TCC · DEE</p>
        <div className="vidro">{children}</div>
      </div>
    </div>
  );
}
