// Placeholder honesto para telas que existem no projeto original e ainda serão construídas.
interface Props {
  titulo: string;
  descricao: string;
}

export function EmConstrucao({ titulo, descricao }: Props) {
  return (
    <>
      <h1>{titulo}</h1>
      <p className="legenda">{descricao}</p>
      <section className="cartao-secao bloco estado-vazio">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4" />
        </svg>
        <h2>Em construção</h2>
        <p className="nota-vazio">Esta área já existe no fluxo e será montada numa próxima etapa.</p>
      </section>
    </>
  );
}
