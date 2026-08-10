// Seção "Documentos" do modal único de edição do TCC (coordenador).
// Lista os documentos e permite: editar metadados (SEM trocar o tipo), substituir o
// arquivo (cria nova versão; o antigo vira SUBSTITUIDA) e adicionar um documento novo.
// Uploads aceitam só PDF e usam o padrão seguro de gravação do backend.
import { useState } from 'react';
import { apiPut, apiUpload, URL_API, type ErroApi } from '../api';
import { formatoDoTipoDoc, arquivoPermitidoParaTipo } from '@tcc/compartilhado';
import { ModalConfirmacao } from './ModalConfirmacao';

// AVALIACAO_BANCA fica FORA do upload avulso: esse tipo só nasce pelo fluxo da banca
// (formar banca / substituir o arquivo do documento vinculado) — o backend também rejeita.
const TIPOS = ['PLANO_DESENVOLVIMENTO', 'TERMO_ACEITE', 'MONOGRAFIA', 'VERSAO_FINAL'];
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
const icoTrocar = ic('M21 2v6h-6|M3 12a9 9 0 0 1 15-6.7L21 8|M3 22v-6h6|M21 12a9 9 0 0 1-15 6.7L3 16');
// Plus pequeno (tamanho fixo) para o botão compacto "Adicionar documento".
const icoMais = (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5v14" /><path d="M5 12h14" />
  </svg>
);

function msgErro(e: unknown, padrao: string) {
  const er = e as ErroApi;
  return er.erros?.[0]?.mensagem || er.mensagem || padrao;
}

// Edição de metadados (sem trocar o tipo do documento existente).
function FormMeta({ doc, aoSalvo, aoFechar }: { doc: any; aoSalvo: () => void; aoFechar: () => void }) {
  const [status, setStatus] = useState(doc.status ?? 'PENDENTE');
  const [nomeArquivo, setNomeArquivo] = useState(doc.nomeArquivo ?? '');
  const [parecer, setParecer] = useState(doc.parecer ?? '');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setErro('');
    if (!nomeArquivo.trim()) return setErro('Informe o nome exibido do arquivo.');
    setSalvando(true);
    try {
      await apiPut(`/tccs/documentos/${doc.id}`, { status, nomeArquivo: nomeArquivo.trim(), parecer: parecer.trim() || null });
      aoSalvo();
      aoFechar();
    } catch (e) {
      setErro(msgErro(e, 'Não foi possível salvar.'));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="doc-edit">
      {erro && <div className="erro-geral">{erro}</div>}
      <p className="legenda" style={{ marginTop: 0 }}>Tipo: <strong>{ROTULO_TIPO[doc.tipo] ?? doc.tipo}</strong> (não editável). Para mudar o arquivo, use “Substituir arquivo”.</p>
      <div className="grade-2">
        <label className="campo"><span>Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>{STATUS.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        </label>
        <label className="campo"><span>Nome exibido</span><input value={nomeArquivo} onChange={(e) => setNomeArquivo(e.target.value)} /></label>
      </div>
      <label className="campo" style={{ marginTop: 10 }}><span>Parecer / devolutiva</span><textarea rows={2} value={parecer} onChange={(e) => setParecer(e.target.value)} /></label>
      <div className="acoes" style={{ justifyContent: 'flex-end' }}>
        <button className="botao botao-secundario" disabled={salvando} onClick={aoFechar}>Cancelar</button>
        <button className="botao" disabled={salvando} onClick={salvar}>{salvando ? 'Salvando…' : 'Salvar documento'}</button>
      </div>
    </div>
  );
}

// Substituição do arquivo de um documento existente (mesmo tipo; cria nova versão).
function FormSubstituir({ doc, aoSalvo, aoFechar }: { doc: any; aoSalvo: () => void; aoFechar: () => void }) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [status, setStatus] = useState(doc.status ?? 'PENDENTE');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);

  // Valida e abre a confirmação (troca de documento oficial não deve executar direto).
  function pedirConfirmacao() {
    setErro('');
    if (!arquivo) return setErro('Escolha o novo arquivo.');
    if (!arquivoPermitidoParaTipo(doc.tipo, arquivo.name)) return setErro(`Para este documento, envie ${formatoDoTipoDoc(doc.tipo).rotulo}.`);
    setConfirmando(true);
  }

  async function substituir() {
    if (!arquivo) return;
    setErro('');
    setSalvando(true);
    try {
      const form = new FormData();
      form.append('arquivo', arquivo);
      form.append('status', status);
      await apiUpload(`/tccs/documentos/${doc.id}/substituir`, form);
      setConfirmando(false);
      aoSalvo();
      aoFechar();
    } catch (e) {
      setErro(msgErro(e, 'Não foi possível substituir o arquivo.'));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="doc-edit">
      {erro && !confirmando && <div className="erro-geral">{erro}</div>}
      <p className="legenda" style={{ marginTop: 0 }}>O arquivo atual vira <strong>SUBSTITUIDA</strong> e o novo passa a ser a versão mais recente de <strong>{ROTULO_TIPO[doc.tipo] ?? doc.tipo}</strong>.</p>
      <div className="grade-2">
        <label className="campo"><span>Novo arquivo ({formatoDoTipoDoc(doc.tipo).accept.replace(/,/g, ', ')})</span><input type="file" accept={formatoDoTipoDoc(doc.tipo).accept} onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} /></label>
        <label className="campo"><span>Status do novo</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>{STATUS.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        </label>
      </div>
      <div className="acoes" style={{ justifyContent: 'flex-end' }}>
        <button className="botao botao-secundario" disabled={salvando} onClick={aoFechar}>Cancelar</button>
        <button className="botao" disabled={salvando || !arquivo} onClick={pedirConfirmacao}>{salvando ? 'Enviando…' : 'Substituir arquivo'}</button>
      </div>

      {confirmando && (
        <ModalConfirmacao
          titulo="Substituir documento oficial"
          mensagem={<>Isso substitui o arquivo oficial de <strong>{ROTULO_TIPO[doc.tipo] ?? doc.tipo}</strong>: a versão atual passa a ser <strong>SUBSTITUIDA</strong> e o novo arquivo vira a versão mais recente. Deseja continuar?</>}
          textoConfirmar="Substituir arquivo"
          textoProcessando="Enviando…"
          perigo
          processando={salvando}
          erro={erro}
          aoConfirmar={substituir}
          aoCancelar={() => setConfirmando(false)}
        />
      )}
    </div>
  );
}

// Adição de um documento novo ao TCC (aqui o tipo PODE ser escolhido).
function FormAdicionar({ tccId, aoSalvo, aoFechar }: { tccId: string; aoSalvo: () => void; aoFechar: () => void }) {
  const [tipo, setTipo] = useState(TIPOS[0]);
  const [status, setStatus] = useState('PENDENTE');
  const [parecer, setParecer] = useState('');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setErro('');
    if (!arquivo) return setErro('Escolha o arquivo.');
    if (!arquivoPermitidoParaTipo(tipo, arquivo.name)) return setErro(`Para este tipo, envie ${formatoDoTipoDoc(tipo).rotulo}.`);
    setSalvando(true);
    try {
      const form = new FormData();
      form.append('arquivo', arquivo);
      form.append('tipo', tipo);
      form.append('status', status);
      if (parecer.trim()) form.append('parecer', parecer.trim());
      await apiUpload(`/tccs/${tccId}/documentos/admin`, form);
      aoSalvo();
      aoFechar();
    } catch (e) {
      setErro(msgErro(e, 'Não foi possível adicionar o documento.'));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="doc-edit">
      {erro && <div className="erro-geral">{erro}</div>}
      <p className="legenda" style={{ marginTop: 0 }}>A versão é automática (próxima daquele tipo no TCC). Formato: {formatoDoTipoDoc(tipo).rotulo}.</p>
      <div className="grade-2">
        <label className="campo"><span>Tipo</span>
          <select value={tipo} onChange={(e) => setTipo(e.target.value)}>{TIPOS.map((t) => <option key={t} value={t}>{ROTULO_TIPO[t] ?? t}</option>)}</select>
        </label>
        <label className="campo"><span>Status inicial</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>{STATUS.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        </label>
        <label className="campo"><span>Arquivo ({formatoDoTipoDoc(tipo).accept.replace(/,/g, ', ')})</span><input type="file" accept={formatoDoTipoDoc(tipo).accept} onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} /></label>
      </div>
      <label className="campo" style={{ marginTop: 10 }}><span>Parecer / devolutiva (opcional)</span><textarea rows={2} value={parecer} onChange={(e) => setParecer(e.target.value)} /></label>
      <div className="acoes" style={{ justifyContent: 'flex-end' }}>
        <button className="botao botao-secundario" disabled={salvando} onClick={aoFechar}>Cancelar</button>
        <button className="botao" disabled={salvando || !arquivo} onClick={salvar}>{salvando ? 'Enviando…' : 'Adicionar documento'}</button>
      </div>
    </div>
  );
}

export function PainelDocumentosTcc({ tcc, aoSalvo }: { tcc: any; aoSalvo: () => void }) {
  const [editando, setEditando] = useState<string | null>(null);
  const [substituindo, setSubstituindo] = useState<string | null>(null);
  const [adicionando, setAdicionando] = useState(false);
  const docs: any[] = tcc.documentos ?? [];

  // Abre uma ação por documento de cada vez (editar metadados OU substituir arquivo).
  const abrirEdicao = (id: string) => { setSubstituindo(null); setEditando(editando === id ? null : id); };
  const abrirSubstituir = (id: string) => { setEditando(null); setSubstituindo(substituindo === id ? null : id); };

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
                <button className="botao-icone" title="Editar metadados" onClick={() => abrirEdicao(d.id)}>{icoLapis}</button>
                <button className="botao-icone" title="Substituir arquivo" onClick={() => abrirSubstituir(d.id)}>{icoTrocar}</button>
                <a className="botao-icone" title="Visualizar" href={`${URL_API}/tccs/documentos/${d.id}/visualizar`} target="_blank" rel="noreferrer">{icoOlho}</a>
                <a className="botao-icone" title="Baixar" href={`${URL_API}/tccs/documentos/${d.id}/baixar`} target="_blank" rel="noreferrer">{icoBaixar}</a>
              </span>
            </div>
            {editando === d.id && <FormMeta doc={d} aoSalvo={aoSalvo} aoFechar={() => setEditando(null)} />}
            {substituindo === d.id && <FormSubstituir doc={d} aoSalvo={aoSalvo} aoFechar={() => setSubstituindo(null)} />}
          </div>
        ))
      )}

      <div className="doc-add">
        <button className="botao botao-secundario doc-add-btn" onClick={() => setAdicionando((v) => !v)}>
          {icoMais} {adicionando ? 'Fechar' : 'Adicionar documento'}
        </button>
        {adicionando && <FormAdicionar tccId={tcc.id} aoSalvo={aoSalvo} aoFechar={() => setAdicionando(false)} />}
      </div>
    </>
  );
}
