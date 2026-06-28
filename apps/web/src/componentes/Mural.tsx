import { useEffect, useState } from 'react';
import { apiGet, apiPost, apiPut, apiDelete, type ErroApi } from '../api';
import { useAuth } from '../autenticacao/contexto';
import { Modal } from './Modal';
import { ModalConfirmacao } from './ModalConfirmacao';

// Mural de avisos compartilhado por todos os perfis (espelha o projeto antigo).
// podeGerenciar = coordenador: cria/edita/apaga avisos e vê os destinatários.

const CORES = [
  { value: '', label: 'Padrão', hex: '' },
  { value: 'azul', label: 'Azul', hex: '#3b82f6' },
  { value: 'verde', label: 'Verde', hex: '#22c55e' },
  { value: 'amarelo', label: 'Amarelo', hex: '#eab308' },
  { value: 'vermelho', label: 'Vermelho', hex: '#ef4444' },
  { value: 'roxo', label: 'Roxo', hex: '#a855f7' },
  { value: 'laranja', label: 'Laranja', hex: '#f97316' },
];
const PERFIS = [
  { value: 'ALUNO', label: 'Alunos' },
  { value: 'PROFESSOR', label: 'Professores' },
  { value: 'AVALIADOR', label: 'Externos' },
  { value: 'COORDENADOR', label: 'Coordenadores' },
];
const TODOS = PERFIS.map((p) => p.value);
const rotuloPerfil = (v: string) => PERFIS.find((p) => p.value === v)?.label ?? v;

function fmt(iso: string) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const ic = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {d.split('|').map((p, i) => <path key={i} d={p} />)}
  </svg>
);
const icoMegafone = ic('M3 11v2a1 1 0 0 0 1 1h2l4 4V6L6 10H4a1 1 0 0 0-1 1z|M15 8a4 4 0 0 1 0 8');
const icoLapis = ic('M12 20h9|M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z');
const icoLixeira = ic('M3 6h18|M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2');
const icoPin = ic('M12 17v5|M9 10.5V4h6v6.5l2 3.5H7z');
const icoComentario = ic('M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z');
const icoEnviar = ic('M22 2 11 13|M22 2 15 22l-4-9-9-4z');

export function Mural({ podeGerenciar }: { podeGerenciar: boolean }) {
  const { usuario } = useAuth();
  const [avisos, setAvisos] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [comentariosAbertos, setAbertos] = useState<Set<string>>(new Set());
  const [textoComentario, setTexto] = useState<Record<string, string>>({});

  // form do modal
  const [modal, setModal] = useState(false);
  const [editando, setEditando] = useState<any | null>(null);
  const [titulo, setTitulo] = useState('');
  const [conteudo, setConteudo] = useState('');
  const [destinatarios, setDestinatarios] = useState<string[]>([...TODOS]);
  const [cor, setCor] = useState('');
  const [fixado, setFixado] = useState(false);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  // Confirmação de remoção (aviso ou comentário).
  const [confirmarRemocao, setConfirmarRemocao] = useState<
    | { tipo: 'aviso'; id: string }
    | { tipo: 'comentario'; avisoId: string; comentarioId: string }
    | null
  >(null);
  const [processandoRemocao, setProcessandoRemocao] = useState(false);
  const [erroRemocao, setErroRemocao] = useState('');

  function carregar() {
    apiGet('/avisos')
      .then((a: any) => setAvisos(a ?? []))
      .catch(() => setAvisos([]))
      .finally(() => setCarregando(false));
  }
  useEffect(carregar, []);

  function abrirNovo() {
    setEditando(null);
    setTitulo('');
    setConteudo('');
    setDestinatarios([...TODOS]);
    setCor('');
    setFixado(false);
    setErro('');
    setModal(true);
  }
  function abrirEditar(a: any) {
    setEditando(a);
    setTitulo(a.titulo);
    setConteudo(a.conteudo);
    setDestinatarios(a.destinatarios?.split(',') ?? [...TODOS]);
    setCor(a.cor ?? '');
    setFixado(!!a.fixado);
    setErro('');
    setModal(true);
  }
  const alternaDest = (v: string) =>
    setDestinatarios((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]));

  async function salvar() {
    setErro('');
    if (!titulo.trim()) return setErro('Informe o título do aviso.');
    if (!conteudo.trim()) return setErro('Escreva a mensagem do aviso.');
    if (!destinatarios.length) return setErro('Selecione ao menos um perfil destinatário.');
    setSalvando(true);
    try {
      const corpo = { titulo: titulo.trim(), conteudo: conteudo.trim(), destinatarios, cor, fixado };
      if (editando) await apiPut(`/avisos/${editando.id}`, corpo);
      else await apiPost('/avisos', corpo);
      setModal(false);
      carregar();
    } catch (e) {
      const er = e as ErroApi;
      setErro(er.erros?.[0]?.mensagem || er.mensagem || 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  }

  function pedirRemocao(alvo: NonNullable<typeof confirmarRemocao>) {
    setErroRemocao('');
    setConfirmarRemocao(alvo);
  }
  async function executarRemocao() {
    if (!confirmarRemocao) return;
    setErroRemocao('');
    setProcessandoRemocao(true);
    try {
      if (confirmarRemocao.tipo === 'aviso') await apiDelete(`/avisos/${confirmarRemocao.id}`);
      else await apiDelete(`/avisos/${confirmarRemocao.avisoId}/comentarios/${confirmarRemocao.comentarioId}`);
      setConfirmarRemocao(null);
      carregar();
    } catch (e) {
      setErroRemocao((e as ErroApi).mensagem || 'Não foi possível remover.');
    } finally {
      setProcessandoRemocao(false);
    }
  }

  function toggleComentarios(id: string) {
    setAbertos((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  async function comentar(id: string) {
    const texto = (textoComentario[id] || '').trim();
    if (!texto) return;
    try {
      await apiPost(`/avisos/${id}/comentarios`, { texto });
      setTexto((p) => ({ ...p, [id]: '' }));
      carregar();
    } catch (e) {
      window.alert((e as ErroApi).mensagem || 'Não foi possível comentar.');
    }
  }

  if (carregando) return <p className="nota-vazio">Carregando…</p>;

  return (
    <>
      <div className="mural-cabecalho">
        <div className="mural-titulo">
          <span className="ico">{icoMegafone}</span>
          <div>
            <h1>Mural de avisos</h1>
            <p className="legenda">
              {podeGerenciar ? 'Publique e gerencie avisos para os usuários do sistema.' : 'Avisos e comunicados da coordenação.'}
            </p>
          </div>
        </div>
        {podeGerenciar && <button className="botao" onClick={abrirNovo}>+ Novo aviso</button>}
      </div>

      {avisos.length === 0 ? (
        <section className="cartao-secao bloco estado-vazio">
          <span className="ico">{icoMegafone}</span>
          <p className="nota-vazio">Nenhum aviso no momento.</p>
        </section>
      ) : (
        <div className="mural-lista bloco">
          {avisos.map((a) => {
            const classeCor = a.cor ? ` cor-${a.cor}` : a.fixado ? ' fixado' : '';
            const aberto = comentariosAbertos.has(a.id);
            const coments: any[] = a.comentarios ?? [];
            return (
              <article key={a.id} className={`aviso-card${classeCor}`}>
                <div className="aviso-cabecalho-top">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="aviso-chips" style={{ marginBottom: 4 }}>
                      {a.fixado && <span className="pilula pilula-azul">{icoPin} Fixado</span>}
                      <h3 style={{ margin: 0 }}>{a.titulo}</h3>
                    </div>
                    <p className="aviso-conteudo">{a.conteudo}</p>
                    <div className="aviso-meta-linha">
                      <span>{a.autorNome ? `${a.autorNome} · ` : ''}{fmt(a.criadoEm)}</span>
                      {podeGerenciar && (
                        <span className="aviso-chips">
                          {(a.destinatarios?.split(',') ?? []).map((d: string) => (
                            <span key={d} className="pilula pilula-neutra">{rotuloPerfil(d)}</span>
                          ))}
                        </span>
                      )}
                    </div>
                  </div>
                  {podeGerenciar && (
                    <span className="aviso-acoes">
                      <button className="botao-icone" title="Editar" onClick={() => abrirEditar(a)}>{icoLapis}</button>
                      <button className="botao-icone" title="Apagar" onClick={() => pedirRemocao({ tipo: 'aviso', id: a.id })}>{icoLixeira}</button>
                    </span>
                  )}
                </div>

                <div className="aviso-rodape">
                  <button className="coment-toggle" onClick={() => toggleComentarios(a.id)}>
                    {icoComentario}
                    {coments.length > 0 ? `${coments.length} comentário${coments.length > 1 ? 's' : ''}` : 'Comentar'}
                  </button>
                  {aberto && (
                    <>
                      <div className="coment-lista">
                        {coments.map((c) => (
                          <div key={c.id} className="coment-item">
                            <span className="coment-avatar">{c.autorNome?.charAt(0)?.toUpperCase() ?? '?'}</span>
                            <div className="coment-corpo">
                              <div className="coment-meta">
                                <span className="coment-nome">{c.autorNome}</span>
                                <span className="coment-data">{fmt(c.criadoEm)}</span>
                                {(c.autorId === usuario?.id || podeGerenciar) && (
                                  <button className="coment-apagar" title="Apagar comentário" onClick={() => pedirRemocao({ tipo: 'comentario', avisoId: a.id, comentarioId: c.id })}>{icoLixeira}</button>
                                )}
                              </div>
                              <p className="coment-texto">{c.texto}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="coment-form">
                        <input
                          value={textoComentario[a.id] || ''}
                          onChange={(e) => setTexto((p) => ({ ...p, [a.id]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); comentar(a.id); } }}
                          placeholder="Escreva um comentário…"
                        />
                        <button className="botao" onClick={() => comentar(a.id)} disabled={!(textoComentario[a.id] || '').trim()}>{icoEnviar}</button>
                      </div>
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {modal && (
        <Modal titulo={editando ? 'Editar aviso' : 'Novo aviso'} aoFechar={() => !salvando && setModal(false)}>
          {erro && <div className="erro-geral">{erro}</div>}
          <label className="campo">
            <span>Título</span>
            <input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Título do aviso" />
          </label>
          <label className="campo">
            <span>Mensagem</span>
            <textarea rows={5} value={conteudo} onChange={(e) => setConteudo(e.target.value)} placeholder="Escreva a mensagem…" />
          </label>
          <div className="campo">
            <span>Destinatários</span>
            <div className="radios" style={{ flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
              {PERFIS.map((p) => (
                <label key={p.value}>
                  <input type="checkbox" checked={destinatarios.includes(p.value)} onChange={() => alternaDest(p.value)} />
                  {p.label}
                </label>
              ))}
            </div>
          </div>
          <div className="campo">
            <span>Cor do card</span>
            <div className="cor-swatches">
              {CORES.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  className={`cor-swatch${cor === c.value ? ' sel' : ''}`}
                  title={c.label}
                  onClick={() => setCor(c.value)}
                  style={{ background: c.hex || 'var(--papel-2)' }}
                />
              ))}
            </div>
          </div>
          <label className="linha-check" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginTop: 12 }}>
            <input type="checkbox" checked={fixado} onChange={(e) => setFixado(e.target.checked)} />
            <span className="pin-mini">{icoPin}</span>
            <span>Fixar no topo do mural</span>
          </label>
          <div className="acoes">
            <button className="botao botao-secundario" disabled={salvando} onClick={() => setModal(false)}>Cancelar</button>
            <button className="botao" disabled={salvando} onClick={salvar}>{salvando ? 'Salvando…' : editando ? 'Salvar' : 'Publicar aviso'}</button>
          </div>
        </Modal>
      )}

      {confirmarRemocao && (
        <ModalConfirmacao
          titulo={confirmarRemocao.tipo === 'aviso' ? 'Remover aviso' : 'Remover comentário'}
          mensagem={
            confirmarRemocao.tipo === 'aviso'
              ? 'Deseja remover este aviso do mural? Os comentários também serão apagados. Esta ação não pode ser desfeita.'
              : 'Deseja remover este comentário? Esta ação não pode ser desfeita.'
          }
          textoConfirmar="Remover"
          textoProcessando="Removendo…"
          perigo
          processando={processandoRemocao}
          erro={erroRemocao}
          aoConfirmar={executarRemocao}
          aoCancelar={() => setConfirmarRemocao(null)}
        />
      )}
    </>
  );
}
