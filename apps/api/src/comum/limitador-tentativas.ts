// Limitador de tentativas em MEMÓRIA (anti brute-force/spam) — simples e isolado, sem
// dependência nova. Conta tentativas por CHAVE dentro de uma janela deslizante; ao passar do
// limite, bloqueia até a janela expirar. Fácil de trocar depois por Redis/etc. sem mexer nos
// controllers (basta manter esta interface).
//
// `agora` é injetável para os testes controlarem o tempo sem timers reais.
type Registro = { contagem: number; expira: number };

export class LimitadorTentativas {
  private readonly mapa = new Map<string, Registro>();

  constructor(
    private readonly limite: number,
    private readonly janelaMs: number,
    private readonly agora: () => number = () => Date.now(),
  ) {}

  // Registra UMA tentativa para a chave e devolve true se AINDA está permitido (dentro do
  // limite) ou false se estourou (deve bloquear). Janela nova quando a anterior expira.
  permitir(chave: string): boolean {
    const t = this.agora();
    const reg = this.mapa.get(chave);
    if (!reg || t >= reg.expira) {
      this.mapa.set(chave, { contagem: 1, expira: t + this.janelaMs });
      return true;
    }
    reg.contagem += 1;
    return reg.contagem <= this.limite;
  }

  // Zera o contador de uma chave (ex.: após login bem-sucedido, para não punir o usuário legítimo).
  limpar(chave: string): void {
    this.mapa.delete(chave);
  }

  // Remove entradas expiradas para o mapa não crescer sem limite (chamado esporadicamente).
  podar(): void {
    const t = this.agora();
    for (const [k, reg] of this.mapa) if (t >= reg.expira) this.mapa.delete(k);
  }
}

// Extrai um identificador de origem (IP) da requisição, com fallbacks. Só para chavear o
// limitador — não é usado para autorização.
export function ipDaRequisicao(req: { ip?: string; socket?: { remoteAddress?: string } }): string {
  return req?.ip || req?.socket?.remoteAddress || 'desconhecido';
}
