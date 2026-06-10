import { useTema, type Familia, type Fonte, type Tema } from '../tema/contexto';

const TEMAS: { valor: Tema; titulo: string; fundo: string; destaque: string }[] = [
  { valor: 'claro', titulo: 'Claro', fundo: '#fafafa', destaque: '#0ea5e9' },
  { valor: 'escuro', titulo: 'Escuro', fundo: '#0f141b', destaque: '#38bdf8' },
  { valor: 'preto', titulo: 'Preto', fundo: '#000000', destaque: '#38bdf8' },
  { valor: 'institucional', titulo: 'Institucional', fundo: '#e8eef7', destaque: '#12355b' },
];

const TAMANHOS: { valor: Fonte; titulo: string; desc: string }[] = [
  { valor: 'pequeno', titulo: 'Pequena', desc: 'Compacto' },
  { valor: 'medio', titulo: 'Média', desc: 'Padrão' },
  { valor: 'grande', titulo: 'Grande', desc: 'Confortável' },
];

const TIPOS: { valor: Familia; titulo: string; desc: string; fonte: string }[] = [
  { valor: 'padrao', titulo: 'Padrão', desc: 'Sans-serif', fonte: 'var(--sans)' },
  { valor: 'serif', titulo: 'Serif', desc: 'Tradicional', fonte: 'var(--serif)' },
  { valor: 'mono', titulo: 'Monoespaçada', desc: 'Código', fonte: 'var(--mono)' },
];

export function Configuracoes() {
  const { tema, fonte, familia, definirTema, definirFonte, definirFamilia } = useTema();

  return (
    <>
      <h1>Configurações</h1>
      <p className="legenda">Preferências de exibição do sistema.</p>

      <section className="cartao-secao bloco">
        <h2>Aparência</h2>

        <div className="config-grupo">
          <h3>Tema</h3>
          <p>As preferências ficam salvas neste navegador.</p>
          <div className="tema-grid">
            {TEMAS.map((t) => (
              <button
                key={t.valor}
                type="button"
                className={`tema-card${tema === t.valor ? ' sel' : ''}`}
                onClick={() => definirTema(t.valor)}
              >
                {tema === t.valor && <span className="tema-check" aria-hidden>✓</span>}
                <span className="tema-amostra">
                  <span className="tema-cor" style={{ background: t.fundo }} />
                  <span className="tema-cor" style={{ background: t.destaque }} />
                </span>
                <span className="tema-nome">{t.titulo}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="cartao-secao bloco">
        <h2>Fonte</h2>

        <div className="config-grupo">
          <h3>Tamanho</h3>
          <p>Ajusta o tamanho dos textos do sistema.</p>
          <div className="opcoes">
            {TAMANHOS.map((f) => (
              <button
                key={f.valor}
                type="button"
                className={`opcao${fonte === f.valor ? ' sel' : ''}`}
                onClick={() => definirFonte(f.valor)}
              >
                <span className="opcao-titulo">{f.titulo}</span>
                <span className="opcao-desc">{f.desc}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="config-grupo">
          <h3>Tipo</h3>
          <p>Escolha a família tipográfica da interface.</p>
          <div className="opcoes">
            {TIPOS.map((f) => (
              <button
                key={f.valor}
                type="button"
                className={`opcao${familia === f.valor ? ' sel' : ''}`}
                onClick={() => definirFamilia(f.valor)}
              >
                <span className="opcao-titulo" style={{ fontFamily: f.fonte }}>{f.titulo}</span>
                <span className="opcao-desc">{f.desc}</span>
                <span className="previa" style={{ fontFamily: f.fonte }}>Exemplo Aa 123</span>
              </button>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
