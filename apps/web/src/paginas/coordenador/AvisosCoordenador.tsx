import { useEffect, useState } from 'react';
import { apiGet, apiPost, apiDelete, type ErroApi } from '../../api';

function formatarData(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

export function AvisosCoordenador() {
  const [avisos, setAvisos] = useState<any[]>([]);
  const [titulo, setTitulo] = useState('');
  const [conteudo, setConteudo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');

  function carregar() {
    apiGet('/avisos').then(setAvisos).catch(() => setAvisos([]));
  }
  useEffect(carregar, []);

  async function publicar() {
    setErro('');
    setEnviando(true);
    try {
      await apiPost('/avisos', { titulo, conteudo });
      setTitulo('');
      setConteudo('');
      carregar();
    } catch (e) {
      const er = e as ErroApi;
      setErro(er.erros?.[0]?.mensagem || er.mensagem || 'Não foi possível publicar.');
    } finally {
      setEnviando(false);
    }
  }

  async function remover(id: string) {
    if (!window.confirm('Remover este aviso?')) return;
    try {
      await apiDelete(`/avisos/${id}`);
      carregar();
    } catch (e) {
      window.alert((e as ErroApi).mensagem || 'Não foi possível remover.');
    }
  }

  return (
    <>
      <h1>Mural de avisos</h1>
      <p className="legenda">Publique comunicados e prazos. Eles aparecem para todos os alunos.</p>

      <section className="cartao-secao bloco">
        <h2>Novo aviso</h2>
        {erro && <div className="erro-geral">{erro}</div>}
        <label className="campo">
          <span>Título</span>
          <input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Reunião de abertura do semestre" />
        </label>
        <label className="campo">
          <span>Conteúdo</span>
          <textarea rows={4} value={conteudo} onChange={(e) => setConteudo(e.target.value)} placeholder="Escreva o comunicado…" />
        </label>
        <div className="acoes">
          <button className="botao" disabled={enviando} onClick={publicar}>
            {enviando ? 'Publicando…' : 'Publicar aviso'}
          </button>
        </div>
      </section>

      <section className="cartao-secao bloco">
        <h2>Publicados</h2>
        {avisos.length ? (
          <div className="lista">
            {avisos.map((a) => (
              <article key={a.id} className="aviso-item">
                <div className="aviso-cabecalho">
                  <h3>{a.titulo}</h3>
                  <button className="link-inline" onClick={() => remover(a.id)}>
                    Remover
                  </button>
                </div>
                <p className="aviso-conteudo">{a.conteudo}</p>
                <p className="aviso-meta">
                  {a.autorNome ? `${a.autorNome} · ` : ''}
                  {formatarData(a.criadoEm)}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <p className="nota-vazio">Nenhum aviso publicado.</p>
        )}
      </section>
    </>
  );
}
