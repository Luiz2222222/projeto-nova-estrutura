import { Component, type ErrorInfo, type ReactNode } from 'react';

// Proteção GLOBAL de renderização (item 8): se qualquer tela quebrar ao renderizar (ex.: um
// dado inesperado da API), este limite de erro (React Error Boundary) mostra uma mensagem
// amigável com "Recarregar" em vez de deixar a tela inteiramente branca. Error boundaries
// precisam ser componentes de classe — não há equivalente em hooks.
export class LimiteErro extends Component<{ children: ReactNode }, { erro: boolean }> {
  state: { erro: boolean } = { erro: false };

  static getDerivedStateFromError(): { erro: boolean } {
    return { erro: true };
  }

  componentDidCatch(erro: Error, info: ErrorInfo) {
    // Mantém o rastro no console para depuração (não há telemetria externa neste projeto).
    console.error('Erro de renderização capturado pelo LimiteErro:', erro, info);
  }

  render() {
    if (this.state.erro) {
      return (
        <div className="centro" style={{ flexDirection: 'column', gap: 16, padding: 24, textAlign: 'center' }}>
          <h2>Algo deu errado ao exibir esta página</h2>
          <p className="nota-vazio">Tente recarregar. Se o problema continuar, avise a coordenação.</p>
          <button className="botao" onClick={() => window.location.reload()}>Recarregar</button>
        </div>
      );
    }
    return this.props.children;
  }
}
