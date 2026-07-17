import { useEffect, useState } from 'react';
import { apiGet, apiDelete, apiPut, apiUpload, URL_API, type ErroApi } from '../../api';
import { CampoArquivo } from '../../componentes/CampoArquivo';
import { ModalConfirmacao } from '../../componentes/ModalConfirmacao';

function formatarTamanho(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const PAPEIS = ['ALUNO', 'PROFESSOR', 'AVALIADOR'] as const;
const PLURAL: Record<string, string> = { ALUNO: 'Alunos', PROFESSOR: 'Professores', AVALIADOR: 'Avaliadores' };

const ic = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {d.split('|').map((p, i) => <path key={i} d={p} />)}
  </svg>
);
const icoOlho = ic('M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z|M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0');
const icoBaixar = ic('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4|M7 10l5 5 5-5|M12 15V3');
const icoLapis = ic('M12 20h9|M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z');
const icoLixeira = ic('M3 6h18|M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2');

// Seção do Planejamento: documentos de referência (modelos) + escolha de quais perfis podem ver.
export function SecaoModelos() {
  const [docs, setDocs] = useState<any[]>([]);
  const [titulo, setTitulo] = useState('');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [visiveis, setVisiveis] = useState<string[]>([...PAPEIS]);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');

  const [editando, setEditando] = useState<string | null>(null);
  const [editVisiveis, setEditVisiveis] = useState<string[]>([]);

  const [removendo, setRemovendo] = useState<any | null>(null);
  const [processandoRem, setProcessandoRem] = useState(false);
  const [erroRem, setErroRem] = useState('');

  function carregar() {
    apiGet<any[]>('/documentos-referencia').then(setDocs).catch(() => setDocs([]));
  }
  useEffect(carregar, []);

  const alterna = (lista: string[], setLista: (v: string[]) => void, p: string) =>
    setLista(lista.includes(p) ? lista.filter((x) => x !== p) : [...lista, p]);

  async function enviar() {
    setErro('');
    if (!titulo.trim()) return setErro('Informe um título.');
    if (!arquivo) return setErro('Selecione um arquivo.');
    if (!visiveis.length) return setErro('Selecione ao menos um perfil que pode ver o documento.');
    setEnviando(true);
    try {
      const f = new FormData();
      f.append('titulo', titulo.trim());
      f.append('visivelPara', visiveis.join(','));
      f.append('arquivo', arquivo);
      await apiUpload('/documentos-referencia', f);
      setTitulo('');
      setArquivo(null);
      setVisiveis([...PAPEIS]);
      carregar();
    } catch (e) {
      setErro((e as ErroApi).mensagem || 'Não foi possível enviar.');
    } finally {
      setEnviando(false);
    }
  }

  async function salvarVisibilidade(id: string) {
    try {
      await apiPut(`/documentos-referencia/${id}/visibilidade`, { visivelPara: editVisiveis.join(',') });
      setEditando(null);
      carregar();
    } catch (e) {
      window.alert((e as ErroApi).mensagem || 'Não foi possível salvar.');
    }
  }

  async function confirmarRemover() {
    if (!removendo) return;
    setErroRem('');
    setProcessandoRem(true);
    try {
      await apiDelete(`/documentos-referencia/${removendo.id}`);
      setRemovendo(null);
      carregar();
    } catch (e) {
      setErroRem((e as ErroApi).mensagem || 'Não foi possível remover.');
    } finally {
      setProcessandoRem(false);
    }
  }

  return (
    <section className="cartao-secao bloco">
      <h2>Documentos de referência</h2>
      <p className="legenda" style={{ marginBottom: 18 }}>
        Modelos e orientações disponíveis para download. Escolha quais perfis podem ver cada documento.
      </p>

      {erro && <div className="erro-geral">{erro}</div>}
      <label className="campo">
        <span>Título</span>
        <input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Template Word — TCC" />
      </label>
      <CampoArquivo rotulo="Arquivo" arquivo={arquivo} aoMudar={setArquivo} aceita="" dica="PDF, Word, etc." />
      <div className="campo">
        <span>Quem pode ver</span>
        <div className="radios">
          {PAPEIS.map((p) => (
            <label key={p}>
              <input type="checkbox" checked={visiveis.includes(p)} onChange={() => alterna(visiveis, setVisiveis, p)} />
              {PLURAL[p]}
            </label>
          ))}
        </div>
      </div>
      <div className="acoes">
        <button className="botao" disabled={enviando} onClick={enviar}>
          {enviando ? 'Enviando…' : 'Adicionar'}
        </button>
      </div>

      {docs.length > 0 && (
        <ul className="lista-arquivos" style={{ marginTop: 18 }}>
          {docs.map((d) => (
            <li key={d.id} className="item-arquivo">
              <div className="item-arquivo-info">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                <div>
                  <span className="nome">{d.titulo}</span>
                  <span className="meta">
                    {d.nomeArquivo}
                    {d.tamanho ? ` · ${formatarTamanho(d.tamanho)}` : ''}
                  </span>
                  {editando === d.id ? (
                    <div className="radios" style={{ marginTop: 8 }}>
                      {PAPEIS.map((p) => (
                        <label key={p}>
                          <input type="checkbox" checked={editVisiveis.includes(p)} onChange={() => alterna(editVisiveis, setEditVisiveis, p)} />
                          {PLURAL[p]}
                        </label>
                      ))}
                    </div>
                  ) : (
                    <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                      {(d.visivelPara?.split(',') ?? []).map((p: string) => (
                        <span key={p} className="pilula pilula-neutra">{PLURAL[p] ?? p}</span>
                      ))}
                    </span>
                  )}
                </div>
              </div>
              <span className="acoes-doc">
                {editando === d.id ? (
                  <>
                    <button className="botao" onClick={() => salvarVisibilidade(d.id)}>Salvar</button>
                    <button className="botao botao-secundario" onClick={() => setEditando(null)}>Cancelar</button>
                  </>
                ) : (
                  <>
                    <a className="botao-icone" title="Visualizar" href={`${URL_API}/documentos-referencia/${d.id}/visualizar`} target="_blank" rel="noreferrer">{icoOlho}</a>
                    <a className="botao-icone" title="Baixar" href={`${URL_API}/documentos-referencia/${d.id}/baixar`} target="_blank" rel="noreferrer">{icoBaixar}</a>
                    <button className="botao-icone" title="Editar perfis" onClick={() => { setEditando(d.id); setEditVisiveis(d.visivelPara?.split(',') ?? []); }}>{icoLapis}</button>
                    <button className="botao-icone" title="Remover" onClick={() => { setErroRem(''); setRemovendo(d); }}>{icoLixeira}</button>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {removendo && (
        <ModalConfirmacao
          titulo="Remover documento de referência"
          mensagem={<>Deseja remover <strong>{removendo.titulo}</strong>? Os perfis que tinham acesso deixarão de ver este documento. Esta ação não pode ser desfeita.</>}
          textoConfirmar="Remover"
          textoProcessando="Removendo…"
          perigo
          processando={processandoRem}
          erro={erroRem}
          aoConfirmar={confirmarRemover}
          aoCancelar={() => setRemovendo(null)}
        />
      )}
    </section>
  );
}
