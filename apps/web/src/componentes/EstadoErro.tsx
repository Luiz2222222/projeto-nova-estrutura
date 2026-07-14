// Estado de ERRO de carregamento (falha de rede/API/500). Mostra uma mensagem clara e um botão
// "Tentar novamente" — nunca deve ser confundido com "não há dados". Usado pelas telas de aluno
// e coordenador (item 8).
export function EstadoErro({ mensagem, aoTentar }: { mensagem?: string; aoTentar: () => void }) {
  return (
    <section className="cartao-secao bloco" style={{ textAlign: 'center' }}>
      <div className="alerta alerta-erro" style={{ textAlign: 'left' }}>
        <strong>Não foi possível carregar os dados.</strong>{' '}
        {mensagem || 'Verifique sua conexão e tente novamente.'}
      </div>
      <button className="botao" style={{ marginTop: 16 }} onClick={aoTentar}>
        Tentar novamente
      </button>
    </section>
  );
}
