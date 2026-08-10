// Correção administrativa de FLUXO (coordenador): muda a fase do TCC por uma ação
// controlada em duas etapas — primeiro o backend devolve a lista de impactos (nada é
// gravado), depois o coordenador confirma e a correção é aplicada numa transação.
// Substitui o antigo select "Fase atual" da edição genérica, que só trocava o texto da
// fase e deixava banca/notas/defesa contraditórias.
import { useState } from 'react';
import { apiPost, type ErroApi } from '../api';
import { FASES, ROTULO_FASE } from '@tcc/compartilhado';
import { Modal } from './Modal';

export function ModalCorrigirFase({ tcc, aoFechar, aoSalvo }: { tcc: any; aoFechar: () => void; aoSalvo: () => void }) {
  const [fase, setFase] = useState<string>(tcc.faseAtual ?? '');
  const [impactos, setImpactos] = useState<string[] | null>(null);
  const [erro, setErro] = useState('');
  const [processando, setProcessando] = useState(false);

  async function chamar(confirmar: boolean) {
    setErro('');
    setProcessando(true);
    try {
      const r = await apiPost<{ aplicado: boolean; impactos: string[] }>(`/tccs/${tcc.id}/corrigir-fase`, { fase, confirmar });
      if (r.aplicado) {
        aoSalvo();
        aoFechar();
        return;
      }
      setImpactos(r.impactos ?? []);
    } catch (e) {
      const er = e as ErroApi;
      setErro(er.erros?.[0]?.mensagem || er.mensagem || 'Não foi possível corrigir a fase.');
      setImpactos(null);
    } finally {
      setProcessando(false);
    }
  }

  const mesmaFase = fase === tcc.faseAtual;

  return (
    <Modal titulo="Correção de fluxo" subtitulo={`TCC: ${tcc.titulo}`} aoFechar={aoFechar}>
      <p className="legenda" style={{ marginBottom: 12 }}>
        Ação excepcional da coordenação: muda a fase e limpa/reinicializa os dados que deixarem
        de valer (notas apuradas, defesa, avaliações), sempre mostrando o impacto antes de aplicar.
      </p>
      {erro && <div className="erro-geral">{erro}</div>}

      <label className="campo">
        <span>Fase atual: <strong>{ROTULO_FASE[tcc.faseAtual] ?? tcc.faseAtual}</strong></span>
      </label>
      <label className="campo">
        <span>Nova fase</span>
        <select value={fase} onChange={(e) => { setFase(e.target.value); setImpactos(null); setErro(''); }}>
          {FASES.map((f) => <option key={f} value={f}>{ROTULO_FASE[f] ?? f}</option>)}
        </select>
      </label>

      {impactos && (
        <div className="alerta" style={{ marginTop: 12 }}>
          <strong>Impacto desta correção:</strong>
          <ul style={{ margin: '8px 0 0 18px' }}>
            {impactos.map((i, n) => <li key={n}>{i}</li>)}
          </ul>
        </div>
      )}

      <div className="acoes">
        <button className="botao botao-secundario" onClick={aoFechar}>Cancelar</button>
        {!impactos ? (
          <button className="botao" disabled={processando || mesmaFase} onClick={() => chamar(false)}>
            {processando ? 'Verificando…' : 'Ver impacto'}
          </button>
        ) : (
          <button className="botao botao-perigo" disabled={processando} onClick={() => chamar(true)}>
            {processando ? 'Aplicando…' : 'Confirmar correção'}
          </button>
        )}
      </div>
    </Modal>
  );
}
