// Agendar/editar a DEFESA (Fase II) — usado pela COORDENAÇÃO no detalhe interno do TCC.
// Mesmo endpoint e mesmas validações do agendamento pelo orientador (PUT /tccs/:id/defesa):
// horário interpretado no fuso de Fortaleza, qualquer data vale (passada libera a avaliação
// na hora) e a liberação da Fase II continua 100% automática — não há botão de "liberar".
import { useState } from 'react';
import { apiPut, type ErroApi } from '../api';
import { partesDefesaFortaleza, montarInstanteDefesa } from '../utils/defesa';
import { Modal } from './Modal';

export function ModalAgendarDefesa({ tcc, aoFechar, aoSalvo }: { tcc: any; aoFechar: () => void; aoSalvo: () => void }) {
  const inicial = tcc?.defesaAgendadaPara ? partesDefesaFortaleza(tcc.defesaAgendadaPara) : null;
  const [data, setData] = useState(inicial?.data ?? '');
  const [hora, setHora] = useState(inicial?.hora ?? '');
  const [local, setLocal] = useState(tcc?.defesaLocal ?? '');
  const [comentario, setComentario] = useState(tcc?.defesaComentario ?? '');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function salvar() {
    if (!data || !hora) { setErro('Informe a data e a hora da defesa.'); return; }
    if (!local.trim()) { setErro('Informe o local da defesa.'); return; }
    const quando = montarInstanteDefesa(data, hora);
    if (Number.isNaN(quando.getTime())) { setErro('Data e hora inválidas.'); return; }
    setErro('');
    setEnviando(true);
    try {
      await apiPut(`/tccs/${tcc.id}/defesa`, {
        dataHora: quando.toISOString(),
        local: local.trim(),
        comentario: comentario.trim() || undefined,
      });
      aoSalvo();
      aoFechar();
    } catch (e) {
      const er = e as ErroApi;
      setErro(er.erros?.[0]?.mensagem || er.mensagem || 'Não foi possível salvar o agendamento.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal titulo={tcc?.defesaAgendadaPara ? 'Editar agendamento da defesa' : 'Agendar defesa'} subtitulo={`TCC: ${tcc.titulo}`} aoFechar={aoFechar}>
      {erro && <div className="erro-geral">{erro}</div>}
      <p className="legenda" style={{ marginBottom: 12 }}>
        Horário no fuso de Fortaleza. A avaliação da banca abre automaticamente no horário
        marcado (datas já passadas liberam na hora). Reagendar avisa todos os envolvidos.
      </p>
      <div className="grade-2">
        <label className="campo"><span>Data</span><input type="date" value={data} onChange={(e) => setData(e.target.value)} /></label>
        <label className="campo"><span>Hora</span><input type="time" value={hora} onChange={(e) => setHora(e.target.value)} /></label>
      </div>
      <label className="campo"><span>Local (sala ou link HTTPS)</span><input value={local} onChange={(e) => setLocal(e.target.value)} placeholder="Auditório do DEE ou https://…" /></label>
      <label className="campo"><span>Comentário (opcional)</span><textarea rows={2} value={comentario} onChange={(e) => setComentario(e.target.value)} /></label>
      <div className="acoes">
        <button className="botao botao-secundario" disabled={enviando} onClick={aoFechar}>Cancelar</button>
        <button className="botao" disabled={enviando} onClick={salvar}>{enviando ? 'Salvando…' : 'Salvar agendamento'}</button>
      </div>
    </Modal>
  );
}
