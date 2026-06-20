// Troca administrativa dos 2 avaliadores da banca da Fase I (coordenador).
// A Fase II (se existir) é sincronizada no backend: orientador + estes 2 avaliadores.
import { useEffect, useState } from 'react';
import { apiGet, apiPut, type ErroApi } from '../api';
import { Modal } from './Modal';

const rotuloCandidato = (c: any) =>
  `${c.tratamento ? c.tratamento + ' ' : ''}${c.nomeCompleto}${c.papel === 'AVALIADOR' ? ` (Externo${c.afiliacao ? ' · ' + c.afiliacao : ''})` : ' (Professor)'}`;

export function ModalTrocarAvaliadores({ tccId, membrosFase1, aoFechar, aoSalvo }: { tccId: string; membrosFase1: any[]; aoFechar: () => void; aoSalvo: () => void }) {
  const [candidatos, setCandidatos] = useState<any[]>([]);
  const [avaliador1, setAvaliador1] = useState(membrosFase1?.[0]?.avaliadorId ?? '');
  const [avaliador2, setAvaliador2] = useState(membrosFase1?.[1]?.avaliadorId ?? '');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    apiGet(`/tccs/${tccId}/banca/candidatos`).then((r: any) => setCandidatos(r ?? [])).catch(() => setCandidatos([]));
  }, [tccId]);

  async function salvar() {
    setErro('');
    if (!avaliador1 || !avaliador2) return setErro('Escolha os dois avaliadores.');
    if (avaliador1 === avaliador2) return setErro('Os dois avaliadores devem ser pessoas diferentes.');
    setSalvando(true);
    try {
      await apiPut(`/tccs/${tccId}/banca/avaliadores`, { avaliadorIds: [avaliador1, avaliador2] });
      aoSalvo();
      aoFechar();
    } catch (e) {
      const er = e as ErroApi;
      setErro(er.erros?.[0]?.mensagem || er.mensagem || 'Não foi possível trocar os avaliadores.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal titulo="Editar avaliadores da Fase I" subtitulo="A banca da Fase II é sincronizada automaticamente (orientador + estes 2 avaliadores)." aoFechar={() => !salvando && aoFechar()}>
      {erro && <div className="erro-geral">{erro}</div>}
      <div className="alerta" style={{ background: 'rgba(245,158,11,.12)', color: '#b45309', marginBottom: 14 }}>
        ⚠ Trocar um avaliador <strong>descarta a avaliação dele</strong>; o novo entra como pendente. Quem continuar mantém os dados.
      </div>
      <div className="grade-2">
        <label className="campo">
          <span>Avaliador 1</span>
          <select value={avaliador1} onChange={(e) => setAvaliador1(e.target.value)}>
            <option value="">Selecione…</option>
            {candidatos.filter((c) => c.id !== avaliador2).map((c) => <option key={c.id} value={c.id}>{rotuloCandidato(c)}</option>)}
          </select>
        </label>
        <label className="campo">
          <span>Avaliador 2</span>
          <select value={avaliador2} onChange={(e) => setAvaliador2(e.target.value)}>
            <option value="">Selecione…</option>
            {candidatos.filter((c) => c.id !== avaliador1).map((c) => <option key={c.id} value={c.id}>{rotuloCandidato(c)}</option>)}
          </select>
        </label>
      </div>
      <div className="acoes">
        <button className="botao botao-secundario" disabled={salvando} onClick={aoFechar}>Cancelar</button>
        <button className="botao" disabled={salvando || !avaliador1 || !avaliador2 || avaliador1 === avaliador2} onClick={salvar}>{salvando ? 'Salvando…' : 'Salvar avaliadores'}</button>
      </div>
    </Modal>
  );
}
