// Edição administrativa de uma avaliação de membro da banca (coordenador).
// Notas por critério (com máscara/clamp pelo peso), comentários por critério,
// parecer geral e status. ENVIADO/BLOQUEADO/CONCLUIDO exigem todas as notas.
import { useState } from 'react';
import { apiPut, type ErroApi } from '../api';
import { CRITERIOS_FASE1, CRITERIOS_FASE2, colunaNota, type Criterio } from '@tcc/compartilhado';
import { Modal } from './Modal';
import { clampScore, construirParecer, extrairSecao, fmtNum, numToStr, parseBR, pesoDe } from '../utils/avaliacao';

const STATUS_OPCOES = [
  { v: 'PENDENTE', r: 'Pendente (rascunho — aceita parcial)' },
  { v: 'ENVIADO', r: 'Enviado' },
  { v: 'BLOQUEADO', r: 'Bloqueado' },
  { v: 'CONCLUIDO', r: 'Concluído' },
];

export function ModalEditarAvaliacao({ membro, fase, pesos, aoFechar, aoSalvo }: { membro: any; fase: string; pesos: any; aoFechar: () => void; aoSalvo: () => void }) {
  const ehF2 = fase === 'FASE_2';
  const criterios: Criterio[] = ehF2 ? CRITERIOS_FASE2 : CRITERIOS_FASE1;

  const [notas, setNotas] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    for (const c of criterios) o[c.chave] = numToStr(membro[colunaNota(c.chave)]);
    return o;
  });
  const [comentarios, setComentarios] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    for (const c of criterios) o[c.chave] = extrairSecao(membro.parecer ?? '', c.rotulo);
    return o;
  });
  const [parecerGeral, setParecerGeral] = useState(extrairSecao(membro.parecer ?? '', 'Parecer geral'));
  const [status, setStatus] = useState(membro.status ?? 'PENDENTE');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  const total = (() => {
    let s = 0;
    for (const c of criterios) {
      const n = parseBR(notas[c.chave] ?? '');
      if (n == null) return null;
      s += n;
    }
    return s;
  })();

  async function salvar() {
    setErro('');
    const exigeCompleto = status === 'ENVIADO' || status === 'BLOQUEADO' || status === 'CONCLUIDO';
    const corpo: Record<string, number> = {};
    for (const c of criterios) {
      const n = parseBR(notas[c.chave] ?? '');
      if (n == null) {
        if (exigeCompleto) return setErro(`Para o status "${status}", preencha a nota de "${c.rotulo}".`);
        continue;
      }
      if (n < 0 || n > pesoDe(c, pesos)) return setErro(`A nota de "${c.rotulo}" deve estar entre 0 e ${fmtNum(pesoDe(c, pesos))}.`);
      corpo[c.chave] = n;
    }
    setSalvando(true);
    try {
      await apiPut(`/bancas/membros/${membro.id}/avaliacao`, {
        notas: corpo,
        parecer: construirParecer(criterios, comentarios, parecerGeral) || undefined,
        status,
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

  const numCor = ehF2 ? 'var(--roxo)' : 'var(--azul-forte)';

  return (
    <Modal titulo="Editar avaliação" subtitulo={`${membro.avaliador?.tratamento ? membro.avaliador.tratamento + ' ' : ''}${membro.avaliador?.nomeCompleto ?? ''} · ${ehF2 ? 'Fase II' : 'Fase I'}`} aoFechar={() => !salvando && aoFechar()}>
      {erro && <div className="erro-geral">{erro}</div>}

      <label className="campo">
        <span>Status</span>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUS_OPCOES.map((s) => <option key={s.v} value={s.v}>{s.r}</option>)}
        </select>
      </label>

      <div className="criterios-lista" style={{ marginTop: 14 }}>
        {criterios.map((c, i) => (
          <div key={c.chave} className="criterio-card">
            <span className="criterio-num" style={{ background: numCor }}>{i + 1}</span>
            <div className="criterio-corpo">
              <div className="criterio-cabecalho">
                <span className="criterio-titulo">{c.rotulo}</span>
                <span className="criterio-nota">
                  <input inputMode="decimal" value={notas[c.chave] ?? ''} disabled={salvando}
                    onChange={(e) => setNotas((v) => ({ ...v, [c.chave]: clampScore(e.target.value, pesoDe(c, pesos), v[c.chave] ?? '') }))}
                    placeholder="–" />
                  <span className="criterio-peso">/ {fmtNum(Number(pesoDe(c, pesos).toFixed(1)))}</span>
                </span>
              </div>
              <p className="criterio-desc">{c.descricao}</p>
              <textarea rows={2} className="criterio-comentario" value={comentarios[c.chave] ?? ''} disabled={salvando}
                onChange={(e) => setComentarios((v) => ({ ...v, [c.chave]: e.target.value }))} placeholder="Comentário do critério…" />
            </div>
          </div>
        ))}
      </div>

      <label className="campo" style={{ marginTop: 14 }}>
        <span>Parecer geral</span>
        <textarea rows={3} value={parecerGeral} disabled={salvando} onChange={(e) => setParecerGeral(e.target.value)} placeholder="Comentários gerais…" />
      </label>

      <div className="nota-total-box">
        <span>Nota total{ehF2 ? ' (NF2)' : ' (NF1)'}:</span>
        <strong>{total != null ? fmtNum(Number(total.toFixed(2))) : '—'}</strong>
        <span className="nota-total-max">/ 10,0</span>
      </div>

      <div className="acoes">
        <button className="botao botao-secundario" disabled={salvando} onClick={aoFechar}>Cancelar</button>
        <button className="botao" disabled={salvando} onClick={salvar}>{salvando ? 'Salvando…' : 'Salvar avaliação'}</button>
      </div>
    </Modal>
  );
}
