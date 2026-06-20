// Edição de metadados de um documento do TCC pelo coordenador (PUT /tccs/documentos/:id).
// Não troca o arquivo em si — só tipo, status, versão, parecer e nome exibido.
import { useState } from 'react';
import { apiPut, type ErroApi } from '../api';
import { Modal } from './Modal';

const TIPOS = ['PLANO_DESENVOLVIMENTO', 'TERMO_ACEITE', 'MONOGRAFIA', 'VERSAO_FINAL', 'AVALIACAO_BANCA'];
const ROTULO_TIPO: Record<string, string> = {
  PLANO_DESENVOLVIMENTO: 'Plano de desenvolvimento',
  TERMO_ACEITE: 'Termo de aceite',
  MONOGRAFIA: 'Monografia',
  VERSAO_FINAL: 'Versão final',
  AVALIACAO_BANCA: 'Documento para avaliação (banca)',
};
const STATUS = ['PENDENTE', 'EM_ANALISE', 'APROVADO', 'REJEITADO', 'SUBSTITUIDA'];

export function ModalEditarDocumento({ doc, aoFechar, aoSalvo }: { doc: any; aoFechar: () => void; aoSalvo: () => void }) {
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
      await apiPut(`/tccs/documentos/${doc.id}`, {
        tipo,
        status,
        versao: v,
        nomeArquivo: nomeArquivo.trim(),
        parecer: parecer.trim() || null,
      });
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
    <Modal titulo="Editar documento" subtitulo={doc.nomeArquivo} aoFechar={() => !salvando && aoFechar()}>
      {erro && <div className="erro-geral">{erro}</div>}
      <p className="legenda" style={{ marginTop: 0 }}>Edita apenas os dados do documento (o arquivo enviado não é trocado).</p>
      <div className="grade-2">
        <label className="campo">
          <span>Tipo</span>
          <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
            {TIPOS.map((t) => <option key={t} value={t}>{ROTULO_TIPO[t] ?? t}</option>)}
          </select>
        </label>
        <label className="campo">
          <span>Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="campo"><span>Versão</span><input inputMode="numeric" value={versao} onChange={(e) => setVersao(e.target.value)} /></label>
        <label className="campo"><span>Nome do arquivo</span><input value={nomeArquivo} onChange={(e) => setNomeArquivo(e.target.value)} /></label>
      </div>
      <label className="campo" style={{ marginTop: 12 }}><span>Parecer / devolutiva</span><textarea rows={3} value={parecer} onChange={(e) => setParecer(e.target.value)} /></label>
      <div className="acoes">
        <button className="botao botao-secundario" disabled={salvando} onClick={aoFechar}>Cancelar</button>
        <button className="botao" disabled={salvando} onClick={salvar}>{salvando ? 'Salvando…' : 'Salvar alterações'}</button>
      </div>
    </Modal>
  );
}
