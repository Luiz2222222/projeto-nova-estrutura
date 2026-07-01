import { useEffect, useState } from 'react';
import { apiGet, apiPut, type ErroApi } from '../../api';
import { MARCOS_CALENDARIO, ROTULO_MARCO, DESC_MARCO, type MarcoCalendario } from '@tcc/compartilhado';

function paraInput(valor: string | null | undefined): string {
  if (!valor) return '';
  return new Date(valor).toISOString().slice(0, 10);
}

// Seção do Planejamento: período/semestre ATIVO (manual) + calendário desse período.
export function SecaoCalendario() {
  const [datas, setDatas] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState('');

  // Período ativo definido manualmente pela coordenação (o sistema não troca sozinho pela data).
  const [periodoAtivo, setPeriodoAtivo] = useState<string>('');
  const [periodo, setPeriodo] = useState<string>('');
  const [salvandoPeriodo, setSalvandoPeriodo] = useState(false);
  const [msgPeriodo, setMsgPeriodo] = useState('');

  function carregarCalendario() {
    apiGet('/calendario')
      .then((cal: any) => {
        const d: Record<string, string> = {};
        for (const m of MARCOS_CALENDARIO) d[m] = cal ? paraInput(cal[m]) : '';
        setDatas(d);
      })
      .catch(() => {});
  }

  useEffect(() => {
    apiGet('/semestre-ativo')
      .then((r: any) => {
        setPeriodoAtivo(r?.semestre ?? '');
        setPeriodo(r?.semestre ?? '');
      })
      .catch(() => {});
    carregarCalendario();
  }, []);

  function mudar(marco: MarcoCalendario, valor: string) {
    setDatas((d) => ({ ...d, [marco]: valor }));
  }

  async function salvarPeriodo() {
    setSalvandoPeriodo(true);
    setMsgPeriodo('');
    try {
      const r: any = await apiPut('/semestre-ativo', { semestre: periodo.trim() });
      setPeriodoAtivo(r?.semestre ?? periodo.trim());
      setPeriodo(r?.semestre ?? periodo.trim());
      setMsgPeriodo(`Período ativo definido: ${r?.semestre ?? periodo.trim()}.`);
      carregarCalendario(); // o calendário é por período — recarrega o do período ativo
    } catch (e) {
      const er = e as ErroApi;
      setMsgPeriodo(er.erros?.[0]?.mensagem || er.mensagem || 'Não foi possível definir o período.');
    } finally {
      setSalvandoPeriodo(false);
    }
  }

  async function salvar() {
    setSalvando(true);
    setMensagem('');
    try {
      const corpo: Record<string, string | null> = {};
      for (const m of MARCOS_CALENDARIO) corpo[m] = datas[m] || null;
      await apiPut('/calendario', corpo);
      setMensagem('Calendário salvo com sucesso.');
    } catch (e) {
      setMensagem((e as ErroApi).mensagem || 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <section className="cartao-secao bloco">
      {/* Título à esquerda; à direita, o período ativo (campo + botão) alinhado ao título. */}
      <div className="cabecalho-secao" style={{ alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Calendário do período</h2>
        <div className="acoes" style={{ margin: 0, alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--tinta-2)' }}>Período:</span>
          <input
            type="text"
            value={periodo}
            placeholder="2026.1"
            maxLength={7}
            onChange={(e) => setPeriodo(e.target.value)}
            style={{ width: 110 }}
          />
          <button className="botao" disabled={salvandoPeriodo || !periodo.trim() || periodo.trim() === periodoAtivo} onClick={salvarPeriodo}>
            {salvandoPeriodo ? 'Definindo…' : 'Definir'}
          </button>
        </div>
      </div>
      <p className="legenda" style={{ marginTop: 8, marginBottom: 4 }}>
        O <strong>período ativo</strong> (formato AAAA.1 / AAAA.2) é definido manualmente e usado para listar TCCs,
        calendário, exportações e pesos. O sistema não troca de período sozinho pela data, e mudar aqui
        <strong> não altera</strong> o semestre de TCCs já existentes.
      </p>
      {msgPeriodo && <p className="nota-vazio" style={{ marginTop: 0 }}>{msgPeriodo}</p>}
      <p className="legenda" style={{ marginBottom: 18 }}>
        Defina as datas-marco do período. Elas aparecem na aba “Informações” dos alunos.
      </p>
      <div className="calendario-grid">
        {MARCOS_CALENDARIO.map((m) => (
          <label key={m} className="campo">
            <span>{ROTULO_MARCO[m]}</span>
            <input type="date" value={datas[m] ?? ''} onChange={(e) => mudar(m, e.target.value)} />
            <small className="muted">{DESC_MARCO[m]}</small>
          </label>
        ))}
      </div>
      <div className="acoes">
        {mensagem && <span className="nota-vazio" style={{ margin: 0, alignSelf: 'center' }}>{mensagem}</span>}
        <button className="botao" disabled={salvando} onClick={salvar}>
          {salvando ? 'Salvando…' : 'Salvar calendário'}
        </button>
      </div>
    </section>
  );
}
