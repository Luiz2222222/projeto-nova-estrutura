// Aba "Documentos" do modal único de edição do TCC (coordenador).
// Lista os documentos do TCC e edita metadados inline (PUT /tccs/documentos/:id).
import { useState } from 'react';
import { apiPut, URL_API, type ErroApi } from '../api';

const TIPOS = ['PLANO_DESENVOLVIMENTO', 'TERMO_ACEITE', 'MONOGRAFIA', 'VERSAO_FINAL', 'AVALIACAO_BANCA'];
const ROTULO_TIPO: Record<string, string> = {
  PLANO_DESENVOLVIMENTO: 'Plano de desenvolvimento',
  TERMO_ACEITE: 'Termo de aceite',
  MONOGRAFIA: 'Monografia',
  VERSAO_FINAL: 'Versão final',
  AVALIACAO_BANCA: 'Documento para avaliação (banca)',
};
const STATUS = ['PENDENTE', 'EM_ANALISE', 'APROVADO', 'REJEITADO', 'SUBSTITUIDA'];

const ic = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {d.split('|').map((p, i) => <path key={i} d={p} />)}
  </svg>
);
const icoOlho = ic('M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z|M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0');
const icoBaixar = ic('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4|M7 10l5 5 5-5|M12 15V3');
const icoLapis = ic('M12 20h9|M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z');

function FormDoc({ doc, aoSalvo, aoFechar }: { doc: any; aoSalvo: () => void; aoFechar: () => void }) {
  const [tipo, setTipo] = useState(doc.tipo ?? '');
  const [status, setStatus] = useState(doc.status ?? '');
  const [versao, setVersao] = useState(String(doc.versao ?? 1));
  const [nomeArquivo, setNomeArquivo] = useState(doc.nomeArquivo ?? '');
  const [parecer, setParecer] = useState(doc.parecer ?? '');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setErro('');
    const v = parseInt(versao, 10);
    if (!Number.isInteger(v) || v < 1) return setErro('Versão deve ser um número inteiro ≥ 1.');
    if (!nomeArquivo.trim()) return setErro('Informe o nome do arquivo.');
    setSalvando(true);
    try {
      await apiPut(`/tccs/documentos/${doc.id}`, { tipo, status, versao: v, nomeArquivo: nomeArquivo.trim(), parecer: parecer.trim() || null });
      aoSalvo();
      aoFechar();
    } catch (e) {
      const er = e as ErroApi;
      setErro(er.erros?.[0]?.mensagem || er.mensagem || 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="doc-edit">
      {erro && <div className="erro-geral">{erro}</div>}
      <div className="grade-2">
        <label className="campo"><span>Tipo</span>
          <select value={tipo} onChange={(e) => setTipo(e.target.value)}>{TIPOS.map((t) => <option key={t} value={t}>{ROTULO_TIPO[t] ?? t}</option>)}</select>
        </label>
        <label className="campo"><span>Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>{STATUS.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        </label>
        <label className="campo"><span>Versão</span><input inputMode="numeric" value={versao} onChange={(e) => setVersao(e.target.value)} /></label>
        <label className="campo"><span>Nome do arquivo</span><input value={nomeArquivo} onChange={(e) => setNomeArquivo(e.target.value)} /></label>
      </div>
      <label className="campo" style={{ marginTop: 10 }}><span>Parecer / devolutiva</span><textarea rows={2} value={parecer} onChange={(e) => setParecer(e.target.value)} /></label>
      <div className="acoes" style={{ justifyContent: 'flex-end' }}>
        <button className="botao botao-secundario" disabled={salvando} onClick={aoFechar}>Cancelar</button>
        <button className="botao" disabled={salvando} onClick={salvar}>{salvando ? 'Salvando…' : 'Salvar documento'}</button>
      </div>
    </div>
  );
}

export function PainelDocumentosTcc({ tcc, aoSalvo }: { tcc: any; aoSalvo: () => void }) {
  const [editando, setEditando] = useState<string | null>(null);
  const docs: any[] = tcc.documentos ?? [];

  return (
    <>
      <h3 className="titulo-bloco">Documentos do TCC</h3>
      {docs.length === 0 ? (
        <p className="nota-vazio">Nenhum documento enviado.</p>
      ) : (
        docs.map((d) => (
          <div key={d.id} className="doc-bloco">
            <div className="item-arquivo">
              <div className="item-arquivo-info">
                <span className="nome">{ROTULO_TIPO[d.tipo] ?? d.tipo}</span>
                <span className="meta">{d.nomeArquivo} · v{d.versao} · {d.status}</span>
              </div>
              <span className="acoes-doc">
                <button className="botao-icone" title="Editar" onClick={() => setEditando(editando === d.id ? null : d.id)}>{icoLapis}</button>
                <a className="botao-icone" title="Visualizar" href={`${URL_API}/tccs/documentos/${d.id}/visualizar`} target="_blank" rel="noreferrer">{icoOlho}</a>
                <a className="botao-icone" title="Baixar" href={`${URL_API}/tccs/documentos/${d.id}/baixar`} target="_blank" rel="noreferrer">{icoBaixar}</a>
              </span>
            </div>
            {editando === d.id && <FormDoc doc={d} aoSalvo={aoSalvo} aoFechar={() => setEditando(null)} />}
          </div>
        ))
      )}
    </>
  );
}
